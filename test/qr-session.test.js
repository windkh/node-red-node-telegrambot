// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { QR_LOGIN_TIMEOUT_MS, createQrSession } = require('../telegrambot/lib/qr-session');

// A login that never finishes on its own, so a second one can start while it is still running — which is
// the situation the rules in qr-session exist for and the one the real function cannot be made to produce
// offline.
function createSlowLogin() {
    const runs = [];

    const runLogin = (parameters, getPassword, onToken, onSession, onError, signal) => {
        const run = {
            parameters: parameters,
            signal: signal,
            token: onToken,
            session: onSession,
            error: onError,
            aborted: false,
        };
        signal.addEventListener('abort', () => {
            run.aborted = true;
        });
        runs.push(run);
    };

    return { runLogin: runLogin, runs: runs };
}

const A_TOKEN = { url: 'tg://login?token=AQID', svg: '<svg></svg>', expires: 1785700000 };

describe('createQrSession', () => {
    it('reports nothing running before anything starts', () => {
        const session = createQrSession(createSlowLogin().runLogin);

        assert.deepStrictEqual(session.status(), { type: 'idle' });
    });

    it('reports waiting until the first token exists', () => {
        const session = createQrSession(createSlowLogin().runLogin);
        session.start({ apiId: '1' }, Promise.resolve('pw'));

        assert.deepStrictEqual(session.status(), { type: 'waiting' });
    });

    it('passes the parameters and the password prompt to the login', () => {
        const { runLogin, runs } = createSlowLogin();
        const password = Promise.resolve('pw');
        const session = createQrSession(runLogin);

        session.start({ apiId: '12345', apiHash: 'hash' }, password);

        assert.deepStrictEqual(runs[0].parameters, { apiId: '12345', apiHash: 'hash' });
    });

    it('shows every token, not just the first, because Telegram expires them', () => {
        const { runLogin, runs } = createSlowLogin();
        const session = createQrSession(runLogin);
        session.start({}, Promise.resolve('pw'));

        runs[0].token(A_TOKEN);
        assert.deepStrictEqual(session.status(), { type: 'qr', ...A_TOKEN });

        const replacement = { url: 'tg://login?token=BBBB', svg: '<svg/>', expires: 1785700030 };
        runs[0].token(replacement);
        assert.deepStrictEqual(session.status(), { type: 'qr', ...replacement });
    });

    it('shows the session once it arrives', () => {
        const { runLogin, runs } = createSlowLogin();
        const session = createQrSession(runLogin);
        session.start({}, Promise.resolve('pw'));

        runs[0].session('1AbCdEf');

        assert.deepStrictEqual(session.status(), { type: 'session', session: '1AbCdEf' });
    });

    it('shows a failure', () => {
        const { runLogin, runs } = createSlowLogin();
        const session = createQrSession(runLogin);
        session.start({}, Promise.resolve('pw'));

        runs[0].error('Error 400 (API_ID_INVALID): ...');

        assert.deepStrictEqual(session.status(), { type: 'error', error: 'Error 400 (API_ID_INVALID): ...' });
    });

    it('aborts the running login when a second one starts', () => {
        // Without this the first run keeps asking Telegram for tokens forever, and both runs compete over
        // the one password prompt that lib/auth-prompt parks in module state.
        const { runLogin, runs } = createSlowLogin();
        const session = createQrSession(runLogin);

        session.start({ apiId: 'first' }, Promise.resolve('pw'));
        session.start({ apiId: 'second' }, Promise.resolve('pw'));

        assert.strictEqual(runs.length, 2);
        assert.strictEqual(runs[0].aborted, true, 'the replaced login must be stopped');
        assert.strictEqual(runs[1].aborted, false);
    });

    it('ignores the abandoned login once it has been replaced', () => {
        // An aborted signInUserWithQrCode rejects, so the abandoned run does report a failure of its own,
        // after being replaced. It must not land on the run that replaced it — which holds because each
        // attempt owns its own state and only the current one is ever read. Asserted as the property
        // rather than as the mechanism, so it survives a change of mechanism.
        const { runLogin, runs } = createSlowLogin();
        const session = createQrSession(runLogin);

        session.start({ apiId: 'first' }, Promise.resolve('pw'));
        session.start({ apiId: 'second' }, Promise.resolve('pw'));

        runs[0].error('AbortError: the login was cancelled');
        assert.deepStrictEqual(session.status(), { type: 'waiting' }, 'the new attempt must be unaffected');

        runs[0].token(A_TOKEN);
        assert.deepStrictEqual(session.status(), { type: 'waiting' }, 'nor may it show a stale code');

        runs[0].session('stale-session');
        assert.deepStrictEqual(session.status(), { type: 'waiting' }, 'nor a session for another attempt');

        // And the current one still works.
        runs[1].token(A_TOKEN);
        assert.deepStrictEqual(session.status(), { type: 'qr', ...A_TOKEN });
    });

    it('stops reporting anything once stopped', () => {
        const { runLogin, runs } = createSlowLogin();
        const session = createQrSession(runLogin);
        session.start({}, Promise.resolve('pw'));

        session.stop();

        assert.strictEqual(runs[0].aborted, true);
        assert.deepStrictEqual(session.status(), { type: 'idle' });
    });

    it('gives up on its own after the timeout, so a forgotten dialog stops polling Telegram', async () => {
        const { runLogin, runs } = createSlowLogin();
        const session = createQrSession(runLogin, 5);
        session.start({}, Promise.resolve('pw'));

        assert.strictEqual(runs[0].aborted, false);
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.strictEqual(runs[0].aborted, true, 'the backstop must fire');
    });

    it('has a backstop measured in minutes, not seconds or hours', () => {
        // Long enough to walk to another room for the phone, short enough that a forgotten dialog is not
        // still asking Telegram for tokens an hour later.
        assert.ok(QR_LOGIN_TIMEOUT_MS >= 60 * 1000, 'too short to scan a code');
        assert.ok(QR_LOGIN_TIMEOUT_MS <= 15 * 60 * 1000, 'too long for a forgotten dialog');
    });
});
