// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const loginEndpoints = require('../telegrambot/nodes/login-endpoints');

// Captures the route handlers so they can be invoked without an HTTP server.
function loadRoutes() {
    const routes = {};

    loginEndpoints({
        httpAdmin: {
            get(route, handler) {
                routes[route] = handler;
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

describe('login admin endpoints', () => {
    it('acknowledges a phone code even when no login is waiting for one', () => {
        const routes = loadRoutes();
        const res = createResponse();

        routes['/node-red-node-telegrambot-setphonecode']({ query: { phoneCode: '12345' } }, res);

        assert.deepStrictEqual(res.body, ['ok']);
    });

    it('acknowledges a password even when no login is waiting for one', () => {
        const routes = loadRoutes();
        const res = createResponse();

        routes['/node-red-node-telegrambot-setpassword']({ query: { password: 'secret' } }, res);

        assert.deepStrictEqual(res.body, ['ok']);
    });

    it('forwards a code supplied after the login started', async () => {
        const routes = loadRoutes();
        const res = createResponse();

        // The login route parks the promises; the follow-up request settles them. An empty query
        // means the login aborts before it reaches Telegram, which is what keeps this test offline.
        const login = new Promise((resolve) => {
            routes['/node-red-node-telegrambot-login']({ query: {} }, { json: resolve });
        });

        routes['/node-red-node-telegrambot-setphonecode']({ query: { phoneCode: '54321' } }, res);

        const answer = await login;
        assert.strictEqual(answer.type, 'error');
        assert.strictEqual(answer.error, 'Parameters are missing: apiId, apiHash, phoneNumber');
        assert.deepStrictEqual(res.body, ['ok']);
    });
});
