# 0014 — Release the teleproto move as 1.0.0

## Context

`AGENTS.md` requires an ADR for any major bump, explaining the breaking change. This is that ADR. The
version goes from 0.3.0 straight to 1.0.0.

The honest starting point: **the flow contract does not break.** Node type names, credential names,
`msg.payload` shapes, the config node's properties and the `connected` / `disconnected` status texts are
all unchanged by [ADR 0013](0013-migrate-to-teleproto.md), and stored sessions carry over byte-identical.
A user on 0.2.x can update and redeploy with nothing to do. Under a strict reading of semver that is a
minor release, which is what 0.3.0 was.

## What makes it a major anyway

Three things, and the third is the one that decides it.

**The whole MTProto implementation was replaced.** Every byte this package puts on the wire now goes
through a different library. ADR 0013 records what was verified, and the test suite passes — but the
suite cannot connect to Telegram, by design, so nothing here exercises the protocol itself. The parts of
teleproto this package leans on but cannot test offline (the connection lifecycle, DC migration, the
update loop, MTProxy) are only as good as the fork. Shipping that as a patch-level increment
misrepresents how much moved.

**Two small contract details did change.** The `broken` status text is now
`broken: login again or redeploy`, which breaks a flow that matched on the old string. The **Use WSS**
checkbox is gone from the config dialog — harmless, since the stored property survives and nothing read
it usefully before, but it is a visible change to the node's UI.

**npm's latest is 0.1.6.** Everything from 0.1.7 onward — twenty-odd entries in `CHANGELOG.md` — has only
ever existed in git. So for the users who actually install this package, 1.0.0 is not "0.3.0 plus a
library swap". It is the first release in which:

- the sender node awaits client methods, so `msg.payload` stops being a pending Promise (0.1.8)
- failures are reported instead of dropped, so Catch and Complete nodes work (0.1.9)
- the client is destroyed on redeploy, so redeploys stop leaking sessions (0.1.10)
- the bot token and 2FA password are persisted at all (0.1.11)
- the account password stops being written into the proxy password field (0.1.11)
- the login endpoints are `POST`, not `GET` — flagged breaking at the time (0.2.0)
- the secrets are no longer sent back to the editor (0.2.0)
- there are two new node types, `download` and `upload` (0.1.19, 0.1.20)

Two of those need the user to do something by hand, and one is a documented breaking change to the admin
endpoints. That is a major release by any reading, and it happens to land in the same version as the
library swap.

## Decision

Release as **1.0.0**, and write the upgrade path down for users rather than leaving it spread across
twenty changelog entries: [MIGRATION.md](../../../MIGRATION.md).

`0.3.0` was committed but never published, so its `CHANGELOG.md` heading is **renamed** to `1.0.0` rather
than a second entry being stacked on top. Recording a release that never existed would be worse than the
gap in numbering.

Nothing in the code changes for this ADR. It is a version and documentation decision.

## Consequences

- The version number now carries information: 1.x means teleproto, 0.x means GramJS.
- Users upgrading from npm get one document that tells them what to do, including the two manual steps
  they would otherwise have to infer from `CHANGELOG.md` entries for versions they never ran.
- A major number sets an expectation of stability for the node contract from here on. The things
  `AGENTS.md` already lists as public API are exactly the things that must now survive to 2.0.0 —
  including, from now on, the `broken` status text, which this release is the last chance to correct.
- 0.3.0 is skipped in the published history. Anyone reading git will find the commit; anyone reading
  `CHANGELOG.md` or npm will not see a version that was never released.
