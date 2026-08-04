# 0022 — The runtime connect must not be able to start a login

## Context

Found by running the debug setup against a real account. A deploy produced this:

```
[warn] Telegram login failed: Code is empty
[warn] Error: AUTH_USER_CANCEL
    at Object.signInUser (teleproto/client/auth.js:224)
    at _authFlow (teleproto/client/auth.js:567)
    at Object.start (teleproto/client/auth.js:82)
    at createTelegramClient (telegrambot/lib/telegram-client.js:100)
    at TelegramConfigNode.getTelegramClient (telegrambot/nodes/config-node.js:207)
    at TelegramSenderNode.start (telegrambot/nodes/sender-node.js:83)
```

A node's `start()` — deploy time, no user watching a dialog — reached `signInUser`. `AGENTS.md` has said
since the modularisation that this must not be possible:

> The runtime path only ever restores a stored session. If a change makes deploy-time code prompt for
> anything, that change is wrong.

## What was actually happening

`client.start()` probes the session before anything else and returns immediately when it is valid, so the
normal case never came near this. When the probe fails, teleproto reads the auth params to decide what to
do — and `lib/telegram-client.js` was handing it a **`phoneNumber`**, which is the switch for the
interactive flow.

`signInUser` then does this, in this order:

```js
const sendCodeResult = await client.sendCode(apiCredentials, phoneNumber, ...);
...
if (typeof authParams.phoneCode === 'function') { phoneCode = await authParams.phoneCode(); }
if (!phoneCode) { throw new Error('Code is empty'); }
```

**`sendCode` comes first.** So a deploy with a stale session made Telegram send a real login code to the
account, and only then failed because no `phoneCode` callback was supplied. Every redeploy did it again —
which is precisely how an account earns a `FLOOD_WAIT` on the code endpoint, the risk issue #28 called out
for repeated interactive logins.

The user-visible part was a confusing pair of warnings. The invisible part was worse: unsolicited login
codes, and a rate limit building up on the account.

This is original behaviour, not something teleproto introduced — the same `authParams` shape was there
before the migration, and GramJS's `signInUser` sends the code first too. It survived this long because it
only fires when the session is invalid, which is exactly when nobody is looking closely.

## Decision

**User mode passes empty auth params.** With neither `phoneNumber` nor `botAuthToken`, teleproto's `start()`
throws the real reason instead of starting anything:

```js
if (!authParams || (!('phoneNumber' in authParams) && !('botAuthToken' in authParams))) {
    throw authError ?? new UnauthorizedError('Not authorized and no auth parameters were provided');
}
```

`AuthKeyUnregisteredError`, `SessionRevokedError`, `UnauthorizedError` — each of which says something true
about why the session did not work, and all of which reach the flow through the existing `warn`. That is
what a deploy should report.

**Bot mode keeps `botAuthToken`.** Re-authorising a bot from its token is one non-interactive request; it
sends the account nothing and cannot prompt. It is also how a bot is meant to sign in, so there is no
reason to make bot users log in again through the editor after a session expires.

**The `onError` callback is gone from this path.** Nothing interactive runs any more, so it could never
fire. Keeping it "just in case" would be a guard against a state that cannot occur — and worse, it would
read as though something interactive were still expected here.

`lib/login.js` and `lib/login-qr.js` keep theirs. Those are the editor's flows, they are _supposed_ to
prompt, and a user is watching.

## Consequences

- **A deploy can no longer cause Telegram to send a login code.** For anyone whose session had expired,
  that had been happening on every redeploy.
- A stale session now reports what is actually wrong instead of `Code is empty` / `AUTH_USER_CANCEL`. The
  node still shows `disconnected` and the flow still loads, as before.
- `lib/telegram-client.js` no longer needs `describeAuthError`; that import is gone with the callback.
- The tests that pinned "both onError callbacks route through warn" now say something stronger and more
  useful: the runtime path has **no** `onError` and **no** `phoneNumber`, so it cannot prompt at all. They
  are source-level assertions for the same reason as the rest of `test/auth-error.test.js` — reaching this
  code needs a real account, so there is nothing to drive offline.
- Four reversals, all failing a test, including both halves of the defect: putting the `phoneNumber` back,
  and reintroducing an interactive `onError`.

## What this does not fix

The two error strings teleproto uses for an unresolvable peer differ, and `nodes/sender-node.js` only
matches one of them:

| teleproto             | wording                                       | matched |
| --------------------- | --------------------------------------------- | ------- |
| `client/users.js:529` | `Could not find the input entity for …`       | yes     |
| `client/users.js:608` | `Cannot find any entity corresponding to "…"` | no      |

So the hint added in #24 does not appear for a username that cannot be resolved at all — only for the
cached-id case. Found in the same session, left alone here to keep this change to one thing.
