# AGENTS.md — node-red-node-telegrambot

<!-- BEGIN node-red-standards:managed (do not edit — run `nrstd sync`) -->

> These shared rules are maintained centrally in **node-red-standards** and refreshed here by
> `nrstd sync`. Do not edit between the managed markers — change the standard instead. Everything
> below the managed block (the "Project-specific rules" section) is yours and is never overwritten.

## Shared: Architecture

- Node packages are modular: `lib/` holds framework-independent, unit-testable core logic;
  `nodes/` holds one file per Node-RED node; `icons/` holds node icons.
- The registered entry file (`<pkg>/99-<name>.js`) is a thin delegator that only `require`s and
  registers the modules in `nodes/`. Keep runtime glue thin.
- Record non-trivial design decisions as an ADR in `doc/architecture/adr/`.

## Shared: Code style

- Lint: ESLint flat config (`eslint.config.js`), ESLint >= 10. Run the lint script before committing.
  `eslint` and `@eslint/js` must stay on the same major: `@eslint/js@10` peers on `eslint@^10`, and
  pairing `eslint@10` with `@eslint/js@9` silently keeps the v9 recommended rule set.
- ESLint 10's recommended set adds `no-unassigned-vars` and `no-useless-assignment`. Both are errors:
  don't declare a binding only to pass `undefined` around, and don't assign a value no later
  statement reads.
- Format: Prettier (`.prettierrc.json`) — 4-space indent, single quotes, es5 trailing commas.
- Target Node.js >= 20.
- Avoid `var` — use `const`, or `let` only when the binding is reassigned (enforced by `no-var` / `prefer-const`).
- One statement per line — don't pack multiple instructions onto a single line; keep lines simple to read (enforced by `max-statements-per-line`).
- Keep functions short, and read top to bottom in order of likelihood:
    - **Preconditions first.** Check arguments at the top and leave immediately — throw where the
      caller is code, or call the error path where the caller is a Node-RED flow.
    - **Then the most likely case.** The happy path belongs directly after the preconditions, not at
      the bottom behind every exceptional branch. A reader should not have to scroll past the rare
      cases to find out what the function is for.
    - **One exit from the body.** Once real work has started, do not return from the middle of it.
      Assign to a single result and return it as the last statement.
    - **If every path must do trailing work, put that work in `finally`** rather than repeating it
      before each exit — an exit that skips the epilogue is the defect this rule exists to prevent.
- No defensive programming. Do not check for states that cannot occur, and do not guard against
  hypothetical future changes to code you control. Validate input at the boundary and then trust it.

## Shared: Tests

- Node's built-in test runner (`node --test`) + `node-red-node-test-helper`. Tests live in `test/` as `*.test.js`.
  Import `{ describe, it }` from `node:test` and assert with `node:assert`. Coverage via `c8`.
- Node's default discovery runs **every** `.js` under `test/`, whatever it is named, so shared helpers and
  fixtures belong outside that directory (e.g. `test-helpers/`). The test script deliberately takes no path
  arguments: a `'test/**/*.test.js'` glob would need Node >= 21 and fails on Node 20, which is still supported.

## Shared: Documentation

- `README.md` is user-facing. Architecture docs live under `doc/architecture/`
  (`overview.md`, `structural-design.md`, `behavioural-design.md`, `adr/`).
- Update `CHANGELOG.md` (Keep a Changelog style) for every user-visible change; bump the
  patch version in `package.json` in the same commit.

## Shared: Workflow

- CI (`.github/workflows/node.js.yml`) must pass: lint, format:check, test, coverage.
- Releases go through `.github/workflows/npm-publish.yml`.
- Never bump the major version without an ADR explaining the breaking change.

## Shared: package.json scripts

`lint`, `lint:fix`, `format`, `format:check`, `test` (`node --test` with `--test-force-exit --test-timeout=30000 --test-concurrency=1`, no path args), `coverage` / `coverage:check` (c8 over `npm test`).

<!-- END node-red-standards:managed -->

## Project-specific rules

<!-- Repo-specific rules go here. `nrstd sync` never touches this section. -->

This package is a Telegram **client** (userbot / selfbot) built on [GramJS](https://gram.js.org/) and
MTProto. It is **not** the Telegram Bot API — that is `node-red-contrib-telegrambot`. Do not reach for
`node-telegram-bot-api` idioms, webhooks, or `getUpdates` here; the client is a long-lived connection.

See [doc/architecture/overview.md](doc/architecture/overview.md) for the layout and
[behavioural-design.md](doc/architecture/behavioural-design.md) for the flows.

### One client per config node

The config node owns the `TelegramClient` and hands it out via `getTelegramClient(node)`, which creates
it lazily and caches it. Telegram limits concurrent sessions per account, so never construct a client
anywhere else — receiver and sender always ask the config node.

### The login flow spans three requests

Telegram's interactive login needs a phone code that only exists after the login has started, so it
cannot be one call. `lib/auth-prompt.js` parks the resolve/reject of a pending promise as module state;
`…-setphonecode` / `…-setpassword` settle it later. When touching this:

- Keep the resolvers as module state. The three admin requests share nothing else, and only one login
  runs at a time.
- An **empty** phone code or password must reject, not resolve — that is how the editor aborts a login.
- The `…-login` response stays open until a session exists. Errors go to the `error` callback and come
  back as `{ type: 'error', error }`; never let a login failure reject the HTTP request.

### Sessions are credentials, and they are account-wide

The login exists only to produce a session string, stored in the config node's `session` credential.
It authenticates the **user account**, not a bot — treat it like a password. Never log it, never put it
in a `msg`, never add it to a test fixture. Tests must run without one (no credentials means no client,
which is exactly what keeps the suite offline).

The runtime path only ever restores a stored session. If a change makes deploy-time code prompt for
anything, that change is wrong.

### Proxy support

The proxy is built once in the config node from the `useproxy` fields and passed straight into the
`TelegramClient` options — GramJS handles both SOCKS (`socksType`) and MTProxy (`MTProxy` + `secret`).
`useWSS` is independent of it. The optional `deviceModel` / `systemVersion` / `appVersion` fields must
be **omitted** when empty rather than passed as `''`, so GramJS applies its own defaults; that is what
`lib/client-params.js` is for.

### Node contract is public API

Node type names (`telegram client config` / `receiver` / `sender`), credential field names (all
lowercase: `apiid`, `apihash`, `session`, `phonenumber`), admin route paths, `msg.payload` shapes, and
the `connected` / `disconnected` status texts are all load-bearing for existing user flows. Changing
any of them is a breaking change and needs an ADR.

Note the raw-event asymmetry: raw events emit `msg.type = 'Raw'` at the top level, while all other
events use `msg.payload.type`. This is inconsistent but intentional — do not "fix" it silently.

### Testing against Telegram

Anything past the parameter check in `lib/login.js` and the connect in `lib/telegram-client.js` needs a
real account. Do not add tests that connect. Fake the client instead — see `test/nodes.test.js`, which
stubs `getTelegramClient` to assert which event handlers get subscribed and removed.
