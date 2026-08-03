# Changelog

All notable changes to this project will be documented in this file.

# [1.0.1] - 2026-08-03

### changed authentication failures to be reported through the Node-RED log instead of `console.log` on stdout, so they carry the node context and respect the configured log level - [#33](https://github.com/windkh/node-red-node-telegrambot/issues/33)

### audited what those two lines were putting in the log, which is what #33 was filed for: nothing sensitive. teleproto's `RPCError` keeps only the request's class name and never stores the request itself, so the phone number, api hash and phone code cannot reach a log line. Pinned by a test using the real `Api.auth.SignIn` request object

### note: the message shown in the config dialog after a failed login is unchanged

# [1.0.0] - 2026-08-03

### **first release published to npm since 0.1.6.** Everything between the two existed only in git, so this upgrade brings twenty-odd changelog entries at once - two of them need a manual step. Read [MIGRATION.md](/MIGRATION.md) before upgrading

### moved the MTProto library from GramJS to [teleproto](https://github.com/sanyok12345/teleproto). `gram-js/gramjs` was archived on GitHub and will not be fixed again; teleproto is a maintained fork of it - [#34](https://github.com/windkh/node-red-node-telegrambot/issues/34)

### your stored session keeps working. The session string format is unchanged, so nobody has to log in again after the upgrade

### changed the `broken` node status text from `session invalid: login again` to `broken: login again or redeploy`. teleproto reports `broken` for a failed reconnect as well as for an unusable session, so the old text pointed at the wrong remedy half the time

### removed the **Use WSS** checkbox. It only ever chose port 443 over 80 for a brand-new session and could not be combined with a proxy; teleproto always uses 443. Existing flows are unaffected and keep the stored value

# [0.2.1] - 2026-08-02

### added button support to the sender node: a plain-JSON `buttons` description in the options object is turned into the objects Telegram needs, since a Function node cannot build them itself. An invalid button is reported with its position - [#27](https://github.com/windkh/node-red-node-telegrambot/issues/27)

### note: callback buttons only work in bot mode. Telegram sends the press to the bot that created the button, so a user account never receives it and the receiver's Callback query event stays silent. Use `url` buttons for userbot flows

# [0.2.0] - 2026-08-01

### fixed the api hash, bot token and two-step-verification password being sent to the editor in clear text. All secret credentials are now `password`-typed, so the runtime hands the editor only a "this is set" flag. The stored values are untouched, but the editor no longer shows them back - [#31](https://github.com/windkh/node-red-node-telegrambot/issues/31)

### fixed the login sending the api hash, phone number, 2FA password and bot token as URL query parameters, where they reach reverse-proxy access logs, browser history and Referer headers. The three login endpoints are now `POST` and carry their values in the body - [#31](https://github.com/windkh/node-red-node-telegrambot/issues/31)

### **breaking:** the admin endpoints `node-red-node-telegrambot-login`, `-setphonecode` and `-setpassword` changed from `GET` to `POST`. The paths are unchanged. These back the Login button in the config dialog, so this only affects anyone who scripted against them directly

# [0.1.20] - 2026-08-01

### added a `telegram client upload` node that sends a Buffer or a file path to a chat, so `file in` and `http request` can feed it directly. `msg.filename` is required for a Buffer: without a name Telegram would receive the file called `unnamed`, so the node reports an error rather than sending it wrongly - [#23](https://github.com/windkh/node-red-node-telegrambot/issues/23)

# [0.1.19] - 2026-08-01

### added a `telegram client download` node that fetches the media on a received message. Wire it to a receiver output: the bytes land in `msg.payload`, the name in `msg.filename` and the original message in `msg.telegram`, so `file out` and `http response` follow directly. A configurable size limit refuses large downloads instead of reading them into memory - [#22](https://github.com/windkh/node-red-node-telegrambot/issues/22), [#9](https://github.com/windkh/node-red-node-telegrambot/issues/9)

# [0.1.18] - 2026-08-01

### added an explanation when Telegram cannot resolve a peer. The original error still reaches Catch nodes unchanged; the node now also warns why it happened - a numeric id only works while the peer is in the session's entity cache, which is lost on restart. Addressing peers by username avoids it entirely - [#24](https://github.com/windkh/node-red-node-telegrambot/issues/24)

# [0.1.17] - 2026-08-01

### added a parse mode option on the config node (Markdown, MarkdownV2, HTML) so message text can be formatted. Off by default: switching it on changes how every message this client sends is interpreted, and any text the flow did not write itself then has to be escaped. `parseMode` can also be set per message instead - [#26](https://github.com/windkh/node-red-node-telegrambot/issues/26)

# [0.1.16] - 2026-08-01

### documented the client methods reachable from the sender node, the two calling conventions and their different args shapes, and the warning that connection and authentication methods disrupt every node sharing the config - [#29](https://github.com/windkh/node-red-node-telegrambot/issues/29)

# [0.1.15] - 2026-07-30

### added a configurable flood wait threshold on the config node. Waits up to this many seconds are slept through silently, longer ones are reported. Default stays 60 seconds; 0 never sleeps - [#20](https://github.com/windkh/node-red-node-telegrambot/issues/20)

### added a `flood wait Ns` status on the sender node when Telegram throttles a send. The original error still reaches Catch nodes unchanged, so `err.seconds` keeps working - [#20](https://github.com/windkh/node-red-node-telegrambot/issues/20)

# [0.1.14] - 2026-07-30

### fixed the client giving up permanently after five failed connection attempts: connectionRetries is no longer pinned to 5, so GramJS' own default applies and a brief outage no longer kills a receiver until the next redeploy - [#19](https://github.com/windkh/node-red-node-telegrambot/issues/19)

### added live connection status on the receiver and sender nodes. They used to set connected once and show it forever; a dropped connection and a recovery are now both visible without enabling raw events - [#19](https://github.com/windkh/node-red-node-telegrambot/issues/19)

### added a distinct status for an invalid session (`session invalid: login again`). Telegram reports this only for an unusable authorization key, where reconnecting cannot help and a new login is required - [#19](https://github.com/windkh/node-red-node-telegrambot/issues/19)

# [0.1.13] - 2026-07-30

### fixed the session string being sent to the editor in clear text: it is now a `password` credential, so the runtime hands the editor only a "has a session" flag. The session authenticates the whole Telegram account

# [0.1.12] - 2026-07-29

### added filters to the receiver node: chats (with an exclude option), direction, from users and a text pattern. Filtering happens in Telegram's event builders, so unwanted traffic never reaches the flow. Leaving the fields empty keeps the previous behaviour - [#18](https://github.com/windkh/node-red-node-telegrambot/issues/18)

# [0.1.11] - 2026-07-29

### fixed the bot token and the two-step-verification password never being stored, because the editor declared credentials the runtime did not - bot token login now works at runtime - [#17](https://github.com/windkh/node-red-node-telegrambot/issues/17)

### fixed the proxy password sharing an input field with the account password: the account password is now the `twofapassword` credential and `password` is the proxy password alone. If you had entered an account password, it will appear prefilled in the proxy password field - clear it there and re-enter it under Password in the login panel - [#17](https://github.com/windkh/node-red-node-telegrambot/issues/17)

### changed the runtime to select user or bot authentication from the configured login mode instead of from the presence of a stored token, so a leftover token can no longer hijack a user-mode config - [#17](https://github.com/windkh/node-red-node-telegrambot/issues/17)

# [0.1.10] - 2026-07-29

### fixed the telegram client never being torn down, so every redeploy left another live session connected and subscribed - likely cause of duplicated messages after a redeploy - [#16](https://github.com/windkh/node-red-node-telegrambot/issues/16)

### fixed the receiver node logging in again while shutting down, because stop() went through getTelegramClient which creates a client when none is cached - [#16](https://github.com/windkh/node-red-node-telegrambot/issues/16)

# [0.1.9] - 2026-07-29

### fixed the sender node silently dropping messages when the payload, the config node or the client was missing - now each case is reported so it reaches a Catch node - [#15](https://github.com/windkh/node-red-node-telegrambot/issues/15)

### fixed the sender node never completing the Node-RED message lifecycle, which broke the Complete node and message tracing - [#15](https://github.com/windkh/node-red-node-telegrambot/issues/15)

# [0.1.8] - 2026-07-29

### fixed the sender node not awaiting client methods, which put a pending Promise into msg.payload and hid every error from Catch nodes - [#14](https://github.com/windkh/node-red-node-telegrambot/issues/14)

### fixed msg.payload.args defaulting to an object on the client-method path, which threw a TypeError instead of calling the method with no arguments - [#14](https://github.com/windkh/node-red-node-telegrambot/issues/14)

# [0.1.7] - 2026-07-29

### changed minimum nodejs version to 20

### split the monolithic node file into telegrambot/nodes/ and telegrambot/lib/ — no behaviour change

### added a test suite (node:test + node-red-node-test-helper) and architecture docs

# [0.1.5] - 2024-01-14

### added devicemodel, systemversion appversion as optional parameters - [#7](https://github.com/windkh/node-red-node-telegrambot/issues/7)

# [0.1.4] - 2023-10-15

### added further filters - [#3](https://github.com/windkh/node-red-node-telegrambot/issues/3)

### added client api - [#5](https://github.com/windkh/node-red-node-telegrambot/issues/5)

# [0.1.3] - 2023-10-12

### added proxy support - [#2](https://github.com/windkh/node-red-node-telegrambot/issues/2)

# [0.1.2] - 2023-10-09

### added raw events

# [0.1.1] - 2023-10-08

### login with bot token added - [#1](https://github.com/windkh/node-red-node-telegrambot/issues/1)

## [0.1.0]

### Added readme and examples, tested echo flow

## [0.0.5]

### Added sender node and examples

## [0.0.3]

### Added simple login button in config node to ease login.

## [0.0.2]

### Receiver node can receive messages from a user

## [0.0.1]

### initial

**Note:** The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
