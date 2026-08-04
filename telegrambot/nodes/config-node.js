// Created by Karl-Heinz Wind
'use strict';

const { UpdateConnectionState } = require('teleproto/network');

const { createTelegramClient } = require('../lib/telegram-client');
const { describeSessionStore } = require('../lib/session-store');
const { updateStatePath, readUpdateState, writeUpdateState } = require('../lib/update-state');

// teleproto reports these as numbers; map them to names so the nodes do not have to know the encoding.
const CONNECTION_STATES = new Map([
    [UpdateConnectionState.connected, 'connected'],
    [UpdateConnectionState.disconnected, 'disconnected'],
    // Two emitters, both terminal for that connection: _handleBadAuthKey (the stored session is
    // unusable) and _reconnect when the reconnect attempt itself fails, which marks the sender dead.
    // GramJS only had the first — see doc/architecture/adr/0013-migrate-to-teleproto.md.
    [UpdateConnectionState.broken, 'broken'],
]);

// One minute. Frequent enough that a crash costs little replay, rare enough to be free.
const SAVE_INTERVAL_MS = 60 * 1000;

// The configuration node owns the shared TelegramClient. Receiver and sender nodes reference it and
// ask for the client via getTelegramClient, so one session serves every node in the flow.
module.exports = function (RED) {
    function TelegramConfigNode(n) {
        RED.nodes.createNode(this, n);

        // Note: createTelegramClient and getTelegramClient take a `node` parameter of their own that
        // shadows this one — theirs is the *calling* receiver or sender, used for its warn channel.
        const node = this;

        // The same object under a name nothing shadows. Anything that has to reach *this* node from inside
        // those two functions goes through it: writing to `node` in there sets a field on whichever
        // receiver or sender happened to ask, which is a bug that reads like working code.
        const configNode = this;

        this.config = n;
        this.client = null;
        this.logLevel = 'warn'; // 'none', 'error', 'warn','info', 'debug'
        this.verbose = n.verboselogging;
        this.useProxy = n.useproxy || false;
        this.proxy;
        const deviceModel = n.devicemodel || '';
        const systemVersion = n.systemversion || '';
        const appVersion = n.appversion || '';
        // Kept as the raw config value: lib/client-params.js decides what counts as unset, because 0 is
        // a meaningful setting here and '' is not.
        const floodSleepThreshold = n.floodsleepthreshold;
        const parseMode = n.parsemode || '';

        // Off unless asked for: switching it on writes this account's auth key to disk, outside the
        // credential store Node-RED keeps the session in. What it buys is peers addressed by numeric id
        // surviving a restart. See doc/architecture/adr/0018-persist-the-entity-cache.md.
        //
        // The name is derived from the node id, so two config nodes never share a store — which matters
        // because store2 keys its areas by name process-wide.
        // Off unless asked for: after a long outage this replays everything that was missed, which on
        // a busy account is a flood the user did not ask for. See
        // doc/architecture/adr/0019-catch-up-on-missed-updates.md.
        // The path is only computed when it is wanted: `RED.settings.userDir` is not guaranteed to be
        // set in every embedding, and the session store above takes the same care for the same reason.
        const catchUp = n.catchup || false;
        let updateStateFile;
        if (catchUp) {
            updateStateFile = updateStatePath(RED.settings.userDir, node.id);
        }

        let sessionStore = '';
        if (n.persistpeers) {
            const described = describeSessionStore(RED.settings.userDir, node.id, process.cwd());
            sessionStore = described.name;

            if (!described.asAsked) {
                // Only reachable on Windows with the user directory on another drive: StoreSession
                // resolves its path relative to the working directory and cannot be given an absolute
                // one, so say where the data actually went rather than leave it to be discovered.
                node.warn('Peer cache stored in ' + described.directory + ', not under the Node-RED user directory.');
            }
        }

        if (this.useProxy) {
            this.proxy = {
                ip: n.host,
                socksType: Number(n.sockstype),
                port: Number(n.port),
                username: n.username,
                // `n.password` is the *proxy* password, a plain config property. The account's
                // two-step-verification password is a credential and is read as `twofapassword`.
                password: n.password,
                secret: n.secret,
                MTProxy: n.mtproxy,
                timeout: Number(n.timeout),
            };
        }

        // Constant for the node's lifetime, like the device fields above, so it is a closure value
        // rather than another positional argument threaded through createTelegramClient.
        const loginMode = n.loginmode || 'user';
        this.loginMode = loginMode;

        if (this.verbose) {
            this.logLevel = 'debug';
        }

        // let self = this;
        if (this.credentials !== undefined) {
            this.apiId = this.credentials.apiid || '';
            this.apiHash = this.credentials.apihash || '';
            this.session = this.credentials.session || '';
            this.phoneNumber = this.credentials.phonenumber || '';
            this.botToken = this.credentials.bottoken || undefined;
            this.twoFaPassword = this.credentials.twofapassword || '';
        }

        // Why the last connect produced no client, for the nodes to show. Undefined once one succeeds, so
        // a stale reason cannot outlive the problem it described.
        this.lastFailure = undefined;

        this.createTelegramClient = async function (
            node,
            apiId,
            apiHash,
            session,
            phoneNumber,
            botToken,
            logLevel,
            proxy
        ) {
            const options = {
                apiId: apiId,
                apiHash: apiHash,
                session: session,
                phoneNumber: phoneNumber,
                botToken: botToken,
                loginMode: loginMode,
                logLevel: logLevel,
                proxy: proxy,
                deviceModel: deviceModel,
                systemVersion: systemVersion,
                appVersion: appVersion,
                floodSleepThreshold: floodSleepThreshold,
                parseMode: parseMode,
                sessionStore: sessionStore,
            };

            return await createTelegramClient(
                options,
                (message) => node.warn(message),
                (reason) => {
                    configNode.lastFailure = reason;
                }
            );
        };

        // Receiver and sender nodes register here so they can be told when the connection changes.
        // Without this they set their status once, at start, and then show `connected` forever — even
        // after the client has died.
        this.statusListeners = new Set();

        this.addStatusListener = function (listener) {
            node.statusListeners.add(listener);
        };

        this.removeStatusListener = function (listener) {
            node.statusListeners.delete(listener);
        };

        // Called for every raw update; teleproto routes the connection states through the raw handlers.
        this.onConnectionState = function (update) {
            const state = update instanceof UpdateConnectionState ? CONNECTION_STATES.get(update.state) : undefined;

            if (state !== undefined) {
                for (const listener of node.statusListeners) {
                    listener.onConnectionState(state);
                }
            }
        };

        // How often the position is written while the flow runs. On a clean redeploy the close handler
        // saves it; this bounds how much is replayed again after a crash, which the library's own
        // duplicate check then mostly absorbs.
        let saveTimer;

        // Reads what the update manager has reached and writes it down. Called on a timer and on close.
        this.saveUpdateState = function () {
            const client = node.client;

            if (updateStateFile !== undefined && client && client.updateManager && client.updateManager.state) {
                writeUpdateState(updateStateFile, client.updateManager.state, (message) => node.warn(message));
            }
        };

        // Replays what was missed while Node-RED was down.
        //
        // teleproto does the hard part — the difference loop, `differenceTooLong`, `updatesTooLong`, and
        // deduplication — but its `ensureState()` initialises from the server's *current* position, which
        // is the same as skipping the gap. Seeding the saved position first is what turns that into a
        // catch-up. Replayed updates go through the same dispatch as live ones, so the receiver node
        // emits them exactly as it would have at the time.
        this.catchUpOnUpdates = async function (client) {
            const saved = readUpdateState(updateStateFile, (message) => node.warn(message));

            if (saved !== undefined) {
                try {
                    client.updateManager.refreshFromState(saved);
                    await client.catchUp();
                } catch (error) {
                    // A failed catch-up must not stop the flow starting: the live stream still works.
                    node.warn('Could not catch up on missed updates: ' + error.message);
                }
            }

            // From here the position is worth remembering even if there was nothing to replay.
            saveTimer = setInterval(() => node.saveUpdateState(), SAVE_INTERVAL_MS);
            saveTimer.unref();
        };

        // Activates the client or returns the already activated bot.
        this.getTelegramClient = async function (node) {
            if (!this.client) {
                const client = await this.createTelegramClient(
                    node,
                    this.apiId,
                    this.apiHash,
                    this.session,
                    this.phoneNumber,
                    this.botToken,
                    this.logLevel,
                    this.proxy
                );

                if (client) {
                    // Cleared on success, so a node that connects on its second attempt does not keep
                    // showing why the first one failed.
                    this.lastFailure = undefined;

                    // Registered here rather than by the nodes, so the state is observed whether or not
                    // anyone enabled "send raw events". A user's own raw handler still receives these
                    // updates as before — teleproto calls every registered handler.
                    client.addEventHandler(this.onConnectionState);
                }

                this.client = client;

                // After `this.client` is set, so the handlers a replayed update reaches are the same ones
                // a live update would, and so saveUpdateState can find the client.
                if (client && catchUp) {
                    await node.catchUpOnUpdates(client);
                }
            }

            return this.client;
        };

        // Tears the client down so a redeploy does not leave a live session behind.
        //
        // destroy() rather than disconnect(): teleproto runs its update loop as
        // `while (!client._destroyed)` and only destroy() sets that flag. After a plain disconnect the
        // loop keeps going, reconnects through `_sender.reconnect()` and carries on pinging, so the
        // session would survive every redeploy. destroy() also clears the registered event builders
        // and drops the borrowed senders.
        this.closeTelegramClient = async function () {
            // Written before the client is dropped: this is the position a redeploy resumes from.
            if (saveTimer !== undefined) {
                clearInterval(saveTimer);
                saveTimer = undefined;
            }
            node.saveUpdateState();

            const client = node.client;
            // Cleared first so a concurrent getTelegramClient builds a fresh one instead of handing
            // out the client being torn down.
            node.client = null;

            if (client) {
                await client.destroy();
            }
        };

        this.onStarted = function () {};
        RED.events.on('flows:started', this.onStarted);

        this.on('close', function (removed, done) {
            RED.events.removeListener('flows:started', node.onStarted);

            (async () => {
                try {
                    await node.closeTelegramClient();
                } catch (error) {
                    // A Telegram outage must not block a redeploy, so report and carry on.
                    node.warn(error);
                } finally {
                    done();
                }
            })();
        });
    }

    // Node-RED only persists credentials declared here. The editor's credentials block must match
    // this list exactly — anything it offers but this omits is silently discarded on deploy.
    //
    // The type matters for more than masking: for `text` the runtime sends the stored value to the
    // editor in clear (see @node-red/runtime/lib/api/flows.js), while for `password` it sends only a
    // `has_<name>` boolean. The session authenticates the whole account, so it must never travel.
    //
    // This block, not the editor's, is what the runtime consults to decide what to send back: every
    // secret is `password`, so the editor receives only a `has_<name>` flag. The login routes then
    // substitute the __PWRD__ placeholder from storage — see lib/login-credentials.js.
    //
    // `apiid` is an application id, not a secret. `phonenumber` stays legible so the user can tell which
    // account a config node belongs to; masking it would make several accounts indistinguishable.
    RED.nodes.registerType('telegram client config', TelegramConfigNode, {
        credentials: {
            apiid: { type: 'text' },
            apihash: { type: 'password' },
            session: { type: 'password' },
            phonenumber: { type: 'text' },
            bottoken: { type: 'password' },
            twofapassword: { type: 'password' },
        },
    });
};
