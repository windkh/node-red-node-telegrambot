// Created by Karl-Heinz Wind
'use strict';

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const { buildClientParams } = require('./client-params');

// Connects a client from an already stored session string, i.e. the runtime counterpart to
// ./login. Without a session there is nothing to restore, so the caller is told to log in first.
//
// Connecting is best effort: a Telegram outage or a stale session must not take the flow down, so
// failures are reported through `warn` and the caller gets `undefined` instead of a client.
// `warn` keeps this module free of any Node-RED dependency.
async function createTelegramClient(options, warn) {
    const apiId = options.apiId;
    const session = options.session;
    const botToken = options.botToken;

    let client;
    try {
        if (apiId !== undefined && apiId !== '' && session !== undefined && session !== '') {
            const stringSession = new StringSession(session);
            const ID = Number(apiId);

            const clientParams = buildClientParams(options);

            client = new TelegramClient(stringSession, ID, options.apiHash, clientParams);

            client.setLogLevel(options.logLevel);

            // Branch on the configured login mode, not on whether a token happens to be stored:
            // a token left over from experimenting with bot mode would otherwise hijack the auth of
            // a config that has since been switched back to user mode. This also matches ./login.js,
            // which already keys off loginMode.
            let authParams;
            if (options.loginMode === 'bot') {
                authParams = {
                    botAuthToken: botToken,
                };

                if (!botToken) {
                    warn('Login mode is bot but no bot token is stored: log in again.');
                }
            } else {
                authParams = {
                    phoneNumber: options.phoneNumber,
                    onError: (err) => {
                        console.log(err);
                        return true; // abort
                    },
                };
            }

            await client.start(authParams);
            await client.connect();
        } else {
            warn('No session: login first.');
        }
    } catch (error) {
        warn(error);
    }

    return client;
}

module.exports = {
    createTelegramClient,
};
