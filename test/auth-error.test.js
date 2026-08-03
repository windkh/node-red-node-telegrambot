// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');

const { Api } = require('teleproto');
const { RPCMessageToError } = require('teleproto/errors');

const { describeAuthError } = require('../telegrambot/lib/auth-error');

// These are not real values, and they are not credential-shaped either — they only have to be findable.
// `AGENTS.md` forbids a real hash, token, session or phone number in a fixture.
const CANARY_PHONE = '+00CANARYPHONE';
const CANARY_HASH = 'CANARYCODEHASH';
const CANARY_CODE = 'CANARYCODE';

// The request the interactive login actually sends. Building the real Api object rather than a plain
// stand-in is the point: the guarantee being tested is teleproto's, not ours, so a fake would only pin
// down our assumption about it.
function signInRequest() {
    return new Api.auth.SignIn({
        phoneNumber: CANARY_PHONE,
        phoneCodeHash: CANARY_HASH,
        phoneCode: CANARY_CODE,
    });
}

// One per shape the error can take: an exact match in teleproto's error table, a regex match that
// captures a number, a DC-migration error, and something the table does not know at all.
const TELEGRAM_FAILURES = [
    'PHONE_CODE_INVALID',
    'SESSION_PASSWORD_NEEDED',
    'FLOOD_WAIT_42',
    'PHONE_MIGRATE_4',
    'NOT_IN_THE_TABLE',
];

describe('describeAuthError', () => {
    it('leads with the code and the error message, which is what identifies the failure', () => {
        const error = RPCMessageToError({ errorMessage: 'PHONE_CODE_INVALID', errorCode: 400 }, signInRequest());
        const description = describeAuthError(error);

        assert.match(description, /^Error 400 \(PHONE_CODE_INVALID\)/);
    });

    it('carries no part of the request, whatever Telegram rejected', () => {
        // The reason issue #33 was filed. teleproto's RPCError takes the request but uses only its
        // `className` and never stores it, so no field of it can reach a log — this is what says so out
        // loud. If a future version of the library starts attaching the request, this fails.
        for (const failure of TELEGRAM_FAILURES) {
            const error = RPCMessageToError({ errorMessage: failure, errorCode: 400 }, signInRequest());
            const description = describeAuthError(error);

            for (const canary of [CANARY_PHONE, CANARY_HASH, CANARY_CODE]) {
                assert.ok(!description.includes(canary), `${failure} leaked ${canary}: ${description}`);
            }
        }
    });

    it('carries no part of the request when the whole error object is inspected either', () => {
        // describeAuthError only reads three fields, so it could pass the check above while the object
        // itself held a credential — and someone logging the error directly would then leak it. Assert
        // the property the audit actually established.
        for (const failure of TELEGRAM_FAILURES) {
            const error = RPCMessageToError({ errorMessage: failure, errorCode: 400 }, signInRequest());
            const inspected = util.inspect(error, { depth: 6 });

            for (const canary of [CANARY_PHONE, CANARY_HASH, CANARY_CODE]) {
                assert.ok(!inspected.includes(canary), `${failure} carries ${canary} on the error object`);
            }
        }
    });

    it('names the DC on a migration error, because that is the diagnosis', () => {
        const error = RPCMessageToError({ errorMessage: 'PHONE_MIGRATE_4', errorCode: 303 }, signInRequest());

        assert.match(describeAuthError(error), /DC 4/);
    });

    it('passes a plain Error through by its message', () => {
        // teleproto aborts several auth paths with a literal: Auth failed, Password is empty, Code is
        // empty, First name is required.
        assert.strictEqual(describeAuthError(new Error('Password is empty')), 'Password is empty');
    });

    it('copes with the string login() rejects an unsupported mode with', () => {
        // lib/login.js throws `'LoginMode ' + loginMode + ' is not supported'` — a string, not an Error.
        assert.strictEqual(
            describeAuthError('LoginMode webhook is not supported'),
            'LoginMode webhook is not supported'
        );
    });
});

// The other half of #33, and the half that stands whether or not anything leaks: stdout bypasses the
// Node-RED log, so it carries no node context and ignores the configured log level.
//
// These are **source-level** checks, which is not how this suite normally works. The justification: the
// `onError` callbacks can only be reached by a real TelegramClient talking to a real account, and the
// suite deliberately never connects. There is no offline path to them, so there is nothing to drive and
// nothing to observe — an assertion on behaviour is not available at any price. What is available is the
// channel each one names, and that is what must not silently revert to stdout.
//
// Removing the `warn` argument from the login route passed every other test in this file, which is what
// prompted these.
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_ROOT = path.join(__dirname, '..', 'telegrambot');

function readSource(relative) {
    return fs.readFileSync(path.join(PACKAGE_ROOT, relative), 'utf8');
}

function collectSources(directory) {
    const found = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...collectSources(full));
        } else if (entry.name.endsWith('.js')) {
            found.push(full);
        }
    }

    return found;
}

// Everything between `onError:` and the `return true` that aborts the login.
function onErrorBody(source) {
    const match = source.match(/onError:\s*\(err\)\s*=>\s*\{([\s\S]*?)return true/);

    return match === null ? null : match[1];
}

describe('the logging channel', () => {
    it('is never console.log, anywhere in the package', () => {
        const offenders = collectSources(PACKAGE_ROOT)
            // Match a call, not the word: three files mention `console.log` in a comment explaining why
            // they no longer use it, and those comments are worth keeping.
            .filter((file) => /console\s*\.\s*log\s*\(/.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(PACKAGE_ROOT, file));

        assert.deepStrictEqual(offenders, [], 'report through node.warn or RED.log instead');
    });

    it('is warn in both onError callbacks', () => {
        for (const file of ['lib/login.js', 'lib/telegram-client.js']) {
            const body = onErrorBody(readSource(file));

            assert.notStrictEqual(body, null, `${file} no longer has a recognisable onError callback`);
            assert.match(body, /\bwarn\(/, `${file} must report the failure through warn`);
        }
    });

    it('is a real callback that the login route hands to login()', () => {
        // lib/ must stay free of RED, so the route passes the runtime logger in. An admin route has no
        // node instance to warn through, which is why this one is RED.log rather than node.warn.
        const source = readSource('nodes/login-endpoints.js');

        assert.match(source, /RED\.log\.warn\(/, 'the login route must pass the runtime logger to login()');
    });
});
