// Created by Karl-Heinz Wind
'use strict';

const { NewMessage } = require('telegram/events');
const { DeletedMessage } = require('telegram/events/DeletedMessage');
const { EditedMessage } = require('telegram/events/EditedMessage');
const { Album } = require('telegram/events/Album');
const { CallbackQuery } = require('telegram/events/CallbackQuery');

// The receiver node subscribes to Telegram events on the shared client and emits one message per
// event. Which event types are subscribed is configured per node; each subscription is tracked so
// that only the handlers actually added are removed again on close.
module.exports = function (RED) {
    function TelegramReceiverNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);
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
            if (node.config) {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    if (node.rawEventHandlerAdded) {
                        client.removeEventHandler(node.rawEventHandler);
                        node.rawEventHandlerAdded = false;
                    }

                    if (node.newMessageEventHandlerAdded) {
                        client.removeEventHandler(node.newMessageEventHandler, new NewMessage({}));
                        node.newMessageEventHandlerAdded = false;
                    }

                    if (node.deletedMessageEventHandlerAdded) {
                        client.removeEventHandler(node.deletedMessageEventHandler, new DeletedMessage({}));
                        node.deletedMessageEventHandlerAdded = false;
                    }

                    if (node.editedMessageEventHandlerAdded) {
                        client.removeEventHandler(node.editedMessageEventHandler, new EditedMessage({}));
                        node.editedMessageEventHandlerAdded = false;
                    }

                    if (node.albumEventHandlerAdded) {
                        client.removeEventHandler(node.albumEventHandler, new Album({}));
                        node.albumEventHandlerAdded = false;
                    }

                    if (node.callbackQueryEventHandlerAdded) {
                        client.removeEventHandler(node.callbackQueryEventHandler, new CallbackQuery({}));
                        node.callbackQueryEventHandlerAdded = false;
                    }
                }
            }

            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.start = async () => {
            if (node.config) {
                const client = await node.config.getTelegramClient(node);
                if (client) {
                    if (node.sendRawEvents) {
                        client.addEventHandler(node.rawEventHandler);
                        node.rawEventHandlerAdded = true;
                    }

                    if (node.sendNewMessage) {
                        client.addEventHandler(node.newMessageEventHandler, new NewMessage({}));
                        node.newMessageEventHandlerAdded = true;
                    }

                    if (node.sendDeletedMessage) {
                        client.addEventHandler(node.deletedMessageEventHandler, new DeletedMessage({}));
                        node.deletedMessageEventHandlerAdded = true;
                    }

                    if (node.sendEditedMessage) {
                        client.addEventHandler(node.editedMessageEventHandler, new EditedMessage({}));
                        node.editedMessageEventHandlerAdded = true;
                    }

                    if (node.sendAlbum) {
                        client.addEventHandler(node.albumEventHandler, new Album({}));
                        node.albumEventHandlerAdded = true;
                    }

                    if (node.sendCallbackQuery) {
                        client.addEventHandler(node.callbackQueryEventHandler, new CallbackQuery({}));
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
            node.stop();
            // node.status({});
            done();
        });
    }

    RED.nodes.registerType('telegram client receiver', TelegramReceiverNode);
};
