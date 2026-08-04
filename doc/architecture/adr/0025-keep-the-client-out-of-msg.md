# 0025 — Keep the client out of the messages a flow sees

## Context

Reported from a running flow, as an observation about the shape of a raw event: the payload looked like

```
{
  state: 1,
  _client: {
    apiId: 23871401,
    apiHash: "…",
    session: { _authKey: { _key: new Uint8Array([93, 100, 189, …]) } },
    …
  }
}
```

That auth key **is** the session. `AGENTS.md` has said since the beginning that the session authenticates the
user account rather than a bot, that it is to be treated like a password, and — in as many words — that it
must never be put in a `msg`. It was in every `msg`.

teleproto hangs the client on every event it builds:

```js
// teleproto/client/updates.js:113
event._client = client;
```

A `Message`, a `Dialog` and a `Forward` keep the same reference, so it is not only the receiver: the sender's
result, the upload node's sent message and every item the list node emits carry it too.

### How far it actually got

Three serialisers, measured rather than assumed — the third against the shipped `@node-red/util`:

| Reader                                                                        | Sees the client                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `JSON.stringify` of an `Api.*` object alone                                   | no — TL classes have a generated `toJSON` that emits only the TL fields |
| `util.inspect`, a debugger's _copy value_, any Function node that walks a msg | yes, always                                                             |
| **Node-RED's debug sidebar**                                                  | **yes**                                                                 |

The sidebar was the surprise, and the first guess about it was wrong. The `toJSON` on a `Message` does hide
the client behind `msg.payload.message` — but the receiver also puts the **event** in the msg, and
`NewMessageEvent` has no `toJSON` at all. Neither does `UpdateConnectionState`, which is a bare
`class { state }` and reaches a flow through the raw-event path. So Node-RED's encoder follows `_client` for
every event type:

```
{"payload":{"state":1,"_client":{"apiId":1,"apiHash":"…","session":{"_authKey":{"_key":…
```

Attach a debug node, open the sidebar, copy the output into a bug report, and you have published your
account. That is the actual severity: not a theoretical reachability, a one-click export.

## Decision

**Make `_client` non-enumerable on everything a node sends.** `lib/hide-client.js` walks the msg and
redefines each `_client` it finds:

```js
Object.defineProperty(current, CLIENT, {
    value: current[CLIENT],
    enumerable: false,
    writable: true,
    configurable: true,
});
```

Deleting the reference was not available: `message.reply()`, `download()`, `getSender()` and the public
`client` getter all read `_client`. Hiding it keeps every one of those working — a non-enumerable property is
still an ordinary property to code that names it — while everything that _enumerates_ stops seeing it:
`JSON.stringify`, `util.inspect`, Node-RED's encoder, and `RED.util.cloneMessage`, which would otherwise
deep-copy the entire client into every clone the list node makes per item.

`writable` and `configurable` stay `true` so that teleproto assigning `_client` again — a plain assignment to
an existing property, which keeps that property's descriptor — does not put it back on show.

Three details of the walk are load-bearing:

- **`_client` is a leaf.** It is hidden and never descended into. That is also what keeps the walk cheap: the
  client is by far the largest thing in reach.
- **Iterative, not recursive.** The graph has cycles — the client points back at the events.
- **Typed arrays are skipped.** Not cosmetic: `Object.keys` on a 4 MB Buffer yields four million keys.
  Measured at 1.24 s for one buffer, against 0.06 ms with the check. A downloaded file passing through would
  stall the flow.

Applied at nine send sites: the receiver's six handlers, the sender's result, the upload node's sent message,
and both of the list node's modes. Not in the download node, which introduces no teleproto object of its own —
what it moves to `msg.telegram` arrived from one of the nine.

## Consequences

- The session, api id and api hash no longer leave the runtime through a `msg`, by any of the three readers
  above. The events themselves are unchanged: `"state":1` and `"message":"hi"` still arrive.
- Existing flows are unaffected. `msg.payload.event`, `msg.payload.message` and the rest are the same objects
  with the same methods; only a serialiser can tell the difference, which is the point.
- Fifteen reversals, each failing a test: the nine send sites one at a time, and six mutations of the walk
  itself. The cycle guard is the one that fails as a hang rather than an assertion — an infinite loop has no
  other symptom.
- The counter-tests state the bug rather than assuming it: two tests assert that the **unfixed** object leaks
  through Node-RED's real encoder. If teleproto ever gives its event wrappers a `toJSON`, those fail and say
  so, instead of the fixed-side checks quietly proving nothing.
- The lesson: the rule in `AGENTS.md` was right and was being followed for everything we _wrote_ into a msg.
  What it did not cover was a reference the library added to an object we passed along. "Never put the session
  in a msg" has to mean "never put anything that can reach it", and there is no way to see the difference
  without following the graph.
