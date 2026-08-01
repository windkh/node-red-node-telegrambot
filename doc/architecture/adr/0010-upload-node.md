# 0010 — A separate node for uploading files

## Context

Sending a file that a flow holds as a Buffer — from `file in`, `http request`, an exec node — did not
work usefully. `sendFile` was reachable through the sender's generic bridge, and GramJS does accept a
bare Buffer, but look at how it names one (`_fileToMedia`, `client/uploads.js`):

```js
let name;
if ('name' in file) {
    name = file.name;
} else {
    name = 'unnamed';
}
if (Buffer.isBuffer(file)) {
    createdFile = new CustomFile(name, file.length, '', file);
}
```

Buffers carry no `name`, so the file arrived in the recipient's chat called **"unnamed"**. Not broken,
but wrong in a way the user only discovers after sending. Supplying the name means constructing a
`CustomFile`, which a Function node cannot `require`.

## Decision

**A new node type, `telegram client upload`**, mirroring the download node from ADR 0009. The reasoning
there applies unchanged: the sender is deliberately a generic bridge, and this needs its own
configuration — destination, caption, as-document — which belongs in a dialog rather than in `msg`.
Symmetry also matters here: a package that has a download node and hides upload inside the generic
sender would be harder to learn than one with both.

**`msg.filename` is required for a Buffer, and its absence is an error.** The alternative was to invent
a name, which only moves the surprise. A path needs no filename, because GramJS stats it and uses the
basename — so the requirement is conditional, which is why `lib/upload.js` exposes `needsFilename`
rather than the node guessing.

**The size comes from the Buffer, never from the caller.** `CustomFile(name, size, path, buffer)` takes
a size, and taking it from anywhere but `buffer.length` would let the two disagree.

**Destination and caption take a config default that `msg` overrides.** A flow sending to one fixed chat
configures it once; a flow routing to many sets `msg.peer` per message. Both are common, so both work,
with `msg` winning.

**The output is the sent message, not the Buffer.** What a flow wants next is the `Message` Telegram
created — to reply to, edit or pin. Carrying a large Buffer along would be dead weight. This differs
deliberately from the download node, which _does_ preserve its input under `msg.telegram`, because there
the input is small and still useful.

## Consequences

- `file in` → upload and `http request` → upload work without a Function node in between.
- A fifth node type. `test/registration.test.js` asserts the exact list and was updated; the config node
  stays first, since every other node resolves it by id at construction.
- **The status plumbing is now duplicated four times** (receiver, sender, download, upload): the three
  status constants, `STATUS_BY_STATE`, the listener registration and the close-time deregistration. ADR
  0009 said this would be worth extracting if a fifth node appeared. It has. The next change in this area
  should pull it into `lib/` or a shared node mixin rather than copying it a fifth time.
- Large files: a Buffer must fit in memory before it can be sent. The help says to pass a path instead,
  which lets GramJS stream from disk. Not enforced — a size guard on the way out would need the same
  "cannot always tell" caveat as the download node, without the same payoff.
- Verified by reversing three things independently: passing the Buffer through unwrapped, allowing a
  missing filename, and ignoring `msg.peer`. Each fails exactly the tests that cover it.
