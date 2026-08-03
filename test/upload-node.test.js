// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');

const helper = require('node-red-node-test-helper');
const telegramBotNode = require('../telegrambot/telegrambot.js');
const { toUploadFile, needsFilename } = require('../telegrambot/lib/upload');

helper.init(require.resolve('node-red'));

const configNode = { id: 'c1', type: 'telegram client config', name: 'test client' };

describe('toUploadFile', () => {
    it('wraps a Buffer with the given name and its own length', () => {
        const buffer = Buffer.from('hello');
        const file = toUploadFile(buffer, 'greeting.txt');

        // Without this teleproto names a bare Buffer "unnamed", because Buffers carry no `name`.
        assert.strictEqual(file.name, 'greeting.txt');
        assert.strictEqual(file.size, 5, 'the size must come from the Buffer, not from the caller');
        assert.strictEqual(file.buffer, buffer);
    });

    it('passes a path through untouched', () => {
        // teleproto stats a path and uses its basename, so there is nothing to add.
        assert.strictEqual(toUploadFile('/tmp/clip.mp4', undefined), '/tmp/clip.mp4');
    });

    it('returns nothing for anything else', () => {
        for (const payload of [undefined, null, '', 42, {}, []]) {
            assert.strictEqual(toUploadFile(payload, 'x'), undefined, JSON.stringify(payload));
        }
    });

    it('knows a Buffer needs a name and a path does not', () => {
        assert.strictEqual(needsFilename(Buffer.from('x')), true);
        assert.strictEqual(needsFilename('/tmp/x'), false);
    });
});

describe('upload node', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    async function load(uploadConfig) {
        const flow = [configNode, { id: 'n1', type: 'telegram client upload', bot: 'c1', ...uploadConfig }];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        const calls = [];
        const client = {
            sendFile: async (peer, params) => {
                calls.push({ peer, params });
                return { className: 'Message', id: 99 };
            },
        };
        n1.config.client = client;
        n1.config.getTelegramClient = async () => client;
        n1.status = () => {};

        return { node: n1, calls };
    }

    function drive(node, msg) {
        return new Promise((resolve, reject) => {
            node.on('call:error', (call) => reject(call.args[0]));
            node.send = (out) => resolve(out);
            node.receive({ ...msg, _msgid: '1' });
            setTimeout(() => reject(new Error('nothing was sent or reported')), 1500);
        });
    }

    it('uploads a Buffer under its msg.filename', async () => {
        const { node, calls } = await load({ peer: 'someone' });

        const sent = await drive(node, { payload: Buffer.from('data'), filename: 'notes.txt' });

        assert.strictEqual(calls[0].peer, 'someone');
        assert.strictEqual(calls[0].params.file.name, 'notes.txt');
        assert.strictEqual(calls[0].params.file.size, 4);
        assert.deepStrictEqual(sent.payload, { className: 'Message', id: 99 }, 'the sent message is the result');
    });

    it('uploads a path without needing a filename', async () => {
        const { node, calls } = await load({ peer: 'someone' });

        await drive(node, { payload: '/tmp/clip.mp4' });

        assert.strictEqual(calls[0].params.file, '/tmp/clip.mp4');
    });

    it('refuses a Buffer with no filename rather than sending it as "unnamed"', async () => {
        const { node, calls } = await load({ peer: 'someone' });

        const error = await drive(node, { payload: Buffer.from('data') }).then(
            () => undefined,
            (reason) => reason
        );

        assert.match(String(error), /msg\.filename is required/);
        assert.deepStrictEqual(calls, []);
    });

    it('lets msg.peer override the configured destination', async () => {
        const { node, calls } = await load({ peer: 'configured' });

        await drive(node, { payload: '/tmp/x.txt', peer: 'from-message' });

        assert.strictEqual(calls[0].peer, 'from-message');
    });

    it('reports a missing destination', async () => {
        const { node, calls } = await load({ peer: '' });

        const error = await drive(node, { payload: '/tmp/x.txt' }).then(
            () => undefined,
            (reason) => reason
        );

        assert.match(String(error), /No destination/);
        assert.deepStrictEqual(calls, []);
    });

    it('reports a payload that is neither a Buffer nor a path', async () => {
        const { node } = await load({ peer: 'someone' });

        const error = await drive(node, { payload: { not: 'a file' } }).then(
            () => undefined,
            (reason) => reason
        );

        assert.match(String(error), /must be a Buffer or a file path/);
    });

    it('uses the configured caption and lets msg.caption win', async () => {
        const { node, calls } = await load({ peer: 'someone', caption: 'from config' });

        await drive(node, { payload: '/tmp/a.txt' });
        assert.strictEqual(calls[0].params.caption, 'from config');

        await drive(node, { payload: '/tmp/b.txt', caption: 'from message' });
        assert.strictEqual(calls[1].params.caption, 'from message');
    });

    it('passes the as-document flag through', async () => {
        const { node, calls } = await load({ peer: 'someone', forcedocument: true });

        await drive(node, { payload: '/tmp/a.png' });

        assert.strictEqual(calls[0].params.forceDocument, true);
    });
});
