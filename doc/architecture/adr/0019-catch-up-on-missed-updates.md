# 0019 — Catch up on missed updates by persisting the position, opt-in

## Context

Messages arriving while Node-RED is stopped or redeploying were lost. The receiver subscribes to the live
update stream and has no notion of what it missed.

Issue #21 was the last and by far the largest item on the improvement plan, and it was scoped against
GramJS, where `catchUp()` was literally `function catchUp() { /* TODO */ }`. The issue therefore described
building the whole thing: persist the state, call `updates.getDifference`, loop `differenceSlice`, handle
`differenceTooLong`, handle `updatesTooLong` on the live stream, replay through the same handlers, and
cope with duplicates at the boundaries.

## Almost all of that is already done

teleproto has a real `UpdateManager`. Read before designing anything, and it changes the size of the job
completely:

| Issue asked for                            | Where it is                                                      |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `getDifference` on reconnect               | `fetchCommonDifference` / `fetchDifferenceLoop`                  |
| loop `differenceSlice` until drained       | `fetchDifferenceLoop`, tracking `intermediateState`              |
| handle `differenceTooLong`                 | jumps `pts` forward and stops, logging `getDifference: too long` |
| handle `updatesTooLong` on the live stream | `onUpdates`, requests a common difference                        |
| replay through the same handlers           | `dispatch` → `_dispatchUpdate`, the same path live updates take  |
| cope with duplicates                       | `isDuplicateMessage`, checked inside `dispatch`                  |
| per-channel state                          | `fetchChannelDifference`, `ChannelDifferenceTooLong`             |
| recover after a silent stretch             | `isStale()` / `recoverIfStale()`, run by the update loop         |

**What it cannot do is know where the stream was before the process existed.** `ensureState()` initialises
from the server's _current_ position, which is exactly "skip whatever was missed" — correct for a first
run, and the whole problem for a restart.

So this issue reduces to its point 1 and its point 7: persist the position, and make it a choice.

## Decision

**`lib/update-state.js` keeps `pts` / `qts` / `date` / `seq` in
`<user directory>/telegram-updates/<config node id>.json`.** One file per config node, next to Node-RED's
own data rather than in the working directory, for the same reason as
[ADR 0018](0018-persist-the-entity-cache.md): the working directory depends on how Node-RED was started.

Plain JSON, no dependency, and — unlike the session store — **nothing secret**. These are sequence
numbers. That is why this needs none of ADR 0018's agonising about where the data may live.

**Seed, then catch up, in that order.** `refreshFromState(saved)` overwrites whatever `ensureState()` put
there, and `catchUp()` then asks for the difference from the saved position. The other order asks for the
difference from _now_, which fetches nothing — a counter-test pins it, because the two lines look
interchangeable.

**Off by default.** After a long outage on a busy account this arrives as a flood the moment the user
deploys. The issue asked for this and it is right.

**Written on close, and on a 60-second timer.** Close is what a clean redeploy resumes from. The timer
bounds how much a hard crash costs; over-replaying is the safe direction, and the library's duplicate
check absorbs most of it.

**Written through a temporary file and a rename.** A crash part way through a plain write leaves a
truncated file, and then the position is lost — the exact thing this feature exists to prevent.

**A damaged or partial file is reported and treated as "start from now."** That is a boundary check, not
defensive programming about our own code: the file is external, and a crash or a text editor can leave it
half-written. A missing file says nothing at all, because a first run is normal rather than a problem.

**A failed catch-up warns and lets the flow start.** The live stream still works; losing the deploy over a
replay would be the worse failure.

## What is deliberately not done

**Replayed messages are not marked.** The issue offered `replayed: true` on the payload as an option.
teleproto dispatches them through the same path as live updates and gives no hook to distinguish them, so
marking them would mean wrapping `dispatch` — reaching into a private method to add a field to a public
`msg` shape. Not worth it. The consequence is documented instead: a flow cannot tell, and does not have to
change.

**No cap on how much is replayed.** Telegram already bounds it: past its own window it answers
`differenceTooLong`, the library jumps the position forward, and those messages are gone. A second,
invented limit would be guesswork about a window Telegram does not publish.

**`differenceTooLong` is not surfaced as a node status or a warning.** There is no hook — the library logs
it through its own logger at warn level, which our default log level shows. Documented rather than
papered over.

## Consequences

- Missed messages reach the flow after a restart, for configs that opt in.
- A new config property, `catchup`, default `false`, and a new directory `telegram-updates` under the user
  directory. Added to `.gitignore` alongside `telegram-sessions`.
- Duplicate delivery around the boundary is possible. Mostly filtered by the library; a flow that must not
  act twice should be idempotent, which the node help now says.
- Twelve reversals, all failing a test. One needed a test written: with the option off, removing the
  `updateStateFile !== undefined` guard still wrote no file — but warned on every redeploy about failing
  to write one, which is noise for a feature nobody switched on.
- This closes the improvement plan's last hard item. #28 remains, and it is convenience.
