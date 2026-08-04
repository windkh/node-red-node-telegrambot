# 0027 — Raw events get the same payload shape as every other event

## Context

Five of the receiver's six event types name themselves in `msg.payload.type` and put the event in
`msg.payload.event`. Raw events did neither: the update went straight into `msg.payload`, and the name went
into `msg.type` at the top level.

```js
// NewMessage, DeletedMessage, EditedMessage, Album, CallbackQuery
{ payload: { type: 'NewMessage', message: …, sender: …, chat: …, event: … } }

// Raw
{ type: 'Raw', payload: <the update itself> }
```

It came from `44a5ef6 fixed #3` — the original shape, not something a refactor introduced — and `AGENTS.md`
recorded it as "inconsistent but intentional — do not 'fix' it silently". Which is the right instruction for
an accident that has become a contract, and the wrong end state.

The cost is paid by every flow that handles more than one event type. A Function node switching on
`msg.payload.type` has to carry a special case for raw updates, and one that forgets is not obviously wrong
until a raw update arrives. `EchoMessage.json` shipped with exactly that mistake: it reached into
`msg.payload.message` and threw `Cannot read properties of undefined (reading 'className')` on every raw
update.

There is no additive route. `payload` cannot be both the update and a wrapper around it, and putting
`type` and a self-referencing `event` onto the update object would mean mutating a teleproto object and
placing a cycle in the msg — worse than the asymmetry it fixed.

## Decision

**Raw events use the same shape as the rest.** Breaking, so it goes in a major version.

```js
{
    type: 'Raw',                                  // kept
    payload: { type: 'Raw', event: <the update> },
}
```

`msg.type` **stays**. It costs one line, it is the check most flows use, and keeping it narrows the break to
one thing: reading a field of the update. `msg.payload.className` becomes `msg.payload.event.className`.

The update itself is passed through by reference, not copied or converted — same as before, and the same as
`event` on the other five.

## Consequences

- A flow can switch on `msg.payload.type` for all six event types with no exception, which is the whole
  point. `msg.payload.event` is likewise the event for all six.
- **Breaking for flows that read the raw update out of `msg.payload` directly.** `MIGRATION.md` has the
  change; it is one path segment. Flows that only test `msg.type === 'Raw'` are unaffected.
- Raw events are off by default and support no filters, so the affected population is the smallest of the six.
- The note in `AGENTS.md` telling the next reader not to fix this is gone, replaced by the contract itself.
- `test/nodes.test.js` now asserts `payload.type` for **all six** handlers rather than five, so a new event
  type cannot be added with a sixth shape.
