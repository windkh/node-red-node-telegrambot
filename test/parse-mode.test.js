// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

// createTelegramClient builds a real TelegramClient, which cannot run offline, so the parse-mode
// decision is exercised through the same allow-list the client path uses. Keep this list in step with
// PARSE_MODES in telegrambot/lib/telegram-client.js and with sanitizeParseMode in
// node_modules/telegram/Utils.js, which is what actually accepts or throws.
const { sanitizeParseMode } = require('telegram/Utils');
const { applyParseMode } = require('../telegrambot/lib/telegram-client');

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
            assert.doesNotThrow(() => sanitizeParseMode(mode), `GramJS rejected '${mode}'`);
        }
    });

    it('accepts the long aliases too, so a hand-edited flow still works', () => {
        for (const mode of ALSO_ACCEPTED) {
            assert.doesNotThrow(() => sanitizeParseMode(mode), `GramJS rejected '${mode}'`);
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
