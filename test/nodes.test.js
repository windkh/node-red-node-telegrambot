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

    it('exposes the bot token and the two-step-verification password from credentials', async () => {
        // Placeholders only — never a real token or password in a fixture.
        const credentials = { c1: { bottoken: 'placeholder-token', twofapassword: 'placeholder-pw' } };
        await helper.load(telegramBotNode, [configNode], credentials);

        const c1 = helper.getNode('c1');
        assert.strictEqual(c1.botToken, 'placeholder-token');
        assert.strictEqual(c1.twoFaPassword, 'placeholder-pw');
    });

    it('still receives the session at runtime although it is a password credential', async () => {
        // `type: 'password'` only stops the runtime from sending the value to the *editor*; the node
        // itself must still get it, or no deployed flow could connect.
        await helper.load(telegramBotNode, [configNode], { c1: { session: 'placeholder-session' } });

        assert.strictEqual(helper.getNode('c1').session, 'placeholder-session');
    });

    it('leaves botToken undefined when no bot token is stored', async () => {
        await helper.load(telegramBotNode, [configNode]);

        // Must be undefined rather than '': lib/telegram-client.js used to pick the bot auth path
        // from the mere presence of a token, and an empty string is still a presence.
        //
        // twoFaPassword is undefined here for a different reason: with nothing stored, Node-RED does
        // not create `node.credentials` at all, so the whole credential block is skipped — apiId and
        // session are undefined in that case too.
        const c1 = helper.getNode('c1');
        assert.strictEqual(c1.botToken, undefined);
        assert.strictEqual(c1.twoFaPassword, undefined);
    });

    it('leaves botToken undefined when the stored token is empty', async () => {
        await helper.load(telegramBotNode, [configNode], { c1: { bottoken: '' } });

        assert.strictEqual(helper.getNode('c1').botToken, undefined, 'an empty token must not count as a token');
    });

    it('keeps the proxy password separate from the two-step-verification password', async () => {
        // `password` is a config property (the SOCKS proxy password); the account password is the
        // `twofapassword` credential. They share neither a name nor an editor field any more.
        const flow = [{ ...configNode, useproxy: true, host: '127.0.0.1', password: 'proxy-pw' }];
        const credentials = { c1: { twofapassword: 'account-pw' } };
        await helper.load(telegramBotNode, flow, credentials);

        const c1 = helper.getNode('c1');
        assert.strictEqual(c1.proxy.password, 'proxy-pw', 'the proxy must keep its own password');
        assert.strictEqual(c1.twoFaPassword, 'account-pw', 'the account password must not be overwritten');
    });

    it('defaults loginMode to user', async () => {
        await helper.load(telegramBotNode, [configNode]);

        assert.strictEqual(helper.getNode('c1').loginMode, 'user');
    });

    it('reads loginMode bot from the config', async () => {
        await helper.load(telegramBotNode, [{ ...configNode, loginmode: 'bot' }]);

        assert.strictEqual(helper.getNode('c1').loginMode, 'bot');
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

    it('completes the message exactly once on the success path', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client sender', bot: 'c1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        await helper.load(telegramBotNode, flow);

        const client = { sendMessage: async () => 'result' };
        const doneCalls = [];

        await new Promise((resolve) => {
            helper.getNode('n1').processMessage(
                client,
                { payload: { func: 'sendMessage', args: [] } },
                () => {},
                (error) => {
                    doneCalls.push(error);
                    resolve();
                }
            );
        });

        assert.strictEqual(doneCalls.length, 1, 'nodeDone must be called exactly once');
        assert.strictEqual(doneCalls[0], undefined, 'nodeDone must be called without an error');
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

// Node-RED turns done(err) into node.error(err, msg) (Node.prototype._complete), and the test helper
// proxies node.error and emits a `call:error` event — so driving the real input handler is the only way
// to cover the boundary checks.
describe('sender node input boundary', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    // Rejects rather than hanging when nothing is reported: a dropped message would otherwise stall
    // the whole file until the runner's timeout, which hides which case actually regressed.
    function nextError(node) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('the node reported no error — the message was dropped')),
                1000
            );
            node.on('call:error', (call) => {
                clearTimeout(timer);
                resolve(call.args[0]);
            });
        });
    }

    it('reports a missing payload instead of dropping the message', async () => {
        const flow = [configNode, { id: 'n1', type: 'telegram client sender', bot: 'c1' }];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        const error = nextError(n1);
        n1.receive({});

        assert.strictEqual(await error, 'msg.payload is required.');
    });

    it('reports a missing config node instead of dropping the message', async () => {
        // No `bot` property, so RED.nodes.getNode returns nothing and node.config stays unset.
        await helper.load(telegramBotNode, [{ id: 'n1', type: 'telegram client sender' }]);

        const n1 = helper.getNode('n1');
        const error = nextError(n1);
        n1.receive({ payload: { func: 'sendMessage', args: [] } });

        assert.strictEqual(await error, 'No telegram client config node configured.');
    });

    it('reports a missing client and shows disconnected', async () => {
        const flow = [configNode, { id: 'n1', type: 'telegram client sender', bot: 'c1' }];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        const statuses = [];
        n1.status = (status) => statuses.push(status);

        const error = nextError(n1);
        n1.receive({ payload: { func: 'sendMessage', args: [] } });

        assert.strictEqual(await error, 'No telegram client: check the config node and login first.');
        assert.deepStrictEqual(statuses.at(-1), { fill: 'red', shape: 'ring', text: 'disconnected' });
    });

    it('does not drop a falsy payload', async () => {
        const flow = [configNode, { id: 'n1', type: 'telegram client sender', bot: 'c1' }];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        n1.config.getTelegramClient = async () => ({});

        // 0 is falsy but present: it must reach processMessage and be reported there, not vanish.
        const error = nextError(n1);
        n1.receive({ payload: 0 });

        assert.strictEqual(await error, 'msg.payload: api or func is missing.');
    });
});

// GramJS routes connection states through the raw handlers as UpdateConnectionState instances. The
// config node subscribes to them internally so the status is honest whether or not the user enabled
// "send raw events".
describe('connection state reporting', () => {
    const { UpdateConnectionState } = require('telegram/network');

    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    const flow = [
        configNode,
        { id: 'r1', type: 'telegram client receiver', bot: 'c1' },
        { id: 's1', type: 'telegram client sender', bot: 'c1' },
    ];

    async function loadWithStatusRecorders() {
        await helper.load(telegramBotNode, flow);

        const nodes = { c1: helper.getNode('c1'), r1: helper.getNode('r1'), s1: helper.getNode('s1') };
        const statuses = { r1: [], s1: [] };
        nodes.r1.status = (status) => statuses.r1.push(status);
        nodes.s1.status = (status) => statuses.s1.push(status);

        return { nodes, statuses };
    }

    it('registers the receiver and the sender as listeners', async () => {
        const { nodes } = await loadWithStatusRecorders();

        assert.strictEqual(nodes.c1.statusListeners.size, 2);
    });

    it('reports connected to every listener', async () => {
        const { nodes, statuses } = await loadWithStatusRecorders();

        nodes.c1.onConnectionState(new UpdateConnectionState(UpdateConnectionState.connected));

        assert.deepStrictEqual(statuses.r1.at(-1), { fill: 'green', shape: 'ring', text: 'connected' });
        assert.deepStrictEqual(statuses.s1.at(-1), { fill: 'green', shape: 'ring', text: 'connected' });
    });

    it('reports disconnected to every listener', async () => {
        const { nodes, statuses } = await loadWithStatusRecorders();

        nodes.c1.onConnectionState(new UpdateConnectionState(UpdateConnectionState.disconnected));

        assert.deepStrictEqual(statuses.r1.at(-1), { fill: 'red', shape: 'ring', text: 'disconnected' });
        assert.deepStrictEqual(statuses.s1.at(-1), { fill: 'red', shape: 'ring', text: 'disconnected' });
    });

    it('reports a broken session distinctly from a dropped connection', async () => {
        const { nodes, statuses } = await loadWithStatusRecorders();

        nodes.c1.onConnectionState(new UpdateConnectionState(UpdateConnectionState.broken));

        // GramJS emits `broken` only from _handleBadAuthKey, so reconnecting cannot help — the text has
        // to tell the user to log in again, and the filled dot sets it apart from `disconnected`.
        const expected = { fill: 'red', shape: 'dot', text: 'session invalid: login again' };
        assert.deepStrictEqual(statuses.r1.at(-1), expected);
        assert.deepStrictEqual(statuses.s1.at(-1), expected);
    });

    it('ignores updates that are not connection states', async () => {
        const { nodes, statuses } = await loadWithStatusRecorders();

        const before = statuses.r1.length;
        nodes.c1.onConnectionState({ className: 'UpdateNewMessage' });

        assert.strictEqual(statuses.r1.length, before, 'a normal update must not touch the status');
    });

    it('stops reporting to a node that has been closed', async () => {
        const { nodes, statuses } = await loadWithStatusRecorders();

        await nodes.r1.close();
        const before = statuses.r1.length;
        nodes.c1.onConnectionState(new UpdateConnectionState(UpdateConnectionState.connected));

        assert.strictEqual(nodes.c1.statusListeners.size, 1, 'the closed node must have deregistered');
        assert.strictEqual(statuses.r1.length, before, 'a closed node must not be written to');
        assert.deepStrictEqual(statuses.s1.at(-1), { fill: 'green', shape: 'ring', text: 'connected' });
    });

    it('subscribes the internal handler once a client exists', async () => {
        await helper.load(telegramBotNode, flow);

        const c1 = helper.getNode('c1');
        const added = [];
        c1.createTelegramClient = async () => ({
            addEventHandler: (handler) => added.push(handler),
        });

        await c1.getTelegramClient(helper.getNode('r1'));

        assert.deepStrictEqual(added, [c1.onConnectionState], 'the state handler must be registered');
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
    // builder, whose class name identifies which Telegram event a subscription is for. `addedBuilders`
    // keeps the instances so tests can check which filters actually reached them.
    function createClientRecorder() {
        const added = [];
        const removed = [];
        const addedBuilders = [];
        const removedBuilders = [];

        return {
            added,
            removed,
            addedBuilders,
            removedBuilders,
            destroyed: 0,
            addEventHandler(handler, builder) {
                added.push(builder === undefined ? 'Raw' : builder.constructor.name);
                addedBuilders.push(builder);
            },
            removeEventHandler(handler, builder) {
                removed.push(builder === undefined ? 'Raw' : builder.constructor.name);
                removedBuilders.push(builder);
            },
            async destroy() {
                this.destroyed += 1;
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
        // Both, because that is what the real config node does: getTelegramClient caches the client
        // on `config.client`, and stop() reads the cache rather than creating one during shutdown.
        n1.config.client = client;
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

    it('never creates a client while stopping', async () => {
        const flow = [configNode, { id: 'n1', type: 'telegram client receiver', bot: 'c1', sendnewmessage: true }];
        await helper.load(telegramBotNode, flow);

        // A receiver that never connected: the cache is empty, so stop() must find nothing and must
        // not fall back to getTelegramClient, which would log in just to tear the client down again.
        const n1 = helper.getNode('n1');
        let created = 0;
        n1.config.getTelegramClient = async () => {
            created += 1;
            return undefined;
        };

        await n1.stop();

        assert.strictEqual(created, 0, 'stop() must not call getTelegramClient');
    });

    it('subscribes with no filter options when none are configured', async () => {
        const { client } = await subscribe({ sendnewmessage: true, sendcallbackquery: true, sendalbum: true });

        // Backwards compatibility: an existing receiver has no filter properties stored and must
        // behave exactly as it did when every builder was constructed with `{}`.
        for (const builder of client.addedBuilders) {
            assert.deepStrictEqual(builder.chats, undefined);
            assert.deepStrictEqual(builder.fromUsers, undefined);
        }
    });

    it('passes the configured filters to the builders that accept them', async () => {
        const { client } = await subscribe({
            sendnewmessage: true,
            sendeditedmessage: true,
            senddeletedmessage: true,
            sendalbum: true,
            sendcallbackquery: true,
            chats: 'alice, bob',
            direction: 'incoming',
            fromusers: 'carol',
            pattern: '^ping$',
        });

        const byType = new Map(client.added.map((name, index) => [name, client.addedBuilders[index]]));

        // NewMessage and EditedMessage take everything.
        for (const type of ['NewMessage', 'EditedMessage']) {
            assert.deepStrictEqual(byType.get(type).chats, ['alice', 'bob'], type);
            assert.deepStrictEqual(byType.get(type).fromUsers, ['carol'], type);
            assert.strictEqual(byType.get(type).incoming, true, type);
            assert.ok(byType.get(type).pattern instanceof RegExp, type);
        }

        // CallbackQuery takes chats and pattern but not the message-only options.
        assert.deepStrictEqual(byType.get('CallbackQuery').chats, ['alice', 'bob']);
        assert.strictEqual(byType.get('CallbackQuery').fromUsers, undefined);

        // DeletedMessage and Album take chats only.
        for (const type of ['DeletedMessage', 'Album']) {
            assert.deepStrictEqual(byType.get(type).chats, ['alice', 'bob'], type);
            assert.strictEqual(byType.get(type).fromUsers, undefined, type);
        }
    });

    it('removes handlers with builders carrying the same filters', async () => {
        const { node, client } = await subscribe({ sendnewmessage: true, chats: 'alice' });

        await node.stop();

        assert.deepStrictEqual(client.removedBuilders[0].chats, ['alice']);
    });

    it('refuses to subscribe when the pattern does not compile', async () => {
        const flow = [
            configNode,
            { id: 'n1', type: 'telegram client receiver', bot: 'c1', sendnewmessage: true, pattern: '([' },
        ];
        await helper.load(telegramBotNode, flow);

        const n1 = helper.getNode('n1');
        assert.strictEqual(n1.filters, undefined, 'a filter that did not compile must not be used');

        const client = createClientRecorder();
        n1.config.client = client;
        n1.config.getTelegramClient = async () => client;

        const statuses = [];
        n1.status = (status) => statuses.push(status);
        await n1.start();

        // Forwarding everything because the filter failed would be worse than forwarding nothing.
        assert.deepStrictEqual(client.added, [], 'nothing may be subscribed');
        assert.deepStrictEqual(statuses.at(-1), { fill: 'red', shape: 'ring', text: 'invalid filter' });
    });

    it('tolerates the config node having already destroyed the client', async () => {
        const { node, client } = await subscribe({ sendnewmessage: true });

        // Node-RED closes nodes in an unspecified order, so the config node may go first.
        await node.config.closeTelegramClient();
        await node.stop();

        assert.deepStrictEqual(client.removed, [], 'there is nothing left to unsubscribe');
        assert.strictEqual(client.destroyed, 1, 'the config node destroyed it');
    });
});

describe('config node teardown', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    it('destroys the cached client and clears it', async () => {
        await helper.load(telegramBotNode, [configNode]);

        const c1 = helper.getNode('c1');
        let destroyed = 0;
        c1.client = { destroy: async () => (destroyed += 1) };

        await c1.closeTelegramClient();

        assert.strictEqual(destroyed, 1, 'destroy() must be called — disconnect() leaves the update loop running');
        assert.strictEqual(c1.client, null, 'the cache must be cleared so a redeploy builds a fresh client');
    });

    it('does nothing when no client was ever built', async () => {
        await helper.load(telegramBotNode, [configNode]);

        const c1 = helper.getNode('c1');
        c1.client = null;

        await assert.doesNotReject(() => c1.closeTelegramClient());
    });

    it('completes the close even when destroy rejects', async () => {
        await helper.load(telegramBotNode, [configNode]);

        const c1 = helper.getNode('c1');
        c1.client = {
            destroy: async () => {
                throw new Error('connection already gone');
            },
        };

        // A failing teardown must not stall a redeploy: the close handler reports and still calls
        // done(), so Node.close() — which resolves once every close callback has finished — settles.
        await assert.doesNotReject(() => c1.close());

        assert.strictEqual(c1.client, null);
    });
});
