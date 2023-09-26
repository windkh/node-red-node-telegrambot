// Created by Karl-Heinz Wind

module.exports = function (RED) {
    'use strict';

    // --------------------------------------------------------------------------------------------
    // The configuration node
    function TelegramConfigNode(n) {
        RED.nodes.createNode(this, n);

        // let self = this;

        this.onStarted = function () {};
        RED.events.on('flows:started', this.onStarted);

        this.on('close', function (removed, done) {
            RED.events.removeListener('flows:started', this.onStarted);
            done();
        });
    }
    RED.nodes.registerType('telegram userbot config', TelegramConfigNode, {
        credentials: {
            appid: { type: 'text' },
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

        this.on('close', function (removed, done) {
            node.status({});
            done();
        });
    }
    RED.nodes.registerType('telegram userbot receiver', TelegramReceiverNode);
};
