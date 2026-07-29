# 0005 — Filter events in Telegram's builders, not downstream

## Context

The receiver constructed every GramJS event builder with an empty options object — `new NewMessage({})`
and so on, six times in `start()` and six more in `stop()`. It therefore subscribed to **every** message
in **every** chat, and any narrowing had to happen in a downstream Switch or Function node. On a busy
account that meant Node-RED woke up for traffic it would immediately discard, and paid for
`await message.getSender()` and `await message.getChat()` on each one first.

GramJS already supports filtering in the builders. Issue #3 added the extra event _types_; filtering
_within_ a type is a different axis and was still missing.

## Decision

Expose the filters as node configuration and pass them into the builders, so unwanted traffic never
reaches the flow.

**The builders do not all accept the same options**, which shapes the whole design. Verified against
`node_modules/telegram/events/*.d.ts`:

| Builder                       | Options                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `EventBuilder` (all)          | `chats`, `blacklistChats`                                    |
| `NewMessage`, `EditedMessage` | + `incoming`, `outgoing`, `fromUsers`, `forwards`, `pattern` |
| `CallbackQuery`               | + `pattern`                                                  |
| `DeletedMessage`, `Album`     | base only                                                    |
| `Raw`                         | neither — only `types` and `func`                            |

So `lib/event-filters.js` returns **three** option objects (`common`, `message`, `callbackQuery`) and
each builder gets the one it can accept. Passing an option a builder does not understand would be worse
than not offering it: it looks configured and does nothing.

Raw events stay unfiltered. `RawInterface` has no chat options at all, and raw updates arrive before
Telegram resolves entities, so there is nothing to match a chat against. The node help says so
explicitly, because "filters apply to everything except raw" is otherwise a nasty surprise.

**`incoming` and `outgoing` are mutually exclusive in GramJS**, so the configuration is a single
`direction` choice (`any` / `incoming` / `outgoing`) rather than two checkboxes. That makes the invalid
combination unrepresentable instead of validated.

**Unset filters are omitted, not passed empty**, the same rule `lib/client-params.js` follows. An empty
`chats: []` could plausibly read as "no chats" rather than "every chat", and the library default is the
behaviour that must be preserved. `blacklistChats` is only set alongside a chat list, since inverting an
absent list means nothing.

**Each group gets its own copy of the parsed arrays.** The three objects go to three separate builder
instances; sharing one array by reference would let a mutation in one leak into the others.

**An invalid pattern is reported, not thrown.** The editor rejects it with a `validate` function, but if
one reaches the runtime the constructor reports through `node.error` and leaves `filters` undefined, and
`start()` then subscribes to **nothing** and shows `invalid filter`. Forwarding everything because the
filter failed to compile would be the worst of the three options. Throwing from the constructor was
rejected because it would fail the whole flow deploy.

## Note on `removeEventHandler`

The builders passed to `removeEventHandler` carry the same filters as the ones used to subscribe, for
symmetry — but this turns out not to matter. GramJS implements removal as:

```js
client._eventBuilders = client._eventBuilders.filter(function (item) {
    return item[0] !== event && item[1] !== callback;
});
```

An entry is dropped when the builder **or** the callback matches, so passing the handler is already
sufficient and the builder argument is ignored in practice. (The `&&` looks like it was meant to be
`||`; either way, matching on our unique callback is what we rely on.) This is why the previous code got
away with constructing a fresh `new NewMessage({})` for removal.

## Consequences

- A receiver with no filter configuration behaves exactly as before. Existing flows have none of the new
  properties stored, and every field defaults to "no filtering"; a test asserts this explicitly.
- `forwards` and `func` are deliberately not exposed. `forwards` would need a third tri-state select for
  a narrow case, and `func` is an arbitrary predicate that cannot come from a config dialog.
- `invalid filter` is a new node status text. It is additive, so no existing flow observes a change.
- The parsing lives in `lib/`, so it is unit-tested without a Node-RED runtime and without a client;
  `lib/event-filters.js` is at 100% coverage.
- Verified by reversing each half: ignoring the filters in the builders fails two receiver tests, and
  handing the base builders the message-only options fails three filter tests.
