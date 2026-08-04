// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');

const { Api } = require('teleproto');
const { RPCMessageToError } = require('teleproto/errors');

const {
    describeAuthError,
    describeForLog,
    isTelegramError,
    shortFailureReason,
    REMEDY,
    STATUS_LIMIT,
} = require('../telegrambot/lib/auth-error');

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

    it('is warn in the interactive logins, which are the only ones that can fail this way', () => {
        // The editor's login flows legitimately prompt, so they have an onError, and it has to reach the
        // Node-RED log rather than stdout.
        for (const file of ['lib/login.js', 'lib/login-qr.js']) {
            const body = onErrorBody(readSource(file));

            assert.notStrictEqual(body, null, `${file} no longer has a recognisable onError callback`);
            assert.match(body, /\b(warn|error)\(/, `${file} must report the failure through a callback`);
        }
    });

    it('is a real callback that the login route hands to login()', () => {
        // lib/ must stay free of RED, so the route passes the runtime logger in. An admin route has no
        // node instance to warn through, which is why this one is RED.log rather than node.warn.
        const source = readSource('nodes/login-endpoints.js');

        assert.match(source, /RED\.log\.warn\(/, 'the login route must pass the runtime logger to login()');
    });
});

// The runtime connect must never start a login. teleproto's `start()` probes the session and returns when
// it is valid; when it is not, the auth params decide what happens next — and a `phoneNumber` sends it into
// `signInUser`, which calls `sendCode` *before* asking for the code. So a deploy with a stale session used
// to make Telegram text the user a login code and then fail with "Code is empty" — every redeploy, which is
// how an account earns a FLOOD_WAIT on the code endpoint.
//
// With neither phoneNumber nor botAuthToken, `start()` throws the real reason instead. These assertions are
// source-level for the same reason as the ones above: reaching this code needs a real account.
// See doc/architecture/adr/0022-never-log-in-at-deploy-time.md.
describe('the runtime connect', () => {
    const runtime = () => readSource('lib/telegram-client.js');

    it('sends a failed connect through describeForLog rather than logging it raw', () => {
        // Source-level, and it has to be: the two differ only for an error Telegram sent, and getting one
        // of those requires a real answer from Telegram. Everything reachable offline throws a plain Error,
        // which describeForLog returns unchanged — so a behavioural test cannot tell `warn(describeForLog(e))`
        // from `warn(e)`. This can.
        assert.match(runtime(), /warn\(describeForLog\(error\)\)/, 'an expired session must not log a stack');
    });

    it('never asks teleproto for an interactive login', () => {
        const source = runtime();

        // A phoneNumber in the auth params is the switch that turns a failed session probe into a code
        // being sent. It belongs to lib/login.js, which the editor drives, and nowhere near here.
        assert.ok(!/phoneNumber\s*:/.test(source), 'the runtime auth params must not carry a phoneNumber');
        assert.strictEqual(onErrorBody(source), null, 'an onError here means something interactive can run');
    });

    it('still authorises a bot from its token, which prompts nobody', () => {
        // The one non-interactive re-authorisation worth keeping: a single request, and the account is sent
        // nothing at all.
        assert.match(runtime(), /botAuthToken\s*:/, 'bot mode must keep its token');
    });

    it('hands start() nothing at all in user mode', () => {
        // The literal shape that makes teleproto surface the real authorization error instead of starting
        // a login.
        assert.match(runtime(), /authParams = \{\};/, 'user mode must pass empty auth params');
    });
});

// What a node shows on its status when there is no client. describeAuthError writes for a log, which has no
// width limit; this writes for a canvas, which has very little.
describe('shortFailureReason', () => {
    it('turns the codes that need an action into that action', () => {
        // `AUTH_KEY_UNREGISTERED` is accurate and tells the user nothing about what to do next, which is
        // the entire purpose of a red status.
        const error = RPCMessageToError({ errorMessage: 'AUTH_KEY_UNREGISTERED', errorCode: 401 }, signInRequest());

        assert.strictEqual(shortFailureReason(error), 'session invalid: login again');
    });

    it('passes an unrecognised code through, because a code can be searched for', () => {
        const error = RPCMessageToError({ errorMessage: 'SOMETHING_NEW', errorCode: 400 }, signInRequest());

        // Better than "error": this is the string the user can paste into an issue.
        assert.strictEqual(shortFailureReason(error), 'SOMETHING_NEW');
    });

    it('never carries a request field into the status either', () => {
        for (const failure of TELEGRAM_FAILURES) {
            const reason = shortFailureReason(
                RPCMessageToError({ errorMessage: failure, errorCode: 400 }, signInRequest())
            );

            for (const canary of [CANARY_PHONE, CANARY_HASH, CANARY_CODE]) {
                assert.ok(!reason.includes(canary), `${failure} leaked ${canary}`);
            }
        }
    });

    it('fits on a status, whatever the message', () => {
        const long = new Error('x'.repeat(500));

        const reason = shortFailureReason(long);
        assert.ok(reason.length <= STATUS_LIMIT, `${reason.length} characters is too many for a status`);
        assert.ok(reason.endsWith('…'), 'a truncated reason should say it was truncated');
    });

    it('takes a plain string as it is, which is how the no-session case arrives', () => {
        assert.strictEqual(shortFailureReason('no session: login first'), 'no session: login first');
    });

    it('falls back to the message when there is no code', () => {
        assert.strictEqual(shortFailureReason(new Error('socket hang up')), 'socket hang up');
    });

    it('says something rather than nothing when handed nothing', () => {
        for (const nothing of [undefined, null, {}]) {
            assert.strictEqual(shortFailureReason(nothing), 'not connected', JSON.stringify(nothing));
        }
    });

    it('offers a remedy for every unauthorised code it claims to know', () => {
        // The table is the contract: each entry has to name an action, or it may as well be the raw code.
        for (const [code, remedy] of Object.entries(REMEDY)) {
            assert.ok(remedy.length > 0, `${code} has no remedy`);
            assert.ok(remedy.length <= STATUS_LIMIT, `${code}'s remedy does not fit a status`);
            assert.notStrictEqual(remedy, code, `${code} maps to itself, so the entry adds nothing`);
        }
    });
});

// What reaches the log. An expired session used to arrive as an RPCError logged whole — seven frames of
// MtpDispatcher and MTProtoSender for a condition whose remedy is "log in again". It read like a crash.
describe('describeForLog', () => {
    it('reduces a Telegram answer to one line', () => {
        const error = RPCMessageToError({ errorMessage: 'AUTH_KEY_UNREGISTERED', errorCode: 401 }, signInRequest());
        const logged = describeForLog(error);

        assert.strictEqual(typeof logged, 'string', 'an Error would be printed with its stack');
        assert.match(logged, /AUTH_KEY_UNREGISTERED/);
        // The stack is all teleproto frames; the line has to carry what the reader can act on instead.
        assert.match(logged, /401/);
    });

    it('keeps the whole error when the failure is not Telegram answering', () => {
        // A bug on our side: there the stack *is* the diagnosis, and reducing it to a line would throw the
        // only useful part away.
        const bug = new TypeError('client.sendMessage is not a function');

        assert.strictEqual(describeForLog(bug), bug, 'an unexpected error must keep its stack');
    });

    it('carries no request field into the log either', () => {
        for (const failure of TELEGRAM_FAILURES) {
            const logged = String(
                describeForLog(RPCMessageToError({ errorMessage: failure, errorCode: 400 }, signInRequest()))
            );

            for (const canary of [CANARY_PHONE, CANARY_HASH, CANARY_CODE]) {
                assert.ok(!logged.includes(canary), `${failure} leaked ${canary}`);
            }
        }
    });
});

describe('isTelegramError', () => {
    it('is true for an answer from Telegram', () => {
        assert.strictEqual(
            isTelegramError(RPCMessageToError({ errorMessage: 'FLOOD_WAIT_5', errorCode: 420 }, signInRequest())),
            true
        );
    });

    it('is false for everything that broke on our side', () => {
        for (const other of [new TypeError('boom'), new Error('socket hang up'), 'a string', undefined, null, {}]) {
            assert.strictEqual(isTelegramError(other), false, JSON.stringify(String(other)));
        }
    });

    it("is false for Node's own system errors, which also have a code", () => {
        // The trap this predicate walked into once. A `code !== undefined` test called ENOENT a Telegram
        // answer, so a filesystem failure from the session store would have been logged as a line and lost
        // the stack that explains it. An RPC code is a number and comes with an errorMessage; ENOENT is a
        // string and comes with neither.
        let system;
        try {
            require('node:fs').readFileSync('nope/definitely/missing');
        } catch (error) {
            system = error;
        }

        assert.strictEqual(typeof system.code, 'string', 'precondition: a system error has a string code');
        assert.strictEqual(isTelegramError(system), false);
        assert.strictEqual(describeForLog(system), system, 'it must keep its stack');
    });

    it('needs both halves, not either', () => {
        assert.strictEqual(isTelegramError({ code: 401 }), false, 'a number alone is not enough');
        assert.strictEqual(isTelegramError({ errorMessage: 'AUTH_KEY_UNREGISTERED' }), false, 'nor a message alone');
        assert.strictEqual(
            isTelegramError({ code: '401', errorMessage: 'X' }),
            false,
            'a string code is not an RPC code'
        );
    });
});
