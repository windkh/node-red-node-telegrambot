// Created by Karl-Heinz Wind
'use strict';

const { FloodWaitError } = require('teleproto/errors');

const { describeUpload } = require('../lib/upload');
const { hideClientReferences } = require('../lib/hide-client');
const {
    CONNECTED,
    DISCONNECTED,
    failureStatus,
    busyStatus,
    floodWaitStatus,
    attachConnectionStatus,
    detachConnectionStatus,
} = require('../lib/node-status');

// Sends a file to a chat — the mirror of the download node.
//
// `sendFile` is reachable through the sender's generic bridge, but a Node-RED flow holds its file as a
// Buffer, and teleproto names a bare Buffer "unnamed" because Buffers carry no name. Wrapping it in a
// CustomFile is what fixes that, and CustomFile is not something a Function node can require.
module.exports = function (RED) {
    function TelegramUploadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);

        this.peer = config.peer || '';
        this.caption = config.caption || '';
        this.forceDocument = config.forcedocument || false;
        this.silent = config.silent || false;

        // The callbacks handed to teleproto for uploads still in flight. Setting `isCanceled` on one
        // makes the upload throw USER_CANCELED at its next chunk, which is how a redeploy stops a large
        // upload instead of letting it run on into a closed node.
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

        // teleproto reports progress as a fraction and calls this per uploaded chunk, so a percentage in
        // the status is the whole point: a 40 MB file otherwise looks like a hang.
        this.createProgressCallback = function () {
            const report = (progress) => {
                node.status(busyStatus('uploading ' + Math.round(progress * 100) + '%'));
            };

            return report;
        };

        // The payload and the destination have already been validated by the input handler.
        this.sendFile = async function (client, peer, file, msg, nodeSend, nodeDone) {
            const progressCallback = node.createProgressCallback();
            running.add(progressCallback);

            let failure;
            try {
                node.status(busyStatus('uploading'));

                const options = {
                    file: file,
                    caption: msg.caption !== undefined ? msg.caption : node.caption,
                    forceDocument: node.forceDocument,
                    silent: msg.silent !== undefined ? msg.silent : node.silent,
                    progressCallback: progressCallback,
                };

                // Left out entirely when unset. `replyTo: undefined` is the same as absent to teleproto,
                // but keeping the key out means the options object says what was actually asked for.
                if (msg.replyTo !== undefined) {
                    options.replyTo = msg.replyTo;
                }

                const sent = await client.sendFile(peer, options);

                // The Buffer has served its purpose; what a flow wants next is the message Telegram
                // created, so it can be replied to or edited. For an album that is an array of them.
                msg.payload = sent;

                node.status(CONNECTED);
                nodeSend(hideClientReferences(msg));
            } catch (error) {
                failure = error;
                if (error instanceof FloodWaitError) {
                    node.status(floodWaitStatus(error.seconds));
                } else {
                    node.status(DISCONNECTED);
                }
            } finally {
                running.delete(progressCallback);
                nodeDone(failure);
            }
        };

        this.on('input', async function (msg, nodeSend, nodeDone) {
            const peer = msg.peer !== undefined && msg.peer !== '' ? msg.peer : node.peer;
            const described = describeUpload(msg.payload, msg.filename);

            if (peer === '') {
                nodeDone('No destination: set "Send to" on the node or msg.peer.');
            } else if (described.error !== undefined) {
                // Already worded by lib/upload, including which item of an album was wrong.
                nodeDone(described.error);
            } else if (!node.config) {
                nodeDone('No telegram client config node configured.');
            } else {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    await node.sendFile(client, peer, described.file, msg, nodeSend, nodeDone);
                } else {
                    node.status(DISCONNECTED);
                    nodeDone('No telegram client: check the config node and login first.');
                }
            }
        });

        this.on('close', function (removed, done) {
            // Checked by teleproto at the next chunk boundary, so an upload in flight stops rather than
            // continuing to push bytes for a node that no longer exists.
            for (const progressCallback of running) {
                progressCallback.isCanceled = true;
            }

            detachConnectionStatus(node);
            node.stop();
            done();
        });
    }

    RED.nodes.registerType('telegram client upload', TelegramUploadNode);
};
