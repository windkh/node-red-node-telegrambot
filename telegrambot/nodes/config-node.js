// Created by Karl-Heinz Wind
'use strict';

const { createTelegramClient } = require('../lib/telegram-client');

// The configuration node owns the shared TelegramClient. Receiver and sender nodes reference it and
// ask for the client via getTelegramClient, so one session serves every node in the flow.
module.exports = function (RED) {
    function TelegramConfigNode(n) {
        RED.nodes.createNode(this, n);

        this.config = n;
        this.client = null;
        this.logLevel = 'warn'; // 'none', 'error', 'warn','info', 'debug'
        this.verbose = n.verboselogging;
        this.useProxy = n.useproxy || false;
        this.useWSS = n.usewss || false;
        this.proxy;
        const deviceModel = n.devicemodel || '';
        const systemVersion = n.systemversion || '';
        const appVersion = n.appversion || '';

        if (this.useProxy) {
            this.proxy = {
                ip: n.host,
                socksType: Number(n.sockstype),
                port: Number(n.port),
                username: n.username,
                password: n.password,
                secret: n.secret,
                MTProxy: n.mtproxy,
                timeout: Number(n.timeout),
            };
        }

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

        this.createTelegramClient = async function (
            node,
            apiId,
            apiHash,
            session,
            phoneNumber,
            botToken,
            logLevel,
            proxy,
            useWSS
        ) {
            const options = {
                apiId: apiId,
                apiHash: apiHash,
                session: session,
                phoneNumber: phoneNumber,
                botToken: botToken,
                logLevel: logLevel,
                proxy: proxy,
                useWSS: useWSS,
                deviceModel: deviceModel,
                systemVersion: systemVersion,
                appVersion: appVersion,
            };

            return await createTelegramClient(options, (message) => node.warn(message));
        };

        // Activates the client or returns the already activated bot.
        this.getTelegramClient = async function (node) {
            if (!this.client) {
                this.client = await this.createTelegramClient(
                    node,
                    this.apiId,
                    this.apiHash,
                    this.session,
                    this.phoneNumber,
                    this.botToken,
                    this.logLevel,
                    this.proxy,
                    this.useWSS
                );
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
};
