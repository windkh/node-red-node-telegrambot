// Created by Karl-Heinz Wind
'use strict';

const { FloodWaitError } = require('teleproto/errors');

const { toUploadFile, needsFilename } = require('../lib/upload');
const {
    CONNECTED,
    DISCONNECTED,
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

        attachConnectionStatus(node, (status) => node.status(status));

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

        // The payload and the destination have already been validated by the input handler.
        this.sendFile = async function (client, peer, file, msg, nodeSend, nodeDone) {
            let failure;
            try {
                node.status(busyStatus('uploading'));

                const sent = await client.sendFile(peer, {
                    file: file,
                    caption: msg.caption !== undefined ? msg.caption : node.caption,
                    forceDocument: node.forceDocument,
                });

                // The Buffer has served its purpose; what a flow wants next is the message Telegram
                // created, so it can be replied to or edited.
                msg.payload = sent;

                node.status(CONNECTED);
                nodeSend(msg);
            } catch (error) {
                failure = error;
                if (error instanceof FloodWaitError) {
                    node.status(floodWaitStatus(error.seconds));
                } else {
                    node.status(DISCONNECTED);
                }
            } finally {
                nodeDone(failure);
            }
        };

        this.on('input', async function (msg, nodeSend, nodeDone) {
            const peer = msg.peer !== undefined && msg.peer !== '' ? msg.peer : node.peer;
            const file = toUploadFile(msg.payload, msg.filename);

            if (peer === '') {
                nodeDone('No destination: set "Send to" on the node or msg.peer.');
            } else if (file === undefined) {
                nodeDone('msg.payload must be a Buffer or a file path.');
            } else if (needsFilename(msg.payload) && !msg.filename) {
                // Without this the file would arrive in the chat called "unnamed".
                nodeDone('msg.filename is required when msg.payload is a Buffer.');
            } else if (!node.config) {
                nodeDone('No telegram client config node configured.');
            } else {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    await node.sendFile(client, peer, file, msg, nodeSend, nodeDone);
                } else {
                    node.status(DISCONNECTED);
                    nodeDone('No telegram client: check the config node and login first.');
                }
            }
        });

        this.on('close', function (removed, done) {
            detachConnectionStatus(node);
            node.stop();
            done();
        });
    }

    RED.nodes.registerType('telegram client upload', TelegramUploadNode);
};
