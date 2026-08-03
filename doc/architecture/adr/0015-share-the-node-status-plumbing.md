# 0015 — Share the node status plumbing, because the duplication came due

## Context

[ADR 0010](0010-upload-node.md) closed with an explicit instruction:

> **The status plumbing is now duplicated four times** (receiver, sender, download, upload): the three
> status constants, `STATUS_BY_STATE`, the listener registration and the close-time deregistration. ADR
> 0009 said this would be worth extracting if a fifth node appeared. It has. The next change in this area
> should pull it into `lib/` or a shared node mixin rather than copying it a fifth time.

Issue #25 is that next change. But the extraction is not being done for tidiness — the liability had
already come due, and nobody noticed.

**[ADR 0013](0013-migrate-to-teleproto.md) corrected the `broken` status text in two of the four nodes.**
teleproto emits `broken` from a second place, so `session invalid: login again` was no longer accurate;
it became `broken: login again or redeploy` in the receiver and the sender, and was left stale in the
download and upload nodes. Four nodes, two texts for the same state, shipped in 1.0.0.

The full suite stayed green through all of it, because `test/nodes.test.js` only ever drove the receiver
and the sender. The statuses are a public contract — a flow can route on them through a Status node — so
a flow watching a download node saw one text and a flow watching a receiver saw another.

## Decision

**`telegrambot/lib/node-status.js` owns the statuses and the subscription.** It exports the three
constants, `STATUS_BY_STATE`, `floodWaitStatus`, `busyStatus`, and the pair
`attachConnectionStatus(node, apply)` / `detachConnectionStatus(node)`.

`lib/` rather than a helper under `nodes/`, because the rule in `AGENTS.md` is that `lib/` must not
reference `RED` — and this does not. It only ever touches the object it is handed: `node.status`,
`node.config.addStatusListener`. `nodes/` is one file per registered node, and this is not one.

**`apply` is a parameter rather than a hardcoded `node.status`.** The sender cannot use `node.status`
directly: it has to remember the connection state so a flood wait can revert to it once it elapses, which
is what `setConnectionStatus` is for. A helper that assumed `node.status` would have forced the sender to
keep its own copy — which is how this started.

**What was deliberately not extracted:** the `start()` / `stop()` pair and the initial status. They look
similar across the four nodes but differ in what they do with the client, and folding them together would
couple four lifecycles to one shape for the sake of six lines.

`INVALID_FILTER` stays in the receiver. Only that node has filters.

## Consequences

- One definition of each status text. The stale `broken` text in the download and upload nodes is fixed
  as a side effect of there being nowhere left to put a second one.
- `test/node-status.test.js` is new and drives **every** node that shows a status, for every state,
  asserting the values rather than only comparing against the shared constants — comparing a node
  against the constant it imports would agree with itself no matter what the text said.
- It also covers **deregistration on close**, which nothing did. Removing `detachConnectionStatus` from a
  node passed the entire suite before this. The cost of that omission is a config node holding a
  reference to a closed node and writing statuses into it after a redeploy — the same class of leak as
  issue #16.
- Verified by reversing five things. Four bit immediately. The fifth — dropping the deregistration — did
  not, which is what prompted the test above.
- A sixth node can now show a connection status in three lines, which is what #25 needs.
