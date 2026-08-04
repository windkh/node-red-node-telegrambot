// Created by Karl-Heinz Wind
'use strict';

const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

const { buildClientParams } = require('./client-params');
const { describeAuthError } = require('./auth-error');

// What to hand teleproto as `authParams.password`. Always a function, because teleproto **calls** it:
// `await authParams.password(passwordSrpResult.hint)` in `client/auth.js`. A password that was already
// known used to be left as the string the editor posted, and the call then threw
// `authParams.password is not a function` into `onError` — which aborts, so teleproto raised
// `AUTH_USER_CANCEL` and the dialog said the login was cancelled.
//
// That was not a rare path. Node-RED puts `__PWRD__` in a stored password field itself and
// ./login-credentials resolves it to the real password, so every re-login of an account with two-step
// verification arrived here with a non-empty string and could not succeed. Leaving the field blank was
// the only way through, which is what made this look like a rule about the order of entry.
//
// A named function because nothing past this point can run offline — the branch that calls it is inside
// Telegram's password check — so this is the only place a test can hold the rule to.
function passwordSource(supplied, getPassword) {
    let source;

    // The usual case: nothing entered, so the account may still ask and the prompt answers it.
    if (supplied === undefined || supplied === '') {
        source = async () => await getPassword;
    } else {
        source = async () => supplied;
    }

    return source;
}

// Performs the interactive login that produces a session string.
//
// This is the one-off authentication triggered from the config node's editor dialog, not the
// per-runtime connect: it starts from an empty session and reports the resulting session string
// through `sessionCreated`. `getPhoneCode` and `getPassword` are pending promises settled by later
// admin requests (see ./auth-prompt), which is why they are awaited lazily inside the auth params.
//
// `warn` is how a failure that does not end the login gets reported. There is no node instance here —
// the login is an admin route, not a node — so the caller passes the runtime logger. Keeping it a plain
// callback is what lets this module stay free of `RED`.
async function login(parameters, getPhoneCode, getPassword, sessionCreated, error, warn) {
    try {
        const apiId = Number(parameters.apiId);
        const apiHash = parameters.apiHash;
        const phoneNumber = parameters.phoneNumber;
        const botToken = parameters.botToken;
        const loginMode = parameters.loginMode;
        const password = passwordSource(parameters.password, getPassword);

        if (apiId !== undefined && apiHash !== undefined && phoneNumber !== undefined) {
            const stringSession = new StringSession('');

            const clientParams = buildClientParams({
                proxy: parameters.proxy,
                deviceModel: parameters.devicemodel,
                systemVersion: parameters.systemversion,
                appVersion: parameters.appversion,
            });

            const client = new TelegramClient(stringSession, apiId, apiHash, clientParams);

            client.setLogLevel('warn');

            let authParams;
            if (loginMode === 'user') {
                authParams = {
                    phoneNumber: phoneNumber,
                    phoneCode: async () => await getPhoneCode,
                    password: password,
                    // Through `warn`, not `console.log`: stdout bypasses the Node-RED log and its
                    // level. See ./auth-error for what is safe to log here (#33).
                    //
                    // Returning true aborts, and teleproto then throws `AUTH_USER_CANCEL` — which is
                    // all the editor dialog gets to show. The real cause only exists here, so logging
                    // it is not optional.
                    onError: (err) => {
                        warn('Telegram login failed: ' + describeAuthError(err));
                        return true; // abort
                    },
                };
            } else if (loginMode === 'bot') {
                authParams = {
                    botAuthToken: botToken,
                };
            } else {
                throw 'LoginMode ' + loginMode + ' is not supported';
            }

            await client.start(authParams);

            const session = client.session.save();
            sessionCreated(session);
        } else {
            error('Parameters are missing: apiId, apiHash, phoneNumber');
        }
    } catch (err) {
        error(err);
    }
}

module.exports = {
    login,
    passwordSource,
};
