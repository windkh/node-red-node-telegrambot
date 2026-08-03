# 0021 — Three things the teleproto audit turned up

## Context

A pass over the whole package looking for work teleproto now does for us, or does better. Most of what
looked redundant was not — that list is at the end, because "we checked, and here is why it stays" is worth
as much as a change. Three things were real, and only one of them was the tidying the audit went looking
for.

## 1. The download node's size limit understated a photo by a factor of fifty

`mediaSize` counted a photo by filtering `photo.sizes` for entries with a numeric `size`. Of the five TL
variants, **only `PhotoSize` has one**:

| Variant                | Carries           |
| ---------------------- | ----------------- |
| `PhotoSize`            | `size`            |
| `PhotoSizeProgressive` | `sizes: number[]` |
| `PhotoStrippedSize`    | `bytes`           |
| `PhotoCachedSize`      | `bytes`           |
| `PhotoSizeEmpty`       | nothing           |

Telegram sends a mix for any real photo, and the largest entry is usually the `PhotoSizeProgressive`.
Measured against a realistic structure: **90 000 reported, 4 500 000 actually downloaded.** So a limit of
1 MB let a 4.5 MB photo through, and a photo whose sizes are progressive only reported nothing at all —
which made the node skip the check entirely, the case its comment described as rare.

teleproto has the correct arithmetic in `utils._photoSizeByteCount`, including the **622 bytes** a stripped
size expands to when reconstructed. It is **mirrored rather than reused**: it is `instanceof`-based and
underscore-private, and everything in `lib/media.js` is deliberately keyed on `className` so it can be
tested against plain objects with no client. Ten lines, and the design stays.

This bug is older than teleproto — it arrived with the download node in #22. The audit found it by reading
the library's version of the same calculation.

## 2. A rule in AGENTS.md that was not true

`lib/client-params.js` went to some trouble to **omit** `deviceModel` / `systemVersion` / `appVersion` when
empty, and `AGENTS.md` stated that as binding: they "must be **omitted** when empty rather than passed as
`''`, so teleproto applies its own defaults".

teleproto's defaults set all three to `''` and then fall back on any falsy value:

```js
deviceModel: clientParams.deviceModel || os.type().toString() || 'Unknown',
```

So absent and empty are the same thing to it, and the three checks enforced a distinction that does not
exist. Verified by constructing two real clients — one with `''`, one with the keys absent — and comparing
the `InitConnection` they build: identical, and neither empty. That comparison is now the test, so the
premise is asserted against the library rather than against a restatement of it.

The code is three plain assignments, and the rule in `AGENTS.md` says what is actually true. Notably #30
had **already recorded** the equivalence while the rule kept demanding otherwise — a rule and a known fact
disagreeing for weeks without anyone noticing is the part worth remembering.

## 3. The download node could not report progress or be cancelled

`downloadMedia` takes a `progressCallback` and a `signal`; the upload node has had both since 1.2.0, while
the download node showed a static `downloading` and kept streaming into a node Node-RED had already closed.

Now: `downloading 42%`, and a redeploy aborts a download in flight. teleproto checks the signal in its
streaming loop, so a 40 MB video stops between chunks rather than after the file.

Two asymmetries are deliberate and documented in the code, because they look like mistakes:

- **Download gets bytes, upload gets a fraction.** `ProgressCallback` is `(downloaded, total)`; upload's is
  `(progress)`. That is the library's shape, not ours.
- **Download uses an `AbortSignal`, upload sets `isCanceled` on its callback.** `sendFile` offers only the
  latter; `downloadMedia` offers a real signal, which is checked per chunk rather than only when progress
  is reported. Using the better hook where it exists beats a false symmetry.

A percentage is only shown when `total` is greater than zero. Without that, media whose size the server did
not state reports `downloading Infinity%` — which is also what the first version of the test failed to
catch, because `/downloading \d/` does not match `Infinity`.

## Checked and deliberately unchanged

So nobody "simplifies" these later:

| Ours                         | Why it stays                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/update-state.js`        | `MemorySession._updateStates` exists but **nothing reads it**; the abstract `getUpdateState`/`setUpdateState` are gone and only their doc comments remain. No library mechanism.            |
| `lib/reply-markup.js`        | `buildReplyMarkup` takes Buttons, rows and grids — but not JSON, which is all a Function node can produce.                                                                                  |
| its `toRows`                 | Duplicates the library's own normalisation, but we need the grid **first** to name `buttons[1][0]` in an error.                                                                             |
| `lib/upload.js` `CustomFile` | `_fileToMedia` still names a bare Buffer `"unnamed"`.                                                                                                                                       |
| `CONNECTION_STATES`          | teleproto exports the numbers `1 / -1 / 0` and no names.                                                                                                                                    |
| `PARSE_MODES`                | Still matches exactly, and the library's own check is private.                                                                                                                              |
| `EXTENSION_BY_MIME_TYPE`     | `utils.getExtension` is better — it delegates to `mime` and knows WebDocument and profile photos — but is `instanceof`-based, which would break the plain-object tests. A trade, not a win. |

**And one that was tempting.** `client.api.messages.SendMessage(args)` would collapse the sender's raw-API
path to one line and drop the `Api` import. The proxy applies `upperFirst`, so it is even contract
compatible — which is the problem: lowercase method names would silently start working too, widening a
documented `msg.payload` contract as a side effect of tidying. One line is not worth that.

## Consequences

- The **Max size** setting on the download node now does what it says for photos. Anyone who relied on
  large photos slipping through will see them refused.
- `buildClientParams` always includes the three version fields. They were already reaching Telegram as the
  library's defaults, so nothing changes on the wire.
- Ten reversals, all failing a test — after two of the tests were strengthened: one failed as a timeout
  rather than an assertion, and one had a regex that `Infinity` walked straight past.
