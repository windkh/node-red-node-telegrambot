# 0016 — A node for the async-iterator reads, streaming by default

## Context

Reading existing data — message history, the dialog list, a chat's members — was unusable. The sender
node is a generic bridge: it does `msg.payload = result; nodeSend(msg)`. For `client.iterMessages(...)`
the result is an **async iterator**, so the flow received an iterator object and could do nothing with
it.

The non-iterating variants are not much better. `getMessages` is `iterMessages(...).collect()` under the
hood, so it holds the whole result in memory and hands back the library's own collection.

How a stream of items becomes Node-RED messages is not a question the generic bridge can answer. That is
what this node is for.

## Two decisions were taken with the user, because they are contract

The issue said to settle both before writing anything, and `msg.payload` shapes are public API per
`AGENTS.md` — getting either wrong makes the correction a breaking change.

### Output: configurable, streaming by default

**one message per item** with `msg.parts` set (`id`, `index`, `count`, `type: 'array'`), so a standard
`join` in automatic mode reassembles the array. **one message with an array** is available as `mode:
'array'`, with `msg.total` alongside.

Streaming is the default because a large history must not have to fit in memory. The array mode exists
because "give me the members of this group" is a genuinely different job, and forcing a `join` onto every
small read would be friction for no gain.

**`parts.count` is trustworthy, which is what made streaming viable.** A join in automatic mode needs the
count up front, and the count comes from the iterator's `total` — which raised the obvious worry, since
teleproto sets it from `result.count` when present and falls back to `result.messages.length` otherwise.
The fallback is not a guess: Telegram answers with `messages.messagesSlice` (which carries `count`) when
there is more than it returned, and with a plain `messages.messages` when the result is complete — so
where the fallback is used, the batch length _is_ the total. The same holds for dialogs and participants.

Two details follow from the mechanics. `total` is set in `_loadNextChunk`, i.e. while the first `next()`
resolves, so it is readable from the first item onward — which is exactly when the first `parts.count`
has to be written. And the count is `min(limit, total)`, not `total`: a bounded read over a channel of
4000 messages emits the limit, and a count of 4000 would leave the join waiting forever.

### Limit: blank means 100, `0` means unbounded

teleproto has no default of its own. `iterMessages` passes `limit: undefined` into `RequestIter`, which
turns it into `Number.MAX_SAFE_INTEGER`; `iterParticipants` writes `MAX_SAFE_INTEGER` outright. **The
library's default is "read the entire channel."**

For a userbot that is not a neutral default. Iterating a busy channel back to its first message takes a
long time and can earn a `FLOOD_WAIT`, and the README already warns that hammering the API gets accounts
banned. So a blank field means 100, and unbounded has to be asked for with `0` — the same convention as
`Max size` on the download node, where `0` disables the check.

An unusable value (`'soon'`, `-5`, `1.5`) falls back to 100 rather than to unbounded. If something gets
past the editor's validation, a bounded read is the safe reading.

## Other decisions

**One node, not three.** Messages, dialogs and participants differ only in which iterator is called and
whether an entity comes first; the streaming, the parts, the limit, the status and the cancellation are
identical. Three nodes would be three copies of one machine. `lib/list-request.js` holds that difference
as a table.

**The node type is `telegram client list`.** Reading was the last obvious gap; `list` covers all three
without implying only history.

**Every emitted message is a clone.** Reusing one object would hand the join node the same reference with
the last index on it, and the join would never complete. A test asserts the messages are distinct.

**The dialogs options object is passed even when empty.** `iterDialogs` destructures its parameter, so
calling it with no argument throws before it reaches Telegram.

**`search` is offered only where Telegram accepts one.** Messages and participants take it; dialogs do
not. The editor hides the field for dialogs and `buildListArgs` leaves it out — silently dropping a
filter the user configured would be worse than not offering it.

**Cancellation is a flag checked before emitting, not after.** A history read can run for minutes. Set in
the close handler, so a redeploy stops the loop at the next item and a closed node is never written to.
The iterator exposes no `return()`, so there is nothing to release — stopping is simply not pulling
again.

**Progress every 25 items.** A status write per message would cost one per item for no added
information; this is often enough that a long read never looks like a hang.

## Consequences

- A sixth node type. `test/registration.test.js` asserts the exact list and was updated.
- It is the first node to use the shared status plumbing from
  [ADR 0015](0015-share-the-node-status-plumbing.md), which is what that extraction was for — the
  connection status here is three lines rather than a fifth copy.
- `msg.total` is new, and only in array mode. In streaming mode the same information is in
  `parts.count`.
- What is **not** exposed: `offsetId`, `offsetDate`, `addOffset`, `minId`/`maxId`, `filter`, `fromUser`,
  `reverse`, and the participant filters. They are real options with real uses, but each needs a field
  and an explanation, and none is needed to make the node useful. Adding one later is additive.
- Verified by reversing nine things — the blank-limit default, the `0` convention, the count cap, the
  clone, the closing check, the dialogs options object, the `msg` overrides, the unknown-type guard, and
  the registration itself. All nine fail a test.
