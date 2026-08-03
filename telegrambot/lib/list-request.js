// Created by Karl-Heinz Wind
'use strict';

// Turns the list node's configuration into a call on the teleproto client.
//
// Three reads share everything except which iterator they call: messages, dialogs and participants. So
// this is a table rather than three code paths, and the node stays one node.
//
// `needsPeer` is the only real difference in shape — `iterDialogs` takes options alone, the other two
// take an entity first. `search` is listed per kind because only two of them accept it, and silently
// dropping a configured filter is worse than not offering it.
const LIST_KINDS = {
    messages: { method: 'iterMessages', needsPeer: true, supportsSearch: true },
    dialogs: { method: 'iterDialogs', needsPeer: false, supportsSearch: false },
    participants: { method: 'iterParticipants', needsPeer: true, supportsSearch: true },
};

// What a blank limit means. teleproto has no default of its own: `iterMessages` passes
// `limit: undefined` into RequestIter, which turns it into Number.MAX_SAFE_INTEGER, and
// `iterParticipants` writes MAX_SAFE_INTEGER outright. So the library's default is "iterate the entire
// channel", and for a userbot that is a realistic way to earn a FLOOD_WAIT or a ban — the README warns
// about exactly this. A blank field therefore means 100, and unbounded has to be asked for.
const DEFAULT_LIMIT = 100;

// 0 is how the user asks for everything, matching the download node's "Max size", where 0 disables the
// check. `undefined` is what the library wants for unbounded, so that is what 0 becomes.
function resolveLimit(value) {
    let limit = DEFAULT_LIMIT;

    if (value !== undefined && value !== null && value !== '') {
        const candidate = Number(value);
        if (Number.isInteger(candidate) && candidate >= 0) {
            limit = candidate === 0 ? undefined : candidate;
        }
    }

    return limit;
}

// The arguments to spread into `client[method]`. Building the array here rather than in the node is what
// keeps the two calling shapes in one place.
function buildListArgs(kind, peer, limit, search) {
    const definition = LIST_KINDS[kind];
    const options = { limit: limit };

    if (definition.supportsSearch && search !== undefined && search !== '') {
        options.search = search;
    }

    // Note the object is passed even when empty: `iterDialogs` destructures its parameter, so calling it
    // with no argument throws before it reaches Telegram.
    return definition.needsPeer ? [peer, options] : [options];
}

// How many messages a streaming read will emit, for `msg.parts.count`.
//
// `total` comes from the iterator and is authoritative: Telegram answers with a sliced response carrying
// a `count` when there is more than it returned, and with a plain non-sliced response when the result is
// complete — and teleproto's fallback in that second case is the batch length, which is then the true
// total. A bounded read emits whichever is smaller.
function emitCount(limit, total) {
    let count = total;

    if (limit !== undefined && limit < total) {
        count = limit;
    }

    return count;
}

module.exports = {
    LIST_KINDS,
    DEFAULT_LIMIT,
    resolveLimit,
    buildListArgs,
    emitCount,
};
