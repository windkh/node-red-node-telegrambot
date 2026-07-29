# 0001 — Split the monolithic entry file into nodes/ and lib/

## Context

All three node types, the interactive login, and the three admin routes lived in a single 611-line
`telegrambot/telegrambot.js`, inside one `module.exports = function (RED)` closure. Nothing could be
tested without a Node-RED runtime, and the client-construction logic was duplicated between the
interactive login and the runtime connect.

The shared standard (`node-red-standards`) requires `lib/` for framework-independent logic and
`nodes/` for one file per node type, with the registered entry file as a thin delegator.

## Decision

Split along the existing seams, without changing runtime behaviour:

- `nodes/config-node.js`, `nodes/receiver-node.js`, `nodes/sender-node.js` — one file per node type.
- `nodes/login-endpoints.js` — the three `RED.httpAdmin.get` routes. They need `RED`, so they cannot
  live in `lib/`, but they are editor-time support rather than node behaviour and therefore do not
  belong in `config-node.js` either.
- `lib/login.js`, `lib/telegram-client.js`, `lib/client-params.js`, `lib/auth-prompt.js` — no `RED`.
- `telegrambot/telegrambot.js` stays the path registered in `package.json` and only requires and calls
  the four `nodes/` modules, in the original registration order.

Two consequences of moving code out of the `RED` closure were resolved as follows:

- `createTelegramClient` warned through `node.warn` and swallowed every error. Rather than restructure
  the error handling, `lib/telegram-client.js` takes a `warn` callback. A plain function keeps the
  module framework-independent and the move stays behaviour-preserving.
- The duplicated `clientParams` construction (identical in login and connect, including the rule that
  empty optional version fields must be omitted so GramJS applies its own defaults) became
  `lib/client-params.js`.

`telegrambot.html` is **not** split. Node-RED loads the `.html` sitting next to the registered entry
file as one document; splitting it would require a build step, which this package does not have.

## Consequences

- `lib/` is unit-testable without Node-RED; `nodes/` is testable through `node-red-node-test-helper`.
  A test suite now exists where there was none.
- Node type names, credential names, admin route paths, `msg` shapes, and status texts are unchanged —
  existing flows and stored credentials keep working. `package.json` still points at
  `telegrambot/telegrambot.js`.
- The entry file no longer matches the standard's `<pkg>/99-<name>.js` naming. Renaming it would change
  the path in `package.json` and was judged not worth the churn for an established package.
- Anything past the parameter check in `lib/login.js` and the connect in `lib/telegram-client.js` needs
  a real Telegram account, so those paths stay uncovered by tests. Coverage thresholds in
  `package.json` are set to reflect that rather than to a number the suite cannot honestly reach.
