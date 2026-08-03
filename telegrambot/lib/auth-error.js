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

module.exports = {
    describeAuthError,
};
