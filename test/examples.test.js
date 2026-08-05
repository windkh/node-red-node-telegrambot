// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

// The example flows are documentation that runs, which is what makes them worth testing: a broken one
// is read as the package being broken. This suite came out of `EchoMessage.json` throwing
// "Cannot read properties of undefined (reading 'className')" on every update, because its Function
// node reached into `msg.payload.message` for payloads that have none.

const EXAMPLES = join(__dirname, '..', 'examples');
const FILES = readdirSync(EXAMPLES).filter((name) => name.endsWith('.json'));

// Every shape telegrambot/nodes/receiver-node.js emits. Keep in step with the six handlers there.
// A raw event also carries `msg.type`, kept from before 2.0.0; `msg.payload.type` is set for all six.
function receiverPayloads() {
    const message = { className: 'Message', message: 'hello', id: 7 };

    return {
        Raw: () => ({ type: 'Raw', payload: { type: 'Raw', event: { state: 1 } } }),
        NewMessage: () => ({
            payload: { type: 'NewMessage', message: message, originalUpdate: {}, sender: {}, chat: {}, event: {} },
        }),
        DeletedMessage: () => ({ payload: { type: 'DeletedMessage', deletedIds: [1, 2], event: {} } }),
        EditedMessage: () => ({
            payload: { type: 'EditedMessage', message: message, sender: {}, chat: {}, event: {} },
        }),
        Album: () => ({ payload: { type: 'Album', messages: [message], originalUpdates: [], event: {} } }),
        CallbackQuery: () => ({ payload: { type: 'CallbackQuery', query: {}, event: {} } }),
    };
}

// A Function node's body, callable. Node-RED also gives it `node`, `flow`, `context`, `env` and `RED`;
// none of the examples uses them, and a test that had to fake them would be testing the fake.
function asFunction(node) {
    return new Function('msg', node.func);
}

function load(file) {
    return JSON.parse(readFileSync(join(EXAMPLES, file), 'utf8'));
}

const EVENT_TYPES = [
    'sendrawevents',
    'sendnewmessage',
    'senddeletedmessage',
    'sendeditedmessage',
    'sendalbum',
    'sendcallbackquery',
];

describe('the example flows', () => {
    it('ships some', () => {
        // The manual test plan counts them, and the README points at the palette's Import dialog.
        assert.ok(FILES.length >= 8, `expected at least eight examples, found ${FILES.length}`);
    });

    for (const file of FILES) {
        it(`${file} is a flow of typed nodes`, () => {
            const flow = load(file);

            assert.ok(Array.isArray(flow), 'a flow is an array of nodes');
            flow.forEach((node) => {
                assert.strictEqual(typeof node.id, 'string', 'every node needs an id');
                assert.strictEqual(typeof node.type, 'string', `${node.id} has no type`);
            });
        });

        it(`${file} has Function nodes that compile`, () => {
            const flow = load(file);

            flow.filter((node) => node.type === 'function').forEach((node) => {
                assert.doesNotThrow(() => asFunction(node), `${node.name || node.id} does not parse`);
            });
        });
    }
});

// An example that errors on the first inject is indistinguishable from a broken package. Both rules
// below come from that being reported twice: `ReadHistory` shipped an empty peer and failed with
// `No chat: set "Read from" on the node or msg.peer.`, and `Api.messages.SendMessage` shipped the
// placeholder `"to username"`, which cannot resolve because a username has no space in it.
describe('every example runs on the first inject', () => {
    // Nodes whose `peer` decides where the call goes. A list node reading dialogs needs none.
    function peersThatMustBeSet(flow) {
        return flow.filter((node) => {
            let needed = false;

            if (node.type === 'telegram client upload' || node.type === 'telegram client sender') {
                needed = node.peer !== undefined;
            } else if (node.type === 'telegram client list') {
                needed = node.what === 'messages' || node.what === 'participants';
            }

            return needed;
        });
    }

    for (const file of FILES) {
        it(`${file} addresses a peer it can reach`, () => {
            const flow = load(file);

            peersThatMustBeSet(flow).forEach((node) => {
                assert.ok(
                    typeof node.peer === 'string' && node.peer.length > 0,
                    `${node.type} ${node.id} ships an empty peer, so the example fails on import`
                );
            });
        });

        it(`${file} builds no peer that cannot resolve`, () => {
            // A Function node that hands the sender a peer must hand it a usable one. A space is the
            // giveaway: no username contains one, so "to username" was never going to work.
            const flow = load(file);

            flow.filter((node) => node.type === 'function').forEach((node) => {
                const out = asFunction(node)({ payload: {} });
                const peer = out && out.payload && out.payload.args ? out.payload.args.peer : undefined;

                if (typeof peer === 'string') {
                    assert.ok(peer.length > 0, `${node.name} builds an empty peer`);
                    assert.ok(!peer.includes(' '), `${node.name} builds "${peer}", which cannot resolve`);
                }
            });
        });
    }
});

// A receiver in the flow means its Function nodes are fed by one, and then they meet whatever the user
// ticks — not only the event type the example had in mind.
describe('an example driven by a receiver', () => {
    const driven = FILES.filter((file) => load(file).some((node) => node.type === 'telegram client receiver'));

    it('exists, or these checks prove nothing', () => {
        assert.ok(driven.length > 0);
    });

    for (const file of driven) {
        it(`${file} enables the events it needs`, () => {
            // An imported example that subscribes to nothing looks broken and invites the user to tick
            // boxes at random - which is how the raw path, and the crash, were found.
            const receivers = load(file).filter((node) => node.type === 'telegram client receiver');

            receivers.forEach((receiver) => {
                const enabled = EVENT_TYPES.filter((name) => receiver[name] === true);
                assert.ok(enabled.length > 0, `${receiver.id} subscribes to no event type`);
            });
        });

        it(`${file} survives every payload a receiver can send`, () => {
            const flow = load(file);
            const functions = flow.filter((node) => node.type === 'function');

            for (const node of functions) {
                const run = asFunction(node);

                for (const [shape, build] of Object.entries(receiverPayloads())) {
                    assert.doesNotThrow(() => run(build()), `${node.name || node.id} threw on a ${shape} payload`);
                }
            }
        });
    }
});

describe('EchoMessage', () => {
    const flow = load('EchoMessage.json');
    const echo = asFunction(flow.find((node) => node.type === 'function'));
    const payloads = receiverPayloads();

    it('echoes a new message as a SendMessage call', () => {
        const out = echo(payloads.NewMessage());

        assert.strictEqual(out.payload.api, 'messages');
        assert.strictEqual(out.payload.func, 'SendMessage');
        assert.strictEqual(out.payload.args.message, 'hello');
        assert.strictEqual(typeof out.payload.args.randomId, 'bigint', 'SendMessage needs a randomId');
    });

    it('sends nothing for anything else', () => {
        for (const shape of ['Raw', 'DeletedMessage', 'EditedMessage', 'Album', 'CallbackQuery']) {
            assert.strictEqual(echo(payloads[shape]()), undefined, `a ${shape} payload must not be echoed`);
        }
    });

    it('sends nothing for a message with no text', () => {
        // A photo or a sticker without a caption. Echoing it would earn a MESSAGE_EMPTY from Telegram.
        for (const empty of ['', undefined, null]) {
            const msg = payloads.NewMessage();
            msg.payload.message = { className: 'Message', message: empty };

            assert.strictEqual(echo(msg), undefined, `${JSON.stringify(empty)} is nothing to echo`);
        }
    });

    it('falls back to the message peer when the chat could not be resolved', () => {
        // getChat() returns undefined when this session holds no access hash for the chat, and
        // SendMessage then fails with "Cannot cast undefined to any kind of undefined" - which names
        // neither the argument nor the request. peerId is on every message.
        const msg = payloads.NewMessage();
        msg.payload.chat = undefined;
        msg.payload.message = { className: 'Message', message: 'hello', peerId: { className: 'PeerUser' } };

        const out = echo(msg);

        assert.deepStrictEqual(out.payload.args.peer, { className: 'PeerUser' });
    });

    it('prefers the resolved chat when there is one', () => {
        // The better peer: an entity teleproto can turn into an InputPeer without asking Telegram.
        const msg = payloads.NewMessage();
        msg.payload.chat = { className: 'User', id: 7 };
        msg.payload.message = { className: 'Message', message: 'hello', peerId: { className: 'PeerUser' } };

        assert.deepStrictEqual(echo(msg).payload.args.peer, { className: 'User', id: 7 });
    });

    it('sends nothing when there is no peer at all', () => {
        const msg = payloads.NewMessage();
        msg.payload.chat = undefined;
        msg.payload.message = { className: 'Message', message: 'hello' };

        assert.strictEqual(echo(msg), undefined);
    });

    it('listens to incoming messages only, or it echoes its own echo', () => {
        // The sender's message comes back to the receiver as a new outgoing message. Without this the
        // flow answers itself, forever, on the user's own account.
        const receiver = flow.find((node) => node.type === 'telegram client receiver');

        assert.strictEqual(receiver.direction, 'incoming');
    });
});
