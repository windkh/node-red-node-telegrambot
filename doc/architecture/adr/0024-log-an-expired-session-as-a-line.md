# 0024 — Log an expired session as a line, not a stack

## Context

Reported from a real run, and reported as _"nach dem start kommt eine exception"_:

```
[warn] AuthKeyUnregisteredError: The specified authorization key is not registered in the system
       (for example, a PFS temporary key has expired). (caused by updates.GetState)
    at RPCMessageToError (teleproto/errors/index.js:25:17)
    at MtpDispatcher.handleRPCResult (teleproto/network/MtpDispatcher.js:97:58)
    at MtpDispatcher.process (teleproto/network/MtpDispatcher.js:45:15)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at MtpDispatcher.handleContainer (teleproto/network/MtpDispatcher.js:121:13)
    at MtpDispatcher.process (teleproto/network/MtpDispatcher.js:45:9)
    at MTProtoSender._readLoop (teleproto/network/MTProtoSender.js:607:17)
```

The behaviour was right. `(caused by updates.GetState)` is the authorization probe inside `client.start()`;
it failed, and because [ADR 0022](0022-never-log-in-at-deploy-time.md) removed the interactive path, the
real error was reported instead of a login being started. No `Code is empty`, no login code sent.

The **presentation** was wrong. Seven frames of `MtpDispatcher` and `MTProtoSender` for a condition whose
entire remedy is "log in again", logged in a way that reads like a crash — which is exactly how it was read.
Not an exception at all: caught, warned, status set, flow running.

That regressed in ADR 0022. Before it, this path went through `describeAuthError` on its way to the log; the
callback that did so was removed with the interactive flow, and the bare `warn(error)` underneath was left.

## Decision

**`describeForLog(error)` decides what a log gets.** One line when Telegram answered, the error itself when
something unexpected broke:

```
Error 401 (AUTH_KEY_UNREGISTERED): The specified authorization key is not registered in the system
(for example, a PFS temporary key has expired). (caused by updates.GetState)
```

Everything actionable, nothing else. A `TypeError` from our own code keeps its stack, because there the
stack _is_ the diagnosis and reducing it to a line would throw away the only useful part.

A named function rather than a ternary at the call site, and that is not decoration: the two branches differ
only for an error Telegram sent, which cannot be produced offline, so the rule has to be testable on its
own. Same reasoning as `openSession` in ADR 0018.

The status is unchanged — `shortFailureReason` already gave it `session invalid: login again`.

## The predicate needed a second half

`isTelegramError` began as `error.code !== undefined`, which looked sufficient and was not:

|                            | `code`              | `errorMessage`            |
| -------------------------- | ------------------- | ------------------------- |
| `AuthKeyUnregisteredError` | `401` (number)      | `'AUTH_KEY_UNREGISTERED'` |
| a filesystem `ENOENT`      | `'ENOENT'` (string) | absent                    |

**Node's own system errors carry a `code` too.** `openStoredSession` creates a directory, so a permissions or
path failure from the session store would have been mistaken for a Telegram answer and stripped of the stack
that explains it — turning a diagnosable bug into one line saying `Error undefined (undefined)`.

So the test is a **numeric** `code` _and_ an `errorMessage`. Found by asking what else has a `code`, not by
hitting it, and pinned by a test that provokes a real `ENOENT`.

## Consequences

- An expired session now reads as what it is. The remedy is on the node status, the detail is one line in
  the log, and neither looks like a crash.
- A failure that is genuinely ours still arrives with its stack.
- Seven reversals, all failing a test. One needed a source-level assertion, and the comment says why:
  everything reachable offline throws a plain `Error`, which `describeForLog` returns unchanged, so no
  behavioural test can tell `warn(describeForLog(e))` from `warn(e)`.
- The lesson that keeps recurring in this package: removing a callback removes the things it did on the way
  past. ADR 0022 took out the interactive login and, with it, the formatting nobody was thinking about.
