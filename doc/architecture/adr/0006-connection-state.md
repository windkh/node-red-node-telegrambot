# 0006 — Let GramJS handle reconnection, and report the state it publishes

## Context

Two related defects made a node's status a poor guide to whether it was working.

**`connectionRetries` was pinned to 5.** `lib/client-params.js` hardcoded it, overriding the GramJS
default of `Infinity` (verified in `clientParamsDefault`, `client/telegramBaseClient.js`, alongside
`retryDelay: 1000`, `autoReconnect: true`, `requestRetries: 5`, `timeout: 10`). With a 1s retry delay,
roughly five seconds of network trouble left the client permanently dead — and because the config node
caches `this.client`, `getTelegramClient` kept handing back the same dead object until the next redeploy.

**The status was written once and never updated.** Receiver and sender set `connected` or `disconnected`
in `start()` and nothing touched it again, so a node showed `connected` indefinitely while the client was
gone.

GramJS already publishes what is needed. `_handleUpdate` turns the numeric states into an
`UpdateConnectionState` and dispatches it to the **raw** handlers, so today it is only visible if the
user enables "send raw events", mixed in with real updates and indistinguishable without inspecting the
class.

## Decision

**Do not add a second recovery mechanism.** `connectionRetries` is now left unset, along with
`retryDelay`, `timeout` and `autoReconnect`, so the library's own defaults apply. Investigating point 4
of the issue settled this: reconnection is GramJS's job and it does it in several places already —
`MTProtoSender.connect` retries `_retries` times with `sleep(_delay)`, and the update loop calls
`client._sender.reconnect()` when a ping fails. A parallel loop in this package clearing `this.client`
would race those.

**`broken` must not trigger a rebuild.** This is the finding that shaped the design.
`UpdateConnectionState.broken` is emitted from exactly one place — `_handleBadAuthKey` in
`network/MTProtoSender.js`, logged as "Broken authorization key for dc N, resetting...". It means the
**stored session is unusable**, not that the network hiccuped. Rebuilding a client from the same session
string would reproduce the failure immediately and forever. So `broken` is reported to the user as
`session invalid: login again`, with a filled dot rather than a ring to set it apart from a transient
`disconnected`, and nothing is retried.

Contrast:

| State          | Emitted for                                      | Response                     |
| -------------- | ------------------------------------------------ | ---------------------------- |
| `disconnected` | failed connect attempt, ping timeout, disconnect | show it; GramJS recovers     |
| `connected`    | connect or reconnect succeeded                   | show it                      |
| `broken`       | unusable authorization key (`_handleBadAuthKey`) | show it; recovery impossible |

**The config node observes the state, not the nodes.** It keeps a `Set` of listeners that receiver and
sender join on construction and leave on close, and registers one internal raw handler on the client. The
handler is added by `getTelegramClient` right after the client is built, so the state is observed whether
or not anyone enabled raw events. Verified that this is additive: `Raw({})` has no `types`, `chats` or
`func`, so `EventBuilder.filter` passes everything through, and GramJS calls every registered handler —
a user already keying off `UpdateConnectionState` in their raw output keeps receiving it.

The config node maps GramJS's numbers to names (`connected` / `disconnected` / `broken`) and the nodes map
names to their own status objects, so the encoding stays in one place and the status texts stay in the
node modules that own them.

## Consequences

- A dropped connection now shows up on the canvas, and recovery does too, without the user enabling raw
  events.
- The existing `connected` and `disconnected` texts are unchanged — they are public API. `broken` is a
  new text and so is `invalid filter` from ADR 0005; both are additive.
- The receiver's status objects moved into named constants, as the sender's already had. They were
  duplicated four times, and `broken` would have made five.
- A node that has been closed deregisters, so nothing writes to it afterwards. Covered by a test.
- `lib/client-params.js` and `nodes/config-node.js` are both at 100% coverage.
- Two `client-params` tests asserted the hardcoded `connectionRetries` — including one that checked the
  exact key set. They were updated deliberately, and the replacement asserts the key is _absent_, which
  is what the fix is about.
- Verified by reversing each half: restoring `connectionRetries: 5` fails two tests, and dropping the
  internal handler registration fails one.
