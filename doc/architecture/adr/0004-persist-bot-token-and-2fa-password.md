# 0004 — Persist the bot token and the 2FA password, and select auth by login mode

## Context

The editor offered a Bot-Token field and a two-step-verification password field, and neither value was
ever stored. `telegrambot.html` declared six credentials; `config-node.js` declared four. Node-RED only
persists credentials declared on the **server** side, so `bottoken` and `password` were silently
discarded on every deploy. `this.botToken` was therefore always `undefined`, and
`lib/telegram-client.js` — which picked its auth path with `if (botToken === undefined)` — always took
the user path, even for a config set to bot mode. It happened to work while the stored session stayed
valid, because GramJS `start()` checks `checkAuthorization()` first; once the session lapsed it tried to
sign in as a _user_ with an empty phone number. Bot-token login was requested in issue #1; this is the
half of it that never worked at runtime.

Investigating the `password` name turned up something worse than a naming clash. `password` was declared
in **both** the editor's `defaults` (the SOCKS proxy password) and its `credentials` (the account's 2FA
password), and the template contained **two input elements with the same id**
`node-config-input-password` — one in the login panel, one in the proxy panel. Node-RED binds a
`defaults`/`credentials` key to `#node-config-input-<key>`, and an id selector resolves to the first
match, so:

- the proxy password input was inert: never populated, never read;
- `n.password`, which feeds `this.proxy.password`, received whatever was typed into the **2FA** field;
- the login request sent that same value as both the 2FA password and the proxy password
  (`telegrambot.html` read the one element twice, once for each purpose).

## Decision

**Rename the credential, not the config property.** The 2FA credential becomes `twofapassword` with its
own input id; `password` stays the proxy config property and its input id becomes unique.

The deciding argument is what each name has stored. The 2FA credential was never declared server-side,
so **nothing was ever persisted under it** — renaming it costs no data. `n.password` _is_ stored in
existing flow files, so renaming that would have discarded every configured proxy password. Credential
field names are public API per `AGENTS.md`, but a credential that was never written is not in use.

Consequence to be aware of: an existing `n.password` holds whatever the user typed into the 2FA field,
and that value will now appear in the proxy password field. Both are secrets belonging to the same user
and stay local, but the value is in the wrong box until they correct it.

**Select the auth path by `loginMode`, not by the presence of a token.** With the token finally
persisted, `if (botToken === undefined)` would have introduced a fresh hazard: a token left over from
experimenting with bot mode survives a switch back to user mode, and would silently hijack the auth.
`lib/telegram-client.js` now branches on `options.loginMode === 'bot'`, which is also what
`lib/login.js` already does. For user configs this reproduces today's behaviour exactly, including when
a stale token is present; only bot configs change, and they change to what they were always meant to do.
Bot mode with no stored token now warns `Login mode is bot but no bot token is stored: log in again.`
instead of failing as a user login with an empty phone number.

`botToken` is read as `this.credentials.bottoken || undefined`, so an empty stored token stays
`undefined` rather than becoming `''`.

`loginMode` became a closure constant next to `deviceModel` / `systemVersion` / `appVersion` instead of a
tenth positional argument to `createTelegramClient`, whose signature is already too long.

## Consequences

- Bot-token login works at runtime, and the 2FA password survives a deploy.
- The proxy password works for the first time.
- Users who had typed a 2FA password will find it prefilled in the proxy password field, and must
  re-enter it under Password in the login panel. This is the migration cost of separating the two.
- The registration test is the real guard for the credential declaration:
  `helper.load(nodes, flow, credentials)` feeds the helper's store directly and bypasses the
  server-side filter, so a node-level test cannot detect a missing declaration. Verified by removing
  the declaration again — only `test/registration.test.js` fails.
- The auth-path branch itself is still not unit-tested: `lib/telegram-client.js` constructs a real
  `TelegramClient`, so covering the branch offline would need the client factory injected. That is the
  same documented limitation as for `lib/login.js` and is why that file sits near 48% coverage.
