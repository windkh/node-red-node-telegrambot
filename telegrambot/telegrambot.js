// Created by Karl-Heinz Wind

module.exports = function (RED) {
    'use strict';

    const { Api, TelegramClient } = require('telegram');
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

    async function login(parameters, getPhoneCode, getPassword, sessionCreated, error) {
        try {
            let apiId = Number(parameters.apiId);
            let apiHash = parameters.apiHash;
            let phoneNumber = parameters.phoneNumber;
            let botToken = parameters.botToken;
            let password = parameters.password;
            let loginMode = parameters.loginMode;

            if (password === undefined || password === '') {
                password = async () => await getPassword;
            }

            if (apiId !== undefined && apiHash !== undefined && phoneNumber !== undefined) {
                const stringSession = new StringSession('');
                const client = new TelegramClient(stringSession, apiId, apiHash, {
                    connectionRetries: 5,
                });

                // client.setLogLevel('debug');

                let authParams;
                if (loginMode === 'user') {
                    authParams = {
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
                } else if (loginMode === 'bot') {
                    authParams = {
                        botAuthToken: botToken,
                    };
                } else {
                    throw 'LoginMode ' + loginMode + ' is not supported';
                }

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

    RED.httpAdmin.get('/node-red-node-telegrambot-login', function (req, res) {
        let parameters = req.query;

        let getPhoneCode = createPhoneCodePromise();
        let getPassword = createPasswordPromise();

        try {
            login(
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
        this.verbose = n.verboselogging;
        this.loginMode = n.loginmode;
        if (!this.loginMode) {
            this.loginMode = 'user';
        }

        if (this.verbose) {
            this.logLevel = 'debug';
        }

        // let self = this;
        if (this.credentials !== undefined) {
            this.apiId = this.credentials.apiid || '';
            this.apiHash = this.credentials.apihash || '';
            this.session = this.credentials.session || '';
            this.phoneNumber = this.credentials.phonenumber || '';
        }

        this.createTelegramClient = async function createTelegramClient(node, apiId, apiHash, session, phoneNumber, botToken, logLevel) {
            let client;
            try {
                if (apiId !== undefined && apiId !== '' && session !== undefined && session !== '') {
                    const stringSession = new StringSession(session);
                    const ID = Number(apiId);
                    client = new TelegramClient(stringSession, ID, apiHash, {
                        connectionRetries: 5,
                    });

                    client.setLogLevel(logLevel);

                    let authParams;
                    if (botToken === undefined) {
                        authParams = {
                            phoneNumber: phoneNumber,
                            onError: (err) => {
                                console.log(err);
                                return true; // abort
                            },
                        };
                    } else {
                        authParams = {
                            botAuthToken: botToken,
                        };
                    }

                    await client.start(authParams);
                    await client.connect();
                } else {
                    node.warn('No session: login first.');
                }
            } catch (error) {
                node.warn(error);
            }

            return client;
        };

        // Activates the client or returns the already activated bot.
        this.getTelegramClient = async function (node) {
            if (!this.client) {
                this.client = await this.createTelegramClient(node, this.apiId, this.apiHash, this.session, this.phoneNumber, this.botToken, this.logLevel);
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
    RED.nodes.registerType('telegram client config', TelegramConfigNode, {
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
        this.sendRawEvents = config.sendrawevents || false;
        this.rawEventHandlerAdded = false;
        this.newMessageEventHandlerAdded = false;

        this.rawEventHandler = async (event) => {
            let msg = {
                payload: event,
            };
            node.send(msg);
        };

        this.newMessageEventHandler = async (event) => {
            let message = event.message;
            let msg = {
                payload: {
                    message: message,
                    sender: await message.getSender(),
                    chat: await message.getChat(),
                    event: event,
                },
            };
            node.send(msg);
        };

        this.stop = async () => {
            if (node.config) {
                let client = await node.config.getTelegramClient(node);
                if (client) {
                    if (node.rawEventHandlerAdded) {
                        client.removeEventHandler(node.rawEventHandler);
                        node.rawEventHandlerAdded = false;
                    }

                    if (node.newMessageEventHandlerAdded) {
                        client.removeEventHandler(node.newMessageEventHandler, new NewMessage({}));
                        node.newMessageEventHandlerAdded = false;
                    }
                }
            }

            node.status({
                fill: 'green',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.start = async () => {
            if (node.config) {
                let client = await node.config.getTelegramClient(node);
                if (client) {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'connected',
                    });

                    if (node.sendRawEvents) {
                        client.addEventHandler(node.rawEventHandler);
                        node.rawEventHandlerAdded = true;
                    } else {
                        client.addEventHandler(node.newMessageEventHandler, new NewMessage({}));
                        node.newMessageEventHandlerAdded = true;
                    }
                }
            } else {
                // no config node?
            }
        };
        this.start();

        this.on('close', function (removed, done) {
            node.stop();
            node.status({});
            done();
        });
    }
    RED.nodes.registerType('telegram client receiver', TelegramReceiverNode);

    // --------------------------------------------------------------------------------------------
    // The sender node sends messages.
    function TelegramSenderNode(config) {
        RED.nodes.createNode(this, config);
        let node = this;
        this.bot = config.bot;
        this.config = RED.nodes.getNode(this.bot);

        this.start = async () => {
            if (node.config) {
                let client = await node.config.getTelegramClient(node);
                if (client) {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'connected',
                    });
                }
            } else {
                // no config node?
            }
        };
        this.start();

        this.processMessage = function (client, msg, nodeSend, nodeDone) {
            if (msg.payload !== undefined) {
                let api = msg.payload.api;
                let func = msg.payload.func;
                let args = msg.payload.args || {};

                if (api !== undefined && func !== undefined) {
                    (async () => {
                        try {
                            let request = new Api[api][func](args);
                            const result = await client.invoke(request);
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
                    let client = await node.config.getTelegramClient(node);
                    if (client) {
                        this.processMessage(client, msg, nodeSend, nodeDone);
                    }
                } else {
                    // no config node?
                }
            }
        });

        this.on('close', function (removed, done) {
            node.status({});
            done();
        });
    }
    RED.nodes.registerType('telegram client sender', TelegramSenderNode);
};
