// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { login } = require('../telegrambot/lib/login');

// These cases stop at the parameter check, so no TelegramClient is ever constructed and nothing
// reaches the network. Anything past that check needs a real Telegram account and is out of scope
// for the test suite.
describe('login parameter validation', () => {
    it('reports missing parameters instead of attempting a connection', async () => {
        const errors = [];
        const sessions = [];

        await login(
            {},
            Promise.resolve('code'),
            Promise.resolve('pw'),
            (session) => sessions.push(session),
            (error) => errors.push(error)
        );

        assert.deepStrictEqual(errors, ['Parameters are missing: apiId, apiHash, phoneNumber']);
        assert.strictEqual(sessions.length, 0, 'no session may be reported');
    });

    it('reports missing parameters when only the api hash is given', async () => {
        const errors = [];

        await login(
            { apiHash: 'hash' },
            Promise.resolve('code'),
            Promise.resolve('pw'),
            () => {},
            (error) => errors.push(error)
        );

        assert.deepStrictEqual(errors, ['Parameters are missing: apiId, apiHash, phoneNumber']);
    });
});
