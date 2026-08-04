// Created by Karl-Heinz Wind
'use strict';

const { Api } = require('teleproto');
const { FloodWaitError } = require('teleproto/errors');

const { convertButtonsInArgs } = require('../lib/reply-markup');
const { hideClientReferences } = require('../lib/hide-client');
const {
    CONNECTED,
    DISCONNECTED,
    failureStatus,
    floodWaitStatus,
    attachConnectionStatus,
    detachConnectionStatus,
} = require('../lib/node-status');

// teleproto throws a plain Error for a peer it cannot resolve, and it has **two** messages for two
// different problems. There is no class to match on, so this goes by the wording; if teleproto rewords
// either one the hint is simply lost, and the original error reaches the flow untouched either way.
//
// The distinction matters more than it looks. The first hint tells the user a username always works — which
// is exactly wrong for the second case, where the username *is* what Telegram could not find. One hint for
// both would send them looking in the wrong place.
const PEER_HINTS = [
    {
        // client/users.js `getInputEntity`: it has the peer but no access hash for it — in practice, a bare
        // numeric id that is not in this session's cache.
        wording: 'Could not find the input entity',
        hint:
            'Telegram could not resolve that peer. A username or an invite link always works. A bare ' +
            "numeric id only works while that peer is in this session's entity cache, which is held in " +
            'memory and lost on every restart — so a flow that worked before a redeploy can fail after ' +
            'one. Address the peer by username, resolve it once with getEntity in the same flow, or turn ' +
            'on "Remember peers" on the config node.',
    },
    {
        // client/users.js `_getEntityFromString`: a username, phone number or invite link that Telegram does
        // not know at all.
        wording: 'Cannot find any entity corresponding to',
        hint:
            'Telegram does not know that username or link. Check the spelling — a leading @ is optional, ' +
            'but a space is not part of a username, so a leftover placeholder like "to username" from an ' +
            'example flow will fail here. A phone number only resolves if that person is in your ' +
            'contacts, and a private channel needs an invite link you have already joined.',
    },
    {
        // Utils.js `getPeer`, reached through `getInputEntity`, for a peer that is not merely unknown but
        // absent. `Cannot cast undefined to any kind of undefined` is what a missing `peer` reads like, and
        // it names neither the argument nor the request — the only wording in this list that says nothing
        // at all on its own.
        //
        // Before this entry existed the same message had already cost a debugging session: the request that
        // was logged alongside it showed a full peer, because a request is built and invoked in one step and
        // the failing one was a *different* message.
        wording: 'Cannot cast undefined to any kind of undefined',
        hint:
            'No peer was passed: `peer` in the arguments is undefined. In a flow built on a received ' +
            'message this is usually `msg.payload.chat`, which the receiver fills with `getChat()` — and ' +
            'that comes back empty when this session holds no access hash for the chat. Fall back to ' +
            '`msg.payload.message.peerId`, which every message carries, or turn on "Remember peers" on ' +
            'the config node so the hashes survive a restart.',
    },
    {
        // Utils.js `getInputPeer` tests `entity instanceof Api.User` and its siblings, so a structurally
        // identical object is not enough. Kept after the entry above: that message does not contain this
        // wording, but a reader should not have to check.
        wording: 'to any kind of peer',
        hint:
            'That peer is an object teleproto does not recognise. Its entities are class instances and it ' +
            'checks the class, not the fields — so anything that went through JSON on the way here, out of ' +
            'a file or flow context or rebuilt by hand, keeps every field and still fails. Pass the ' +
            'username or the numeric id and let the client resolve it.',
    },
];

// The hint for this error, or undefined when it is not about a peer at all.
function peerHint(error) {
    let hint;

    if (error instanceof Error && typeof error.message === 'string') {
        const matched = PEER_HINTS.find((entry) => error.message.includes(entry.wording));

        if (matched !== undefined) {
            hint = matched.hint;
        }
    }

    return hint;
}

// The sender node is a generic bridge to the Telegram client: `msg.payload.func` names either a
// convenience method on the client itself (no `api`) or a raw MTProto request under `Api[api]`.
// The two differ in how arguments are passed — spread array vs. single options object.
module.exports = function (RED) {
    function TelegramSenderNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);

        // The last status derived from the connection itself. A flood wait is temporary and reverts to
        // this once it elapses, so it has to be remembered rather than recomputed.
        let steadyStatus = DISCONNECTED;
        let floodTimer;

        function clearFloodTimer() {
            if (floodTimer !== undefined) {
                clearTimeout(floodTimer);
                floodTimer = undefined;
            }
        }

        this.setConnectionStatus = (status) => {
            steadyStatus = status;
            // A connection change outranks a flood wait: it says something about the client itself.
            clearFloodTimer();
            node.status(status);
        };

        // Telegram is throttling us. teleproto sleeps through anything up to floodSleepThreshold on its
        // own; this only runs for the waits it gives up on and throws.
        this.showFloodWait = (seconds) => {
            clearFloodTimer();
            node.status(floodWaitStatus(seconds));

            floodTimer = setTimeout(() => {
                floodTimer = undefined;
                node.status(steadyStatus);
            }, seconds * 1000);
            // A long wait must not keep the process alive on its own account.
            floodTimer.unref();
        };

        // Keeps the canvas honest after start(): the connection can drop or the session can be
        // invalidated long after this node last looked at it.
        //
        // Routed through setConnectionStatus rather than node.status, because this node has to remember
        // the state: a flood wait is temporary and reverts to it.
        attachConnectionStatus(node, (status) => node.setConnectionStatus(status));

        this.start = async () => {
            if (node.config) {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    node.setConnectionStatus(CONNECTED);
                } else {
                    // Through setConnectionStatus, so a later flood wait still reverts to this rather than
                    // to a stale `connected`.
                    node.setConnectionStatus(failureStatus(node.config.lastFailure));
                }
            } else {
                // no config node?
            }
        };
        this.start();

        this.stop = async () => {
            node.setConnectionStatus(DISCONNECTED);
        };

        // Performs the call and completes the message. The call has already been validated.
        this.invokeClient = async function (client, call, msg, nodeSend, nodeDone) {
            // Completing the message is the epilogue every path has to run, so it belongs in
            // `finally` — that way no future edit can exit past it.
            let failure;
            try {
                let result;
                if (call.useApi) {
                    // args must be an object
                    const request = new Api[call.api][call.func](call.args);
                    result = await client.invoke(request);
                } else {
                    // Any method on the teleproto client, called with `args` spread as its arguments.
                    // Sending:   sendMessage, sendFile, forwardMessages, editMessage, deleteMessages
                    // Chats:     pinMessage, unpinMessage, markAsRead, kickParticipant
                    // Reading:   getMessages, getDialogs, getParticipants, iterMessages, iterDialogs
                    // Media:     downloadMedia, downloadFile, downloadProfilePhoto, uploadFile
                    // Entities:  getEntity, getInputEntity, getPeerId
                    // Account:   getMe, isBot, isUserAuthorized, checkAuthorization
                    //
                    // Note the client is shared by every node using this config, so the connection and
                    // auth methods (connect, start, signIn*, addEventHandler, …) are reachable but will
                    // disrupt the other nodes. See the node help.
                    //
                    // A plain-JSON `buttons` in the options object becomes real teleproto buttons first: a
                    // Function node cannot require them, so the flow can only produce JSON.
                    result = await client[call.func](...convertButtonsInArgs(call.args));
                }

                msg.payload = result;
                nodeSend(hideClientReferences(msg));
            } catch (error) {
                failure = error;

                // Both branches only *add* to what the flow sees. The original error still goes to
                // nodeDone untouched, because a Catch node may well be inspecting it.
                if (error instanceof FloodWaitError) {
                    node.showFloodWait(error.seconds);
                } else {
                    const hint = peerHint(error);

                    if (hint !== undefined) {
                        node.warn(hint);
                    }
                }
            } finally {
                nodeDone(failure);
            }
        };

        // The payload is validated by the input handler, so it can be trusted here.
        this.processMessage = function (client, msg, nodeSend, nodeDone) {
            const api = msg.payload.api;
            const useApi = api !== undefined && api !== '';
            const call = {
                api: api,
                func: msg.payload.func,
                useApi: useApi,
                // The two calling conventions take different argument shapes, so they need
                // different defaults: a raw API request is constructed from one options object,
                // a client method is called with spread arguments.
                args: msg.payload.args || (useApi ? {} : []),
            };

            if (call.func !== undefined) {
                if (call.useApi || Array.isArray(call.args)) {
                    node.invokeClient(client, call, msg, nodeSend, nodeDone);
                } else {
                    nodeDone('msg.payload.args must be an array when msg.payload.api is not set.');
                }
            } else {
                nodeDone('msg.payload: api or func is missing.');
            }

            // TODO:
            // await client.sendMessage(sender, {
            //    message: `hi your id is ${message.senderId}`,
            //});
            // const entity = await client.getEntity('Windhose');
            // await client.sendMessage(entity, { message: 'Hello!' });
        };

        this.on('input', async function (msg, nodeSend, nodeDone) {
            // Anything that cannot be handled is reported rather than dropped: a silently discarded
            // message is the most confusing failure mode this node has.
            if (msg.payload !== undefined && msg.payload !== null) {
                if (node.config) {
                    const client = await node.config.getTelegramClient(node);
                    if (client) {
                        node.processMessage(client, msg, nodeSend, nodeDone);
                    } else {
                        node.setConnectionStatus(failureStatus(node.config.lastFailure));
                        nodeDone('No telegram client: check the config node and login first.');
                    }
                } else {
                    nodeDone('No telegram client config node configured.');
                }
            } else {
                nodeDone('msg.payload is required.');
            }
        });

        this.on('close', function (removed, done) {
            detachConnectionStatus(node);
            // A pending flood-wait timer would otherwise write to a closed node.
            clearFloodTimer();
            node.stop();
            // node.status({});
            done();
        });
    }

    RED.nodes.registerType('telegram client sender', TelegramSenderNode);
};
