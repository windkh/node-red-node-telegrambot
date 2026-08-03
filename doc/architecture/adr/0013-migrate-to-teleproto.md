# 0013 — Move from GramJS to teleproto

## Context

`gram-js/gramjs` is **archived** on GitHub. Its last push was 2026-07-14 and it now carries 323 open
issues that nobody can close. Every MTProto detail this package depends on — the connection loop, the
session format, the TL layer — sits in a repository that will not receive another fix, including for a
protocol Telegram keeps changing.

[teleproto](https://github.com/sanyok12345/teleproto) is a fork of GramJS taken in 2025 and developed
independently since (MIT, npm `teleproto`, 1.228.5 at the time of writing, last push the day this was
written). Issue #34 proposed it.

## The question that decided this

A userbot session is expensive to replace: it needs an interactive login with a phone code, and on some
accounts a 2FA password. If the migration invalidated stored sessions, every user would have to log in
again on upgrade — which turns a dependency swap into a breaking change.

**It does not.** teleproto's `StringSession` keeps GramJS's wire format exactly: same `CURRENT_VERSION`
marker `"1"`, same `dcId ‖ addressLength ‖ address ‖ port ‖ authKey` layout. Verified both directions
with a real `AuthKey`:

```
gramjs -> teleproto -> save   identical: true
teleproto -> gramjs -> save   identical: true
```

The only difference is that teleproto's session loads lazily — `_authKey` is built in `load()`, which
`_initSession` awaits — so a `save()` before `load()` returns `""`. Nothing in this package calls
`save()` on a session it did not create, so that is invisible here.

## Decision

Swap the dependency and repoint the eighteen require paths. Everything this package imports exists in
teleproto under the same subpath: `teleproto`, `/errors`, `/network`, `/events`, `/events/*`,
`/sessions`, `/tl/custom/button`, `/client/uploads`.

Node type names, credential names, admin routes, `msg.payload` shapes and the `connected` /
`disconnected` status texts are untouched.

## What actually differs, and what was done about it

Three things. A mechanical find-and-replace would have shipped all three as silent defects.

### 1. `useWSS` is gone — and it never did what its name says

GramJS's `useWSS` had exactly two effects, and neither was a WebSocket transport in Node:

```js
if (this.useWSS && this._proxy) { throw new Error("Cannot use SSL with proxies…"); }
this.session.setDC(DEFAULT_DC_ID, …, this.useWSS ? 443 : 80);
```

The transport comes from `networkSocket`, which GramJS defaults to `PromisedNetSockets` whenever
`isNode`. In Node-RED that is always. So ticking the box changed the initial DC port from 80 to 443 for
a session that had no stored DC yet, and forbade combining it with a proxy. That is all.

teleproto has no `useWSS` and hardcodes `const DC_PORT = 443`. The one thing the option did is now
unconditional, and the better of the two.

Worse: the checkbox lived inside the `#useproxy` block, which `oneditprepare` hides unless "Use proxy"
is ticked. It was therefore only reachable in precisely the configuration GramJS refused to start —
`Cannot use SSL with proxies` — and invisible in every configuration where it would have done its one
useful thing. Nobody has reported this, which says how much use it saw.

So the option is **dropped, not remapped**. teleproto can do real WebSockets via
`networkSocket: PromisedWebSockets`, and mapping the old checkbox onto that was tempting — but it would
change the transport of every config that ticked a box which never meant that. A genuine transport
choice is a new feature, not part of a migration.

`usewss` stays in the editor's `defaults` so saved flows round-trip unchanged; the input row is gone and
nothing reads the value.

### 2. `broken` has a second emitter now, so the status text was lying

GramJS emitted `UpdateConnectionState.broken` from exactly one place, `_handleBadAuthKey`. That is what
[ADR 0006](0006-connection-state.md) reasoned from, and why the status read `session invalid: login
again`.

teleproto emits it from two: `_handleBadAuthKey`, and `_reconnect` when the reconnect attempt itself
throws — which sets `_lifecycle = "dead"` and fails all pending requests. The second one is not an
invalid session, so the old text sends the user to fix the wrong thing.

What survives is the part the _shape_ encodes: both emitters leave that sender dead, so waiting will not
help and the filled dot is still right. Only the cause was over-specific. The text is now
`broken: login again or redeploy`.

This is the one user-visible behaviour change in the migration.

### 3. `sanitizeParseMode` is no longer exported

GramJS exported it from `telegram/Utils`; `test/parse-mode.test.js` used it to check our allow-list
against what the library really accepts. teleproto has it only as
`TelegramClient.prototype._sanitizeParseMode`.

The test now calls that private method. Reaching for a private in a test is normally wrong, but the
alternative is asserting our allow-list against a copy of the library's, which would agree with itself
forever while the real check drifted. It touches no instance state, so calling it unbound works; if that
ever stops being true the test fails, which is the outcome we want. The accepted values are unchanged
(`md`, `markdown`, `md2`, `markdownv2`, `html`), and it still throws on anything else.

## Verified unchanged

Claims this package's comments and node help make about the library, each re-checked against teleproto
rather than assumed to have survived the fork:

| Claim                                                                                                                             | Still true                  |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `while (!client._destroyed)` update loop, so `destroy()` is required ([ADR 0003](0003-destroy-the-client-on-close.md))            | yes, `client/updates.js`    |
| `"Could not find the input entity"` wording ([ADR 0008](0008-entity-resolution.md))                                               | yes, `client/users.js`      |
| `_fileToMedia` names a bare Buffer `"unnamed"` ([ADR 0010](0010-upload-node.md))                                                  | yes, `client/uploads.js`    |
| `incoming` / `outgoing` mutually exclusive ([ADR 0005](0005-receiver-event-filters.md))                                           | yes, `events/NewMessage.js` |
| `Raw` builder takes only `types` and `func`                                                                                       | yes, `events/Raw.js`        |
| `UpdateConnectionState` values (1 / -1 / 0)                                                                                       | yes                         |
| Proxy shape: `socksType` for SOCKS, `MTProxy` + `secret` for MTProxy                                                              | yes                         |
| Button factory asymmetry — inline factories return the TL object, keyboard factories a wrapper ([ADR 0012](0012-reply-markup.md)) | yes                         |

`TelegramClientParams` differs by exactly one removal (`useWSS`) and four additions
(`keepAliveInterval`, `reCaptchaCallback`, `downloadPool`, `entityCache`). None of the four is required.

## Consequences

- The package no longer depends on an archived library.
- **Stored sessions keep working.** No user has to log in again. This is a minor version, 0.3.0.
- `test/dependencies.test.js` is new and pins the swap: teleproto is declared, `telegram` is not a
  dependency of any kind, no source file requires it, and every module under `telegrambot/` loads. The
  last two matter because a stale `require('telegram/…')` is not necessarily loud — a leftover or
  hoisted `telegram` in `node_modules` would resolve it and quietly run two MTProto libraries at once.
- The old GramJS documentation still transfers for the most part, but is no longer authoritative.
  `AGENTS.md` says so explicitly, because the three divergences above are exactly the kind of thing
  remembered knowledge gets wrong.

## Not done here, worth knowing

teleproto adds things this package could use later, all out of scope for a migration:

- **`entityCache` client option** — [#32](https://github.com/windkh/node-red-node-telegrambot/issues/32)
  asks for a persistent entity cache, and GramJS had no hook for one.
- **`client.api.messages.sendMessage({…})` facade** — a second calling convention alongside
  `client.invoke(new Api.…)`. The sender node's two conventions ([ADR 0002](0002-await-the-client-method-path.md))
  could collapse into it, but that is a `msg.payload` contract change.
- **`catchUp` is no longer an empty stub**, which is what blocked
  [#21](https://github.com/windkh/node-red-node-telegrambot/issues/21). GramJS had literally
  `function catchUp() { /* TODO */ }`; teleproto delegates to a real `UpdateManager` that tracks
  `pts`/`qts` and fetches the common difference. It holds that state **in memory**, though, so #21
  still needs somewhere to persist it across a Node-RED restart — the hard half of that issue is
  smaller now, not gone.
