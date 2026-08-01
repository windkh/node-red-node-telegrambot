// Created by Karl-Heinz Wind
'use strict';

const { login } = require('../lib/login');
const {
    createPhoneCodePromise,
    createPasswordPromise,
    settlePhoneCode,
    settlePassword,
} = require('../lib/auth-prompt');
const { resolveLoginSecrets } = require('../lib/login-credentials');

// Admin HTTP API backing the "Login" button in the config node's editor dialog. Telegram's
// interactive login needs a phone code (and possibly a 2FA password) that the user can only supply
// after the login has already started, so it spans three requests: `-login` starts it and stays
// open until a session exists, while `-setphonecode` and `-setpassword` feed in the answers.
//
// **POST, not GET.** These requests carry the api hash, the phone number, the 2FA password and the bot
// token. As query parameters those end up in reverse-proxy and web-server access logs, in browser
// history and in Referer headers. A body does not.
//
// The editor can only post what it has: real values for a config node that was never saved, and the
// __PWRD__ placeholder for one whose secrets are stored. resolveLoginSecrets swaps the placeholder for
// the stored credential, which is what lets those credentials be `password`-typed — the runtime never
// hands them back to the browser at all.
module.exports = function (RED) {
    RED.httpAdmin.post('/node-red-node-telegrambot-setphonecode', function (req, res) {
        const parameters = req.body || {};

        settlePhoneCode(parameters.phoneCode);

        res.json('ok');
    });

    RED.httpAdmin.post('/node-red-node-telegrambot-setpassword', function (req, res) {
        const parameters = req.body || {};

        settlePassword(parameters.password);

        res.json('ok');
    });

    RED.httpAdmin.post('/node-red-node-telegrambot-login', function (req, res) {
        const posted = req.body || {};
        // Undefined for a config node that has never been deployed, which is the normal case for a
        // first login — then there is nothing stored and the posted values are used as they are.
        const stored = posted.id !== undefined ? RED.nodes.getCredentials(posted.id) : undefined;
        const parameters = resolveLoginSecrets(posted, stored);

        const getPhoneCode = createPhoneCodePromise();
        const getPassword = createPasswordPromise();

        try {
            login(
                parameters,
                getPhoneCode,
                getPassword,
                (session) => {
                    const data = { session: session };
                    res.json(data);
                },
                (error) => {
                    let message;
                    if (error.code !== undefined) {
                        message = 'Error ' + error.code + ' (' + error.errorMessage + '): ' + error.message;
                    } else if (error.message !== undefined) {
                        message = error.message;
                    } else {
                        message = error;
                    }

                    const data = {
                        type: 'error',
                        error: message,
                    };
                    res.json(data);
                }
            );
        } catch {
            // TODO: login() reports its own failures through the error callback above; this only
            // catches a synchronous throw before that callback is reachable.
        }
    });
};
