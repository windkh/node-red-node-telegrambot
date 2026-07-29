// Created by Karl-Heinz Wind
'use strict';

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const { buildClientParams } = require('./client-params');

// Performs the interactive login that produces a session string.
//
// This is the one-off authentication triggered from the config node's editor dialog, not the
// per-runtime connect: it starts from an empty session and reports the resulting session string
// through `sessionCreated`. `getPhoneCode` and `getPassword` are pending promises settled by later
// admin requests (see ./auth-prompt), which is why they are awaited lazily inside the auth params.
async function login(parameters, getPhoneCode, getPassword, sessionCreated, error) {
    try {
        const apiId = Number(parameters.apiId);
        const apiHash = parameters.apiHash;
        const phoneNumber = parameters.phoneNumber;
        const botToken = parameters.botToken;
        const loginMode = parameters.loginMode;

        // An empty password means the account may still ask for one: defer to the prompt.
        let password = parameters.password;
        if (password === undefined || password === '') {
            password = async () => await getPassword;
        }

        if (apiId !== undefined && apiHash !== undefined && phoneNumber !== undefined) {
            const stringSession = new StringSession('');

            const clientParams = buildClientParams({
                proxy: parameters.proxy,
                useWSS: parameters.useWSS,
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
                    onError: (err) => {
                        console.log(err);
                        // if (err.errorMessage === 'PHONE_CODE_INVALID') {
                        // }
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
};
