// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
    createPhoneCodePromise,
    createPasswordPromise,
    settlePhoneCode,
    settlePassword,
} = require('../telegrambot/lib/auth-prompt');

describe('auth prompt', () => {
    it('resolves the phone code promise with the value supplied later', async () => {
        const getPhoneCode = createPhoneCodePromise();
        settlePhoneCode('12345');

        assert.strictEqual(await getPhoneCode, '12345');
    });

    it('rejects the phone code promise when the user supplies nothing', async () => {
        const getPhoneCode = createPhoneCodePromise();
        settlePhoneCode('');

        await assert.rejects(() => getPhoneCode);
    });

    it('resolves the password promise with the value supplied later', async () => {
        const getPassword = createPasswordPromise();
        settlePassword('secret');

        assert.strictEqual(await getPassword, 'secret');
    });

    it('rejects the password promise when the user supplies nothing', async () => {
        const getPassword = createPasswordPromise();
        settlePassword('');

        await assert.rejects(() => getPassword);
    });

    it('settles the newest promise when a login is retried', async () => {
        const abandoned = createPhoneCodePromise();
        abandoned.catch(() => {});

        const current = createPhoneCodePromise();
        settlePhoneCode('67890');

        assert.strictEqual(await current, '67890');
    });
});
