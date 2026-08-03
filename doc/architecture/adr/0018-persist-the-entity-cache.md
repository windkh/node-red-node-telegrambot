# 0018 — Persist the peer cache with StoreSession, opt-in

## Context

MTProto will not let a client address a user by numeric id alone — it needs an `InputPeer` carrying an
`access_hash`, and the client only holds one for peers it has already seen. `StringSession.save()`
serialises the dc id, address, port and auth key and nothing else, so that list dies with the process.

The symptom, which [ADR 0008](0008-entity-resolution.md) documented and made the node explain: a flow
that addresses peers by numeric id works while it is being built and fails after the next redeploy with
`Could not find the input entity`. Explaining it was the right first step. Removing the cause is #32.

## A correction first

The comment I left on #34 said teleproto's new `entityCache` client option was the hook this needed.
**That was wrong**, and anyone starting from it would have gone the wrong way. `entityCache` is
`boolean | { max, ttl }` — a size-and-expiry policy for the in-memory cache, with no way to plug in
storage.

What actually exists is `StoreSession`: it extends `MemorySession` and overrides `processEntities` and
`getEntityRowsById` on top of `node-localstorage`, so the rows survive. That is what this uses, on the
user's instruction, with the trade below stated rather than glossed.

## The trade, which is the whole decision

`StoreSession` persists **the auth key as well as the entity rows.** It does not offer a way to keep one
and not the other.

That key is the same secret as the session string, which until now lived only in Node-RED's credentials
file — encrypted, and the thing [ADR 0011](0011-keep-secrets-out-of-the-editor.md) went to some trouble
to keep out of sight. Turning this on writes it to a plain directory. Anyone who can read that directory
can act as the account.

So: **off by default, and the dialog says why in the imperative.** A user who addresses peers by username
never needed this and should never turn it on; a user who addresses them by id gets to make an informed
choice. Enabling it silently for everyone on upgrade would have been the wrong call regardless of how
useful the feature is.

## Where the data goes, and why it took work

`StoreSession`'s constructor does `new LocalStorage('./' + sessionName)`. Hardcoded, and relative to the
**working directory** — which for Node-RED depends on how it was started, and is not the user directory in
the official Docker image.

Three things were checked before settling on an approach:

- **An absolute name is mangled.** `'./' + 'D:/tmp/x'` becomes a directory literally called `D:` under the
  working directory.
- **`store2.area(name, storage)` caches by name and ignores the storage on a second call**, so replacing
  `session.store` after construction with one pointing elsewhere does not work — both writes land in the
  first area.
- **`new LocalStorage(path)` creates its directory immediately**, so merely calling the constructor
  already litters the working directory, whatever is done afterwards.

Which leaves one clean answer: hand the constructor a **working-directory-relative path** that resolves to
where we want it. `describeSessionStore` computes it from `RED.settings.userDir`, so the store lands in
`<user directory>/telegram-sessions/<config node id>` — next to the flows and the credentials file, and
independent of the working directory.

The name is per config node because `store2` keys its areas process-wide: two config nodes sharing a name
would share one store, and with it one account's key.

The one case with no relative form is a user directory on another Windows drive. Then the name falls back
to a plain working-directory-relative one, and the node **warns with the actual path** rather than leaving
it to be discovered.

## Seeding, and what happens after a re-login

The credential stays the source of truth. The login flow is untouched — it still produces a `StringSession`
and a session string, which is what the user can back up and what `ADR 0011` protects.

On first use the store is empty, so it is seeded from that credential. On later starts it is used as it
stands. If the two disagree the credential wins, the store is **deleted** and re-seeded, and the user is
told the cached peers were discarded. Merging would be worse: the rows carry access hashes, and a changed
credential may be a different account entirely, in which case every cached hash is wrong.

**`setDC` before `authKey`, and the order is not cosmetic.** `MemorySession.setDC` replaces the auth key
with whichever one it has cached for the new data centre whenever the id changes — so on a fresh store,
which starts at dc 0, setting the key first and the data centre second throws the key away. The tests
caught this; a counter-test now pins it.

## What this does not fix

`getEntityRowsByUsername`, `ByPhone` and `ByName` are **not** overridden by `StoreSession`, so those
lookups still come from the in-memory map and still cost a resolve after a restart. That is fine:
usernames resolve on demand anyway, and numeric ids were the thing that broke.

## Consequences

- Numeric peer ids keep working across a restart, for configs that opt in.
- A new config property, `persistpeers`, default `false`.
- `openSession` is now exported from `lib/telegram-client.js` for the same reason `applyParseMode` is:
  `createTelegramClient` cannot run offline, and this branch decides where the account key lives.
  Extracting it was not tidying — **both directions of removing that branch passed the entire suite**
  until it had its own test.
- Nine reversals, all failing a test.
- `MIGRATION.md` gains a section: this is off for everyone after an upgrade, including anyone who was
  relying on ids working within a single run.
