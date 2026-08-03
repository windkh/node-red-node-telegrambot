# 0020 — QR-code login, rendered on the server

## Context

The phone-code login is the most fragile part of the package: three admin requests, a held response, and a
code the user has to paste before Telegram's own timeout. Repeated attempts also earn a `FLOOD_WAIT` on
the code endpoint. Issue #28 asked for the alternative — scan a QR code in a Telegram app that is already
signed in.

## What the library gives us

`signInUserWithQrCode` does more than the issue expected. It loops `auth.ExportLoginToken`, calls a
`qrCode` callback with **each** token (a fresh one about every 30 seconds — `QR_CODE_TIMEOUT`), waits on
the `UpdateLoginToken` that says it was scanned, follows `LoginTokenMigrateTo` to another data centre, and
falls through to `signInWithPassword` on `SESSION_PASSWORD_NEEDED`. It also takes an `abortSignal`.

Two consequences: **two-step verification needs no new plumbing** — it uses the same password prompt as
the phone-code flow, so the existing `-setpassword` route and password field serve both. And **the token
refresh the issue called "the real work" is the library's**; what remains is getting each new token to the
editor.

## Decisions

### Two routes, and the response is not held open

`-loginqr` starts the login and answers `{ type: 'started' }` immediately. The editor then polls
`-loginqrstatus`, which answers `waiting`, `qr`, `session`, `error` or `idle`.

The phone-code flow holds its response until a session exists. That cannot work here: the point is to push
a **replacement** token when the old one expires, and one response can only answer once. Polling was the
issue's own suggestion and it is right. It also makes this flow simpler than the one it sits next to —
nothing is parked waiting for a request that may never come.

### The QR is rendered on the server

This was the one real fork. The issue was explicit that a new runtime dependency for an editor-only
convenience is a poor trade, and offered a hand-rolled encoder or just showing the link.

A hand-rolled encoder is a few hundred lines of Reed-Solomon and bit placement, and **whether a phone
camera reads the result is not something any test here can tell us.** Shipping unverifiable
bit-manipulation into the editor is worse than the dependency it avoids. Showing only the link is not a QR
login.

So: `qrcode-generator`, which is **MIT, 4.6 kB unpacked and has no dependencies of its own**, and it is
called **server-side** — `createSvgTag()` returns an `<svg>` string that rides along in the poll response.
That is what makes the trade acceptable: no browser library, no route serving a static asset, no vendored
code, one small dependency used in one place. The editor sets `innerHTML` and is done.

The link is offered alongside the picture, for anyone on a machine where Telegram is installed.

`scalable: true` matters and is easy to get wrong: it **removes** the fixed `width`/`height`, and the
`viewBox` is emitted either way — so a test asserting the viewBox proves nothing. The test asserts the
absence of the fixed size, which is what lets the code fill the dialog.

### One login at a time, enforced rather than assumed

`lib/auth-prompt.js` parks its password resolver in module state on the documented assumption that only
one login runs at a time, and a QR login needs that prompt too. So a second attempt **replaces** the
first: `lib/qr-session.js` aborts the running one before starting the next.

A replaced run then reports its own abort failure, after the fact. It lands nowhere, because each attempt
owns its own state object and `status()` only ever reads the current one.

**That last paragraph is a correction.** The first version had a `current === state` check inside every
callback, and a comment claiming the abort and the check were both necessary. Trying to break it showed
the check was unfalsifiable: a stale run can only write to its own dead object, so removing the check
changed nothing any test could see. It was a guard against a state that cannot occur, which `AGENTS.md`
forbids, and it is gone. The property is still asserted — as a property, so it survives a change of
mechanism.

### A five-minute backstop

The editor has no reliable "the user closed me" signal. `oneditsave` / `oneditcancel` stop the polling, but
a browser tab that vanishes stops nothing server-side, and the login would keep asking Telegram for tokens.
The `abortSignal` teleproto accepts exists for this; five minutes is long enough to fetch a phone and short
enough that a forgotten dialog is not still working an hour later.

## Consequences

- Two new admin route paths, which are public API per `AGENTS.md`. `test/registration.test.js` asserts the
  exact list and was updated; the existing three are untouched.
- One new runtime dependency, `qrcode-generator`. First non-teleproto dependency this package has had.
- `lib/qr-session.js` takes the login function as a parameter rather than requiring it. That is what lets
  the replace-and-abort rules be tested without an account — and they needed it: with the state machine
  inline in the route, two of the reversals could not be made to fail.
- Two-step verification works through the existing password field with no new route.
- Eleven reversals, all failing a test.
- Not done: no cancel route. Stopping the poll and letting the backstop fire is enough, and a fourth route
  for it would be a path in the public API to maintain forever.
