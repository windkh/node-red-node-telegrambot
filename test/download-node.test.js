// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');

const helper = require('node-red-node-test-helper');
const telegramBotNode = require('../telegrambot/telegrambot.js');

helper.init(require.resolve('node-red'));

const configNode = { id: 'c1', type: 'telegram client config', name: 'test client' };

// A photo message in the shape the receiver emits, built from plain objects with GramJS' `className`
// discriminator. Nothing here touches the network.
function photoMessage(sizeInBytes) {
    const message = {
        id: 42,
        media: {
            className: 'MessageMediaPhoto',
            photo: {
                className: 'Photo',
                id: 777n,
                sizes: [{ className: 'PhotoSize', type: 'x', size: sizeInBytes }],
            },
        },
    };

    return { type: 'NewMessage', message: message, sender: { id: 'sender' }, chat: { id: 'chat' } };
}

describe('download node', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    async function load(downloadConfig) {
        const flow = [configNode, { id: 'n1', type: 'telegram client download', bot: 'c1', ...downloadConfig }];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        const calls = [];
        const client = {
            downloadMedia: async (message, params) => {
                calls.push({ message, params });
                return Buffer.from('bytes');
            },
        };
        n1.config.client = client;
        n1.config.getTelegramClient = async () => client;

        const statuses = [];
        n1.status = (status) => statuses.push(status);

        return { node: n1, calls, statuses };
    }

    function drive(node, payload) {
        return new Promise((resolve, reject) => {
            node.receive({ payload: payload, _msgid: '1' });
            node.on('call:error', (call) => reject(call.args[0]));
            node.on('input', () => {});
            // The node sends on success; capture that instead of guessing at timing.
            node.send = (msg) => resolve(msg);
            setTimeout(() => reject(new Error('nothing was sent or reported')), 1500);
        });
    }

    it('emits the buffer with metadata and keeps the original message', async () => {
        const { node, calls } = await load({});

        const sent = await drive(node, photoMessage(1000));

        assert.ok(Buffer.isBuffer(sent.payload), 'the bytes belong in payload');
        assert.strictEqual(sent.payload.toString(), 'bytes');
        assert.strictEqual(sent.filename, 'telegram-777.jpg');
        assert.strictEqual(sent.mimetype, 'image/jpeg');
        assert.deepStrictEqual(sent.telegram.sender, { id: 'sender' }, 'the message must stay reachable');
        assert.strictEqual(calls.length, 1);
    });

    it('passes the configured thumbnail index to downloadMedia', async () => {
        const { node, calls } = await load({ thumb: '0' });

        await drive(node, photoMessage(1000));

        assert.strictEqual(calls[0].params.thumb, 0);
    });

    it('asks for the full media when no thumbnail is configured', async () => {
        const { node, calls } = await load({ thumb: '' });

        await drive(node, photoMessage(1000));

        assert.strictEqual(calls[0].params.thumb, undefined);
    });

    it('refuses a download above the size limit without fetching it', async () => {
        const { node, calls } = await load({ maxsize: '1' });

        const error = await drive(node, photoMessage(5 * 1024 * 1024)).then(
            () => undefined,
            (reason) => reason
        );

        assert.match(String(error), /above the configured limit/);
        assert.deepStrictEqual(calls, [], 'nothing may be read into memory');
    });

    it('downloads when the size is within the limit', async () => {
        const { node, calls } = await load({ maxsize: '10' });

        await drive(node, photoMessage(5 * 1024 * 1024));

        assert.strictEqual(calls.length, 1);
    });

    it('treats a limit of zero as no limit', async () => {
        const { node, calls } = await load({ maxsize: '0' });

        await drive(node, photoMessage(500 * 1024 * 1024));

        assert.strictEqual(calls.length, 1);
    });

    it('reports a message with no media', async () => {
        const { node, calls } = await load({});

        const error = await drive(node, { type: 'NewMessage', message: { id: 1 } }).then(
            () => undefined,
            (reason) => reason
        );

        assert.match(String(error), /no media/);
        assert.deepStrictEqual(calls, []);
    });

    it('reports a payload that is not a telegram message', async () => {
        const { node } = await load({});

        const error = await drive(node, 'just text').then(
            () => undefined,
            (reason) => reason
        );

        assert.match(String(error), /not a telegram message/);
    });
});
