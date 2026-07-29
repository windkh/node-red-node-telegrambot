// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');

const helper = require('node-red-node-test-helper');
const telegramBotNode = require('../telegrambot/telegrambot.js');

helper.init(require.resolve('node-red'));

// Without credentials the config node has no session, so getTelegramClient warns and hands out no
// client. That keeps these tests offline: nothing ever reaches Telegram.
const configNode = { id: 'c1', type: 'telegram client config', name: 'test client' };

describe('telegram client nodes', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    it('loads a config node', async () => {
        await helper.load(telegramBotNode, [configNode]);

        const c1 = helper.getNode('c1');
        assert.ok(c1, 'config node was not created');
        assert.strictEqual(c1.loginMode, 'user', 'loginMode should default to user');
        assert.strictEqual(c1.useProxy, false);
        assert.strictEqual(c1.logLevel, 'warn');
    });

    it('switches the config node to debug logging when verbose logging is on', async () => {
        await helper.load(telegramBotNode, [{ ...configNode, verboselogging: true }]);

        assert.strictEqual(helper.getNode('c1').logLevel, 'debug');
    });

    it('builds the proxy settings when the config node uses a proxy', async () => {
        const flow = [
            {
                ...configNode,
                useproxy: true,
                host: '127.0.0.1',
                port: '1080',
                sockstype: '5',
                timeout: '2',
            },
        ];
        await helper.load(telegramBotNode, flow);

        const proxy = helper.getNode('c1').proxy;
        assert.strictEqual(proxy.ip, '127.0.0.1');
        assert.strictEqual(proxy.port, 1080);
        assert.strictEqual(proxy.socksType, 5);
        assert.strictEqual(proxy.timeout, 2);
    });

    it('loads a receiver node wired to the config node', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client receiver', bot: 'c1', sendnewmessage: true, wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        assert.ok(n1, 'receiver node was not created');
        assert.strictEqual(n1.sendNewMessage, true);
        assert.strictEqual(n1.sendRawEvents, false, 'unset event options should default to false');
        assert.ok(n1.config, 'receiver node did not resolve its config node');
    });

    it('loads a sender node wired to the config node', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        assert.ok(n1, 'sender node was not created');
        assert.ok(n1.config, 'sender node did not resolve its config node');
    });

    it('calls a client method named by msg.payload.func', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        // Every GramJS client method is async, so the fake has to be too — a synchronous fake would
        // pass even if the node forgot to await the call.
        const calls = [];
        const client = {
            sendMessage: async (...args) => {
                calls.push(args);
                return 'result';
            },
        };

        const msg = { payload: { func: 'sendMessage', args: ['chat', { message: 'hi' }] } };
        const sent = await new Promise((resolve) => {
            helper.getNode('n1').processMessage(client, msg, resolve, () => {});
        });

        assert.deepStrictEqual(calls, [['chat', { message: 'hi' }]]);
        assert.strictEqual(sent.payload, 'result', 'the resolved value must land in msg.payload');
    });

    it('reports a rejecting client method through nodeDone', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const failure = new Error('CHAT_WRITE_FORBIDDEN');
        const client = {
            sendMessage: async () => {
                throw failure;
            },
        };

        const msg = { payload: { func: 'sendMessage', args: ['chat'] } };
        const error = await new Promise((resolve) => {
            helper.getNode('n1').processMessage(client, msg, () => {}, resolve);
        });

        assert.strictEqual(error, failure, 'the original error must reach nodeDone unchanged');
    });

    it('calls a client method with no arguments when args is omitted', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const calls = [];
        const client = {
            getMe: async (...args) => {
                calls.push(args);
                return 'me';
            },
        };

        const sent = await new Promise((resolve) => {
            helper.getNode('n1').processMessage({ ...client }, { payload: { func: 'getMe' } }, resolve, () => {});
        });

        assert.deepStrictEqual(calls, [[]], 'args must default to an empty array, not an empty object');
        assert.strictEqual(sent.payload, 'me');
    });

    it('rejects a non-array args on the client-method path with a readable error', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const errors = [];
        const msg = { payload: { func: 'sendMessage', args: { peer: 'chat' } } };
        helper.getNode('n1').processMessage(
            {},
            msg,
            () => {},
            (error) => errors.push(error)
        );

        assert.deepStrictEqual(errors, ['msg.payload.args must be an array when msg.payload.api is not set.']);
    });

    it('reports an error when msg.payload names no function', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const errors = [];
        helper.getNode('n1').processMessage(
            {},
            { payload: {} },
            () => {},
            (error) => errors.push(error)
        );

        assert.deepStrictEqual(errors, ['msg.payload: api or func is missing.']);
    });

    it('invokes a raw MTProto request when msg.payload names an api', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const invoked = [];
        const client = {
            invoke: async (request) => {
                invoked.push(request);
                return 'invoked';
            },
        };

        const msg = { payload: { api: 'account', func: 'CheckUsername', args: { username: 'someone' } } };
        const sent = await new Promise((resolve) => {
            helper.getNode('n1').processMessage(client, msg, resolve, () => {});
        });

        assert.strictEqual(invoked.length, 1);
        assert.strictEqual(invoked[0].username, 'someone');
        assert.strictEqual(sent.payload, 'invoked');
    });

    it('reports an error when the named api function does not exist', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const msg = { payload: { api: 'account', func: 'NoSuchRequest', args: {} } };
        const error = await new Promise((resolve) => {
            helper.getNode('n1').processMessage({}, msg, () => {}, resolve);
        });

        assert.ok(error instanceof Error);
    });
});

describe('receiver node event handlers', () => {
    const receiverFlow = [
        configNode,
        { id: 'n1', type: 'telegram client receiver', bot: 'c1', wires: [['n2']] },
        { id: 'n2', type: 'helper' },
    ];

    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    // The handlers are what GramJS calls on an incoming update. Driving them directly checks the
    // emitted msg shape — the part flows depend on — without needing a live connection.
    async function capture(handlerName, event) {
        await helper.load(telegramBotNode, receiverFlow);

        const n1 = helper.getNode('n1');
        const sent = [];
        n1.send = (msg) => sent.push(msg);

        await n1[handlerName](event);

        return sent;
    }

    it('passes a raw event through untouched', async () => {
        const event = { some: 'update' };
        const sent = await capture('rawEventHandler', event);

        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].type, 'Raw');
        assert.strictEqual(sent[0].payload, event);
    });

    it('resolves sender and chat for a new message', async () => {
        const message = {
            originalUpdate: { id: 7 },
            getSender: async () => ({ id: 'sender' }),
            getChat: async () => ({ id: 'chat' }),
        };
        const sent = await capture('newMessageEventHandler', { message: message });

        assert.strictEqual(sent[0].payload.type, 'NewMessage');
        assert.strictEqual(sent[0].payload.message, message);
        assert.deepStrictEqual(sent[0].payload.originalUpdate, { id: 7 });
        assert.deepStrictEqual(sent[0].payload.sender, { id: 'sender' });
        assert.deepStrictEqual(sent[0].payload.chat, { id: 'chat' });
    });

    it('reports the deleted ids for a deleted message', async () => {
        const sent = await capture('deletedMessageEventHandler', { deletedIds: [1, 2] });

        assert.strictEqual(sent[0].payload.type, 'DeletedMessage');
        assert.deepStrictEqual(sent[0].payload.deletedIds, [1, 2]);
    });

    it('resolves sender and chat for an edited message', async () => {
        const message = {
            getSender: async () => ({ id: 'sender' }),
            getChat: async () => ({ id: 'chat' }),
        };
        const sent = await capture('editedMessageEventHandler', { message: message });

        assert.strictEqual(sent[0].payload.type, 'EditedMessage');
        assert.strictEqual(sent[0].payload.message, message);
    });

    it('reports every message of an album', async () => {
        const sent = await capture('albumEventHandler', { messages: ['a', 'b'], originalUpdates: ['u'] });

        assert.strictEqual(sent[0].payload.type, 'Album');
        assert.deepStrictEqual(sent[0].payload.messages, ['a', 'b']);
        assert.deepStrictEqual(sent[0].payload.originalUpdates, ['u']);
    });

    it('reports the query of a callback query', async () => {
        const sent = await capture('callbackQueryEventHandler', { query: { data: 'yes' } });

        assert.strictEqual(sent[0].payload.type, 'CallbackQuery');
        assert.deepStrictEqual(sent[0].payload.query, { data: 'yes' });
    });
});

describe('receiver node subscriptions', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    // Records add/removeEventHandler instead of connecting. The second argument is the GramJS event
    // builder, whose class name identifies which Telegram event a subscription is for.
    function createClientRecorder() {
        const added = [];
        const removed = [];

        return {
            added,
            removed,
            addEventHandler(handler, builder) {
                added.push(builder === undefined ? 'Raw' : builder.constructor.name);
            },
            removeEventHandler(handler, builder) {
                removed.push(builder === undefined ? 'Raw' : builder.constructor.name);
            },
        };
    }

    // start() already ran during load with no client; re-running it against a recorder is what the
    // node does once a session exists.
    async function subscribe(receiverConfig) {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client receiver', bot: 'c1', ...receiverConfig, wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        const client = createClientRecorder();
        n1.config.getTelegramClient = async () => client;

        const statuses = [];
        n1.status = (status) => statuses.push(status);

        await n1.start();

        return { node: n1, client: client, statuses: statuses };
    }

    it('subscribes to nothing when no event type is enabled', async () => {
        const { client } = await subscribe({});

        assert.deepStrictEqual(client.added, []);
    });

    it('subscribes only to the enabled event types', async () => {
        const { client } = await subscribe({ sendnewmessage: true, sendalbum: true });

        assert.deepStrictEqual(client.added, ['NewMessage', 'Album']);
    });

    it('subscribes to every event type when all are enabled', async () => {
        const { client } = await subscribe({
            sendrawevents: true,
            sendnewmessage: true,
            senddeletedmessage: true,
            sendeditedmessage: true,
            sendalbum: true,
            sendcallbackquery: true,
        });

        assert.deepStrictEqual(client.added, [
            'Raw',
            'NewMessage',
            'DeletedMessage',
            'EditedMessage',
            'Album',
            'CallbackQuery',
        ]);
    });

    it('reports connected once subscribed', async () => {
        const { statuses } = await subscribe({ sendnewmessage: true });

        assert.deepStrictEqual(statuses.at(-1), { fill: 'green', shape: 'ring', text: 'connected' });
    });

    it('removes exactly the handlers it added on stop', async () => {
        const { node, client, statuses } = await subscribe({ sendnewmessage: true, sendcallbackquery: true });

        await node.stop();

        assert.deepStrictEqual(client.removed, ['NewMessage', 'CallbackQuery']);
        assert.deepStrictEqual(statuses.at(-1), { fill: 'red', shape: 'ring', text: 'disconnected' });
    });

    it('does not remove handlers twice when stop runs again', async () => {
        const { node, client } = await subscribe({ sendnewmessage: true });

        await node.stop();
        await node.stop();

        assert.deepStrictEqual(client.removed, ['NewMessage']);
    });
});
