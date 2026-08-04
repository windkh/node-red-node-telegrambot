# 0023 — Put the reason for a failed connect in the node status

## Context

[ADR 0022](0022-never-log-in-at-deploy-time.md) made a failed connect report the real authorization error
instead of starting a login. That fixed what the runtime _does_; this is about what the user _sees_.

Every node ended its `start()` the same way:

```js
const client = await node.config.getTelegramClient(node);
if (client) {
    node.status(CONNECTED);
} else {
    node.status(DISCONNECTED);
}
```

So a revoked session, a wrong api hash, a missing login and a network outage all produced the identical red
ring reading `disconnected`. The reason existed — `createTelegramClient` had it — but it only ever went to
`warn`, which means the only way to find out was to open the log.

## Decision

**`warn` and `fail` are separate channels, because they mean different things.**
`createTelegramClient(options, warn, fail)`: `warn` is for notes that do not stop the connect — an unknown
parse mode, a bot config with no token — and `fail` is for the reason there is no client at all. Recording
every `warn` as "the failure" would have been simpler and wrong, since a parse-mode note would then become
the node's status.

Both stay plain callbacks, which is what keeps `lib/` free of `RED`.

**The config node remembers the last reason and clears it on success.** `configNode.lastFailure` — nodes
read it in the branch where they already knew there was no client, so nothing new is plumbed through the
status-listener mechanism. Clearing it matters: a reason left from an earlier attempt would keep being shown
by every node that asks, long after the problem was fixed.

**A filled dot, not a ring.** `disconnected` keeps the ring because it comes from the connection-state
stream and heals itself. A failed connect needs somebody to do something, which is the same distinction
`broken` already makes.

**The text prefers a remedy, then Telegram's code, then the message.** `shortFailureReason` in
`lib/auth-error.js`, alongside `describeAuthError`, which writes for a log and has no width limit:

| Telegram says           | The status says                  |
| ----------------------- | -------------------------------- |
| `AUTH_KEY_UNREGISTERED` | `session invalid: login again`   |
| `SESSION_REVOKED`       | `session revoked: login again`   |
| `API_ID_INVALID`        | `api id or hash is wrong`        |
| `USER_DEACTIVATED_BAN`  | `account banned`                 |
| anything unrecognised   | the code itself, truncated to 40 |

The mapping only covers codes where the code alone leaves the user guessing. Everything else passes through
**as the code**, deliberately: `SOMETHING_NEW` is searchable and can be pasted into an issue, which "error"
cannot. Truncation is at 40 characters with an ellipsis, so a long network error cannot push the label off
the canvas.

## Two mistakes this took

Worth recording, because both looked like working code.

**I wrote the reason onto the wrong object.** The fail callback did `node.lastFailure = reason` — and inside
`createTelegramClient` and `getTelegramClient`, `node` is the **calling receiver or sender**, not the config
node. The file's own header comment warns about exactly that shadowing, and I walked into it anyway. The
status silently stayed generic. There is now a `configNode` alias that nothing shadows, and the comment says
why it exists.

**I tested one node and thought I had tested the feature.** Reverting the sender failed a test; reverting the
download node did not. Same gap that shipped two different `broken` texts in 1.0.0
([ADR 0015](0015-share-the-node-status-plumbing.md)). `test/node-status.test.js` now drives the reason
through **every** node that shows a status.

## Consequences

- A red status names its cause. `no session: login first` for a config that was never logged in,
  `session invalid: login again` for one whose session died, the Telegram code for anything else.
- Green as soon as a client exists, unchanged — and the recorded reason is dropped at the same moment.
- `createTelegramClient` takes a third argument. It has exactly one caller outside the tests.
- Ten reversals, all failing a test. Three did not until the coverage above was added: clearing on success,
  the four non-sender nodes, and the thrown-error path as distinct from the no-session path.
