// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');

const helper = require('node-red-node-test-helper');
const telegramBotNode = require('../telegrambot/telegrambot.js');
const { describeUpload } = require('../telegrambot/lib/upload');

helper.init(require.resolve('node-red'));

const configNode = { id: 'c1', type: 'telegram client config', name: 'test client' };

describe('describeUpload', () => {
    it('wraps a Buffer with the given name and its own length', () => {
        const buffer = Buffer.from('hello');
        const { file } = describeUpload(buffer, 'greeting.txt');

        // Without this teleproto names a bare Buffer "unnamed", because Buffers carry no `name`.
        assert.strictEqual(file.name, 'greeting.txt');
        assert.strictEqual(file.size, 5, 'the size must come from the Buffer, not from the caller');
        assert.strictEqual(file.buffer, buffer);
    });

    it('passes a path through untouched', () => {
        // teleproto stats a path and uses its basename, so there is nothing to add.
        assert.deepStrictEqual(describeUpload('/tmp/clip.mp4', undefined), { file: '/tmp/clip.mp4' });
    });

    it('reports a Buffer with no name rather than letting it be sent as "unnamed"', () => {
        // The wording is unchanged from before albums existed, because the node reports it verbatim and
        // a flow may be matching on it.
        for (const missing of [undefined, null, '']) {
            const { file, error } = describeUpload(Buffer.from('x'), missing);

            assert.strictEqual(file, undefined);
            assert.strictEqual(error, 'msg.filename is required when msg.payload is a Buffer.');
        }
    });

    it('reports anything that is not a file at all', () => {
        for (const payload of [undefined, null, '', 42, {}]) {
            const { file, error } = describeUpload(payload, 'x');

            assert.strictEqual(file, undefined, JSON.stringify(payload));
            assert.strictEqual(error, 'msg.payload must be a Buffer or a file path.');
        }
    });

    it('builds an album from an array, taking each name by position', () => {
        const first = Buffer.from('one');
        const { file, error } = describeUpload([first, '/tmp/two.jpg'], ['one.jpg']);

        assert.strictEqual(error, undefined);
        assert.strictEqual(file.length, 2);
        assert.strictEqual(file[0].name, 'one.jpg');
        assert.strictEqual(file[0].size, 3);
        // A path inside an album needs no entry in the filename array.
        assert.strictEqual(file[1], '/tmp/two.jpg');
    });

    it('names the position of the item that is wrong', () => {
        // "One of my five is broken" is the question this wording exists to answer.
        const bad = describeUpload(['/tmp/a.jpg', '/tmp/b.jpg', Buffer.from('c')], ['x', 'y']);

        assert.strictEqual(bad.file, undefined);
        assert.strictEqual(bad.error, 'msg.filename[2] is required when msg.payload[2] is a Buffer.');

        const alsoBad = describeUpload(['/tmp/a.jpg', 42], []);
        assert.strictEqual(alsoBad.error, 'msg.payload[1] must be a Buffer or a file path.');
    });

    it('refuses the whole album when one item is wrong, rather than sending part of it', () => {
        const { file } = describeUpload(['/tmp/a.jpg', 42, '/tmp/c.jpg'], []);

        assert.strictEqual(file, undefined, 'a half album is worse than none');
    });

    it('reports an empty array instead of asking Telegram to send nothing', () => {
        assert.strictEqual(describeUpload([], []).error, 'msg.payload is an empty array: nothing to send.');
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

    it('sends an array as one album', async () => {
        const { node, calls } = await load({ peer: 'someone' });

        await drive(node, { payload: [Buffer.from('a'), '/tmp/b.jpg'], filename: ['a.jpg'] });

        assert.ok(Array.isArray(calls[0].params.file), 'the album must reach the client as an array');
        assert.strictEqual(calls[0].params.file.length, 2);
        assert.strictEqual(calls[0].params.file[0].name, 'a.jpg');
        assert.strictEqual(calls[0].params.file[1], '/tmp/b.jpg');
    });

    it('reports which album item is wrong, and sends nothing', async () => {
        const { node, calls } = await load({ peer: 'someone' });

        const error = await drive(node, { payload: ['/tmp/a.jpg', Buffer.from('b')], filename: [] }).then(
            () => undefined,
            (reason) => reason
        );

        assert.match(String(error), /msg\.filename\[1\] is required/);
        assert.deepStrictEqual(calls, [], 'a half album must not be sent');
    });

    it('passes the silent flag through and lets msg.silent win', async () => {
        const { node, calls } = await load({ peer: 'someone', silent: true });

        await drive(node, { payload: '/tmp/a.txt' });
        assert.strictEqual(calls[0].params.silent, true);

        // false has to survive the override, which a plain `||` would swallow.
        await drive(node, { payload: '/tmp/b.txt', silent: false });
        assert.strictEqual(calls[1].params.silent, false);
    });

    it('passes msg.replyTo through, and leaves the key out when it is unset', async () => {
        const { node, calls } = await load({ peer: 'someone' });

        await drive(node, { payload: '/tmp/a.txt' });
        assert.ok(!('replyTo' in calls[0].params), 'an unset replyTo must not appear at all');

        await drive(node, { payload: '/tmp/b.txt', replyTo: 4242 });
        assert.strictEqual(calls[1].params.replyTo, 4242);
    });

    it('reports upload progress as a percentage in the status', async () => {
        const { node, calls } = await load({ peer: 'someone' });
        const statuses = [];
        node.status = (status) => statuses.push(status);

        await drive(node, { payload: '/tmp/a.txt' });

        // teleproto hands the callback a fraction and calls it per chunk; a 40 MB upload otherwise looks
        // like a hang.
        const report = calls[0].params.progressCallback;
        assert.strictEqual(typeof report, 'function');

        report(0.42);
        assert.deepStrictEqual(statuses.at(-1), { fill: 'blue', shape: 'dot', text: 'uploading 42%' });
    });

    it('cancels an upload still in flight when the node closes', async () => {
        // teleproto checks `isCanceled` at each chunk boundary and throws USER_CANCELED. Without this a
        // redeploy would keep pushing bytes for a node that no longer exists.
        let release;
        const held = new Promise((resolve) => {
            release = resolve;
        });

        const flow = [configNode, { id: 'n1', type: 'telegram client upload', bot: 'c1', peer: 'someone' }];
        await helper.load(telegramBotNode, flow);
        const n1 = helper.getNode('n1');
        n1.status = () => {};

        let seen;
        n1.config.getTelegramClient = async () => ({
            sendFile: async (peer, params) => {
                seen = params.progressCallback;
                await held;
                return { className: 'Message', id: 1 };
            },
        });

        n1.receive({ payload: '/tmp/a.txt', _msgid: '1' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(typeof seen, 'function', 'the upload should be in flight');
        assert.notStrictEqual(seen.isCanceled, true, 'not cancelled yet');

        await n1.close();

        assert.strictEqual(seen.isCanceled, true, 'closing must cancel the upload in flight');
        release();
    });
});
