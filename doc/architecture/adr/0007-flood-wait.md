# 0007 — Make FLOOD_WAIT visible without changing the error

## Context

`FLOOD_WAIT` is the error that matters most for a userbot: the README warns that flooding gets accounts
limited or banned, and it was the least visible failure in the package.

GramJS handles it in `client/users.js`:

```js
else if (e instanceof errors.FloodWaitError || e instanceof errors.FloodTestPhoneWaitError) {
    if (e.seconds <= client.floodSleepThreshold) {
        client._log.info(`Sleeping for ${e.seconds}s on flood wait (Caused by ${request.className})`);
        await sleep(e.seconds * 1000);
    } else {
        state.finished.resolve();
        throw e;
    }
}
```

So below the threshold (default 60s) the flow simply appears to hang for up to a minute with no status
change, and above it the error surfaced through `nodeDone` with nothing on the canvas to explain it.
The threshold itself was not configurable, so a user who wanted to fail fast could not.

## Decision

**Expose `floodSleepThreshold`** as a config-node option, omitted when unset so the library default
applies. `0` is a meaningful value — never sleep, fail immediately — so emptiness cannot be a falsy
check; `lib/client-params.js` parses it explicitly and rejects anything that is not a finite
non-negative number, falling back to the default rather than handing GramJS a `NaN`. The editor
validates the range separately.

**Report the wait, do not repackage the error.** The sender detects `FloodWaitError` (imported from
`telegram/errors` — verified exported, an `Error`, with a numeric `.seconds`) and sets a yellow
`flood wait Ns` status, then hands the **original** error to `nodeDone` unchanged. A Catch node may
well be reading `err.seconds`, so this had to be an addition rather than a replacement. Yellow because,
unlike the red states, the connection is fine — Telegram is throttling it.

The status reverts to whatever the connection last reported once the wait elapses, which means the node
has to remember that "steady" status rather than recompute it. A connection change **outranks** a
pending flood wait and cancels its timer: it says something about the client itself, not about
throttling. The timer is `unref()`ed so a long wait cannot keep the process alive, and cleared on close
so it cannot write to a closed node.

## Two things the issue asked for that turned out not to be needed

**The login error formatter already preserves the wait time.** The issue claimed `seconds` was lost.
Checked against a real error:

```
seconds: 42   code: 420   errorMessage: FLOOD
message: A wait of 42 seconds is required (caused by auth.SendCode)
```

and the existing formatter's first branch produces
`Error 420 (FLOOD): A wait of 42 seconds is required (caused by auth.SendCode)`. The wait is in the text
via `error.message`. Nothing was changed here — a formatter that works did not need touching.

**There is no hook for the below-threshold sleep.** `floodSleepThreshold` is consulted in exactly one
place, and GramJS reports the sleep only through `client._log.info(...)`. There is no event to subscribe
to, so a `node.warn` on a silent sleep is not implementable without patching the library. Worth knowing:
because the config node sets the log level to `warn` by default, that line is not even printed —
enabling **verbose logging** raises the level to `debug` and surfaces GramJS's own message. That is
documented in the node help as the way to see silent throttling.

## Consequences

- Throttling above the threshold is visible on the canvas; below it, verbose logging is the answer.
- `flood wait Ns` is a new status text. Additive, like `broken` (ADR 0006) and `invalid filter`
  (ADR 0005); the existing `connected` / `disconnected` texts are untouched public API.
- A flood wait of many minutes leaves the status showing until it elapses or the connection changes,
  which is the intent — it is the only signal the user gets that a send did not go out.
- Verified by reversing each half: removing the `FloodWaitError` check fails one sender test, and
  replacing the explicit emptiness test with a falsy check fails the zero-threshold test. Note the first
  attempt at that second counter-test did **not** fail, because the assertion only covered the string
  `'0'`, which is truthy; the test now asserts numeric `0` as well, which is what actually pins the
  behaviour down.
