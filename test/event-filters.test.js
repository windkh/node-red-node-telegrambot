// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { buildEventFilters } = require('../telegrambot/lib/event-filters');

describe('buildEventFilters', () => {
    it('produces empty option objects when nothing is configured', () => {
        const filters = buildEventFilters({});

        // This is the backwards-compatible case: an existing receiver has none of these properties
        // stored and must keep behaving exactly as it did with `new NewMessage({})`.
        assert.deepStrictEqual(filters.common, {});
        assert.deepStrictEqual(filters.message, {});
        assert.deepStrictEqual(filters.callbackQuery, {});
    });

    it('splits a comma separated chat list and trims the entries', () => {
        const filters = buildEventFilters({ chats: ' alice , bob ,carol ' });

        assert.deepStrictEqual(filters.common.chats, ['alice', 'bob', 'carol']);
    });

    it('drops empty entries from a list', () => {
        const filters = buildEventFilters({ chats: 'alice,,bob,' });

        assert.deepStrictEqual(filters.common.chats, ['alice', 'bob']);
    });

    it('omits chats entirely for an empty or blank value', () => {
        // Not `chats: []`: an empty array could read as "no chats" rather than "every chat", and the
        // library default is the behaviour we want.
        assert.ok(!('chats' in buildEventFilters({ chats: '' }).common));
        assert.ok(!('chats' in buildEventFilters({ chats: '   ' }).common));
        assert.ok(!('chats' in buildEventFilters({}).common));
    });

    it('only sets blacklistChats alongside a chat list', () => {
        const withList = buildEventFilters({ chats: 'alice', blacklistchats: true });
        assert.strictEqual(withList.common.blacklistChats, true);

        const withoutList = buildEventFilters({ blacklistchats: true });
        assert.ok(!('blacklistChats' in withoutList.common), 'inverting an absent list means nothing');
    });

    it('maps the direction choice to the mutually exclusive teleproto flags', () => {
        const incoming = buildEventFilters({ direction: 'incoming' }).message;
        assert.strictEqual(incoming.incoming, true);
        assert.ok(!('outgoing' in incoming), 'incoming and outgoing must never both be set');

        const outgoing = buildEventFilters({ direction: 'outgoing' }).message;
        assert.strictEqual(outgoing.outgoing, true);
        assert.ok(!('incoming' in outgoing));

        const any = buildEventFilters({ direction: 'any' }).message;
        assert.ok(!('incoming' in any));
        assert.ok(!('outgoing' in any));
    });

    it('splits the sender list into fromUsers', () => {
        const filters = buildEventFilters({ fromusers: 'alice, bob' });

        assert.deepStrictEqual(filters.message.fromUsers, ['alice', 'bob']);
        assert.ok(!('fromUsers' in filters.common), 'the base builders do not accept fromUsers');
    });

    it('compiles the pattern into a RegExp', () => {
        const filters = buildEventFilters({ pattern: '^ping$' });

        assert.ok(filters.message.pattern instanceof RegExp);
        assert.ok(filters.message.pattern.test('ping'));
        assert.ok(!filters.message.pattern.test('pong'));
    });

    it('throws on an invalid pattern so it fails at deploy, not per message', () => {
        assert.throws(() => buildEventFilters({ pattern: '([' }));
    });

    it('gives each builder group only the options it accepts', () => {
        const filters = buildEventFilters({
            chats: 'alice',
            blacklistchats: true,
            direction: 'incoming',
            fromusers: 'bob',
            pattern: 'hi',
        });

        // Verified against node_modules/telegram/events/*.d.ts — see the header of
        // telegrambot/lib/event-filters.js.
        assert.deepStrictEqual(Object.keys(filters.common).sort(), ['blacklistChats', 'chats']);
        assert.deepStrictEqual(Object.keys(filters.message).sort(), [
            'blacklistChats',
            'chats',
            'fromUsers',
            'incoming',
            'pattern',
        ]);
        assert.deepStrictEqual(Object.keys(filters.callbackQuery).sort(), ['blacklistChats', 'chats', 'pattern']);
    });

    it('does not let the groups share mutable state', () => {
        // Each group is handed to a different teleproto builder, so a mutation in one must not leak.
        const filters = buildEventFilters({ chats: 'alice', fromusers: 'bob' });

        filters.message.chats.push('intruder');
        filters.message.fromUsers.push('intruder');

        assert.deepStrictEqual(filters.common.chats, ['alice']);
        assert.deepStrictEqual(filters.callbackQuery.chats, ['alice']);
    });
});
