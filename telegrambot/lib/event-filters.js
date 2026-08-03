// Created by Karl-Heinz Wind
'use strict';

// Turns the receiver node's filter configuration into the option objects teleproto event builders take.
//
// The builders do not all accept the same options, so this produces one object per group. Verified
// against telegram@2 (`node_modules/telegram/events/*.d.ts`):
//
//   EventBuilder (all builders)     chats, blacklistChats
//   NewMessage, EditedMessage       + incoming, outgoing, fromUsers, forwards, pattern
//   CallbackQuery                   + pattern
//   DeletedMessage, Album           base only
//   Raw                             neither — only `types` and `func`, so raw events cannot be
//                                   filtered by chat at all
//
// Unset options are left out entirely rather than passed as empty values, the same rule
// ./client-params.js follows: an empty `chats: []` could plausibly read as "no chats" rather than
// "every chat", and the library's own default is the behaviour we want.

// 'alice, bob' -> ['alice', 'bob']; empty or blank -> undefined, so the key gets omitted.
function parseEntityList(value) {
    let entities;

    if (typeof value === 'string' && value.trim() !== '') {
        entities = value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '');
    }

    return entities;
}

// Throws on an invalid expression. The caller is code (the node constructor), which is where the
// standard says a precondition failure belongs, and it surfaces once at deploy rather than per message.
function compilePattern(value) {
    let pattern;

    if (typeof value === 'string' && value !== '') {
        pattern = new RegExp(value);
    }

    return pattern;
}

// A fresh object each call, including its own copy of the chat list: the three groups are handed to
// three separate teleproto builders and must not share mutable state.
function buildCommonFilters(chats, blacklistChats) {
    const filters = {};

    if (chats !== undefined) {
        filters.chats = [...chats];

        // Only meaningful alongside a chat list — on its own it would invert nothing.
        if (blacklistChats) {
            filters.blacklistChats = true;
        }
    }

    return filters;
}

function buildEventFilters(config) {
    const chats = parseEntityList(config.chats);
    const fromUsers = parseEntityList(config.fromusers);
    const pattern = compilePattern(config.pattern);

    // `incoming` and `outgoing` are mutually exclusive in teleproto, so the configuration is a single
    // choice rather than two flags: that makes the invalid combination unrepresentable.
    const message = buildCommonFilters(chats, config.blacklistchats);
    if (config.direction === 'incoming') {
        message.incoming = true;
    } else if (config.direction === 'outgoing') {
        message.outgoing = true;
    }
    if (fromUsers !== undefined) {
        message.fromUsers = [...fromUsers];
    }
    if (pattern !== undefined) {
        message.pattern = pattern;
    }

    const callbackQuery = buildCommonFilters(chats, config.blacklistchats);
    if (pattern !== undefined) {
        callbackQuery.pattern = pattern;
    }

    return {
        common: buildCommonFilters(chats, config.blacklistchats),
        message: message,
        callbackQuery: callbackQuery,
    };
}

module.exports = {
    buildEventFilters,
};
