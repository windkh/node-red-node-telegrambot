// Created by Karl-Heinz Wind
'use strict';

// Keeps the TelegramClient out of the messages a flow sees.
//
// teleproto hangs the client on every event it builds — `event._client = client` in
// `client/updates.js` — and a Message, Dialog or Forward keeps the same reference. The client owns
// `session._authKey`, which *is* the session: it authenticates the whole account, not one node, and
// `apiId` and `apiHash` sit next to it. So a msg carrying an event carries the credentials.
//
// Not theoretical. `Api.*` classes have a generated `toJSON` that emits only the TL fields, so the
// debug sidebar stays quiet for a NewMessage — but `UpdateConnectionState` is a bare `class { state }`
// with no `toJSON`, and it reaches a flow through the same raw-event path. Node-RED's own encoder then
// prints the client whole, measured against the shipped `@node-red/util`:
//
//     {"payload":{"state":1,"_client":{"apiId":1,"apiHash":"…","session":{"_authKey":{"_key":…
//
// Anyone pasting that into an issue publishes their account. And `util.inspect`, a debugger's "copy
// value" and any Function node that walks a msg see it for every event type, `toJSON` or not.
//
// Deleting the reference is not an option: `message.reply()`, `download()`, `getSender()` and the
// `client` getter all read `_client`. It is made non-enumerable instead. Reads keep working, while
// everything that *enumerates* stops seeing it — JSON.stringify, util.inspect, Node-RED's encoder,
// and `RED.util.cloneMessage`, which would otherwise deep-copy the whole client into every clone.
const CLIENT = '_client';

// Worth walking into. The typed-array test is not cosmetic: `Object.keys` on a Buffer yields one key
// per byte, so a downloaded file would be walked byte by byte.
function isWalkable(value) {
    return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value);
}

// Hides every client reference reachable from `value`, and returns `value`.
//
// Iterative rather than recursive, because the graph has cycles — the client points back at the
// events. `_client` is a leaf: it is hidden and never descended into, which is also what keeps the
// walk cheap, the client being by far the largest thing in reach.
//
// `writable` and `configurable` stay true so that teleproto assigning `_client` again — which is a
// plain assignment to an existing property — does not put it back on show.
function hideClientReferences(value) {
    const pending = [value];
    const walked = new Set();

    while (pending.length > 0) {
        const current = pending.pop();

        if (isWalkable(current) && !walked.has(current)) {
            walked.add(current);

            for (const key of Object.keys(current)) {
                if (key === CLIENT) {
                    Object.defineProperty(current, CLIENT, {
                        value: current[CLIENT],
                        enumerable: false,
                        writable: true,
                        configurable: true,
                    });
                } else {
                    pending.push(current[key]);
                }
            }
        }
    }

    return value;
}

module.exports = {
    hideClientReferences,
};
