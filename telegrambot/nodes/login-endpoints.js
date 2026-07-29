// Created by Karl-Heinz Wind
'use strict';

const { login } = require('../lib/login');
const {
    createPhoneCodePromise,
    createPasswordPromise,
    settlePhoneCode,
    settlePassword,
} = require('../lib/auth-prompt');

// Admin HTTP API backing the "Login" button in the config node's editor dialog. Telegram's
// interactive login needs a phone code (and possibly a 2FA password) that the user can only supply
// after the login has already started, so it spans three requests: `-login` starts it and stays
// open until a session exists, while `-setphonecode` and `-setpassword` feed in the answers.
module.exports = function (RED) {
    RED.httpAdmin.get('/node-red-node-telegrambot-setphonecode', function (req, res) {
        const parameters = req.query;

        settlePhoneCode(parameters.phoneCode);

        res.json('ok');
    });

    RED.httpAdmin.get('/node-red-node-telegrambot-setpassword', function (req, res) {
        const parameters = req.query;

        settlePassword(parameters.password);

        res.json('ok');
    });

    RED.httpAdmin.get('/node-red-node-telegrambot-login', function (req, res) {
        const parameters = req.query;

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
