# 0017 — Finish the upload node: albums, silent, replyTo, progress

## Context

[ADR 0010](0010-upload-node.md) added the upload node and settled the hard parts: the `CustomFile`
wrapping, the required filename, the size coming from the Buffer. What it did **not** record is that
issue #23 also asked for options which never shipped:

> expose the options that matter: `caption`, `forceDocument`, `silent`, `replyTo`, and a thumbnail
>
> support sending several files as an album, since `sendFile` accepts an array
>
> surface `progressCallback` as an optional node status update ("uploading 42%") rather than as output
> messages

Only `caption` and `forceDocument` were delivered. The issue was closed anyway, and the ADR gave no
reason for the omissions — so this is the rest of #23 rather than a new feature.

## What the library actually offers

Checked before designing, because the option list is long and the useful subset is not obvious.
`SendFileInterface` has 39 properties. The relevant mechanics:

- **`progressCallback`** is `(progress: number) => void` with an optional `isCanceled` property. The
  progress is a **fraction**, not a percentage — `progress += 1 / partCount` in `uploads.js` — and
  setting `isCanceled = true` makes the upload throw `USER_CANCELED` at its next chunk boundary.
- **`file` takes an array**, which teleproto routes to `_sendAlbum`. `caption` accepts an array too.
- **`silent`** and **`replyTo`** are plain pass-throughs.

## Decision

**Albums come from an array in `msg.payload`.** Every Buffer in it still needs its own name, so
`msg.filename` becomes an array aligned by index; a path in the array needs no entry.

The validation moved into `lib/upload.js` as `describeUpload`, replacing `toUploadFile` +
`needsFilename`. The node used to combine those two and word the error itself, which would mean
reimplementing the loop and the messages for albums. One function returning `{ file }` or `{ error }`
keeps the wording in one place — and the single-file messages are **byte-identical** to before, because
the node reports them verbatim and a flow may be matching on them.

**Errors name the position:** `msg.filename[2] is required when msg.payload[2] is a Buffer.` A wrong
item in an album of five is otherwise a guessing game. Same reasoning as the button positions in
[ADR 0012](0012-reply-markup.md).

**One bad item refuses the whole album.** An album is a unit; half of one arriving is worse than none.

**Progress is a node status, not output messages.** `uploading 42%`, from `Math.round(progress * 100)`.
A 40 MB upload otherwise looks like a hang, and emitting a message per chunk would flood the flow — which
is what the issue asked for.

**Closing the node cancels an upload in flight.** The callbacks for running uploads are held in a `Set`
and get `isCanceled = true` in the close handler. Without it a redeploy leaves teleproto pushing bytes
for a node that no longer exists — the same concern the list node handles for reads
([ADR 0016](0016-list-node.md)).

**`replyTo` is left out of the options object entirely when unset**, rather than passed as `undefined`.
Both work, but an options object that lists only what was asked for is easier to read in a log.

**`silent` is a config checkbox with an `msg.silent` override**, using an explicit `!== undefined` test.
A `||` would swallow `msg.silent: false`, which is a real thing to want when the node default is on.

## What is deliberately still left out

**The thumbnail.** `thumb` is accepted, but the library's own documentation says Telegram ignores it
unless the file is a JPEG under about 20 kB and 320×320 — _and_ that the underlying media's dimensions
must be supplied through `attributes` with a `DocumentAttributeVideo`. `attributes` is not exposed and
exposing it means exposing the TL attribute classes. A `thumb` field on its own would mostly do nothing,
which is the same trade ADR 0012 declined for `auth` buttons. Left out rather than half-supported.

**`uploadFile`** — upload without sending, for reusing one upload across several sends. It is a plain
client method with no iterator and no marshalling problem, so the sender node's generic bridge already
reaches it. Nothing to add.

**A configurable message property for the file.** The issue suggested one, defaulting to `msg.payload`.
`msg.payload` _is_ the Node-RED convention and what `file in` and `http request` produce; a field to
change it would earn its space only for a flow that cannot use a Change node.

The remaining 30-odd options — `voiceNote`, `videoNote`, `supportsStreaming`, `ttlSeconds`, `spoiler`,
`scheduleDate`, `noforwards`, … — are each a field plus an explanation. Adding one later is additive.

## Consequences

- `lib/upload.js` exports `describeUpload` instead of `toUploadFile` / `needsFilename`. Both were only
  ever used by the upload node and its tests.
- A `silent` config property. The stored flow gains a key; nothing existing changes meaning.
- `msg.payload` on the output is an **array** of messages for an album, a single message otherwise —
  which is what `sendFile` returns in each case.
- Ten reversals, all failing a test. One of them was not a reversal but a genuine find: the first version
  of `describeFile` guarded with `filename !== undefined && filename !== ''`, which let `null` through and
  named the file `null`. The old node had `!msg.filename`, which caught it. The guard is now
  `typeof filename === 'string' && filename !== ''`.
