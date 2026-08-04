// Created by Karl-Heinz Wind
'use strict';

const { FloodWaitError } = require('teleproto/errors');

const { LIST_KINDS, resolveLimit, buildListArgs, emitCount } = require('../lib/list-request');
const {
    CONNECTED,
    DISCONNECTED,
    failureStatus,
    busyStatus,
    floodWaitStatus,
    attachConnectionStatus,
    detachConnectionStatus,
} = require('../lib/node-status');

// How often the status is refreshed while reading. Every item would be a status write per message for no
// added information; this is often enough that a long read never looks like a hang.
const PROGRESS_EVERY = 25;

// Reads existing data — message history, the dialog list, a chat's participants.
//
// None of this works through the sender's generic bridge, because these are **async iterators**:
// `msg.payload = await client.iterMessages(...)` puts an iterator object into the flow, which is not
// something a flow can do anything with. Deciding how a stream of items becomes messages is a Node-RED
// question, and that decision is this node. See doc/architecture/adr/0016-list-node.md.
module.exports = function (RED) {
    function TelegramListNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);

        this.what = config.what || 'messages';
        this.peer = config.peer || '';
        this.limit = config.limit;
        this.search = config.search || '';
        this.mode = config.mode || 'stream';

        // Set by the close handler. A read of a large channel can take minutes, and without this the
        // loop would keep pulling from Telegram and emitting into a node Node-RED has already closed.
        let closing = false;

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

        // Emits one message per item, with `msg.parts` so a downstream join can reassemble the array.
        //
        // The clone is what makes this safe: every emitted message carries its own `parts`, and reusing
        // one object would give the join node the same reference with the last index on it.
        this.emitItem = function (msg, item, group, index, count, nodeSend) {
            const emitted = RED.util.cloneMessage(msg);
            emitted.payload = item;
            emitted.parts = {
                id: group,
                index: index,
                count: count,
                type: 'array',
            };

            nodeSend(emitted);
        };

        // Pulls the iterator dry, or until the limit, the close handler or an error stops it.
        this.readAll = async function (client, request, msg, nodeSend, nodeDone) {
            let failure;
            try {
                node.status(busyStatus('reading'));

                const iterator = client[request.method](...request.args);
                const collected = [];
                const group = RED.util.generateId();
                let index = 0;
                let count;

                for await (const item of iterator) {
                    // Checked before emitting rather than after, so a closed node is never written to.
                    if (closing) {
                        break;
                    }

                    if (node.mode === 'stream') {
                        // `total` is only known once the first batch has been fetched, which has just
                        // happened — the first `next()` loads a chunk before it yields anything.
                        if (count === undefined) {
                            count = emitCount(request.limit, iterator.total);
                        }
                        node.emitItem(msg, item, group, index, count, nodeSend);
                    } else {
                        collected.push(item);
                    }

                    index = index + 1;

                    if (index % PROGRESS_EVERY === 0) {
                        node.status(busyStatus('read ' + index));
                    }
                }

                if (node.mode === 'array') {
                    msg.payload = collected;
                    msg.total = iterator.total;
                    nodeSend(msg);
                }

                node.status(CONNECTED);
            } catch (error) {
                failure = error;

                // The original error still reaches the flow untouched — a Catch node may be reading it.
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
            const kind = LIST_KINDS[node.what];
            const peer = msg.peer !== undefined && msg.peer !== '' ? msg.peer : node.peer;
            const request = {
                method: kind === undefined ? undefined : kind.method,
                limit: resolveLimit(msg.limit !== undefined ? msg.limit : node.limit),
                args: undefined,
            };

            if (kind !== undefined) {
                if (!kind.needsPeer || peer !== '') {
                    if (node.config) {
                        const client = await node.config.getTelegramClient(node);
                        if (client) {
                            const search = msg.search !== undefined ? msg.search : node.search;
                            request.args = buildListArgs(node.what, peer, request.limit, search);
                            await node.readAll(client, request, msg, nodeSend, nodeDone);
                        } else {
                            node.status(DISCONNECTED);
                            nodeDone('No telegram client: check the config node and login first.');
                        }
                    } else {
                        nodeDone('No telegram client config node configured.');
                    }
                } else {
                    nodeDone('No chat: set "Read from" on the node or msg.peer.');
                }
            } else {
                nodeDone('Unknown read type: ' + node.what + '. Expected one of ' + Object.keys(LIST_KINDS).join(', '));
            }
        });

        this.on('close', function (removed, done) {
            // Set before anything else, so a read already in flight stops at its next item.
            closing = true;

            detachConnectionStatus(node);
            node.stop();
            done();
        });
    }

    RED.nodes.registerType('telegram client list', TelegramListNode);
};
