// Created by Karl-Heinz Wind
'use strict';

const { findMessage, describeMedia } = require('../lib/media');
const {
    CONNECTED,
    DISCONNECTED,
    failureStatus,
    busyStatus,
    attachConnectionStatus,
    detachConnectionStatus,
} = require('../lib/node-status');

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

        // The controllers for downloads still in flight. teleproto checks the signal in its streaming
        // loop, so aborting one stops it between chunks rather than after the whole file — which is what
        // a redeploy needs from a 40 MB video.
        //
        // Note this differs from the upload node, which sets `isCanceled` on its progress callback: that
        // is the only hook `sendFile` offers, while `downloadMedia` takes a real AbortSignal.
        const running = new Set();

        attachConnectionStatus(node, (status) => node.status(status));

        this.start = async () => {
            if (node.config) {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    node.status(CONNECTED);
                } else {
                    // The reason, not just "disconnected": the config node recorded why there is no
                    // client, and a red status that names the cause saves a trip to the log.
                    node.status(failureStatus(node.config.lastFailure));
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
                    node.status(busyStatus('downloading'));

                    const controller = new AbortController();
                    running.add(controller);

                    // Bytes, not a fraction — the mirror image of the upload node, where teleproto hands
                    // over a fraction instead. Guarded because `total` is 0 for media whose size the
                    // server did not state, and a percentage of nothing is not worth showing.
                    const progressCallback = (downloaded, total) => {
                        const done = Number(downloaded);
                        const whole = Number(total);

                        if (whole > 0) {
                            node.status(busyStatus('downloading ' + Math.round((done / whole) * 100) + '%'));
                        }
                    };

                    let buffer;
                    try {
                        buffer = await client.downloadMedia(message, {
                            thumb: node.thumb,
                            progressCallback: progressCallback,
                            signal: controller.signal,
                        });
                    } finally {
                        running.delete(controller);
                    }

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
            // Stops a download in flight rather than letting it stream into a node that no longer exists.
            for (const controller of running) {
                controller.abort();
            }

            detachConnectionStatus(node);
            node.stop();
            done();
        });
    }

    RED.nodes.registerType('telegram client download', TelegramDownloadNode);
};
