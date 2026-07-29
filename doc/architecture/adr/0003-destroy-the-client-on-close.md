# 0003 — Destroy the client on close, and never create one while stopping

## Context

Nothing ever tore the `TelegramClient` down. The config node's close handler removed its
`flows:started` listener and called `done()`; `this.client` was left untouched.

GramJS keeps a background update loop alive for the lifetime of a client. It pings on a wake-up
timeout, reconnects through `client._sender.reconnect()` on failure, and issues an
`Api.updates.GetState()` every 30 minutes to keep updates flowing. So every Node-RED redeploy left
another fully live MTProto session behind: connected, reconnecting on its own, and still subscribed to
events. Telegram counts concurrent authorizations per account, and a userbot that accumulates them is
exactly the pattern that gets accounts limited. It also explains duplicated messages after a redeploy,
reported in issue #8 — the old and new receiver instances were both subscribed.

A second defect sat in the receiver. `stop()` obtained its client through
`node.config.getTelegramClient(node)`, which **creates and caches** a client when none exists. Closing
a receiver that had never connected therefore attempted a fresh login _during shutdown_, then removed
handlers from a client they were never added to.

## Decision

**Use `destroy()`, not `disconnect()`.** This is the load-bearing detail. Both exist on the GramJS
client, and `disconnect()` looks like the obvious choice, but the update loop is written as:

```js
while (!client._destroyed) { ... }
```

and only `destroy()` sets `_destroyed`. After a plain `disconnect()` the loop keeps running, hits its
reconnect path, and brings the session back up — the leak would survive the fix. `destroy()` also
clears `_eventBuilders` (the registered event handlers) and drops the borrowed senders, both of which
a close should release.

Concretely:

- `config-node.js` gains `closeTelegramClient()`, which clears the cache **first** — so a concurrent
  `getTelegramClient` builds a fresh client instead of receiving the one being torn down — and then
  awaits `client.destroy()`.
- The close handler awaits it inside `try`/`catch`/`finally`, with `done()` in the `finally`. A
  Telegram outage or a hung teardown must not block a redeploy; the error is reported through
  `node.warn` and the close still completes.
- `receiver-node.js` `stop()` reads the cached `node.config.client` instead of calling
  `getTelegramClient()`. No client means there is simply nothing to unsubscribe.
- The receiver's close handler now **awaits** `stop()`, so the unsubscribe actually finishes before
  Node-RED considers the node closed. Previously `done()` was called while `stop()` was still running.

Node-RED closes nodes in an unspecified order, so both orderings are supported: if the config node
goes first the client is already gone and `stop()` finds nothing; if the receiver goes first it
unsubscribes from a live client which is then destroyed.

## Consequences

- Redeploys no longer leak sessions, and the duplicate-message symptom after redeploy should go with
  them. This is the fix for the _cause_; issue #4 had already addressed the handler removal, which was
  correct but not sufficient while the client itself stayed alive.
- `destroy()` is more aggressive than the previous no-op: a redeploy now genuinely disconnects, so the
  first message after a deploy pays the reconnect cost. That is the intended trade.
- An existing test stubbed only `getTelegramClient` and not `config.client`, which no longer reflects
  how the config node behaves — `getTelegramClient` caches into `config.client`, and `stop()` reads
  that cache. The stub now sets both, which is closer to reality and was the reason two tests failed
  when the change landed.
- Verified by reversing each half: swapping `destroy()` back to `disconnect()` fails two tests, and
  restoring the bare `done()` close handler fails one.
