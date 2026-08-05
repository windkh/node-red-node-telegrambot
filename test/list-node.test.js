// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');

const helper = require('node-red-node-test-helper');
const telegramBotNode = require('../telegrambot/telegrambot.js');
const {
    LIST_KINDS,
    DEFAULT_LIMIT,
    resolveLimit,
    buildListArgs,
    emitCount,
    resolveListSettings,
} = require('../telegrambot/lib/list-request');

helper.init(require.resolve('node-red'));

const configNode = { id: 'c1', type: 'telegram client config', name: 'test client' };

describe('resolveLimit', () => {
    it('defaults a blank limit to 100, not to unbounded', () => {
        // The whole point of the option. teleproto's own default is Number.MAX_SAFE_INTEGER, which on a
        // busy channel means reading it to the beginning — slow, and a way to earn a FLOOD_WAIT on a
        // user account.
        for (const blank of [undefined, null, '']) {
            assert.strictEqual(resolveLimit(blank), DEFAULT_LIMIT, `'${blank}' must mean the default`);
        }
    });

    it('treats 0 as unbounded, which the library spells undefined', () => {
        // Same convention as the download node's "Max size", where 0 disables the check. The editor
        // stores numbers as strings, so both have to work — and a numeric 0 is what catches a falsy
        // guard.
        assert.strictEqual(resolveLimit(0), undefined);
        assert.strictEqual(resolveLimit('0'), undefined);
    });

    it('passes a configured limit through as a number', () => {
        assert.strictEqual(resolveLimit(250), 250);
        assert.strictEqual(resolveLimit('250'), 250);
    });

    it('falls back to the default for anything that is not a usable count', () => {
        // The editor validates this; if something invalid gets through, a bounded read is the safe
        // reading — never an accidental unbounded one.
        for (const bad of ['soon', '-5', '1.5', {}]) {
            assert.strictEqual(resolveLimit(bad), DEFAULT_LIMIT, JSON.stringify(bad));
        }
    });
});

describe('buildListArgs', () => {
    it('puts the entity first for messages and participants', () => {
        assert.deepStrictEqual(buildListArgs('messages', 'somechat', 50, ''), ['somechat', { limit: 50 }]);
        assert.deepStrictEqual(buildListArgs('participants', 'somegroup', 50, ''), ['somegroup', { limit: 50 }]);
    });

    it('passes options alone for dialogs, and always passes an object', () => {
        // iterDialogs destructures its parameter, so calling it with nothing throws before it reaches
        // Telegram.
        assert.deepStrictEqual(buildListArgs('dialogs', '', 50, ''), [{ limit: 50 }]);
        assert.deepStrictEqual(buildListArgs('dialogs', '', undefined, ''), [{ limit: undefined }]);
    });

    it('includes a search only where Telegram accepts one', () => {
        assert.deepStrictEqual(buildListArgs('messages', 'c', 10, 'invoice'), ['c', { limit: 10, search: 'invoice' }]);
        assert.deepStrictEqual(buildListArgs('participants', 'g', 10, 'ann'), ['g', { limit: 10, search: 'ann' }]);

        // Dropping it silently would be worse than not offering it, which is why the editor hides the
        // field for dialogs — this is the runtime half of that.
        assert.deepStrictEqual(buildListArgs('dialogs', '', 10, 'invoice'), [{ limit: 10 }]);
    });

    it('leaves an empty search out rather than passing an empty string', () => {
        assert.deepStrictEqual(buildListArgs('messages', 'c', 10, ''), ['c', { limit: 10 }]);
    });
});

describe('emitCount', () => {
    it('is the total when the read is unbounded', () => {
        assert.strictEqual(emitCount(undefined, 4000), 4000);
    });

    it('is the limit when the limit bites', () => {
        assert.strictEqual(emitCount(100, 4000), 100);
    });

    it('is the total when there is less than the limit', () => {
        assert.strictEqual(emitCount(100, 12), 12);
    });
});

// A stand-in for the iterator teleproto returns: async-iterable, and carrying `total` the way
// RequestIter does — set as the first chunk is loaded, so it is readable from the first item onwards.
function createFakeIterator(items, total, options) {
    const settings = options || {};

    return {
        total: undefined,
        calls: [],
        [Symbol.asyncIterator]() {
            const iterator = this;
            let index = 0;

            return {
                next: async () => {
                    // The real iterator learns the total while fetching the first chunk, before it
                    // yields anything from it. A fake that set it up front would let a node read it too
                    // early and still pass.
                    iterator.total = total;

                    if (settings.throwAt === index) {
                        throw settings.error;
                    }
                    if (settings.beforeEach) {
                        await settings.beforeEach(index);
                    }
                    if (index >= items.length) {
                        return { value: undefined, done: true };
                    }

                    const value = items[index];
                    index = index + 1;

                    return { value: value, done: false };
                },
            };
        },
    };
}

function createFakeClient(items, total, options) {
    const recorded = { args: undefined, method: undefined };
    const iterator = createFakeIterator(items, total, options);

    const record = (method) => {
        return (...args) => {
            recorded.method = method;
            recorded.args = args;
            return iterator;
        };
    };

    return {
        recorded: recorded,
        iterMessages: record('iterMessages'),
        iterDialogs: record('iterDialogs'),
        iterParticipants: record('iterParticipants'),
    };
}

// Loads a one-node flow with the client faked. Output is captured by replacing node.send, which is
// what the other node tests in this suite do — nodeSend wraps it, so every emitted message lands in
// .
async function load(nodeConfig, client) {
    const flow = [configNode, { id: 'n1', type: 'telegram client list', bot: 'c1', ...nodeConfig }];
    await helper.load(telegramBotNode, flow);

    const n1 = helper.getNode('n1');
    n1.config.getTelegramClient = async () => client;

    const sent = [];
    n1.send = (msg) => sent.push(msg);

    return { n1: n1, sent: sent };
}

// Node-RED completes a message through `done`; waiting on that rather than on a timer is what makes
// these deterministic.
function whenDone(node) {
    return new Promise((resolve) => {
        const original = node._complete ? node._complete.bind(node) : undefined;
        node._complete = function (msg, error) {
            if (original) {
                original(msg, error);
            }
            resolve(error);
        };
    });
}

// Every setting the dialog offers can also arrive with the message. Two ways in: `msg.payload` as an
// object, which is what a Function node in front of the node builds, and the flat `msg.peer` /
// `msg.limit` / `msg.search` that predate it and have to keep working.
describe('resolveListSettings', () => {
    const CONFIGURED = { what: 'messages', peer: 'somechat', limit: 50, search: '', mode: 'stream' };

    it('uses the node configuration when the message says nothing', () => {
        assert.deepStrictEqual(resolveListSettings(CONFIGURED, { payload: 'go' }), CONFIGURED);
    });

    it('takes every setting from msg.payload', () => {
        const settings = resolveListSettings(CONFIGURED, {
            payload: { what: 'dialogs', peer: 'me', limit: 5, search: 'invoice', mode: 'array' },
        });

        assert.deepStrictEqual(settings, {
            what: 'dialogs',
            peer: 'me',
            limit: 5,
            search: 'invoice',
            mode: 'array',
        });
    });

    it('still takes the flat fields, which came first', () => {
        const settings = resolveListSettings(CONFIGURED, { payload: 'go', peer: 'other', limit: 7, search: 'x' });

        assert.strictEqual(settings.peer, 'other');
        assert.strictEqual(settings.limit, 7);
        assert.strictEqual(settings.search, 'x');
    });

    it('lets msg.payload win over a flat field, because it is the more specific ask', () => {
        const settings = resolveListSettings(CONFIGURED, { peer: 'flat', payload: { peer: 'from-payload' } });

        assert.strictEqual(settings.peer, 'from-payload');
    });

    it('ignores a payload that is not a settings object', () => {
        // The usual trigger is an inject, whose payload is a timestamp or a string. Reading fields off
        // that would turn every such trigger into a request full of undefined.
        for (const payload of [Date.now(), 'go', ['a'], null, undefined, true]) {
            assert.deepStrictEqual(
                resolveListSettings(CONFIGURED, { payload: payload }),
                CONFIGURED,
                JSON.stringify(payload) + ' must contribute nothing'
            );
        }
    });

    it('treats an empty string as "not given", so a blank field does not erase a setting', () => {
        const settings = resolveListSettings(CONFIGURED, { peer: '', payload: { what: '', search: '' } });

        assert.strictEqual(settings.peer, 'somechat');
        assert.strictEqual(settings.what, 'messages');
        assert.strictEqual(settings.search, '');
    });

    it('passes a limit of 0 through, which is how unbounded is asked for', () => {
        // 0 is falsy and meaningful here — resolveLimit turns it into undefined for the library.
        assert.strictEqual(resolveListSettings(CONFIGURED, { payload: { limit: 0 } }).limit, 0);
    });
});

describe('list node', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    it('emits one message per item with joinable parts', async () => {
        const client = createFakeClient(['a', 'b', 'c'], 3);
        const { n1, sent } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });
        assert.strictEqual(await done, undefined);

        assert.deepStrictEqual(
            sent.map((msg) => msg.payload),
            ['a', 'b', 'c']
        );

        // What a standard join node in automatic mode needs: one group id, ascending indices, and a
        // count it can compare them against.
        const groups = new Set(sent.map((msg) => msg.parts.id));
        assert.strictEqual(groups.size, 1, 'all items belong to one group');
        assert.deepStrictEqual(
            sent.map((msg) => msg.parts.index),
            [0, 1, 2]
        );
        for (const msg of sent) {
            assert.strictEqual(msg.parts.count, 3);
            assert.strictEqual(msg.parts.type, 'array');
        }
    });

    it('gives each emitted message its own parts', async () => {
        // Emitting the same object three times would hand the join node one reference carrying the last
        // index, and the join would never complete.
        const client = createFakeClient(['a', 'b'], 2);
        const { n1, sent } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });
        await done;

        assert.notStrictEqual(sent[0], sent[1], 'the same message object was emitted twice');
        assert.notStrictEqual(sent[0].parts, sent[1].parts);
        assert.strictEqual(sent[0].parts.index, 0, 'the first index was overwritten');
    });

    it('caps parts.count at the limit when the limit bites', async () => {
        // Telegram reports thousands available; the node emits two. A count of 4000 would leave a join
        // waiting forever.
        const client = createFakeClient(['a', 'b'], 4000);
        const { n1, sent } = await load({ what: 'messages', peer: 'somechat', limit: 2 }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });
        await done;

        assert.strictEqual(sent[0].parts.count, 2);
    });

    it('carries the incoming message properties through to every item', async () => {
        const client = createFakeClient(['a', 'b'], 2);
        const { n1, sent } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go', topic: 'archive' });
        await done;

        for (const msg of sent) {
            assert.strictEqual(msg.topic, 'archive');
        }
    });

    it('emits one message with an array in array mode', async () => {
        const client = createFakeClient(['a', 'b', 'c'], 3);
        const { n1, sent } = await load({ what: 'dialogs', mode: 'array' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });
        await done;

        assert.strictEqual(sent.length, 1);
        assert.deepStrictEqual(sent[0].payload, ['a', 'b', 'c']);
        assert.strictEqual(sent[0].total, 3);
        assert.strictEqual(sent[0].parts, undefined, 'array mode must not set parts');
    });

    it('defaults the limit to 100 rather than to unbounded', async () => {
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });
        await done;

        assert.deepStrictEqual(client.recorded.args, ['somechat', { limit: 100 }]);
    });

    it('asks the library for an unbounded read only when the limit is 0', async () => {
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'messages', peer: 'somechat', limit: '0' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });
        await done;

        assert.deepStrictEqual(client.recorded.args, ['somechat', { limit: undefined }]);
    });

    it('lets msg override the peer, the limit and the search', async () => {
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'messages', peer: 'configured', limit: 100, search: 'configured' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go', peer: 'fromMsg', limit: 7, search: 'fromMsg' });
        await done;

        assert.deepStrictEqual(client.recorded.args, ['fromMsg', { limit: 7, search: 'fromMsg' }]);
    });

    it('calls the iterator the read type names', async () => {
        for (const [what, method] of Object.entries(LIST_KINDS).map(([kind, def]) => [kind, def.method])) {
            const client = createFakeClient(['a'], 1);
            const { n1 } = await load({ what: what, peer: 'somechat' }, client);

            const done = whenDone(n1);
            n1.receive({ payload: 'go' });
            await done;

            assert.strictEqual(client.recorded.method, method, `${what} called the wrong method`);
            await helper.unload();
        }
    });

    it('reports a missing chat for the reads that need one', async () => {
        for (const what of ['messages', 'participants']) {
            const client = createFakeClient(['a'], 1);
            const { n1 } = await load({ what: what, peer: '' }, client);

            const done = whenDone(n1);
            n1.receive({ payload: 'go' });

            assert.match(String(await done), /No chat/, `${what} must require a chat`);
            assert.strictEqual(client.recorded.method, undefined, 'nothing may be requested');
            await helper.unload();
        }
    });

    it('needs no chat for dialogs', async () => {
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'dialogs', peer: '' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });

        assert.strictEqual(await done, undefined);
        assert.strictEqual(client.recorded.method, 'iterDialogs');
    });

    it('reports an unknown read type instead of calling something arbitrary', async () => {
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'everything', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });

        assert.match(String(await done), /Unknown read type/);
        assert.strictEqual(client.recorded.method, undefined);
    });

    it('reports an error thrown part way through, after emitting what it had', async () => {
        const failure = new Error('CHANNEL_PRIVATE');
        const client = createFakeClient(['a', 'b', 'c'], 3, { throwAt: 2, error: failure });
        const { n1, sent } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });

        assert.strictEqual(await done, failure, 'the original error must reach the flow');
        assert.deepStrictEqual(
            sent.map((msg) => msg.payload),
            ['a', 'b'],
            'items read before the failure are still emitted'
        );
    });

    it('stops reading when the node closes, and emits nothing afterwards', async () => {
        // A history read can run for minutes. Without the check the loop would keep pulling from
        // Telegram and emitting into a node Node-RED has already closed.
        let releaseSecondItem;
        const held = new Promise((resolve) => {
            releaseSecondItem = resolve;
        });
        let reachedSecond;
        const atSecond = new Promise((resolve) => {
            reachedSecond = resolve;
        });

        const client = createFakeClient(['a', 'b', 'c'], 3, {
            beforeEach: async (index) => {
                if (index === 1) {
                    reachedSecond();
                    await held;
                }
            },
        });

        const { n1, sent } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });

        await atSecond;
        const emittedBeforeClose = sent.length;
        await n1.close();
        releaseSecondItem();
        await done;

        assert.strictEqual(emittedBeforeClose, 1, 'the first item should already be out');
        assert.strictEqual(sent.length, 1, 'nothing may be emitted after close');
    });
});

// The node level, because resolveListSettings alone cannot show that the resolved values actually reach
// the client call - `what` picks the iterator, `mode` decides the shape of the output, and both were
// read straight off the node before.
describe('list node settings from the message', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    it('reads what the message asks for, not what is configured', async () => {
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: { what: 'dialogs' } });
        assert.strictEqual(await done, undefined);

        // dialogs takes no entity, so the shape of the call changes with it.
        assert.strictEqual(client.recorded.method, 'iterDialogs');
        assert.deepStrictEqual(client.recorded.args, [{ limit: 100 }]);
    });

    it('switches the output mode from the message', async () => {
        const client = createFakeClient(['a', 'b'], 2);
        const { n1, sent } = await load({ what: 'messages', peer: 'somechat', mode: 'stream' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: { mode: 'array' } });
        assert.strictEqual(await done, undefined);

        assert.strictEqual(sent.length, 1, 'array mode sends one message, not one per item');
        assert.deepStrictEqual(sent[0].payload, ['a', 'b']);
        assert.strictEqual(sent[0].parts, undefined, 'there is nothing for a join node to do');
    });

    it('takes the peer from the payload when the node has none', async () => {
        // What the ReadHistory example does, and what used to stop with "No chat".
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'messages', peer: '' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: { peer: 'me', limit: 5 } });
        assert.strictEqual(await done, undefined);

        assert.deepStrictEqual(client.recorded.args, ['me', { limit: 5 }]);
    });

    it('names all three ways to give a peer when none was given', async () => {
        const client = createFakeClient([], 0);
        const { n1 } = await load({ what: 'messages', peer: '' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: 'go' });
        const error = await done;

        assert.match(String(error), /msg\.payload\.peer/);
    });

    it('refuses an output mode it does not know instead of guessing', async () => {
        // Anything other than stream used to read as array, so a typo silently changed the output shape.
        const client = createFakeClient(['a'], 1);
        const { n1, sent } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: { mode: 'steam' } });
        const error = await done;

        assert.match(String(error), /Unknown output mode: steam/);
        assert.match(String(error), /stream, array/, 'the message has to say what is accepted');
        assert.strictEqual(sent.length, 0, 'nothing may be emitted');
    });

    it('refuses a read type it does not know, naming what came in', async () => {
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'messages', peer: 'somechat' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: { what: 'stories' } });
        const error = await done;

        assert.match(String(error), /Unknown read type: stories/);
    });

    it('searches with what the message supplied', async () => {
        const client = createFakeClient(['a'], 1);
        const { n1 } = await load({ what: 'messages', peer: 'somechat', search: 'configured' }, client);

        const done = whenDone(n1);
        n1.receive({ payload: { search: 'from the message' } });
        assert.strictEqual(await done, undefined);

        assert.deepStrictEqual(client.recorded.args, ['somechat', { limit: 100, search: 'from the message' }]);
    });
});
