// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');

const helper = require('node-red-node-test-helper');
const telegramBotNode = require('../telegrambot/telegrambot.js');

helper.init(require.resolve('node-red'));

const configNode = { id: 'c1', type: 'telegram client config', name: 'test client' };

// A photo message in the shape the receiver emits, built from plain objects with teleproto's `className`
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

// Progress and cancellation, which the upload node has had since 1.2.0 while this one showed a static
// `downloading` and kept streaming into a closed node.
describe('download progress and cancellation', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    async function loadWithClient(onDownload) {
        const flow = [configNode, { id: 'n1', type: 'telegram client download', bot: 'c1' }];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        const statuses = [];
        n1.status = (status) => statuses.push(status);
        n1.config.getTelegramClient = async () => ({ downloadMedia: onDownload });

        return { node: n1, statuses: statuses };
    }

    const A_PHOTO = {
        className: 'Message',
        id: 1,
        media: {
            className: 'MessageMediaPhoto',
            photo: { id: 9, sizes: [{ className: 'PhotoSize', type: 'x', size: 2048 }] },
        },
    };

    it('reports progress as a percentage of the bytes teleproto has fetched', async () => {
        let report;
        const { node, statuses } = await loadWithClient(async (message, params) => {
            report = params.progressCallback;
            // Checked before use: without it a missing callback fails as a timeout rather than as an
            // assertion, which says much less about what went wrong.
            if (typeof report === 'function') {
                report(512, 2048);
            }
            return Buffer.from('data');
        });

        await new Promise((resolve) => {
            node.send = () => resolve();
            node.receive({ payload: A_PHOTO, _msgid: '1' });
        });

        // Bytes, not a fraction — the mirror image of the upload node.
        assert.strictEqual(typeof report, 'function');
        assert.ok(
            statuses.some((status) => status.text === 'downloading 25%'),
            'expected a percentage, got ' + JSON.stringify(statuses.map((s) => s.text))
        );
    });

    it('shows no percentage when the server did not state a size', async () => {
        // A percentage of nothing would read as "0%" forever.
        const { node, statuses } = await loadWithClient(async (message, params) => {
            params.progressCallback(512, 0);
            return Buffer.from('data');
        });

        await new Promise((resolve) => {
            node.send = () => resolve();
            node.receive({ payload: A_PHOTO, _msgid: '1' });
        });

        // Not a digit test: without the guard the text reads `downloading Infinity%`, which a `\d` match
        // sails straight past. Anything after the word at all is wrong here.
        const shown = statuses.filter((status) => status.text.startsWith('downloading')).map((status) => status.text);
        assert.deepStrictEqual([...new Set(shown)], ['downloading'], 'no percentage may be shown');
    });

    it('hands teleproto a signal and aborts it when the node closes', async () => {
        let seen;
        let release;
        const held = new Promise((resolve) => {
            release = resolve;
        });

        const { node } = await loadWithClient(async (message, params) => {
            seen = params.signal;
            await held;
            return Buffer.from('data');
        });

        node.receive({ payload: A_PHOTO, _msgid: '1' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.ok(seen instanceof AbortSignal, 'a real AbortSignal must be passed');
        assert.strictEqual(seen.aborted, false, 'not aborted yet');

        await node.close();

        // teleproto checks this in its streaming loop, so a 40 MB video stops between chunks.
        assert.strictEqual(seen.aborted, true, 'closing must abort a download in flight');
        release();
    });
});
