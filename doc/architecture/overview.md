# Overview

`node-red-node-telegrambot` exposes a Telegram **client** (userbot / selfbot) to Node-RED. It talks
MTProto through [teleproto](https://github.com/sanyok12345/teleproto) and acts under a real Telegram user account — it is
deliberately _not_ the Telegram Bot API, which is what `node-red-contrib-telegrambot` covers.

## Node types

| Node                       | Purpose                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `telegram client config`   | Holds the credentials and owns the single shared `TelegramClient`.     |
| `telegram client receiver` | Subscribes to Telegram events and emits one Node-RED message each.     |
| `telegram client sender`   | Calls a teleproto client method or a raw MTProto request from a `msg`. |

## Runtime model

One `TelegramClient` per config node, created lazily on first use and shared by every receiver and
sender that references it. Telegram allows only a limited number of concurrent sessions per account,
so nodes must never open their own connection — they always go through
`configNode.getTelegramClient(node)`.

Authentication is split in two:

- **Interactive login** happens once, in the editor, and only produces a session string
  (`lib/login.js`). It needs a phone code and possibly a 2FA password, which the user can only supply
  after the login has already started — hence the admin HTTP API in `nodes/login-endpoints.js`.
- **Runtime connect** restores that stored session string without any user interaction
  (`lib/telegram-client.js`). This is the only path a deployed flow uses.

## Operational caveat

A userbot acts as the account owner. Flooding or abuse gets the _account_ limited or banned, not just
the bot. Develop against a test account.

## Further reading

- [Structural design](structural-design.md) — modules and their responsibilities.
- [Behavioural design](behavioural-design.md) — the runtime flows.
- [ADR log](adr/README.md) — recorded decisions.
