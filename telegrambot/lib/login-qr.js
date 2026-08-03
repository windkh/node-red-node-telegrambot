// Created by Karl-Heinz Wind
'use strict';

const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const qrcode = require('qrcode-generator');

const { buildClientParams } = require('./client-params');
const { describeAuthError } = require('./auth-error');

// The alternative to the phone-code login: show a QR code, scan it in a Telegram app that is already
// signed in, and a session comes out. Same result as ./login, different way of proving who you are.
//
// teleproto drives the whole exchange. `signInUserWithQrCode` loops `auth.ExportLoginToken`, calls the
// `qrCode` callback with each token (a fresh one roughly every 30 seconds), listens for the
// `UpdateLoginToken` that says it was scanned, follows `LoginTokenMigrateTo` to another data centre, and
// falls through to `signInWithPassword` on `SESSION_PASSWORD_NEEDED` — so two-step verification uses the
// same password prompt as the phone-code flow. See doc/architecture/adr/0020-qr-code-login.md.

// The deep link a Telegram app expects. The format is not ours to choose: it is in the TL documentation
// for `auth.exportLoginToken` and in teleproto's own JSDoc.
function loginUrl(token) {
    return 'tg://login?token=' + token.toString('base64url');
}

// Rendered here rather than in the editor. A QR encoder is a few hundred lines of Reed-Solomon and bit
// placement, and whether a phone camera reads the result is not something a test can tell us — so this
// uses a library rather than a hand-rolled encoder, and does it server-side so the editor needs no
// browser dependency at all and no route to serve one.
//
// Error correction L, because the payload is short and a denser code is easier for a webcam-quality
// camera to read at a small size. `scalable` so the SVG fills whatever box the dialog gives it.
function qrCodeSvg(url) {
    const qr = qrcode(0, 'L');
    qr.addData(url);
    qr.make();

    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

// Everything the editor needs to show one token: the picture, the link behind it for anyone who would
// rather click than scan, and when it stops being valid.
function describeToken(token, expires) {
    const url = loginUrl(token);

    return { url: url, svg: qrCodeSvg(url), expires: expires };
}

// Runs the QR login.
//
// `qrCreated` is called for every token, not just the first — Telegram expires them, so the editor has to
// be given the replacement. `getPassword` is the same pending promise the phone-code login uses, awaited
// lazily because an account without two-step verification never needs it.
//
// Failures go to `error`, never by rejecting: the caller is an HTTP route that has already answered.
async function loginWithQrCode(parameters, getPassword, qrCreated, sessionCreated, error, abortSignal) {
    try {
        const apiId = Number(parameters.apiId);
        const apiHash = parameters.apiHash;

        if (Number.isFinite(apiId) && apiId > 0 && apiHash !== undefined && apiHash !== '') {
            const stringSession = new StringSession('');

            const clientParams = buildClientParams({
                proxy: parameters.proxy,
                deviceModel: parameters.devicemodel,
                systemVersion: parameters.systemversion,
                appVersion: parameters.appversion,
            });

            const client = new TelegramClient(stringSession, apiId, apiHash, clientParams);
            client.setLogLevel('warn');

            await client.connect();

            await client.signInUserWithQrCode(
                { apiId: apiId, apiHash: apiHash },
                {
                    qrCode: async (code) => qrCreated(describeToken(code.token, code.expires)),
                    password: async () => await getPassword,
                    onError: (err) => {
                        error(describeAuthError(err));
                        return true; // abort
                    },
                    abortSignal: abortSignal,
                }
            );

            sessionCreated(client.session.save());
        } else {
            error('Parameters are missing: apiId, apiHash');
        }
    } catch (err) {
        error(describeAuthError(err));
    }
}

module.exports = {
    loginUrl,
    qrCodeSvg,
    describeToken,
    loginWithQrCode,
};
