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
- Target Node.js >= 22.13.
- Avoid `var` — use `const`, or `let` only when the binding is reassigned (enforced by `no-var` / `prefer-const`).
- One statement per line — don't pack multiple instructions onto a single line; keep lines simple to read (enforced by `max-statements-per-line`).
- Keep functions short, with a single exit:
    - **One exit per function.** A function leaves in exactly one place: its last statement. This
      includes guard clauses — an early `return` in a precondition check is still a second exit and is
      not allowed. Assign to a single result and return it as the last statement. `throw` is the one
      permitted exception, because it is not a return and a `finally` still runs.
    - **Validate by nesting, not by leaving.** State the precondition as the condition that must hold
      and put the work inside it, with the error path in the `else`. Where the caller is code, `throw`
      instead; where the caller is a Node-RED flow, the `else` calls the error path.
    - **Keep functions short enough that the nesting does not matter.** The objection to nesting is
      really an objection to long functions — at a readable length, one or two levels of indentation
      cost nothing. If the nesting starts to hurt, extract a function; never add a second exit.
    - **Most likely case first within each branch**, so a reader meets what the function normally does
      before the exceptions.
    - **If every path must do trailing work, put that work in `finally`** rather than repeating it
      before each exit — combined with the single exit this makes the epilogue unskippable.
- No defensive programming. Do not check for states that cannot occur, and do not guard against
  hypothetical future changes to code you control. Validate input at the boundary and then trust it.

## Shared: Tests

- Node's built-in test runner (`node --test`) + `node-red-node-test-helper`. Tests live in `test/` as `*.test.js`.
  Import `{ describe, it }` from `node:test` and assert with `node:assert`. Coverage via `c8`.
- Node's default discovery runs **every** `.js` under `test/`, whatever it is named, so shared helpers and
  fixtures belong outside that directory (e.g. `test-helpers/`). The test script deliberately takes no path
  arguments: a bare directory is read as a module specifier on Node 22 ("Cannot find module"), and keeping
  helpers out of `test/` is the simpler rule. A glob (`node --test 'test/**/*.test.js'`) does work on the
  supported range and a repo may scope discovery that way if it prefers.
- The test script deliberately has **no `--test-force-exit`**. It calls `process.exit()` as soon as the last
  test finishes, racing libuv's teardown of undici keep-alive sockets and mock HTTP servers — on Windows that
  aborts the process _after_ the results are in, so the runner marks a whole file failed while every test in
  it passed (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`). A suite that exits on its own has
  also _proved_ it leaks no handles, which the flag hides. If the suite ever stops exiting, find the open
  handle — don't reinstate the flag.
- A node file exports `function (RED) {…}`, so without a RED object its contents cannot run at all —
  which is why node files tend to sit at 0% coverage. **Fix that structurally, not with a fake runtime.**
  Almost nothing in such a closure needs `RED`: move it into a plain module beside the node file and test
  it directly, with `nock` intercepting the requests so the assertion is about what actually went to the
  device rather than what a parser intended. What remains in the node file is glue — `createNode`,
  `getNode`, status calls, handler registration.
- Where a test does need a Node-RED shape, **mock the node object, not the RED runtime**: keep the
  dispatcher as `handleInput(node, msg)` and hand it a plain object capturing `status` / `warn` /
  `error` / `send`. Such a mock is repo-specific — keep it in `test-helpers/`, local to the repo. The
  standard deliberately ships no shared RED harness; a shared one invites tests to reach business logic
  through it, which is what leaves the logic in the closure.
- Still keep one **wiring test** for the node file, with a minimal RED stub inline in that test file:
  otherwise nothing loads the node file and a wrong `require` path passes CI and fails at Node-RED start.
- Discovery is repo-wide: `node --test` runs `**/*.test.?(c|m)js` anywhere outside `node_modules`, so a
  sample spec under `examples/` is executed too. Name those files something else.

## Shared: Documentation

- `README.md` is user-facing. Architecture docs live under `doc/architecture/`
  (`overview.md`, `structural-design.md`, `behavioural-design.md`, `adr/`).
- Update `CHANGELOG.md` (Keep a Changelog style) for every user-visible change; bump the
  patch version in `package.json` in the same commit.

## Shared: Workflow

- CI (`.github/workflows/node.js.yml`) must pass: lint, format:check, test, coverage. The coverage
  report is uploaded as a build artifact, so a threshold failure can be inspected from the run.
- Releases go through `.github/workflows/npm-publish.yml`, triggered by pushing a version tag (`v*` /
  `V*`). **Pushing a tag publishes** — there is no second confirmation and `npm publish` is
  irreversible. The `verify` job is the whole safety margin: it re-runs lint, format:check and test on
  the CI matrix, and `publish-npm` declares `needs: verify`. A release is cut from a tag, and nothing
  guarantees that tag points at a commit CI ever saw.
- The tag must agree with `package.json`; `verify` fails otherwise. npm publishes the manifest version,
  not the tag name, so a mismatch publishes the wrong number under a tag that lies about it — and burns
  the intended number for good.
- A semver pre-release tag (`v1.2.3-beta.1`) publishes to the `beta` dist-tag, so Manage Palette users
  tracking `latest` are not pulled onto it. The workflow creates the GitHub release itself with
  generated notes, so `git push --tags` is the whole release.
- `.github/workflows/standards-check.yml` runs `nrstd audit` and fails the build on drift from the standard.
- Never bump the major version without an ADR explaining the breaking change.

## Shared: package.json scripts

`lint`, `lint:fix`, `format`, `format:check`, `test` (`node --test` with `--test-timeout=30000 --test-concurrency=1`, no path args), `coverage` / `coverage:check` (c8 over `npm test`).

The `c8` block carries `reporter: ["text", "lcov"]` — CI uploads `coverage/lcov.info`, and without the
lcov reporter that step ships nothing. Coverage threshold **values** are the repo's own call; `nrstd
sync` never sets or changes them.

But `c8.lines` must be stated, and `audit` checks that it is: c8 defaults `lines` to **90** (branches,
functions and statements default to 0), so a repo that states nothing runs a 90% gate nobody chose.
Omitting the other three reads as "no gate" and is fine. Pick `lines` from the current measurement,
rounded down.

<!-- END node-red-standards:managed -->

## Project-specific rules

<!-- Repo-specific rules go here. `nrstd sync` never touches this section. -->

This package is a Telegram **client** (userbot / selfbot) built on
[teleproto](https://github.com/sanyok12345/teleproto) and MTProto. It is **not** the Telegram Bot API —
that is `node-red-contrib-telegrambot`. Do not reach for `node-telegram-bot-api` idioms, webhooks, or
`getUpdates` here; the client is a long-lived connection.

teleproto is a maintained fork of GramJS, which was archived in 2026. The API is the same one GramJS
had, so its documentation and answers still transfer — but do not assume it: the fork has diverged
(no `useWSS`, no exported `sanitizeParseMode`, a second emitter for the `broken` connection state).
Check `node_modules/teleproto` before relying on anything you remember about GramJS, and never add
`telegram` back as a dependency — `test/dependencies.test.js` fails if you do.

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
- `authParams.password` must be a **function**, even when the password is already known: teleproto calls
  it (`await authParams.password(hint)`). `passwordSource` in `lib/login.js` is what guarantees that —
  passing the string through aborted every re-login of a 2FA account, see
  [ADR 0026](doc/architecture/adr/0026-one-login-step-at-a-time.md).
- The dialog asks for one thing at a time and posts nothing out of turn, driven by `loginStage` in
  `telegrambot.html`. It is testable: `test-helpers/editor-dialog.js` runs the shipped editor script
  against a stand-in for jQuery, so a change to the login panel can be asserted rather than clicked
  through. The QR login shares the password field, so anything that hides it has to account for that.

### Sessions are credentials, and they are account-wide

The login exists only to produce a session string, stored in the config node's `session` credential.
It authenticates the **user account**, not a bot — treat it like a password. Never log it, never put it
in a `msg`, never add it to a test fixture. Tests must run without one (no credentials means no client,
which is exactly what keeps the suite offline).

The runtime path only ever restores a stored session. If a change makes deploy-time code prompt for
anything, that change is wrong.

"Never put it in a `msg`" means **nothing that can reach it**, not just the string itself. teleproto hangs
the client on every event it builds (`event._client = client`), and the client owns `session._authKey` — so
passing an event straight through put the session in every message, and Node-RED's debug sidebar printed
it. Every node send therefore goes through `hideClientReferences` from `lib/hide-client.js`, which makes
those references non-enumerable; see [ADR 0025](doc/architecture/adr/0025-keep-the-client-out-of-msg.md).
If you add a node, or a new send path in an existing one, it needs the same treatment — and when you put a
library object in a `msg`, ask what the library hung on it.

### Proxy support

The proxy is built once in the config node from the `useproxy` fields and passed straight into the
`TelegramClient` options — teleproto handles both SOCKS (`socksType`) and MTProxy (`MTProxy` +
`secret`). `lib/client-params.js` is what builds those options.

The `deviceModel` / `systemVersion` / `appVersion` fields may be passed empty. This rule used to say they
had to be **omitted** when empty so that teleproto would apply its own defaults — that was wrong.
teleproto's defaults set all three to `''` and then fall back on any falsy value
(`clientParams.deviceModel || os.type().toString() || 'Unknown'`), so absent and empty are the same to it.
The code no longer pretends otherwise.

There is no `useWSS` any more. `usewss` survives in the editor's `defaults` so saved flows round-trip,
but nothing reads it — see [ADR 0013](doc/architecture/adr/0013-migrate-to-teleproto.md).

### Node contract is public API

Node type names (`telegram client config` / `receiver` / `sender`), credential field names (all
lowercase: `apiid`, `apihash`, `session`, `phonenumber`, `bottoken`, `twofapassword`), admin route
paths, `msg.payload` shapes, and the `connected` / `disconnected` status texts are all load-bearing for
existing user flows. Changing any of them is a breaking change and needs an ADR.

The editor's `credentials` block in `telegrambot.html` and the one passed to `RED.nodes.registerType`
must list **exactly** the same names. Node-RED persists only what the runtime declares, so anything the
editor offers but the runtime omits is silently discarded on deploy — that was the bug in
[ADR 0004](doc/architecture/adr/0004-persist-bot-token-and-2fa-password.md).
`test/registration.test.js` is what guards this; a node-level test cannot, because
`helper.load(nodes, flow, credentials)` writes to the helper's store directly and bypasses the filter.

Note `password` is a _config_ property holding the SOCKS proxy password, while the account's
two-step-verification password is the `twofapassword` credential. They used to share both a name and a
DOM element id. Do not merge them again.

All six event types share one payload shape: `msg.payload.type` names the event and `msg.payload.event`
carries it. Raw events used to be the exception — the update went straight into `msg.payload` and the name
into `msg.type` — which 2.0.0 corrected, see
[ADR 0027](doc/architecture/adr/0027-symmetric-raw-events.md). `msg.type = 'Raw'` is still set, because it
is the check most existing flows use. A seventh event type must use the same shape; there is no longer an
exception to copy.

### Testing against Telegram

Anything past the parameter check in `lib/login.js` and the connect in `lib/telegram-client.js` needs a
real account. Do not add tests that connect. Fake the client instead — see `test/nodes.test.js`, which
stubs `getTelegramClient` to assert which event handlers get subscribed and removed.
