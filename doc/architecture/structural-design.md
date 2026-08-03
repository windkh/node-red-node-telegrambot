# Structural design

```
telegrambot/
  telegrambot.js            registered entry point — requires and registers the nodes/ modules
  nodes/
    login-endpoints.js      admin HTTP API backing the editor's "Login" button
    config-node.js          telegram client config — owns the shared TelegramClient
    receiver-node.js        telegram client receiver — event subscriptions
    sender-node.js          telegram client sender — client calls and raw MTProto requests
    download-node.js        telegram client download — media from a received message
    upload-node.js          telegram client upload — send a Buffer or a path as a file
  lib/
    login.js                interactive login, produces a session string
    telegram-client.js      runtime connect from a stored session string
    client-params.js        TelegramClient constructor options, shared by both of the above
    auth-prompt.js          deferred phone-code / password promises
    login-credentials.js    resolves the editor's __PWRD__ placeholder against storage
    event-filters.js        receiver filter config -> per-builder teleproto options
    media.js                media descriptor -> filename, mime type, download size
    upload.js               Buffer -> CustomFile, so an upload arrives correctly named
    reply-markup.js         JSON button description -> teleproto Button objects
  telegrambot.html          editor definitions and help for all five nodes
  icons/
```

## Responsibilities

**`telegrambot.js`** — the path in `package.json` under `node-red.nodes`. It only `require`s the
`nodes/` modules and calls them with `RED`. Registration order matters: the config node has to be
registered before the nodes that reference it.

**`nodes/`** — everything that needs `RED`. Node constructors read their config, resolve the config
node, set `node.status`, and send messages. `login-endpoints.js` is separate from `config-node.js`
because it is editor-time support (three `RED.httpAdmin.get` routes), not runtime node behaviour.

**`lib/`** — no `RED`, no Node-RED types, unit-testable on its own. Where a Node-RED concern has to
reach in, it arrives as a plain function: `createTelegramClient` takes a `warn` callback rather than a
node.

## Why login and connect are separate modules

`lib/login.js` and `lib/telegram-client.js` both build a `TelegramClient`, but for opposite purposes:
login starts from an _empty_ `StringSession` and is interactive; connect starts from a _stored_ session
and must never prompt. The genuinely shared part is the constructor options, which is exactly what
`lib/client-params.js` holds — that is the whole reason it exists as its own file.

## The HTML file is not split

`telegrambot.html` still defines all three nodes. Node-RED loads the `.html` next to the registered
entry file as one document, so splitting it would need a build step. See
[ADR 0001](adr/0001-modular-layout.md).
