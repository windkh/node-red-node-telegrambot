// Created by Karl-Heinz Wind
'use strict';

const { Api } = require('telegram');

// The sender node is a generic bridge to the Telegram client: `msg.payload.func` names either a
// convenience method on the client itself (no `api`) or a raw MTProto request under `Api[api]`.
// The two differ in how arguments are passed — spread array vs. single options object.
module.exports = function (RED) {
    function TelegramSenderNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);

        this.start = async () => {
            if (node.config) {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'connected',
                    });
                } else {
                    node.status({
                        fill: 'red',
                        shape: 'ring',
                        text: 'disconnected',
                    });
                }
            } else {
                // no config node?
            }
        };
        this.start();

        this.stop = async () => {
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.processMessage = function (client, msg, nodeSend, nodeDone) {
            if (msg.payload !== undefined) {
                const api = msg.payload.api;
                const func = msg.payload.func;
                const args = msg.payload.args || {};

                if (func !== undefined) {
                    (async () => {
                        try {
                            let result;
                            if (api === undefined || api === '') {
                                // sendMessage, forwardMessages, editMessage, deleteMessages, pinMessage, unpinMessage, markAsRead, sendFile
                                // args must be an array
                                result = client[func](...args);
                            } else {
                                // args must be an object
                                const request = new Api[api][func](args);
                                result = await client.invoke(request);
                            }

                            msg.payload = result;
                            nodeSend(msg);
                        } catch (error) {
                            nodeDone(error);
                        }
                    })();
                } else {
                    nodeDone('msg.payload: api or func is missing.');
                }
            }

            // TODO:
            // await client.sendMessage(sender, {
            //    message: `hi your id is ${message.senderId}`,
            //});
            // const entity = await client.getEntity('Windhose');
            // await client.sendMessage(entity, { message: 'Hello!' });
        };

        this.on('input', async function (msg, nodeSend, nodeDone) {
            if (msg.payload) {
                if (node.config) {
                    const client = await node.config.getTelegramClient(node);
                    if (client) {
                        this.processMessage(client, msg, nodeSend, nodeDone);
                    }
                } else {
                    // no config node?
                }
            }
        });

        this.on('close', function (removed, done) {
            node.stop();
            // node.status({});
            done();
        });
    }

    RED.nodes.registerType('telegram client sender', TelegramSenderNode);
};
