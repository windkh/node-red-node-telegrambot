// Created by Karl-Heinz Wind
'use strict';

const { UpdateConnectionState } = require('telegram/network');

const { createTelegramClient } = require('../lib/telegram-client');

// GramJS reports these as numbers; map them to names so the nodes do not have to know the encoding.
const CONNECTION_STATES = new Map([
    [UpdateConnectionState.connected, 'connected'],
    [UpdateConnectionState.disconnected, 'disconnected'],
    // Emitted only from _handleBadAuthKey: the stored session is unusable, not a network hiccup.
    [UpdateConnectionState.broken, 'broken'],
]);

// The configuration node owns the shared TelegramClient. Receiver and sender nodes reference it and
// ask for the client via getTelegramClient, so one session serves every node in the flow.
module.exports = function (RED) {
    function TelegramConfigNode(n) {
        RED.nodes.createNode(this, n);

        // Note: createTelegramClient and getTelegramClient take a `node` parameter of their own that
        // shadows this one — theirs is the *calling* receiver or sender, used for its warn channel.
        const node = this;

        this.config = n;
        this.client = null;
        this.logLevel = 'warn'; // 'none', 'error', 'warn','info', 'debug'
        this.verbose = n.verboselogging;
        this.useProxy = n.useproxy || false;
        this.useWSS = n.usewss || false;
        this.proxy;
        const deviceModel = n.devicemodel || '';
        const systemVersion = n.systemversion || '';
        const appVersion = n.appversion || '';
        // Kept as the raw config value: lib/client-params.js decides what counts as unset, because 0 is
        // a meaningful setting here and '' is not.
        const floodSleepThreshold = n.floodsleepthreshold;

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

        this.createTelegramClient = async function (
            node,
            apiId,
            apiHash,
            session,
            phoneNumber,
            botToken,
            logLevel,
            proxy,
            useWSS
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
                useWSS: useWSS,
                deviceModel: deviceModel,
                systemVersion: systemVersion,
                appVersion: appVersion,
                floodSleepThreshold: floodSleepThreshold,
            };

            return await createTelegramClient(options, (message) => node.warn(message));
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

        // Called for every raw update; GramJS routes the connection states through the raw handlers.
        this.onConnectionState = function (update) {
            const state = update instanceof UpdateConnectionState ? CONNECTION_STATES.get(update.state) : undefined;

            if (state !== undefined) {
                for (const listener of node.statusListeners) {
                    listener.onConnectionState(state);
                }
            }
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
                    this.proxy,
                    this.useWSS
                );

                if (client) {
                    // Registered here rather than by the nodes, so the state is observed whether or not
                    // anyone enabled "send raw events". A user's own raw handler still receives these
                    // updates as before — GramJS calls every registered handler.
                    client.addEventHandler(this.onConnectionState);
                }

                this.client = client;
            }

            return this.client;
        };

        // Tears the client down so a redeploy does not leave a live session behind.
        //
        // destroy() rather than disconnect(): GramJS runs its update loop as
        // `while (!client._destroyed)` and only destroy() sets that flag. After a plain disconnect the
        // loop keeps going, reconnects through `_sender.reconnect()` and carries on pinging, so the
        // session would survive every redeploy. destroy() also clears the registered event builders
        // and drops the borrowed senders.
        this.closeTelegramClient = async function () {
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
    // apihash, bottoken and twofapassword are secrets too, but the editor's login panel reads their
    // values back to drive the login and would receive the __PWRD__ placeholder instead. Making them
    // `password` requires the login routes to look credentials up server-side — tracked separately.
    RED.nodes.registerType('telegram client config', TelegramConfigNode, {
        credentials: {
            apiid: { type: 'text' },
            apihash: { type: 'text' },
            session: { type: 'password' },
            phonenumber: { type: 'text' },
            bottoken: { type: 'text' },
            twofapassword: { type: 'text' },
        },
    });
};
