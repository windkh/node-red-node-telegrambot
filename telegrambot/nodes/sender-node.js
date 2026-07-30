// Created by Karl-Heinz Wind
'use strict';

const { Api } = require('telegram');
const { FloodWaitError } = require('telegram/errors');

// The status texts are part of this node's public contract — keep them in one place so every code
// path reports the same thing.
const CONNECTED = { fill: 'green', shape: 'ring', text: 'connected' };
const DISCONNECTED = { fill: 'red', shape: 'ring', text: 'disconnected' };
// A filled dot, not a ring, because this one will not fix itself: GramJS reports `broken` only for an
// unusable authorization key, so reconnecting cannot help and the user has to log in again.
const BROKEN = { fill: 'red', shape: 'dot', text: 'session invalid: login again' };

const STATUS_BY_STATE = {
    connected: CONNECTED,
    disconnected: DISCONNECTED,
    broken: BROKEN,
};

// Yellow, because unlike the red states this is Telegram throttling a working connection.
function floodWaitStatus(seconds) {
    return { fill: 'yellow', shape: 'ring', text: 'flood wait ' + seconds + 's' };
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

        // Telegram is throttling us. GramJS sleeps through anything up to floodSleepThreshold on its
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
        this.onConnectionState = (state) => {
            const status = STATUS_BY_STATE[state];
            if (status !== undefined) {
                node.setConnectionStatus(status);
            }
        };

        if (this.config) {
            this.config.addStatusListener(this);
        }

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
                    // sendMessage, forwardMessages, editMessage, deleteMessages, pinMessage, unpinMessage, markAsRead, sendFile
                    // args must be an array
                    result = await client[call.func](...call.args);
                }

                msg.payload = result;
                nodeSend(msg);
            } catch (error) {
                failure = error;

                // Make throttling visible on the canvas, but hand the *original* error on: a Catch node
                // may well be reading err.seconds, so this must stay an addition, not a replacement.
                if (error instanceof FloodWaitError) {
                    node.showFloodWait(error.seconds);
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
            if (node.config) {
                node.config.removeStatusListener(node);
            }
            // A pending flood-wait timer would otherwise write to a closed node.
            clearFloodTimer();
            node.stop();
            // node.status({});
            done();
        });
    }

    RED.nodes.registerType('telegram client sender', TelegramSenderNode);
};
