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

    it('listens to incoming messages only, or it echoes its own echo', () => {
        // The sender's message comes back to the receiver as a new outgoing message. Without this the
        // flow answers itself, forever, on the user's own account.
        const receiver = flow.find((node) => node.type === 'telegram client receiver');

        assert.strictEqual(receiver.direction, 'incoming');
    });
});
