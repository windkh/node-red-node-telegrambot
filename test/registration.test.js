// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const entry = require('../telegrambot/telegrambot.js');

// Collects what the entry point registers, without starting a Node-RED runtime.
function createRedStub() {
    const registeredTypes = [];
    const adminRoutes = [];

    return {
        registeredTypes,
        adminRoutes,
        nodes: {
            registerType(type, constructor, options) {
                registeredTypes.push({ type, constructor, options });
            },
            createNode() {},
            getNode() {
                return undefined;
            },
        },
        httpAdmin: {
            get(route) {
                adminRoutes.push(route);
            },
        },
        events: {
            on() {},
            removeListener() {},
        },
    };
}

describe('entry point registration', () => {
    it('loads without throwing', () => {
        const RED = createRedStub();
        assert.doesNotThrow(() => entry(RED));
    });

    it('registers the node types in dependency order', () => {
        const RED = createRedStub();
        entry(RED);

        // The config node has to come first: every other node resolves it by id at construction time.
        const types = RED.registeredTypes.map((entry) => entry.type);
        assert.deepStrictEqual(types, [
            'telegram client config',
            'telegram client receiver',
            'telegram client sender',
            'telegram client download',
            'telegram client upload',
        ]);
    });

    it('registers every node type with a constructor function', () => {
        const RED = createRedStub();
        entry(RED);

        for (const registered of RED.registeredTypes) {
            assert.strictEqual(typeof registered.constructor, 'function', `${registered.type} has no constructor`);
        }
    });

    it('declares the config node credentials', () => {
        const RED = createRedStub();
        entry(RED);

        const config = RED.registeredTypes.find((entry) => entry.type === 'telegram client config');
        // Must stay in step with the editor's credentials block in telegrambot.html: Node-RED only
        // persists what is declared here, so anything the editor offers but this omits is discarded.
        //
        // `session` is deliberately `password`: for `text` the runtime sends the stored value to the
        // editor in clear, and the session authenticates the whole Telegram account.
        assert.deepStrictEqual(config.options, {
            credentials: {
                apiid: { type: 'text' },
                apihash: { type: 'text' },
                session: { type: 'password' },
                phonenumber: { type: 'text' },
                bottoken: { type: 'text' },
                twofapassword: { type: 'text' },
            },
        });
    });

    it('registers the login admin endpoints used by the editor dialog', () => {
        const RED = createRedStub();
        entry(RED);

        assert.deepStrictEqual(RED.adminRoutes, [
            '/node-red-node-telegrambot-setphonecode',
            '/node-red-node-telegrambot-setpassword',
            '/node-red-node-telegrambot-login',
        ]);
    });
});
