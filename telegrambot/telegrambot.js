// Created by Karl-Heinz Wind

module.exports = function (RED) {
    'use strict';

    const { TelegramClient } = require('telegram');
    const { StringSession } = require('telegram/sessions');
    const { NewMessage } = require('telegram/events');

    // --------------------------------------------------------------------------------------------
    let getPhoneCodeResolve;
    let getPhoneCodeReject;
    let getPasswordResolve;
    let getPasswordReject;

    function createPhoneCodePromise() {
        let getPhoneCode = new Promise((resolve, reject) => {
            getPhoneCodeResolve = resolve;
            getPhoneCodeReject = reject;
        });

        return getPhoneCode;
    }

    function createPasswordPromise() {
        let getPassword = new Promise((resolve, reject) => {
            getPasswordResolve = resolve;
            getPasswordReject = reject;
        });

        return getPassword;
    }

    async function loginUser(parameters, getPhoneCode, getPassword, sessionCreated, error) {
        try {
            let apiId = Number(parameters.apiId);
            let apiHash = parameters.apiHash;
            let phoneNumber = parameters.phoneNumber;
            let password = parameters.password;
            if (password === undefined || password === '') {
                password = async () => await getPassword;
            }

            if (apiId !== undefined && apiHash !== undefined && phoneNumber !== undefined) {
                const stringSession = new StringSession('');
                const client = new TelegramClient(stringSession, apiId, apiHash, {
                    connectionRetries: 5,
                });

                // client.setLogLevel('debug');

                let authParams = {
                    phoneNumber: phoneNumber,
                    phoneCode: async () => await getPhoneCode,
                    password: password,
                    onError: (err) => {
                        console.log(err);
                        // if (err.errorMessage === 'PHONE_CODE_INVALID') {
                        // }
                        return true; // abort
                    },
                };
                await client.start(authParams);

                let session = client.session.save();
                sessionCreated(session);
            } else {
                error('Parameters are missing: apiId, apiHash, phoneNumber');
            }
        } catch (err) {
            error(err);
        }
    }

    RED.httpAdmin.get('/node-red-node-telegrambot-setphonecode', function (req, res) {
        let parameters = req.query;

        if (getPhoneCodeResolve !== undefined && getPhoneCodeResolve !== null) {
            let phoneCode = parameters.phoneCode;
            if (phoneCode !== '') {
                getPhoneCodeResolve(phoneCode);
            } else {
                //  if (err.errorMessage === "RESTART_AUTH") {
                getPhoneCodeReject(phoneCode);
            }
        }

        res.json('ok');
    });

    RED.httpAdmin.get('/node-red-node-telegrambot-setpassword', function (req, res) {
        let parameters = req.query;

        if (getPasswordResolve !== undefined && getPasswordResolve !== null) {
            let password = parameters.password;
            if (password !== '') {
                getPasswordResolve(password);
            } else {
                getPasswordReject(password);
            }
        }

        res.json('ok');
    });

    RED.httpAdmin.get('/node-red-node-telegrambot-loginuser', function (req, res) {
        let parameters = req.query;

        let getPhoneCode = createPhoneCodePromise();
        let getPassword = createPasswordPromise();

        try {
            loginUser(
                parameters,
                getPhoneCode,
                getPassword,
                (session) => {
                    let data = { session: session };
                    res.json(data);
                },
                (error) => {
                    let message;
                    if (error.code !== undefined) {
                        message = 'Error ' + error.code + ' (' + error.errorMessage + '): ' + error.message;
                    } else if (error.message !== undefined) {
                        message = error.message;
                    } else {
                        message = error;
                    }

                    let data = {
                        type: 'error',
                        error: message,
                    };
                    res.json(data);
                }
            );
        } catch (allErrors) {
            // TODO:
        }
    });

    // --------------------------------------------------------------------------------------------
    // The configuration node
    function TelegramConfigNode(n) {
        RED.nodes.createNode(this, n);

        this.config = n;
        this.client = null;
        this.logLevel = 'warn'; // 'none', 'error', 'warn','info', 'debug'

        // let self = this;
        if (this.credentials !== undefined) {
            this.apiId = this.credentials.apiid || '';
            this.apiHash = this.credentials.apihash || '';
            this.session = this.credentials.session || '';
            this.phoneNumber = this.credentials.phonenumber || '';
        }

        this.createTelegramClient = async function createTelegramClient(apiId, apiHash, session, logLevel) {
            let client;
            if (apiId !== undefined && apiId !== '') {
                const stringSession = new StringSession(session);
                const ID = Number(apiId);
                client = new TelegramClient(stringSession, ID, apiHash, {
                    connectionRetries: 5,
                });

                client.setLogLevel(logLevel);

                await client.start({
                    onError: (err) => {
                        console.log(err);
                        return true; // true means that it should be stopped.
                    },
                });
            }

            return client;
        };

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

        const eventHandler = async function (event) {
            const message = event.message;
            const sender = await message.getSender();
            const chat = await message.getChat();
            let msg = {
                payload: {
                    sender: sender,
                    chat: chat,
                    message: message,
                    originalUpdate: event.originalUpdate,
                },
            };
            node.send(msg);
        };

        const start = async () => {
            let client = await node.config.getTelegramClient();
            if (client) {
                node.status({
                    fill: 'green',
                    shape: 'ring',
                    text: 'connected',
                });

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
