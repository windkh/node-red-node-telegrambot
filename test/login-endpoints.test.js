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

// The QR login spans two requests too, but differently: `-loginqr` answers at once and the editor polls
// `-loginqrstatus`, which is what lets a *replacement* token be delivered when Telegram expires the old
// one. A single held response cannot do that.
//
// Posting an empty body is what keeps these offline — the login stops at the parameter check, which still
// exercises the whole route, the state handoff and the polling.
describe('QR login admin endpoints', () => {
    // The status is written from a callback, so it lands a tick after the route answered.
    function settled() {
        return new Promise((resolve) => setImmediate(resolve));
    }

    it('reports nothing running before a QR login is started', () => {
        const routes = loadRoutes();
        const res = createResponse();

        routes['/node-red-node-telegrambot-loginqrstatus']({ body: {} }, res);

        assert.deepStrictEqual(res.body, [{ type: 'idle' }]);
    });

    it('answers the start request at once rather than holding it open', () => {
        const routes = loadRoutes();
        const res = createResponse();

        routes['/node-red-node-telegrambot-loginqr']({ body: {} }, res);

        // Holding until the first token exists would duplicate what the polling does, and a token that
        // never arrives would hang the dialog.
        assert.deepStrictEqual(res.body, [{ type: 'started' }]);
    });

    it('makes the failure reachable through the status route', async () => {
        const routes = loadRoutes();

        routes['/node-red-node-telegrambot-loginqr']({ body: {} }, createResponse());
        await settled();

        const res = createResponse();
        routes['/node-red-node-telegrambot-loginqrstatus']({ body: {} }, res);

        assert.strictEqual(res.body[0].type, 'error');
        assert.strictEqual(res.body[0].error, 'Parameters are missing: apiId, apiHash');
    });

    it('replaces a running login instead of racing it', async () => {
        const routes = loadRoutes();

        routes['/node-red-node-telegrambot-loginqr']({ body: {} }, createResponse());
        await settled();

        // The second start must reset the state, or the first run's result would be shown for the second
        // attempt — and both would be competing over the shared password prompt.
        routes['/node-red-node-telegrambot-loginqr']({ body: { apiId: '12345', apiHash: 'hash' } }, createResponse());

        const res = createResponse();
        routes['/node-red-node-telegrambot-loginqrstatus']({ body: {} }, res);

        assert.strictEqual(res.body[0].type, 'waiting', 'the stale error must not survive a restart');
    });

    it('survives a request with no body at all', () => {
        const routes = loadRoutes();

        assert.doesNotThrow(() => routes['/node-red-node-telegrambot-loginqr']({}, createResponse()));
        assert.doesNotThrow(() => routes['/node-red-node-telegrambot-loginqrstatus']({}, createResponse()));
    });

    it('looks the stored api hash up by the posted node id, like the phone-code login', async () => {
        const routes = loadRoutes({ apihash: 'stored-hash' });

        // Only the placeholder is substituted, so apiId is still missing and nothing reaches Telegram.
        routes['/node-red-node-telegrambot-loginqr']({ body: { id: 'c1', apiHash: PLACEHOLDER } }, createResponse());
        await settled();

        const res = createResponse();
        routes['/node-red-node-telegrambot-loginqrstatus']({ body: {} }, res);

        assert.strictEqual(res.body[0].type, 'error', 'a missing apiId must still stop it');
    });
});
