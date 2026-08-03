// Created by Karl-Heinz Wind
'use strict';

const { Api } = require('teleproto');
const { FloodWaitError } = require('teleproto/errors');

const { convertButtonsInArgs } = require('../lib/reply-markup');
const {
    CONNECTED,
    DISCONNECTED,
    floodWaitStatus,
    attachConnectionStatus,
    detachConnectionStatus,
} = require('../lib/node-status');

// teleproto throws a plain Error for an unresolvable peer — there is no class to match on, so this has to
// go by the message, and it points at Telethon's Python documentation. If teleproto rewords it the hint is
// simply lost; the original error reaches the flow either way.
const UNRESOLVED_PEER = 'Could not find the input entity';

function isUnresolvedPeer(error) {
    return error instanceof Error && typeof error.message === 'string' && error.message.includes(UNRESOLVED_PEER);
}

const UNRESOLVED_PEER_HINT =
    'Telegram could not resolve that peer. A username or an invite link always works. A bare numeric id ' +
    "only works while that peer is in this session's entity cache, which is held in memory and lost on " +
    'every restart — so a flow that worked before a redeploy can fail after one. Address the peer by ' +
    'username, or resolve it once with getEntity in the same flow.';

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
                    node.setConnectionStatus(DISCONNECTED);
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
                nodeSend(msg);
            } catch (error) {
                failure = error;

                // Both branches only *add* to what the flow sees. The original error still goes to
                // nodeDone untouched, because a Catch node may well be inspecting it.
                if (error instanceof FloodWaitError) {
                    node.showFloodWait(error.seconds);
                } else if (isUnresolvedPeer(error)) {
                    node.warn(UNRESOLVED_PEER_HINT);
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
                        node.setConnectionStatus(DISCONNECTED);
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
