# 0008 — Explain unresolvable peers instead of resolving them again

## Context

Addressing a chat or user is the most common source of confusion with this package. `README.md` told
users to put a username in `peer` and left it there, and the sender node still carries the maintainer's
own leftover note:

```js
// TODO:
// const entity = await client.getEntity('Windhose');
// await client.sendMessage(entity, { message: 'Hello!' });
```

MTProto does not let a client address an arbitrary user by id: it needs an `InputPeer` carrying an
`access_hash`, which the client only holds for peers it has already seen. The issue therefore proposed
resolving entities inside the send path — running a plain string or number through `getInputEntity`
before handing it on.

## Decision

**Do not add resolution. GramJS already does it, on both paths.** Verified in the installed source:

- Client-method path: `client/messages.js`, `sendMessage` line 32 —
  `entity = await client.getInputEntity(entity);`
- Raw API path: `client/users.js`, `invoke` calls `await request.resolve(client, utils)`, and the
  generated `resolve()` auto-casts every field whose type is in `AUTO_CASTS` (`tl/api.js`), which
  includes `InputPeer`. `getInputFromResolve` then calls `client.getInputEntity(peer)`.

So a username string works today on both paths. Adding our own call would be a redundant round trip,
and would risk mangling an entity the flow had already resolved. The proposal was dropped.

**What is actually missing is an explanation.** When resolution fails, GramJS throws a plain `Error`:

```
Could not find the input entity for "12345".
     Please read https://docs.telethon.dev/en/stable/concepts/entities.html to find out more details.
```

— a Python library's documentation, for a problem whose real cause is not stated. The sender now
detects this and emits one `node.warn` explaining it, while the **original error still reaches
`nodeDone` untouched**, the same rule as the flood-wait handling in ADR 0007: a Catch node may be
inspecting it, so the hint is an addition, never a replacement.

There is **no error class** for this — unlike `FloodWaitError` — so the check has to match on the
message. That is fragile, and deliberately so: if GramJS rewords it the hint is silently lost and the
original error still flows. A broken match costs a hint, not correctness.

**The cause is documented rather than worked around.** `StringSession.save()` serialises only the dc id,
server address, port and auth key; the entity cache lives in `MemorySession._entities`, an in-memory
`Set`. So it is lost on every restart, and that is why a flow addressing peers by numeric id works while
being built and fails after a redeploy. `README.md` now has a table of what resolves reliably and what
does not, and says plainly: address peers by username.

## Consequences

- No behaviour change to any working flow — the only addition is a warning on a path that was already
  failing.
- The hint is best-effort. If GramJS changes its wording, `UNRESOLVED_PEER` in `nodes/sender-node.js`
  needs updating; a test carries the current string so the drift is at least visible.
- A persistent entity cache would remove the underlying problem, and would make numeric ids portable
  across restarts. That means changing how the session is stored, which is account-level secret
  material, so it is filed separately rather than folded in here.
- Verified by reversing the check in both directions: forcing it false fails the test that the hint is
  given, forcing it true fails the test that unrelated errors stay quiet.
