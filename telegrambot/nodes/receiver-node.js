// Created by Karl-Heinz Wind
'use strict';

const { NewMessage } = require('telegram/events');
const { DeletedMessage } = require('telegram/events/DeletedMessage');
const { EditedMessage } = require('telegram/events/EditedMessage');
const { Album } = require('telegram/events/Album');
const { CallbackQuery } = require('telegram/events/CallbackQuery');

const { buildEventFilters } = require('../lib/event-filters');

// The receiver node subscribes to Telegram events on the shared client and emits one message per
// event. Which event types are subscribed is configured per node; each subscription is tracked so
// that only the handlers actually added are removed again on close.
//
// Filtering happens in Telegram's event builders rather than downstream, so traffic this node is not
// interested in never reaches the flow — and never costs a getSender()/getChat() round trip.
module.exports = function (RED) {
    function TelegramReceiverNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);

        // Built once, so an invalid pattern is reported at deploy rather than per message. On failure
        // this stays undefined and the node refuses to subscribe: forwarding everything because the
        // filter did not compile would be worse than forwarding nothing.
        let filters;
        try {
            filters = buildEventFilters(config);
        } catch (error) {
            this.error(error);
        }
        this.filters = filters;

        this.sendRawEvents = config.sendrawevents || false;
        this.sendNewMessage = config.sendnewmessage || false;
        this.sendDeletedMessage = config.senddeletedmessage || false;
        this.sendEditedMessage = config.sendeditedmessage || false;
        this.sendAlbum = config.sendalbum || false;
        this.sendCallbackQuery = config.sendcallbackquery || false;

        this.rawEventHandlerAdded = false;
        this.newMessageEventHandlerAdded = false;
        this.deletedMessageEventHandlerAdded = false;
        this.editedMessageEventHandlerAdded = false;
        this.albumEventHandlerAdded = false;
        this.callbackQueryEventHandlerAdded = false;

        this.rawEventHandler = async (event) => {
            const msg = {
                type: 'Raw',
                payload: event,
            };
            node.send(msg);
        };

        this.newMessageEventHandler = async (event) => {
            const message = event.message;
            const msg = {
                payload: {
                    type: 'NewMessage',
                    message: message,
                    originalUpdate: message.originalUpdate,
                    sender: await message.getSender(),
                    chat: await message.getChat(),
                    event: event,
                },
            };
            node.send(msg);
        };

        this.deletedMessageEventHandler = async (event) => {
            const msg = {
                payload: {
                    type: 'DeletedMessage',
                    // peer, chatPeer ?
                    deletedIds: event.deletedIds,
                    event: event,
                },
            };
            node.send(msg);
        };

        this.editedMessageEventHandler = async (event) => {
            const message = event.message;
            const msg = {
                payload: {
                    type: 'EditedMessage',
                    message: message,
                    sender: await message.getSender(),
                    chat: await message.getChat(),
                    event: event,
                },
            };
            node.send(msg);
        };

        this.albumEventHandler = async (event) => {
            const msg = {
                payload: {
                    type: 'Album',
                    messages: event.messages,
                    originalUpdates: event.originalUpdates,
                    event: event,
                },
            };
            node.send(msg);
        };

        this.callbackQueryEventHandler = async (event) => {
            const msg = {
                payload: {
                    type: 'CallbackQuery',
                    query: event.query,
                    event: event,
                },
            };
            node.send(msg);
        };

        this.stop = async () => {
            // Deliberately the cached client, not getTelegramClient(): that would *create* one, so
            // closing a receiver that never connected would log in to Telegram just to tear it down.
            // Node-RED closes nodes in an unspecified order, so the config node may already have
            // destroyed the client — then there is simply nothing left to unsubscribe.
            const client = node.config && node.config.client;

            if (client) {
                if (node.rawEventHandlerAdded) {
                    client.removeEventHandler(node.rawEventHandler);
                    node.rawEventHandlerAdded = false;
                }

                // The builders below carry the same filters as the ones used to subscribe. GramJS
                // actually matches on the callback, not the builder, so this is for symmetry rather
                // than correctness — see doc/architecture/adr/0005-receiver-event-filters.md.
                if (node.newMessageEventHandlerAdded) {
                    client.removeEventHandler(node.newMessageEventHandler, new NewMessage(node.filters.message));
                    node.newMessageEventHandlerAdded = false;
                }

                if (node.deletedMessageEventHandlerAdded) {
                    client.removeEventHandler(node.deletedMessageEventHandler, new DeletedMessage(node.filters.common));
                    node.deletedMessageEventHandlerAdded = false;
                }

                if (node.editedMessageEventHandlerAdded) {
                    client.removeEventHandler(node.editedMessageEventHandler, new EditedMessage(node.filters.message));
                    node.editedMessageEventHandlerAdded = false;
                }

                if (node.albumEventHandlerAdded) {
                    client.removeEventHandler(node.albumEventHandler, new Album(node.filters.common));
                    node.albumEventHandlerAdded = false;
                }

                if (node.callbackQueryEventHandlerAdded) {
                    client.removeEventHandler(
                        node.callbackQueryEventHandler,
                        new CallbackQuery(node.filters.callbackQuery)
                    );
                    node.callbackQueryEventHandlerAdded = false;
                }
            }

            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.start = async () => {
            if (node.filters === undefined) {
                // The filter did not compile; the error was already reported in the constructor.
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: 'invalid filter',
                });
            } else if (node.config) {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    if (node.sendRawEvents) {
                        // No builder, so no filters: GramJS' Raw builder accepts only `types` and
                        // `func`, and raw updates arrive before entities are resolved anyway.
                        client.addEventHandler(node.rawEventHandler);
                        node.rawEventHandlerAdded = true;
                    }

                    if (node.sendNewMessage) {
                        client.addEventHandler(node.newMessageEventHandler, new NewMessage(node.filters.message));
                        node.newMessageEventHandlerAdded = true;
                    }

                    if (node.sendDeletedMessage) {
                        client.addEventHandler(
                            node.deletedMessageEventHandler,
                            new DeletedMessage(node.filters.common)
                        );
                        node.deletedMessageEventHandlerAdded = true;
                    }

                    if (node.sendEditedMessage) {
                        client.addEventHandler(node.editedMessageEventHandler, new EditedMessage(node.filters.message));
                        node.editedMessageEventHandlerAdded = true;
                    }

                    if (node.sendAlbum) {
                        client.addEventHandler(node.albumEventHandler, new Album(node.filters.common));
                        node.albumEventHandlerAdded = true;
                    }

                    if (node.sendCallbackQuery) {
                        client.addEventHandler(
                            node.callbackQueryEventHandler,
                            new CallbackQuery(node.filters.callbackQuery)
                        );
                        node.callbackQueryEventHandlerAdded = true;
                    }

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

        this.on('close', function (removed, done) {
            // stop() is async, so awaiting it is what makes the unsubscribe actually finish before
            // Node-RED considers this node closed.
            (async () => {
                try {
                    await node.stop();
                } catch (error) {
                    node.warn(error);
                } finally {
                    done();
                }
            })();
        });
    }

    RED.nodes.registerType('telegram client receiver', TelegramReceiverNode);
};
