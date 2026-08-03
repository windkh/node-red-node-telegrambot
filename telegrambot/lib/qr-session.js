// Created by Karl-Heinz Wind
'use strict';

// Tracks the one QR login that may be in flight, and what the editor should be shown about it.
//
// **Why one.** ./auth-prompt parks its password resolver in module state on the documented assumption
// that only one login runs at a time, and a QR login needs that same prompt for an account with two-step
// verification. So a second attempt replaces the first rather than racing it.
//
// **Why a replaced attempt cannot disturb the new one.** Replacing means aborting, and an aborted
// `signInUserWithQrCode` rejects — so the abandoned run does report a failure of its own, after it has
// been replaced. It lands nowhere, because each attempt owns its own state object and `status()` only ever
// reads the current one. That is the whole mechanism; a `current === state` check inside the callbacks
// would be a guard against a state that cannot be observed. Trying to break it is what showed that.
//
// The login function is a parameter rather than a require: it is the only part that talks to Telegram, and
// keeping it out lets the rules above be exercised without an account. See
// doc/architecture/adr/0020-qr-code-login.md.

// A dialog someone closed and forgot must not keep asking Telegram for tokens. The editor has no reliable
// "I am gone" signal, so this is the backstop; teleproto takes an AbortSignal for exactly this.
const QR_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function createQrSession(runLogin, timeoutMs) {
    const timeout = timeoutMs === undefined ? QR_LOGIN_TIMEOUT_MS : timeoutMs;
    let current;

    function stop() {
        if (current !== undefined) {
            clearTimeout(current.timer);
            current.controller.abort();
            current = undefined;
        }
    }

    function start(parameters, getPassword) {
        stop();

        const controller = new AbortController();
        const state = { controller: controller, status: { type: 'waiting' }, timer: undefined };
        state.timer = setTimeout(() => controller.abort(), timeout);
        state.timer.unref();
        current = state;

        // Writes to this attempt's own state, which is only read while it is the current one.
        const write = (status) => {
            state.status = status;
        };

        // Nothing more will happen once there is a session or a failure, so the backstop can go.
        const settle = (status) => {
            clearTimeout(state.timer);
            write(status);
        };

        runLogin(
            parameters,
            getPassword,
            (token) => write({ type: 'qr', ...token }),
            (session) => settle({ type: 'session', session: session }),
            (message) => settle({ type: 'error', error: message }),
            controller.signal
        );
    }

    function status() {
        return current === undefined ? { type: 'idle' } : current.status;
    }

    return { start: start, status: status, stop: stop };
}

module.exports = {
    QR_LOGIN_TIMEOUT_MS,
    createQrSession,
};
