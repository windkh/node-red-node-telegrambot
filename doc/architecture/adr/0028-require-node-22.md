# 0028 — Require Node.js >= 22.13

## Context

This package declared `engines: { node: ">=20.0.0" }` and tested on the matrix `[20.x, 22.x]`. Both are
now claims we cannot back:

- **Node 20 reached end of life on 2026-04-30.** It receives no security fixes.
- **`node-red@5` declares `engines: { node: ">=22.9" }`.** A supported Node-RED 5 install cannot be on
  Node 20, so the `>=20.0.0` promise described a configuration our own host runtime rules out — while
  obliging us to keep a CI leg for it and to weigh it in every dependency decision.
- **The shared standard moved its floor to `>=22.13.0`** (node-red-standards 0.9.0). Its `nrstd audit`
  now reports this repo at 18/19, and `.github/workflows/standards-check.yml` fails the build on a gap.

The number is not ours to invent. 22.13 is **ESLint 10's own floor on the 22 line**
(`^20.19.0 || ^22.13.0 || >=24`), and ESLint 10 is what the standard mandates. Choosing it removes a
mismatch this package carried in silence: `engines` said `>=20.0.0` while the linter refused to install
below 20.19, so a contributor on 20.0–20.18 got an `EBADENGINE` warning from a floor we had set ourselves.
22.13 also clears `node-red@5`'s `>=22.9`.

Alternatives considered:

- **Stay on `>=20.0.0` and pin the standard.** Rejected: pinning a standard to keep auditing clean is how
  a repo drifts while reporting full marks — the failure this project has already been bitten by.
- **Raise to `>=22.9`,** matching Node-RED 5 exactly. Rejected: it would leave the ESLint mismatch in
  place for 22.9–22.12, i.e. the same defect at a different offset.
- **Raise to `>=22.19`,** matching `undici@8` as `node-red-contrib-telegrambot` did. Rejected here: this
  package does not depend on undici, so that floor would be borrowed rather than justified.

## Decision

Require **Node.js >= 22.13**, released as **3.0.0**.

- `engines.node` → `>=22.13.0`
- CI matrix `[20.x, 22.x]` → `[22.x, 24.x]`, which also adopts the standard's current `node.js.yml`
  verbatim and clears the template drift `nrstd audit` was reporting on that file
- README and `MIGRATION.md` state the requirement; the README's "tested with Node.js v18.12.1 and
  Node-RED v3.0.2" line was stale years before this change and is corrected with it

A major version, because raising the runtime floor is breaking for anyone below it — regardless of how
few that is.

## Consequences

- **Users on Node < 22.13 stay on 2.1.2.** npm refuses the install with `EBADENGINE` rather than
  producing a package that fails at runtime, which is the point of declaring it.
- **Anyone on Node-RED 5 is unaffected** — they already satisfy `>=22.9`, and 22.13 is a small step past
  it. The group that has to act is Node-RED 4 on Node 20, and their path is Node first, then this package.
- **Node 24 enters CI for the first time.** Failures it surfaces are real and were previously invisible.
- **No code changes.** Nothing in `telegrambot/` uses an API newer than Node 20; this is a support
  statement, not a rewrite. The suite is unchanged and green on both matrix legs.
- **`node-red.version` stays at `>=1.3.7`.** Raising the Node floor does not by itself invalidate that
  claim, and narrowing it would need evidence this ADR does not have. It is worth revisiting separately —
  a Node-RED 1.3.7 install on Node 22.13 is an unusual combination to be promising.
- **Reversible** in principle by restoring the floor and the matrix, at the cost of a major version to
  undo a major version — and of re-adopting an EOL runtime.
