// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { login, passwordSource } = require('../telegrambot/lib/login');

// These cases stop at the parameter check, so no TelegramClient is ever constructed and nothing
// reaches the network. Anything past that check needs a real Telegram account and is out of scope
// for the test suite.
describe('login parameter validation', () => {
    it('reports missing parameters instead of attempting a connection', async () => {
        const errors = [];
        const sessions = [];
        const warnings = [];

        await login(
            {},
            Promise.resolve('code'),
            Promise.resolve('pw'),
            (session) => sessions.push(session),
            (error) => errors.push(error),
            (message) => warnings.push(message)
        );

        assert.deepStrictEqual(errors, ['Parameters are missing: apiId, apiHash, phoneNumber']);
        assert.strictEqual(sessions.length, 0, 'no session may be reported');
        // The parameter check is not an authentication failure, so it goes to the caller rather than
        // to the log: the editor dialog is where the user is looking.
        assert.deepStrictEqual(warnings, []);
    });

    it('reports missing parameters when only the api hash is given', async () => {
        const errors = [];

        await login(
            { apiHash: 'hash' },
            Promise.resolve('code'),
            Promise.resolve('pw'),
            () => {},
            (error) => errors.push(error),
            () => {}
        );

        assert.deepStrictEqual(errors, ['Parameters are missing: apiId, apiHash, phoneNumber']);
    });
});

// The 2FA password teleproto is given. It has to be a function, because teleproto calls it:
// `await authParams.password(passwordSrpResult.hint)` in client/auth.js. Passing the string through
// instead threw `authParams.password is not a function` into `onError`, which aborts - so the dialog
// reported `AUTH_USER_CANCEL` and the user was told the login had been cancelled.
//
// Reachable only behind a real Telegram password check, so this is the one place it can be pinned.
describe('passwordSource', () => {
    it('is a function whatever it was given, which is the whole point', async () => {
        for (const supplied of [undefined, '', 'a-password']) {
            assert.strictEqual(
                typeof passwordSource(supplied, Promise.resolve('from the prompt')),
                'function',
                `a ${JSON.stringify(supplied)} password must still arrive as a function`
            );
        }
    });

    it('hands over a password that is already known', async () => {
        // Including the case that made this unusable: a stored 2FA password reaches the route as the
        // __PWRD__ placeholder and lib/login-credentials resolves it, so the login always had one.
        const source = passwordSource('the-stored-one', Promise.resolve('from the prompt'));

        assert.strictEqual(await source('a hint'), 'the-stored-one');
    });

    it('waits for the prompt when there is none', async () => {
        for (const blank of [undefined, '']) {
            const source = passwordSource(blank, Promise.resolve('from the prompt'));

            assert.strictEqual(await source('a hint'), 'from the prompt', `${JSON.stringify(blank)}`);
        }
    });

    it('is called the way teleproto calls it, hint and all', async () => {
        // teleproto passes the account's password hint. Nothing here uses it, but a source that only
        // worked when called with no arguments would be a trap for the next change.
        const source = passwordSource('', Promise.resolve('from the prompt'));

        assert.strictEqual(await source('remember the cat'), 'from the prompt');
    });
});
