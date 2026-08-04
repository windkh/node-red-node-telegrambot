// Created by Karl-Heinz Wind
'use strict';

const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

const { buildClientParams } = require('./client-params');
const { describeForLog, shortFailureReason } = require('./auth-error');
const { openStoredSession } = require('./session-store');

// What teleproto's sanitizeParseMode accepts. It *throws* on anything else, and this is only a formatting
// preference — it must not be able to stop the client connecting, so the value is checked first.
const PARSE_MODES = ['md', 'markdown', 'md2', 'markdownv2', 'html'];

function applyParseMode(client, parseMode, warn) {
    if (parseMode) {
        if (PARSE_MODES.includes(parseMode)) {
            client.setParseMode(parseMode);
        } else {
            warn(`Unknown parse mode '${parseMode}': sending messages without one.`);
        }
    }
}

// Chooses the session the runtime will use.
//
// A StringSession keeps nothing on disk, so the peers it has resolved are lost on every restart and a
// numeric peer id stops working after a redeploy. `sessionStore` opts into an on-disk session that keeps
// them — at the cost of the auth key being written there too, which is why it is a choice and not the
// default. See doc/architecture/adr/0018-persist-the-entity-cache.md.
//
// Exported for tests, for the same reason applyParseMode is: createTelegramClient builds a real
// TelegramClient and cannot run offline, but which session it picks decides where this account's key
// lives, and that is worth pinning down on its own.
async function openSession(options, warn) {
    let telegramSession;

    if (options.sessionStore !== undefined && options.sessionStore !== '') {
        telegramSession = await openStoredSession(options.sessionStore, options.session, warn);
    } else {
        telegramSession = new StringSession(options.session);
    }

    return telegramSession;
}

// Connects a client from an already stored session string, i.e. the runtime counterpart to
// ./login. Without a session there is nothing to restore, so the caller is told to log in first.
//
// Connecting is best effort: a Telegram outage or a stale session must not take the flow down, so
// failures are reported and the caller gets `undefined` instead of a client.
//
// Two channels, because they mean different things. `warn` is for notes that do not stop the connect — an
// unknown parse mode, a bot config with no token. `fail` is for the reason there is no client at all, which
// is what a node turns into its status; before it existed the reason only ever reached the log, and every
// failure looked identical on the canvas.
//
// Both are plain callbacks, which is what keeps this module free of any Node-RED dependency.
async function createTelegramClient(options, warn, fail) {
    const apiId = options.apiId;
    const session = options.session;
    const botToken = options.botToken;

    let client;
    try {
        if (apiId !== undefined && apiId !== '' && session !== undefined && session !== '') {
            const telegramSession = await openSession(options, warn);
            const ID = Number(apiId);

            const clientParams = buildClientParams(options);

            client = new TelegramClient(telegramSession, ID, options.apiHash, clientParams);

            client.setLogLevel(options.logLevel);

            // Unset by default: switching one on would change what every existing flow sends, because
            // text containing *, _ or < would suddenly be read as markup.
            applyParseMode(client, options.parseMode, warn);

            // Branch on the configured login mode, not on whether a token happens to be stored:
            // a token left over from experimenting with bot mode would otherwise hijack the auth of
            // a config that has since been switched back to user mode. This also matches ./login.js,
            // which already keys off loginMode.
            //
            // **No `phoneNumber` in user mode, and that is the point.** `client.start()` probes the
            // session first and returns immediately when it is valid, which is the normal case. When it is
            // not, teleproto reads the auth params to decide what to do — and a `phoneNumber` sends it
            // into the interactive flow, where `signInUser` calls `sendCode` *before* asking for the code.
            // That means a deploy with a stale session made Telegram text the user a login code and then
            // failed with "Code is empty", and every redeploy did it again, which is how an account earns
            // a FLOOD_WAIT on the code endpoint.
            //
            // With neither `phoneNumber` nor `botAuthToken`, `start()` throws the real reason instead —
            // AuthKeyUnregisteredError, SessionRevokedError, UnauthorizedError — which is what the flow
            // should see. AGENTS.md has said all along that deploy-time code must never prompt; this is
            // what makes that true. See doc/architecture/adr/0022-never-log-in-at-deploy-time.md.
            let authParams;
            if (options.loginMode === 'bot') {
                // A bot token is different: re-authorising from it is a single non-interactive request,
                // sends the account nothing, and is exactly how a bot is meant to sign in.
                authParams = {
                    botAuthToken: botToken,
                };

                if (!botToken) {
                    warn('Login mode is bot but no bot token is stored: log in again.');
                }
            } else {
                authParams = {};
            }

            await client.start(authParams);
            await client.connect();
        } else {
            fail('no session: login first');
        }
    } catch (error) {
        // An expired session is ordinary and actionable, not a crash — but it arrives as an RPCError whose
        // stack is seven frames of teleproto internals, which reads like something broke and tells the
        // reader nothing to do. describeForLog decides: Telegram's answer becomes one line, anything
        // unexpected keeps its stack. The status gets the short form either way.
        // See doc/architecture/adr/0024-log-an-expired-session-as-a-line.md.
        warn(describeForLog(error));
        fail(shortFailureReason(error));
    }

    return client;
}

module.exports = {
    createTelegramClient,
    // Exported for tests: createTelegramClient itself builds a real TelegramClient and cannot run
    // offline, but these two decisions are worth pinning down on their own.
    applyParseMode,
    openSession,
};
