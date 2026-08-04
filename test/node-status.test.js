// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const helper = require('node-red-node-test-helper');
const { UpdateConnectionState } = require('teleproto/network');

const telegramBotNode = require('../telegrambot/telegrambot.js');
const { CONNECTED, DISCONNECTED, BROKEN, failureStatus } = require('../telegrambot/lib/node-status');

// Every node that shows a connection status, not just the two that happened to be tested. This file
// exists because they were not: the `broken` text was corrected in the receiver and the sender and left
// stale in the download and upload nodes, and the whole suite stayed green — four nodes, two different
// texts for the same state. A flow routing on the status through a Status node would have seen one text
// or the other depending on which node it was watching.
//
// The statuses are a public contract, so they are asserted by value here rather than only against the
// shared constants: importing the constants alone would let a text change slip through unnoticed, which
// is exactly what happened.
const EXPECTED = {
    connected: { fill: 'green', shape: 'ring', text: 'connected' },
    disconnected: { fill: 'red', shape: 'ring', text: 'disconnected' },
    broken: { fill: 'red', shape: 'dot', text: 'broken: login again or redeploy' },
};

const STATUS_NODES = [
    'telegram client receiver',
    'telegram client sender',
    'telegram client download',
    'telegram client upload',
];

const configNode = { id: 'c1', type: 'telegram client config', botname: 'test' };

describe('connection status, across every node that shows one', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    async function loadEveryStatusNode() {
        const flow = [configNode, ...STATUS_NODES.map((type, index) => ({ id: 'n' + index, type: type, bot: 'c1' }))];
        await helper.load(telegramBotNode, flow);

        const recorded = new Map();
        for (const [index, type] of STATUS_NODES.entries()) {
            const node = helper.getNode('n' + index);
            const statuses = [];
            node.status = (status) => statuses.push(status);
            recorded.set(type, statuses);
        }

        return { config: helper.getNode('c1'), recorded };
    }

    it('subscribes all four to the config node', async () => {
        const { config } = await loadEveryStatusNode();

        // Without this the assertions below could pass vacuously: a node that never registered simply
        // records nothing, and `at(-1)` on an empty array is undefined.
        assert.strictEqual(config.statusListeners.size, STATUS_NODES.length);
    });

    for (const state of ['connected', 'disconnected', 'broken']) {
        it(`reports the same '${state}' status from every node`, async () => {
            const { config, recorded } = await loadEveryStatusNode();

            for (const listener of config.statusListeners) {
                listener.onConnectionState(state);
            }

            for (const type of STATUS_NODES) {
                assert.deepStrictEqual(recorded.get(type).at(-1), EXPECTED[state], `${type} disagrees on '${state}'`);
            }
        });
    }

    it('deregisters every node again when it closes', async () => {
        // The other half of the subscription, and it was untested: dropping the deregistration passed
        // the whole suite. What it costs is a config node holding a reference to a closed node and
        // writing statuses into it after a redeploy — the same class of leak as issue #16.
        const { config, recorded } = await loadEveryStatusNode();
        assert.strictEqual(config.statusListeners.size, STATUS_NODES.length, 'precondition');

        for (const [index] of STATUS_NODES.entries()) {
            await helper.getNode('n' + index).close();
        }

        assert.strictEqual(config.statusListeners.size, 0, 'a closed node is still subscribed');

        // And nothing reaches the closed nodes afterwards. Iterating the (now empty) listener set would
        // pass trivially, so the state is pushed through the config node's own dispatch instead.
        const before = new Map([...recorded].map(([type, statuses]) => [type, statuses.length]));
        config.onConnectionState(new UpdateConnectionState(UpdateConnectionState.connected));

        for (const type of STATUS_NODES) {
            assert.strictEqual(recorded.get(type).length, before.get(type), `${type} was written to after close`);
        }
    });

    it('ignores a state the package does not map, in every node', async () => {
        const { config, recorded } = await loadEveryStatusNode();

        for (const listener of config.statusListeners) {
            listener.onConnectionState('something-new');
        }

        for (const type of STATUS_NODES) {
            assert.deepStrictEqual(recorded.get(type), [], `${type} invented a status for an unknown state`);
        }
    });
});

describe('the shared status constants', () => {
    it('are what the nodes are asserted against', () => {
        // The nodes are checked by value above, so this is the other half: it catches a constant being
        // edited without the expectations following, rather than the two drifting apart silently.
        assert.deepStrictEqual(CONNECTED, EXPECTED.connected);
        assert.deepStrictEqual(DISCONNECTED, EXPECTED.disconnected);
        assert.deepStrictEqual(BROKEN, EXPECTED.broken);
    });
});

describe('failureStatus', () => {
    it('is red, and a dot rather than a ring', () => {
        // A ring means "this heals itself", which is what `disconnected` from the connection-state stream
        // is. A failed connect needs somebody to do something, so it gets the dot.
        const status = failureStatus('session invalid: login again');

        assert.strictEqual(status.fill, 'red');
        assert.strictEqual(status.shape, 'dot');
        assert.notStrictEqual(status.shape, DISCONNECTED.shape, 'it must not look like a transient drop');
    });

    it('carries the reason it was given', () => {
        assert.strictEqual(failureStatus('api id or hash is wrong').text, 'api id or hash is wrong');
    });

    it('says something when there is no reason to give', () => {
        assert.strictEqual(failureStatus(undefined).text, 'not connected');
    });
});

// A red status that names the cause is only useful if *every* node shows it. Testing one of them let a
// reversal of the other four pass unnoticed — the same gap that shipped two different `broken` texts.
describe('the reason for a failed connect', () => {
    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
    });

    for (const type of STATUS_NODES) {
        it(`is what ${type} shows when there is no client`, async () => {
            await helper.load(telegramBotNode, [configNode, { id: 'n1', type: type, bot: 'c1' }]);

            const n1 = helper.getNode('n1');
            const statuses = [];
            n1.status = (status) => statuses.push(status);

            // Driven explicitly rather than relying on the start() that ran during load: that one is async
            // and its status may already have been written before the recorder was attached.
            await n1.start();

            // No credentials in this flow, so the config node never got as far as a session.
            assert.deepStrictEqual(statuses.at(-1), {
                fill: 'red',
                shape: 'dot',
                text: 'no session: login first',
            });
        });
    }

    it('is forgotten once a connect succeeds', async () => {
        await helper.load(telegramBotNode, [configNode]);
        const c1 = helper.getNode('c1');

        // A reason left over from an earlier attempt would keep being shown by every node that asks, long
        // after the problem was fixed.
        c1.lastFailure = 'session invalid: login again';
        c1.createTelegramClient = async () => ({ addEventHandler() {}, destroy: async () => {} });

        await c1.getTelegramClient(c1);

        assert.strictEqual(c1.lastFailure, undefined, 'a stale reason must not outlive the failure');
    });
});
