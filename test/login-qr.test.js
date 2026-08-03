// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { loginUrl, qrCodeSvg, describeToken, loginWithQrCode } = require('../telegrambot/lib/login-qr');

// Not a real login token — any bytes will do, and they must not be a real one.
const A_TOKEN = Buffer.from([0x01, 0x02, 0x03, 0xfb, 0xfc, 0xfd, 0xfe, 0xff]);

describe('loginUrl', () => {
    it('builds the deep link Telegram documents, with a base64url token', () => {
        // The format is not ours to choose: `tg://login?token=base64encodedtoken` comes from the TL
        // documentation for auth.exportLoginToken. base64url, not base64 — a `+` or `/` in a URL query
        // would be read as something else.
        assert.strictEqual(loginUrl(A_TOKEN), 'tg://login?token=AQID-_z9_v8');
    });

    it('uses no padding and no characters that need escaping in a query', () => {
        // Only the token is checked: the URL itself of course contains `=` and `//`.
        const token = loginUrl(Buffer.from([0xff, 0xef, 0xfe])).replace('tg://login?token=', '');

        assert.strictEqual(token, '_-_-');
        assert.ok(!token.includes('='), 'padding would look like another query parameter');
        assert.ok(!token.includes('+'), 'a plus is a space in a query string');
        assert.ok(!token.includes('/'), 'a slash would break the deep link');
    });

    it('round trips, so the bytes Telegram gets are the bytes it sent', () => {
        const encoded = loginUrl(A_TOKEN).replace('tg://login?token=', '');

        assert.ok(Buffer.from(encoded, 'base64url').equals(A_TOKEN));
    });
});

describe('qrCodeSvg', () => {
    it('renders an svg element, so the editor needs no QR library', () => {
        const svg = qrCodeSvg(loginUrl(A_TOKEN));

        assert.match(svg, /^<svg /);
        assert.match(svg, /<\/svg>$/);
    });

    it('scales to whatever box the dialog gives it', () => {
        const svg = qrCodeSvg(loginUrl(A_TOKEN));

        // A viewBox alone is not enough — the library emits one either way. What `scalable` changes is
        // dropping the fixed width and height, and those are what would pin the code to one size and
        // leave it either postage-stamp small or clipped in the dialog.
        assert.match(svg, /viewBox="0 0 \d+ \d+"/);
        assert.ok(!/width="\d+px"/.test(svg), 'a fixed width would not scale to the dialog');
        assert.ok(!/height="\d+px"/.test(svg), 'a fixed height would not scale to the dialog');
    });

    it('encodes the whole payload, however long the token', () => {
        // A QR code has a fixed capacity per version; a longer payload has to grow the code rather than
        // silently truncate. Both must render, and the longer one must be bigger.
        const short = qrCodeSvg(loginUrl(Buffer.alloc(8, 1)));
        const long = qrCodeSvg(loginUrl(Buffer.alloc(64, 1)));

        const size = (svg) => Number(svg.match(/viewBox="0 0 (\d+)/)[1]);

        assert.ok(size(long) > size(short), 'a longer token must produce a larger code');
    });
});

describe('describeToken', () => {
    it('carries the picture, the link and the expiry', () => {
        const described = describeToken(A_TOKEN, 1785700000);

        assert.strictEqual(described.url, 'tg://login?token=AQID-_z9_v8');
        assert.match(described.svg, /^<svg /);
        // Passed through so the editor can say how long the code is good for.
        assert.strictEqual(described.expires, 1785700000);
    });
});

// Anything past the parameter check needs a real Telegram account, exactly as for lib/login.js — so
// these cover the check itself and nothing beyond it.
describe('loginWithQrCode parameter validation', () => {
    async function run(parameters) {
        const errors = [];
        const tokens = [];
        const sessions = [];

        await loginWithQrCode(
            parameters,
            Promise.resolve('pw'),
            (token) => tokens.push(token),
            (session) => sessions.push(session),
            (message) => errors.push(message),
            undefined
        );

        return { errors: errors, tokens: tokens, sessions: sessions };
    }

    it('reports missing parameters instead of attempting a connection', async () => {
        const { errors, tokens, sessions } = await run({});

        assert.deepStrictEqual(errors, ['Parameters are missing: apiId, apiHash']);
        assert.deepStrictEqual(tokens, [], 'no token may be reported');
        assert.deepStrictEqual(sessions, [], 'no session may be reported');
    });

    it('reports an api id that is not a usable number', async () => {
        for (const apiId of ['', 'abc', '0', '-1']) {
            const { errors } = await run({ apiId: apiId, apiHash: 'hash' });

            assert.deepStrictEqual(errors, ['Parameters are missing: apiId, apiHash'], `apiId '${apiId}'`);
        }
    });

    it('reports a missing api hash', async () => {
        const { errors } = await run({ apiId: '12345' });

        assert.deepStrictEqual(errors, ['Parameters are missing: apiId, apiHash']);
    });
});
