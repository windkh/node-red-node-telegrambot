// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const loginEndpoints = require('../telegrambot/nodes/login-endpoints');
const { PLACEHOLDER, resolveLoginSecrets } = require('../telegrambot/lib/login-credentials');

// Captures the route handlers so they can be invoked without an HTTP server. `storedCredentials` stands
// in for what RED.nodes.getCredentials would return.
function loadRoutes(storedCredentials) {
    const routes = {};

    loginEndpoints({
        httpAdmin: {
            post(route, handler) {
                routes[route] = handler;
            },
        },
        nodes: {
            getCredentials() {
                return storedCredentials;
            },
        },
    });

    return routes;
}

function createResponse() {
    const body = [];

    return {
        body,
        json(value) {
            body.push(value);
        },
    };
}

describe('resolveLoginSecrets', () => {
    it('keeps the posted values when they are real', () => {
        const resolved = resolveLoginSecrets(
            { apiHash: 'typed-hash', botToken: 'typed-token', password: 'typed-pw' },
            { apihash: 'stored-hash', bottoken: 'stored-token', twofapassword: 'stored-pw' }
        );

        // A config node that has never been saved posts what the user just typed; that must win.
        assert.strictEqual(resolved.apiHash, 'typed-hash');
        assert.strictEqual(resolved.botToken, 'typed-token');
        assert.strictEqual(resolved.password, 'typed-pw');
    });

    it('substitutes the stored value wherever the placeholder arrives', () => {
        const resolved = resolveLoginSecrets(
            { apiHash: PLACEHOLDER, botToken: PLACEHOLDER, password: PLACEHOLDER },
            { apihash: 'stored-hash', bottoken: 'stored-token', twofapassword: 'stored-pw' }
        );

        // This is what makes a re-login work while the credentials stay `password`-typed: the editor
        // never had the values to send.
        assert.strictEqual(resolved.apiHash, 'stored-hash');
        assert.strictEqual(resolved.botToken, 'stored-token');
        assert.strictEqual(resolved.password, 'stored-pw');
    });

    it('reads the 2FA password from twofapassword, not from the proxy password', () => {
        const resolved = resolveLoginSecrets(
            { password: PLACEHOLDER },
            { password: 'proxy-pw', twofapassword: 'account-pw' }
        );

        assert.strictEqual(resolved.password, 'account-pw');
    });

    it('copes with nothing stored at all', () => {
        const resolved = resolveLoginSecrets({ apiHash: PLACEHOLDER, apiId: '1' }, undefined);

        // Never deployed: there is nothing to substitute, and the placeholder simply fails validation
        // downstream rather than throwing here.
        assert.strictEqual(resolved.apiHash, undefined);
        assert.strictEqual(resolved.apiId, '1', 'the non-secret parameters must pass through');
    });

    it('leaves the non-secret parameters untouched', () => {
        const resolved = resolveLoginSecrets({ apiId: '7', phoneNumber: '+100', loginMode: 'user' }, {});

        assert.strictEqual(resolved.apiId, '7');
        assert.strictEqual(resolved.phoneNumber, '+100');
        assert.strictEqual(resolved.loginMode, 'user');
    });
});

describe('login admin endpoints', () => {
    it('acknowledges a phone code even when no login is waiting for one', () => {
        const routes = loadRoutes();
        const res = createResponse();

        routes['/node-red-node-telegrambot-setphonecode']({ body: { phoneCode: '12345' } }, res);

        assert.deepStrictEqual(res.body, ['ok']);
    });

    it('acknowledges a password even when no login is waiting for one', () => {
        const routes = loadRoutes();
        const res = createResponse();

        routes['/node-red-node-telegrambot-setpassword']({ body: { password: 'secret' } }, res);

        assert.deepStrictEqual(res.body, ['ok']);
    });

    it('survives a request with no body', () => {
        const routes = loadRoutes();
        const res = createResponse();

        assert.doesNotThrow(() => routes['/node-red-node-telegrambot-setphonecode']({}, res));
        assert.deepStrictEqual(res.body, ['ok']);
    });

    it('forwards a code supplied after the login started', async () => {
        const routes = loadRoutes();
        const res = createResponse();

        // The login route parks the promises; the follow-up request settles them. An empty body means
        // the login aborts before it reaches Telegram, which is what keeps this test offline.
        const login = new Promise((resolve) => {
            routes['/node-red-node-telegrambot-login']({ body: {} }, { json: resolve });
        });

        routes['/node-red-node-telegrambot-setphonecode']({ body: { phoneCode: '54321' } }, res);

        const answer = await login;
        assert.strictEqual(answer.type, 'error');
        assert.strictEqual(answer.error, 'Parameters are missing: apiId, apiHash, phoneNumber');
        assert.deepStrictEqual(res.body, ['ok']);
    });

    it('looks the stored credentials up by the posted node id', async () => {
        const routes = loadRoutes({ apihash: 'stored-hash' });

        // Only apiHash is substituted, so phoneNumber is still missing and the login aborts before any
        // network call — which is exactly what keeps this offline while still proving the lookup ran.
        const answer = await new Promise((resolve) => {
            routes['/node-red-node-telegrambot-login'](
                { body: { id: 'c1', apiId: '1', apiHash: PLACEHOLDER } },
                { json: resolve }
            );
        });

        assert.strictEqual(answer.type, 'error');
        assert.strictEqual(answer.error, 'Parameters are missing: apiId, apiHash, phoneNumber');
    });
});
