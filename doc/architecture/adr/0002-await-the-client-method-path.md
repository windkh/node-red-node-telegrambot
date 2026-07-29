# 0002 — Await the sender's client-method path

## Context

The sender node supports two calling conventions, selected by whether `msg.payload.api` is set:

- **raw MTProto**: `client.invoke(new Api[api][func](args))`, with `args` as a single options object
- **client method**: `client[func](...args)`, with `args` spread as arguments

The raw path was awaited; the client-method path was not. Every GramJS client method is `async`, so
`msg.payload` was assigned a **pending Promise** rather than the result. Worse, the surrounding
`try/catch` only covered the synchronous part of the call, so a rejection escaped as an unhandled
promise rejection and `nodeDone(error)` was never reached — errors on `sendMessage` and friends were
invisible to Catch nodes and to the debug sidebar, and under `--unhandled-rejections=throw` could take
the runtime down.

Separately, `args` defaulted to `{}` for both paths. On the client-method path that default was then
spread, and objects are not iterable, so omitting `args` produced `TypeError: … is not iterable`
instead of calling the method with no arguments.

The existing test suite did not catch either problem: its fake client returned a value **synchronously**,
which a missing `await` handles just as well as a present one.

## Decision

- `await` the client-method call.
- Give each path its own `args` default: `[]` where the value is spread, `{}` where it is passed to the
  `Api[...]` constructor. A shared `[]` default would have broken the raw path.
- Reject a non-array `args` on the client-method path up front, via `nodeDone`, with a message naming
  the requirement — rather than letting a `TypeError` escape from the spread.
- Derive the path once into `useApi` instead of repeating the `api === undefined || api === ''` test,
  and express both checks as nested positive conditions with the error path in the `else` — no guard
  clauses. `AGENTS.md` requires a single exit per function and explicitly forbids an early `return` in
  a precondition check; the invocation itself moved into `invokeClient` so the nesting stays shallow.
- Make the test fakes `async`, so a future regression on the `await` fails the suite. This was verified
  by reintroducing the bug: three tests fail, including the rejection case.

Deliberately **not** changed here, to keep the commit reviewable — tracked separately in the follow-up
issue: `nodeDone()` is still not called on the success path, and a missing config node, a missing client
or a falsy `msg.payload` still drop the message silently.

## Consequences

- `msg.payload` now receives the resolved value. Flows that consumed the Promise object cannot have been
  working, so nothing that functioned before changes shape — but the output does change, which is why
  this is recorded rather than treated as a pure bug fix.
- Errors from client methods now reach Catch nodes. A flow that silently discarded failures will start
  reporting them. That is the intent, but it can make an existing broken flow suddenly noisy.
- Omitting `args` now calls the method with no arguments, which is what `getMe()` and similar need. It
  previously threw.
- An explicitly non-array `args` on the client-method path is now a reported error rather than a
  `TypeError`. The message names the constraint so it is actionable from the sidebar.
