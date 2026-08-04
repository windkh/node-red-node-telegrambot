# Migration guide

## 2.0.0 — raw events use the same payload shape as the rest

One change, and only if your flow handles **raw events**. Nothing else about 2.0.0 is breaking: node types,
credentials, config properties, the other five event shapes and the sender's payload are all unchanged.

Five of the six event types always named themselves in `msg.payload.type` and carried the event in
`msg.payload.event`. Raw events did neither — the update went straight into `msg.payload`. Now they match:

```js
// before
{ type: 'Raw', payload: { pts: 474, className: 'UpdateNewMessage', … } }

// 2.0.0
{ type: 'Raw', payload: { type: 'Raw', event: { pts: 474, className: 'UpdateNewMessage', … } } }
```

### What you have to change

| If your flow does this           | Change it to                           |
| -------------------------------- | -------------------------------------- |
| `msg.payload.className`          | `msg.payload.event.className`          |
| `msg.payload.updates`, `.pts`, … | `msg.payload.event.updates`, `.pts`, … |
| `msg.type === 'Raw'`             | nothing — it still works               |

`msg.type` is deliberately kept, so a flow that only tests which kind of event arrived needs no edit at all.
The one thing that moved is reading a field **out of** the update: put `.event` in the path.

**Why break it.** A Function node that switches on `msg.payload.type` had to carry a special case for raw
updates, and one that forgot looked correct until a raw update arrived — which is exactly how the shipped
`EchoMessage` example came to throw `Cannot read properties of undefined`. See
[ADR 0027](doc/architecture/adr/0027-symmetric-raw-events.md).

Raw events are off by default, so if you never ticked that box there is nothing to do.

---

## 1.0.0 — from GramJS to teleproto

Version 1.0.0 replaces the MTProto library underneath these nodes. [GramJS](https://github.com/gram-js/gramjs)
was archived on GitHub in 2026 and will not receive another fix, so the package now uses
[teleproto](https://github.com/sanyok12345/teleproto), a maintained fork of it.

**Your stored session keeps working. You do not have to log in again.** That is the short version, and
for most flows it is the whole story.

If you install from npm you are almost certainly on **0.1.6**, which is the last version published there.
Everything after it — including this one — is a bigger jump than the library swap alone, so read
[§ Coming from 0.1.6](#coming-from-016) as well.

---

### What you have to do

| Coming from        | What is needed                                                              |
| ------------------ | --------------------------------------------------------------------------- |
| **0.1.11 – 0.3.0** | Nothing. Update the package and redeploy.                                   |
| **0.1.7 – 0.1.10** | Two manual steps. See [Coming from 0.1.6](#coming-from-016).                |
| **0.1.6 or older** | The same two steps, and **Node.js 20 or newer** — 0.1.7 raised the minimum. |

Nothing about the **flow** changes in any case: node types, wiring, `msg.payload` shapes and the config
node's properties are all the same. You do not have to touch, re-create or re-import anything.

---

### Why the session survives

This is the question that decided whether 1.0.0 could be a drop-in at all, so it is worth stating what
was actually checked rather than asking you to take it on trust.

teleproto's `StringSession` uses GramJS's format unchanged: the same `"1"` version marker and the same
`dcId ‖ addressLength ‖ address ‖ port ‖ authKey` byte layout. A session string produced by GramJS was
loaded by teleproto and saved again, and the other way round, with a real authorization key. Both
round-trips came back byte-identical.

So the string sitting in your `session` credential is still a valid session, and the runtime restores it
exactly as before. Nobody has to enter a phone code again.

---

### The three things that did change

#### The **Use WSS** checkbox is gone

teleproto has no `useWSS` option, and removing it costs nothing, because in Node the option never did
what its name suggests. It did not select a WebSocket transport — that comes from a different setting
which Node-RED never changed. All `useWSS` did was pick port 443 instead of 80 for a session that had no
stored data centre yet, and refuse to start at all when combined with a proxy.

teleproto uses port 443 unconditionally, so the one useful thing the option did is now simply the
default.

There is nothing for you to do. The stored `usewss` value stays in your flow file and is ignored; the
input row is no longer in the dialog.

<details>
<summary>If you had ticked it</summary>

You would have noticed, because the box only appeared once **Use proxy** was on — and GramJS refused to
start with both, raising `Cannot use SSL with proxies`. If your proxy config works today, the box was
not ticked.

</details>

#### The `broken` node status reads differently

Before: `session invalid: login again`. Now: `broken: login again or redeploy`.

The status still means the same thing — this connection is not coming back on its own, which is why it is
a filled dot and not a ring — but the old text named the wrong cause half the time. GramJS reported
`broken` only for an unusable authorization key. teleproto also reports it when a reconnection attempt
fails outright, and that is not an invalid session.

If you match on the status text anywhere (a Status node feeding a comparison, for instance), update the
string. `connected` and `disconnected` are unchanged.

#### Formatting modes are validated by the new library

Nothing visible: the accepted values are still `md`, `markdown`, `md2`, `markdownv2` and `html`. Listed
only because the check moved inside the library, so an unusual hand-edited value could in principle
behave differently. If you set **Parse mode** through the dialog you are unaffected.

---

### Coming from 0.1.6

0.1.6 is what `npm install node-red-node-telegrambot` gave you until now, and the jump to 1.0.0 crosses
a lot more than the library swap. Two of those changes need something from you.

#### Bot token and 2FA password

In 0.1.6 the config dialog offered a **Bot-Token** field and a **Password** field for two-step
verification, but the runtime declared neither as a credential — and Node-RED persists only what the
runtime declares. Both values were therefore **discarded on every deploy**. Bot mode could not work at
runtime at all, which is what [#17](https://github.com/windkh/node-red-node-telegrambot/issues/17)
fixed.

Nothing of yours is lost, because nothing was ever stored. But:

- **If you use bot mode**, open the config node, enter the bot token again and log in. This time it is
  kept.
- **If your account has two-step verification**, enter the password again under the login panel when you
  next log in.

#### The proxy password may be holding your account password

0.1.6 had two inputs with the same DOM id `node-config-input-password` in one dialog: the account
password under the login panel, and the SOCKS proxy password under the proxy options. Only the first of
the two was ever read, so anything you typed as your **account** password was stored as the **proxy**
password, and the proxy password field did nothing.

If you had entered an account password and also use a proxy:

1. Open the config node and expand **Proxy Options**.
2. Clear the **Password** field there, or replace it with the real proxy password.
3. Enter your account password under **Password** in the login panel instead, where it is now stored as
   its own `twofapassword` credential.

If you never entered an account password, or do not use a proxy, there is nothing to do.

#### Things you get for free

No action needed for any of these; they are listed so the new behaviour is not a surprise. Each one has a
full entry in [CHANGELOG.md](CHANGELOG.md).

| Change                                                                                                | Version |
| ----------------------------------------------------------------------------------------------------- | ------- |
| Sender node no longer resolves a pending Promise into `msg.payload` — you get the real result         | 0.1.8   |
| Sender node reports failures instead of dropping messages, so Catch and Complete nodes work           | 0.1.9   |
| The client is torn down on redeploy, so redeploys stop leaking live sessions and duplicating messages | 0.1.10  |
| Receiver filters: chats, direction, senders, text pattern                                             | 0.1.12  |
| Live connection status on receiver and sender                                                         | 0.1.14  |
| `FLOOD_WAIT` visible as a node status, with a configurable threshold                                  | 0.1.15  |
| Parse mode (Markdown / MarkdownV2 / HTML), off by default                                             | 0.1.17  |
| New `telegram client download` node for media on received messages                                    | 0.1.19  |
| New `telegram client upload` node for a Buffer or a path                                              | 0.1.20  |
| Inline keyboards from a JSON `buttons` description                                                    | 0.2.1   |

Two of them are worth a second look:

- **Redeploys behaved differently before.** Up to 0.1.9 every redeploy left the previous client
  connected and subscribed. If you built anything around receiving each message more than once, that
  will now stop happening.
- **Your credentials are no longer shown back to you.** Since 0.2.0 the api hash, session, bot token and
  2FA password are `password`-typed credentials, so the runtime tells the editor only _that_ they are
  set. The fields show a `__PWRD__` placeholder. This is display only — the stored values are untouched,
  and leaving a field alone keeps what is stored. Only type in one if you want to replace it.

---

### Messages missed while Node-RED was down

New in 1.4.0 and **off by default**: **Catch up** on the config node. Every version so far has simply lost
messages that arrived while Node-RED was stopped, and that stays the behaviour until you switch this on.

Before you do, note that switching it on after a long stop means the whole backlog arrives at once. See
[the README section](README.md#catching-up-after-a-restart).

### Peers addressed by numeric id

New in 1.3.0 and **off by default**, including for you after this upgrade: **Remember peers** on the config
node. Without it, a peer addressed by a bare numeric id only resolves while it is in the in-memory cache,
which every restart clears — the behaviour every version so far has had.

If your flows address peers by username or invite link, ignore this. If they use numeric ids, read
[the README section](README.md#remembering-peers-across-a-restart) before switching it on: it writes this
account's session key to a directory on disk, outside Node-RED's encrypted credentials file.

### If you scripted against the admin endpoints

The three endpoints behind the Login button — `node-red-node-telegrambot-login`, `-setphonecode` and
`-setpassword` — changed from `GET` to `POST` in 0.2.0. The paths are unchanged; the parameters moved
from the query string into a JSON body, so they stop appearing in reverse-proxy access logs and browser
history.

This affects nobody who uses the config dialog.

---

### If something is wrong after upgrading

| Symptom                           | Likely cause                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `broken: login again or redeploy` | Either the session really is invalid — log in again — or a reconnection gave up. Redeploy first; if it returns, log in again.                                            |
| `No session: login first.`        | The `session` credential is empty. It was not lost in the upgrade — sessions carry over — so check whether the config node was re-created or its credentials cleared.    |
| Bot mode does nothing             | The bot token was never stored before 0.1.11. Enter it again. See [above](#bot-token-and-2fa-password).                                                                  |
| The proxy stopped authenticating  | Its password field was inert before 0.1.11 and may hold the wrong value. See [above](#the-proxy-password-may-be-holding-your-account-password).                          |
| Fields show `__PWRD__`            | Expected since 0.2.0. The stored secrets are intact; the editor is no longer shown them.                                                                                 |
| `Could not find the input entity` | Not related to the upgrade. A bare numeric peer id only resolves while that peer is in the session's in-memory cache, which a restart clears. Address peers by username. |

If a flow that worked on 0.1.6 does not work on 1.0.0, please open an issue with the Node-RED log and
the version you came from.

---

### Details

- [ADR 0013](doc/architecture/adr/0013-migrate-to-teleproto.md) — the migration, what was verified and
  what diverged.
- [ADR 0014](doc/architecture/adr/0014-release-as-1-0-0.md) — why this is 1.0.0.
- [CHANGELOG.md](CHANGELOG.md) — every change, per version.
