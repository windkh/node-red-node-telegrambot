// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

// createTelegramClient builds a real TelegramClient, which cannot run offline, so the parse-mode
// decision is exercised through the same allow-list the client path uses. Keep this list in step with
// PARSE_MODES in telegrambot/lib/telegram-client.js and with what the library actually accepts.
//
// GramJS exported that check as `sanitizeParseMode` from `telegram/Utils`. teleproto has it only as
// `TelegramClient.prototype._sanitizeParseMode`, so that is what is exercised here. It is a private
// method, and reaching for one in a test is normally wrong — but the alternative is asserting our
// allow-list against a copy of the library's, which would agree with itself forever while the real
// check drifted. It touches no instance state, so calling it unbound is safe; if teleproto ever
// changes that, this test fails, which is the point.
const { TelegramClient } = require('teleproto');
const sanitizeParseMode = (mode) => TelegramClient.prototype._sanitizeParseMode(mode);
const { applyParseMode, createTelegramClient } = require('../telegrambot/lib/telegram-client');

const OFFERED_BY_THE_EDITOR = ['md', 'md2', 'html'];
const ALSO_ACCEPTED = ['markdown', 'markdownv2'];

function createClientRecorder() {
    const applied = [];

    return {
        applied,
        setParseMode(mode) {
            applied.push(mode);
        },
    };
}

describe('applyParseMode', () => {
    it('does nothing and says nothing when no mode is configured', () => {
        for (const unset of [undefined, null, '']) {
            const client = createClientRecorder();
            const warnings = [];
            applyParseMode(client, unset, (message) => warnings.push(message));

            // The important guard: an unconfigured node must not touch the client's parse mode, or
            // every existing flow would start having its text interpreted as markup.
            assert.deepStrictEqual(client.applied, [], `'${unset}' must count as unset`);
            // And it must stay quiet — the allow-list alone would keep `applied` empty while warning
            // about an "unknown" mode on every single deploy that has none configured.
            assert.deepStrictEqual(warnings, [], `'${unset}' must not warn`);
        }
    });

    it('applies each mode the editor offers', () => {
        for (const mode of OFFERED_BY_THE_EDITOR) {
            const client = createClientRecorder();
            applyParseMode(client, mode, () => {});

            assert.deepStrictEqual(client.applied, [mode]);
        }
    });

    it('warns and leaves the mode alone when the value is unknown', () => {
        const client = createClientRecorder();
        const warnings = [];
        applyParseMode(client, 'markdown-v2', (message) => warnings.push(message));

        // Not passed on: sanitizeParseMode would throw, and inside createTelegramClient that would
        // leave the node with no client at all — over a formatting preference.
        assert.deepStrictEqual(client.applied, []);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /markdown-v2/);
    });
});

describe('parse mode values', () => {
    it('accepts every mode the editor offers', () => {
        for (const mode of OFFERED_BY_THE_EDITOR) {
            assert.doesNotThrow(() => sanitizeParseMode(mode), `teleproto rejected '${mode}'`);
        }
    });

    it('accepts the long aliases too, so a hand-edited flow still works', () => {
        for (const mode of ALSO_ACCEPTED) {
            assert.doesNotThrow(() => sanitizeParseMode(mode), `teleproto rejected '${mode}'`);
        }
    });

    it('throws on anything else, which is why the value is checked before it is used', () => {
        // This is the reason lib/telegram-client.js has an allow-list: an unchecked value would throw
        // inside createTelegramClient and leave the node with no client at all, over a formatting
        // preference.
        assert.throws(() => sanitizeParseMode('markdown-v2'));
        assert.throws(() => sanitizeParseMode('MD'));
    });
});

// createTelegramClient builds a real TelegramClient and cannot connect offline — but it can be made to fail
// before it tries, which is the path that decides what a node's status says. A session string that is not
// one throws inside StringSession's constructor, well before any network call.
describe('a connect that fails', () => {
    async function run(options) {
        const warnings = [];
        const failures = [];

        const client = await createTelegramClient(
            options,
            (message) => warnings.push(message),
            (reason) => failures.push(reason)
        );

        return { client: client, warnings: warnings, failures: failures };
    }

    it('reports no session separately from a broken one', async () => {
        const { client, failures } = await run({ apiId: '12345', apiHash: 'hash', session: '' });

        assert.strictEqual(client, undefined);
        // The two are different problems and a status that conflated them would send the user the wrong way.
        assert.deepStrictEqual(failures, ['no session: login first']);
    });

    it('reports a short reason for a session it cannot even parse', async () => {
        const { client, warnings, failures } = await run({
            apiId: '12345',
            apiHash: 'hash',
            session: 'not-a-session-string',
        });

        assert.strictEqual(client, undefined);
        assert.strictEqual(failures.length, 1, 'the node needs exactly one reason to show');
        assert.ok(failures[0].length > 0);
        // Logged in full as well: the status has a width limit, the log does not, and a Catch node may want
        // the whole error.
        assert.strictEqual(warnings.length, 1);
    });

    it('logs an unexpected error whole, stack and all', async () => {
        // A session string that is not one throws a plain Error from StringSession's constructor — not a
        // Telegram answer, so the stack is worth keeping and `warn` must receive the Error itself.
        const { warnings } = await run({ apiId: '12345', apiHash: 'hash', session: 'not-a-session-string' });

        assert.strictEqual(warnings.length, 1);
        assert.ok(warnings[0] instanceof Error, 'an unexpected failure must reach the log with its stack');
    });

    it('says nothing on the failure channel about a merely odd parse mode', async () => {
        // `warn` is for notes that do not stop the connect; `fail` is only for there being no client.
        const { failures, warnings } = await run({
            apiId: '12345',
            apiHash: 'hash',
            session: 'not-a-session-string',
            parseMode: 'markdown-v2',
        });

        assert.strictEqual(failures.length, 1, 'the parse mode must not add a second reason');
        assert.ok(warnings.length >= 1);
    });
});
