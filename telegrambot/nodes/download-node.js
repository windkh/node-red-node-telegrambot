// Created by Karl-Heinz Wind
'use strict';

const { findMessage, describeMedia } = require('../lib/media');

const CONNECTED = { fill: 'green', shape: 'ring', text: 'connected' };
const DISCONNECTED = { fill: 'red', shape: 'ring', text: 'disconnected' };
const BROKEN = { fill: 'red', shape: 'dot', text: 'session invalid: login again' };

const STATUS_BY_STATE = {
    connected: CONNECTED,
    disconnected: DISCONNECTED,
    broken: BROKEN,
};

// Downloads the media on a received message.
//
// `downloadMedia` is reachable through the sender's generic bridge, but doing it there means digging the
// message out by hand, learning the options shape, and having the resulting Buffer overwrite the message
// you still need. This node takes the receiver's output as-is, checks the size before fetching, and
// emits the bytes in the shape Node-RED's file and HTTP nodes already expect.
module.exports = function (RED) {
    function TelegramDownloadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);

        // Empty means "the full-size media"; an index selects a thumbnail, 0 being the smallest.
        this.thumb = config.thumb === '' || config.thumb === undefined ? undefined : Number(config.thumb);
        // In megabytes, because that is the unit a user thinks in. 0 or empty means no limit.
        this.maxSize = Number(config.maxsize) > 0 ? Number(config.maxsize) * 1024 * 1024 : undefined;

        this.onConnectionState = (state) => {
            const status = STATUS_BY_STATE[state];
            if (status !== undefined) {
                node.status(status);
            }
        };

        if (this.config) {
            this.config.addStatusListener(this);
        }

        this.start = async () => {
            if (node.config) {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    node.status(CONNECTED);
                } else {
                    node.status(DISCONNECTED);
                }
            } else {
                // no config node?
            }
        };
        this.start();

        this.stop = async () => {
            node.status(DISCONNECTED);
        };

        // The message has already been validated by the input handler.
        this.downloadMedia = async function (client, message, msg, nodeSend, nodeDone) {
            const media = message.media;
            const description = describeMedia(media, node.thumb);

            let failure;
            try {
                if (node.maxSize !== undefined && description.size !== undefined && description.size > node.maxSize) {
                    // Refused rather than streamed into memory: a 2 GB video would otherwise take the
                    // runtime down. The size is unknown for some media, and then this cannot help.
                    const megabytes = Math.round(description.size / (1024 * 1024));
                    failure = `${description.filename} is ${megabytes} MB, above the configured limit.`;
                } else {
                    node.status({ fill: 'blue', shape: 'dot', text: 'downloading' });

                    const buffer = await client.downloadMedia(message, { thumb: node.thumb });

                    // Node-RED convention: the bytes go in payload so `file out` and `http response`
                    // work without a Change node. The original message stays reachable, because a flow
                    // usually still needs the sender or the chat.
                    msg.telegram = msg.payload;
                    msg.payload = buffer;
                    msg.filename = description.filename;
                    msg.mimetype = description.mimeType;

                    node.status(CONNECTED);
                    nodeSend(msg);
                }
            } catch (error) {
                failure = error;
                node.status(DISCONNECTED);
            } finally {
                nodeDone(failure);
            }
        };

        this.on('input', async function (msg, nodeSend, nodeDone) {
            const message = findMessage(msg.payload);

            if (message === undefined) {
                nodeDone('msg.payload is not a telegram message: wire this node to a receiver output.');
            } else if (message.media === undefined || message.media === null) {
                nodeDone('This message has no media to download.');
            } else if (!node.config) {
                nodeDone('No telegram client config node configured.');
            } else {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    await node.downloadMedia(client, message, msg, nodeSend, nodeDone);
                } else {
                    node.status(DISCONNECTED);
                    nodeDone('No telegram client: check the config node and login first.');
                }
            }
        });

        this.on('close', function (removed, done) {
            if (node.config) {
                node.config.removeStatusListener(node);
            }
            node.stop();
            done();
        });
    }

    RED.nodes.registerType('telegram client download', TelegramDownloadNode);
};
