// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const entry = require('../telegrambot/telegrambot.js');

// Collects what the entry point registers, without starting a Node-RED runtime.
function createRedStub() {
    const registeredTypes = [];
    const adminRoutes = [];
    // Recorded separately: a login route that went back to GET would put the api hash and the 2FA
    // password in query strings again, and only the method reveals that.
    const getRoutes = [];

    // What the entry point logs on load. Part of the runtime API, so the stub has to have it — without
    // it the version line the entry point writes throws and every test in this file fails at `require`.
    const logged = [];

    return {
        registeredTypes,
        adminRoutes,
        getRoutes,
        logged,
        log: {
            info(message) {
                logged.push(message);
            },
            warn(message) {
                logged.push(message);
            },
            error(message) {
                logged.push(message);
            },
        },
        nodes: {
            registerType(type, constructor, options) {
                registeredTypes.push({ type, constructor, options });
            },
            createNode() {},
            getNode() {
                return undefined;
            },
            getCredentials() {
                return undefined;
            },
        },
        httpAdmin: {
            get(route) {
                getRoutes.push(route);
                adminRoutes.push(route);
            },
            post(route) {
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
            'telegram client list',
        ]);
    });

    it('announces its version on load', () => {
        const RED = createRedStub();
        entry(RED);

        // Whatever the wording, it has to carry the version from package.json — a hardcoded one would
        // drift on the next release and quietly misreport which code is running.
        const version = require('../package.json').version;
        assert.ok(
            RED.logged.some((message) => String(message).includes(version)),
            `expected the load to log version ${version}, got ${JSON.stringify(RED.logged)}`
        );
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
        // Every secret is `password`: for `text` the runtime sends the stored value to the editor in
        // clear. `apiid` is an application id and `phonenumber` has to stay legible so the user can
        // tell which account a config belongs to.
        assert.deepStrictEqual(config.options, {
            credentials: {
                apiid: { type: 'text' },
                apihash: { type: 'password' },
                session: { type: 'password' },
                phonenumber: { type: 'text' },
                bottoken: { type: 'password' },
                twofapassword: { type: 'password' },
            },
        });
    });

    it('registers the login admin endpoints used by the editor dialog', () => {
        const RED = createRedStub();
        entry(RED);

        // The paths are public API per AGENTS.md — anyone who scripted against them depends on these
        // exact strings, so the list is asserted rather than counted.
        assert.deepStrictEqual(RED.adminRoutes, [
            '/node-red-node-telegrambot-setphonecode',
            '/node-red-node-telegrambot-setpassword',
            '/node-red-node-telegrambot-loginqr',
            '/node-red-node-telegrambot-loginqrstatus',
            '/node-red-node-telegrambot-login',
        ]);
    });

    it('registers the login endpoints as POST, so secrets stay out of the URL', () => {
        const RED = createRedStub();
        entry(RED);

        // These bodies carry the api hash, the phone number, the 2FA password and the bot token. As
        // query parameters they reach access logs, browser history and Referer headers.
        assert.deepStrictEqual(RED.getRoutes, [], 'no login route may be a GET');
        assert.strictEqual(RED.adminRoutes.length, 5);
    });
});

// The config dialog's order is the only thing about it worth asserting, and it is worth asserting: the
// optional client parameters were added above the session field, which pushed the one control the dialog
// exists for below the fold. Order is what a reader of the template would have to notice; a test says it.
describe('the config dialog puts first things first', () => {
    const template = (() => {
        const html = readFileSync(join(__dirname, '..', 'telegrambot', 'telegrambot.html'), 'utf8');
        const found = html.match(
            /<script type="text\/x-red" data-template-name="telegram client config">([\s\S]*?)<\/script>/
        );

        return found[1];
    })();

    it('runs identity, then session, then login, then the optional parameters', () => {
        const expected = [
            'node-config-input-loginmode',
            'node-config-input-apihash',
            'node-config-input-session',
            'loginbutton',
            'loginqrbutton',
            'node-config-input-phonecode',
            'node-config-input-devicemodel',
            'node-config-input-useproxy',
        ];

        const positions = expected.map((id) => template.indexOf(id));
        positions.forEach((at, index) => assert.ok(at > -1, expected[index] + ' is not in the dialog'));

        expected.forEach((id, index) => {
            if (index > 0) {
                assert.ok(positions[index] > positions[index - 1], id + ' must come after ' + expected[index - 1]);
            }
        });
    });

    it('keeps the divs balanced', () => {
        // The reorder moved two blocks between nesting levels, and an unbalanced template does not fail
        // to load — it silently swallows whatever follows it.
        const opened = template.match(/<div\b/g).length;
        const closed = template.match(/<\/div>/g).length;

        assert.strictEqual(opened, closed);
    });
});
