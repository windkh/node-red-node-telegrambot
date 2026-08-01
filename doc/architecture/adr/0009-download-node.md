# 0009 — A separate node for downloading media

## Context

A user asked in issue #9 how to get at the photo on a received message. The receiver emits the raw GramJS
message, so a photo arrives as a nested descriptor with `id`, `accessHash`, a `fileReference` Buffer and a
`sizes` array — and there was no documented way to turn that into bytes.

`downloadMedia` was already reachable through the sender's generic bridge, and after ADR 0002 fixed the
missing `await` it genuinely worked:

```js
msg.payload = { func: 'downloadMedia', args: [message, { thumb: 0 }] };
```

So this was not a missing capability. It was three missing pieces of ergonomics:

- the user has to dig the message out of the receiver's payload and know the options shape
- the returned Buffer lands in `msg.payload`, destroying the message the flow usually still needs
- nothing bounds the download, so a 2 GB video is read straight into memory

## Decision

**A new node type, `telegram client download`.** The alternatives were weighed:

- _An operation on the sender._ The sender is deliberately a generic bridge — one method with special
  handling makes it inconsistent, and the configuration (size limit, thumbnail) would have to arrive
  through `msg` instead of the dialog.
- _Auto-download on the receiver._ The most convenient and the easiest to misuse: every incoming file
  would be fetched unasked, including the ones that should not be.
- _Documentation only_, as was the right answer for ADR 0008 and the parse-mode issue. Rejected here
  because the size guard and the metadata cannot live in documentation.

A new node type is public API, which is why this is recorded.

**The bytes go in `msg.payload`, the message moves to `msg.telegram`.** That is the Node-RED convention
for binary, so `file out` and `http response` follow directly with no Change node in between, and
`msg.filename` / `msg.mimetype` are the properties those nodes already read. The original payload is not
discarded, because a flow almost always still needs the sender or the chat.

**The size is checked before fetching, not while.** `lib/media.js` works out how many bytes the download
will be from the media descriptor — `document.size` (a BigInt, converted, so it can be compared to a
limit) or the largest `PhotoSize`. With a thumbnail index it reports _that_ size, since that is what will
actually be fetched. The limit is in megabytes because that is the unit a user thinks in, and `0` means no
limit.

The size cannot be determined for every kind of media — `PhotoStrippedSize` carries its bytes inline and
has no `size` field, for instance. In that case the check is **skipped** rather than guessed at, so this
is a safeguard, not a guarantee. Said so in the node help rather than implying more than it delivers.

**`lib/media.js` keys off `className`, not `instanceof Api.X`.** That is the discriminator GramJS puts on
every TL object, and it is what lets the whole module be unit-tested against plain fabricated objects with
no client and no network — which is the only way to test this offline at all.

## Consequences

- Closes the request in #9, with a worked example flow rather than just prose.
- A fourth node type appears in the palette. `test/registration.test.js` asserted exactly three and was
  updated deliberately; the config node must stay first in the registration order, since every other node
  resolves it by id at construction.
- The download node duplicates the connection-status plumbing from ADR 0006 (listener registration, the
  three status constants). Three nodes now carry near-identical copies. Worth extracting if a fifth
  appears; not worth it yet.
- Progress reporting is not wired up. GramJS accepts a `progressCallback`, and surfacing it as a status
  would help for large files — left out to keep this change reviewable.
- Verified by reversing three things independently: ignoring the size limit, not preserving the original
  message, and not passing the thumbnail through. Each fails exactly one test.
