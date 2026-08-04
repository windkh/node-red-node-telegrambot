// Created by Karl-Heinz Wind
'use strict';

// Describes an authentication failure in one line, for the editor dialog and for the Node-RED log.
//
// **The audit behind this (issue #33).** Both call sites used to `console.log` the error object whole,
// and `AGENTS.md` forbids ever logging the session, api hash, bot token or phone number. What actually
// reaches teleproto's `onError` was checked rather than assumed:
//
//   - An `RPCError` is built as `new RPCError(message, request, code)`. It passes the request to
//     `_fmtRequest`, which returns ` (caused by ${request.className})` — the class name only — and it
//     never assigns the request to the instance. Its own enumerable properties are `name`, `code` and
//     `errorMessage`; some subclasses add `seconds` or `newDc`.
//   - The other paths throw literals: `Auth failed`, `Password is empty`, `Code is empty`,
//     `First name is required`.
//   - Bot mode never gets here at all. `signInBot` throws instead of calling `onError`, and the bot
//     branch of ./telegram-client passes no `onError`, so a bad token already goes through `warn`.
//
// Verified against a real `Api.auth.SignIn` carrying a phone number, a code and a code hash: none of the
// three appears anywhere in the formatted error. So nothing here needs redacting — but a summary is
// still what gets logged, because a stack trace from inside teleproto tells the reader nothing and
// because a summary is something a test can hold to.
function describeAuthError(error) {
    let description;

    // An RPCError, which is what a rejected Telegram request produces. `code` and `errorMessage` are
    // what identify the failure; `message` adds teleproto's own wording and the request class.
    if (error.code !== undefined) {
        description = 'Error ' + error.code + ' (' + error.errorMessage + '): ' + error.message;
    } else if (error.message !== undefined) {
        description = error.message;
    } else {
        // login() itself rejects an unsupported login mode with a plain string.
        description = error;
    }

    return description;
}

// Telegram's error codes, and what they mean for someone reading a node status. Only the ones where the
// code alone would leave the user guessing: `AUTH_KEY_UNREGISTERED` is accurate but says nothing about what
// to do, and doing something is the whole reason a status is red.
const REMEDY = {
    AUTH_KEY_UNREGISTERED: 'session invalid: login again',
    AUTH_KEY_INVALID: 'session invalid: login again',
    AUTH_KEY_DUPLICATED: 'session used elsewhere: login again',
    SESSION_REVOKED: 'session revoked: login again',
    SESSION_EXPIRED: 'session expired: login again',
    USER_DEACTIVATED: 'account deactivated',
    USER_DEACTIVATED_BAN: 'account banned',
    API_ID_INVALID: 'api id or hash is wrong',
    API_ID_PUBLISHED_FLOOD: 'api id is flood-limited',
};

// How long a status may be before the canvas turns it into an ellipsis. Long enough for the remedies above.
const STATUS_LIMIT = 40;

// One line for a node status, as opposed to describeAuthError's one line for a log.
//
// A status has room for a few words, so this prefers Telegram's own error code over the sentence around it
// — and a remedy over the code where there is one to give. Anything unrecognised is passed through
// truncated rather than replaced by something vague: a code the user can search for beats "error".
function shortFailureReason(error) {
    let reason;

    if (error !== undefined && error !== null && REMEDY[error.errorMessage] !== undefined) {
        reason = REMEDY[error.errorMessage];
    } else if (error !== undefined && error !== null && typeof error.errorMessage === 'string') {
        reason = error.errorMessage;
    } else if (typeof error === 'string') {
        reason = error;
    } else if (error !== undefined && error !== null && typeof error.message === 'string') {
        reason = error.message;
    } else {
        reason = 'not connected';
    }

    return reason.length > STATUS_LIMIT ? reason.slice(0, STATUS_LIMIT - 1) + '…' : reason;
}

module.exports = {
    describeAuthError,
    shortFailureReason,
    REMEDY,
    STATUS_LIMIT,
};
