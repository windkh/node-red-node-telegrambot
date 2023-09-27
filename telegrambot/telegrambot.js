// Created by Karl-Heinz Wind

module.exports = function (RED) {
    'use strict';

    const { TelegramClient } = require('telegram');
    const { StringSession } = require('telegram/sessions');
    const { NewMessage } = require('telegram/events');

    // --------------------------------------------------------------------------------------------
    // The configuration node
    function TelegramConfigNode(n) {
        RED.nodes.createNode(this, n);

        this.config = n;
        this.client = null;
        this.logLevel = 'debug';

        // let self = this;
        if (this.credentials !== undefined) {
            this.apiId = this.credentials.apiid || '';
            this.apiHash = this.credentials.apihash || '';
            this.session = this.credentials.session || '';
            this.phoneNumber = this.credentials.phonenumber || '';
        }

        this.createTelegramClient = async function (apiId, apiHash, session, phonenumber, logLevel, done) {
            let client;
            if (apiId !== undefined && apiId !== '') {
                const stringSession = new StringSession(session);
                const ID = Number(apiId);
                client = new TelegramClient(stringSession, ID, apiHash, {
                    connectionRetries: 5,
                });
    
                client.setLogLevel(logLevel);
    
                await client.start({
                    phoneNumber: phonenumber, // TODO: check if we need this
                    onError: (err) => console.log(err),
                });
            }

            return client;
        }

        // Activates the client or returns the already activated bot.
        this.getTelegramClient = async function () {
            if (!this.client) {
                this.client = await this.createTelegramClient(this.apiId, this.apiHash, this.session, this.phoneNumber, this.logLevel);
            }

            return this.client;
        };
        
        this.onStarted = function () {};
        RED.events.on('flows:started', this.onStarted);

        this.on('close', function (removed, done) {
            RED.events.removeListener('flows:started', this.onStarted);
            done();
        });
    }
    RED.nodes.registerType('telegram userbot config', TelegramConfigNode, {
        credentials: {
            apiid: { type: 'text' },
            apihash: { type: 'text' },
            session: { type: 'text' },
            phonenumber: { type: 'text' },
        },
    });

    // --------------------------------------------------------------------------------------------
    // The receiver node receives messages.
    function TelegramReceiverNode(config) {
        RED.nodes.createNode(this, config);
        let node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);

        const start = async () => 
        {
            let client = await node.config.getTelegramClient();
            if (client) {
                node.status({
                    fill: 'green',
                    shape: 'ring',
                    text: 'connected',
                });

                async function eventHandler(event) {
                    const message = event.message;
                    const sender = await message.getSender();
                    const chat = await message.getChat();
                    let msg = {
                        payload : {
                            sender : sender,
                            chat : chat,
                            message : message,
                            originalUpdate : event.originalUpdate
                        },
                    }
                    node.send(msg);
                }
                client.addEventHandler(eventHandler, new NewMessage({}));

                // client.addEventHandler((update) => {
                //     let msg = {
                //         payload : {
                //             update : update,
                //         }
                //     }
                //     node.send(msg);
                // });
            }
        };
        start();

        this.on('close', function (removed, done) {
            node.status({});
            done();
        });
    }
    RED.nodes.registerType('telegram userbot receiver', TelegramReceiverNode);
};

// TODO:
// await client.sendMessage(sender, {
//    message: `hi your id is ${message.senderId}`,
//});
// const entity = await client.getEntity('Windhose');
// await client.sendMessage(entity, { message: 'Hello!' });