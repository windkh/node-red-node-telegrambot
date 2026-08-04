// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const inspect = require('node:util').inspect;

const helper = require('node-red-node-test-helper');
const telegramBotNode = require('../telegrambot/telegrambot.js');

const { Api } = require('teleproto');
const { UpdateConnectionState } = require('teleproto/network');
const { NewMessageEvent } = require('teleproto/events/NewMessage');
const { hideClientReferences } = require('../telegrambot/lib/hide-client');

helper.init(require.resolve('node-red'));

const configNode = { id: 'c1', type: 'telegram client config', name: 'test client' };

// Stands in for the TelegramClient. Shaped like the real one only where it matters: the marker sits
// exactly where `apiHash` and `session._authKey` sit, and the back-reference is there because the real
// client points at everything that points at it.
const SECRET = 'THIS-WOULD-BE-THE-SESSION';

function createFakeClient() {
    const client = {
        apiId: 12345,
        apiHash: SECRET,
        session: { _authKey: { _key: Buffer.from([1, 2, 3]) } },
    };
    client.itself = client;

    return client;
}

// The two serialisers that matter. Node-RED's is the one that put the client on a user's screen; the
// other is what a debugger and any Function node walking a msg effectively do.
//
// @node-red/util comes in with node-red itself, which node-red-node-test-helper already needs, so this
// asserts against the code that actually renders the debug sidebar rather than against a guess at it.
function asDebugSidebar(msg) {
    const util = require('@node-red/util').util;

    // `.msg` is the JSON text the sidebar renders — the string a user would copy out of it.
    return util.encodeObject({ msg: msg }, { maxLength: 10000000 }).msg;
}

function asInspected(msg) {
    return inspect(msg, { depth: 20 });
}

describe('hideClientReferences', () => {
    it('hides the reference but leaves it readable', () => {
        const client = createFakeClient();
        const event = { state: 1, _client: client };

        hideClientReferences(event);

        assert.deepStrictEqual(Object.keys(event), ['state'], '_client must not be enumerable');
        assert.strictEqual(event._client, client, 'teleproto reads _client directly and must keep working');
    });

    it('returns what it was given, so it can wrap a send', () => {
        const msg = { payload: {} };

        assert.strictEqual(hideClientReferences(msg), msg);
    });

    it('finds a client anywhere in the message, not just at the top', () => {
        const client = createFakeClient();
        const msg = {
            payload: {
                type: 'Album',
                messages: [
                    { id: 1, _client: client },
                    { id: 2, _client: client },
                ],
                event: { _client: client, message: { _forward: { _client: client } } },
            },
        };

        hideClientReferences(msg);

        assert.ok(!asInspected(msg).includes(SECRET), 'a nested client is still a leaked session');
        // Named individually: a walk that stopped at the first hit would pass the check above only by
        // accident of ordering.
        assert.deepStrictEqual(Object.keys(msg.payload.messages[0]), ['id']);
        assert.deepStrictEqual(Object.keys(msg.payload.messages[1]), ['id']);
        assert.deepStrictEqual(Object.keys(msg.payload.event), ['message']);
        assert.deepStrictEqual(Object.keys(msg.payload.event.message._forward), []);
    });

    it("terminates on the cycles teleproto's graph is full of", () => {
        const client = createFakeClient();
        const event = { _client: client };
        const message = { event: event, self: undefined };
        message.self = message;
        event.message = message;

        hideClientReferences({ payload: event });

        assert.deepStrictEqual(Object.keys(event), ['message']);
    });

    it('stays hidden when teleproto assigns the client again', () => {
        const client = createFakeClient();
        const event = { _client: client };

        hideClientReferences(event);
        // What client/updates.js does to every event it builds. A plain assignment to an existing
        // property keeps that property's descriptor, so it must not put the client back on show.
        event._client = client;

        assert.deepStrictEqual(Object.keys(event), []);
        assert.strictEqual(event._client, client);
    });

    it('does not enumerate a Buffer, which would mean one key per byte', () => {
        // Not a style point. Object.keys on a 4 MB Buffer yields four million keys: measured at 1.2 s
        // for this one buffer, against 0.06 ms with the check in place. A downloaded file passing
        // through a sender node would stall the flow.
        const msg = { payload: Buffer.alloc(4 * 1024 * 1024), _client: createFakeClient() };

        const started = process.hrtime.bigint();
        hideClientReferences(msg);
        const took = Number(process.hrtime.bigint() - started) / 1e6;

        assert.deepStrictEqual(Object.keys(msg), ['payload'], 'the client must still be hidden');
        assert.ok(took < 300, 'walking the buffer byte by byte took ' + took.toFixed(0) + ' ms');
    });

    it('leaves a real teleproto Message working', () => {
        const client = createFakeClient();
        client.parseMode = undefined;
        const message = new Api.Message({
            id: 7,
            peerId: new Api.PeerUser({ userId: 42n }),
            message: 'hello',
            date: 1,
            out: false,
        });
        message._client = client;

        hideClientReferences({ payload: message });

        assert.strictEqual(message.client, client, 'the `client` getter is public API on a Message');
        assert.strictEqual(message.text, 'hello', 'the text getter reads _client.parseMode');
        assert.ok(!asInspected(message).includes(SECRET));
    });
});

// The reason this exists at all, kept as its own case: the leak was reported from a running flow, and
// this is the object that leaked.
describe('a raw connection-state event', () => {
    function build() {
        const update = new UpdateConnectionState(UpdateConnectionState.connected);
        update._client = createFakeClient();

        return { type: 'Raw', payload: { type: 'Raw', event: update } };
    }

    it('is printed with the session in it, before anything is hidden', () => {
        // The counter-test: it states the leak, so that the check below is known to prove something.
        // UpdateConnectionState is a bare `class { state }` with no toJSON, so Node-RED's encoder
        // follows _client all the way to the auth key. See the next describe for the same thing
        // happening on an ordinary NewMessage, where a toJSON on the Message hides nothing because the
        // event wrapper around it has none.
        const printed = asDebugSidebar(build());

        assert.ok(printed.includes(SECRET), 'expected the unfixed object to leak');
        assert.ok(printed.includes('_authKey'), 'expected the unfixed object to leak');
    });

    it('is printed without it afterwards', () => {
        const printed = asDebugSidebar(hideClientReferences(build()));

        assert.ok(!printed.includes(SECRET));
        assert.ok(!printed.includes('_authKey'));
        assert.ok(printed.includes('"state":1'), 'the event itself must still reach the flow');
    });
});

// And the same for the ordinary case, which looked safe and is not. A Message has a generated toJSON
// that emits only the TL fields, so `msg.payload.message` never showed the client — but the receiver
// also puts the *event* in the msg, and NewMessageEvent has no toJSON at all. That is what makes this a
// leak on every event type rather than a curiosity of the raw path.
describe('a new-message event', () => {
    function build() {
        const message = new Api.Message({
            id: 7,
            peerId: new Api.PeerUser({ userId: 42n }),
            message: 'hi',
            date: 1,
            out: false,
        });
        const event = new NewMessageEvent(message, undefined);
        const client = createFakeClient();
        event._client = client;
        message._client = client;

        return { payload: { type: 'NewMessage', message: message, event: event } };
    }

    it('leaks through the event wrapper, not through the message', () => {
        const msg = build();

        assert.strictEqual(typeof msg.payload.message.toJSON, 'function', 'a Message is meant to have one');
        assert.strictEqual(msg.payload.event.toJSON, undefined, 'the event wrapper has none — that is the hole');
        assert.ok(asDebugSidebar(msg).includes(SECRET), 'expected the unfixed msg to leak');
    });

    it('is clean once the references are hidden', () => {
        const printed = asDebugSidebar(hideClientReferences(build()));

        assert.ok(!printed.includes(SECRET));
        assert.ok(printed.includes('"message":"hi"'), 'the message itself must still reach the flow');
    });
});

// Wiring. Each node is driven the way the existing node tests drive it, so these fail if the call is
// dropped from a send path — which is the only thing that keeps the lib above from being decoration.
describe('the nodes keep the client out of what they send', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    function assertClean(msg, what) {
        assert.ok(!asDebugSidebar(msg).includes(SECRET), what + ' sent the session to the debug sidebar');
        assert.ok(!asInspected(msg).includes(SECRET), what + ' left the session reachable by enumeration');
    }

    const RECEIVER_EVENTS = [
        ['rawEventHandler', () => ({ state: 1 })],
        ['newMessageEventHandler', (client) => ({ message: withClient({}, client) })],
        ['deletedMessageEventHandler', () => ({ deletedIds: [1] })],
        ['editedMessageEventHandler', (client) => ({ message: withClient({}, client) })],
        ['albumEventHandler', (client) => ({ messages: [withClient({ id: 1 }, client)] })],
        ['callbackQueryEventHandler', () => ({ query: { data: Buffer.from('x') } })],
    ];

    function withClient(target, client) {
        target._client = client;
        target.getSender = async () => ({ id: 'sender' });
        target.getChat = async () => ({ id: 'chat' });

        return target;
    }

    for (const [handlerName, buildEvent] of RECEIVER_EVENTS) {
        it('receiver: ' + handlerName, async () => {
            const flow = [
                configNode,
                { id: 'n1', type: 'telegram client receiver', bot: 'c1', wires: [['n2']] },
                { id: 'n2', type: 'helper' },
            ];
            await helper.load(telegramBotNode, flow);

            const client = createFakeClient();
            const event = buildEvent(client);
            event._client = client;

            const n1 = helper.getNode('n1');
            const sent = [];
            n1.send = (msg) => sent.push(msg);

            await n1[handlerName](event);

            assert.strictEqual(sent.length, 1);
            assertClean(sent[0], handlerName);
        });
    }

    it('sender: the result of a client method', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        // What sendMessage really returns: the Message Telegram created, with the client on it.
        const result = { id: 99, _client: createFakeClient() };
        const client = { sendMessage: async () => result };
        const msg = { payload: { func: 'sendMessage', args: ['chat', { message: 'hi' }] } };

        const sent = await new Promise((resolve) => {
            helper.getNode('n1').processMessage(client, msg, resolve, () => {});
        });

        assert.strictEqual(sent.payload, result, 'the message itself must still be what the flow gets');
        assertClean(sent, 'the sender node');
    });

    it('upload: the message Telegram created for the file', async () => {
        const flow = [configNode, { id: 'n1', type: 'telegram client upload', bot: 'c1', peer: 'someone' }];
        await helper.load(telegramBotNode, flow);

        const sentFile = { className: 'Message', id: 99, _client: createFakeClient() };
        const client = { sendFile: async () => sentFile };
        const n1 = helper.getNode('n1');
        n1.config.client = client;
        n1.config.getTelegramClient = async () => client;
        n1.status = () => {};

        const sent = await new Promise((resolve, reject) => {
            n1.on('call:error', (call) => reject(call.args[0]));
            n1.send = resolve;
            n1.receive({ payload: Buffer.from('data'), filename: 'notes.txt', _msgid: '1' });
        });

        assert.strictEqual(sent.payload, sentFile);
        assertClean(sent, 'the upload node');
    });

    // Both modes, because they are two different send paths: the array mode sends msg, the stream mode
    // sends a clone per item. RED.util.cloneMessage is the reason the stream mode matters twice over —
    // it deep-copies enumerable properties, so an unhidden client would be cloned per item.
    for (const mode of ['array', 'stream']) {
        it('list: one message per dialog in ' + mode + ' mode', async () => {
            const flow = [
                configNode,
                { id: 'n1', type: 'telegram client list', bot: 'c1', what: 'dialogs', mode: mode },
            ];
            await helper.load(telegramBotNode, flow);

            // A Dialog holds the client the same way a Message does.
            const dialogs = [
                { className: 'Dialog', id: 1, _client: createFakeClient() },
                { className: 'Dialog', id: 2, _client: createFakeClient() },
            ];
            const iterator = {
                total: 2,
                [Symbol.asyncIterator]: async function* () {
                    yield* dialogs;
                },
            };
            const n1 = helper.getNode('n1');
            n1.config.getTelegramClient = async () => ({ iterDialogs: () => iterator });
            n1.status = () => {};

            const sent = [];
            n1.send = (msg) => sent.push(msg);

            const done = new Promise((resolve) => {
                n1._complete = () => resolve();
            });
            n1.receive({ payload: 'go' });
            await done;

            assert.ok(sent.length > 0, 'nothing was sent');
            sent.forEach((msg, index) => assertClean(msg, 'the list node in ' + mode + ' mode, message ' + index));
        });
    }
});
