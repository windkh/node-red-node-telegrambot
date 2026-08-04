# Changelog

All notable changes to this project will be documented in this file.

# [2.0.0] - 2026-08-04

### **breaking:** raw events now use the same payload shape as every other event type - `msg.payload.type` is `'Raw'` and `msg.payload.event` is the update. Before this the update sat directly in `msg.payload`, so a Function node switching on `msg.payload.type` needed a special case for raw updates, and one that forgot looked correct until a raw update arrived. `msg.type = 'Raw'` is still set, so only reading a field **out of** the update changes: `msg.payload.className` becomes `msg.payload.event.className`. See [MIGRATION.md](/MIGRATION.md) and [ADR 0027](doc/architecture/adr/0027-symmetric-raw-events.md)

### raw events are off by default and support no filters, so this affects the smallest group of flows of the six event types

### documented the payload shape of all six event types in the README and in the receiver's node help, which had never stated it

# [1.7.8] - 2026-08-04

### fixed the `EchoMessage` example throwing `TypeError: Cannot read properties of undefined (reading 'className')` on every update. Its Function node reached into `msg.payload.message`, which four of the receiver's six payload shapes do not have - raw events, deleted messages, albums and callback queries. It now switches on `msg.payload.type`

### the example also enabled no event type at all, so an import received nothing until the user ticked a box - which is how the raw path, and the crash, were found. It now ships with **New messages** on and **Direction: incoming only**, without which the receiver sees the message the sender just sent and the flow echoes its own echo, forever

### note edited messages are no longer echoed. The old condition matched them too, so a correction was replayed as a new message

### new `test/examples.test.js`: every example is parsed, every Function node compiled, and every flow fed by a receiver has to survive all six payload shapes

# [1.7.7] - 2026-08-04

### fixed a login being cancelled when a two-step-verification password was already in the field. teleproto **calls** `authParams.password`, and a password that was already known was passed through as a string - so the call threw `authParams.password is not a function` into `onError`, which aborts, and the dialog reported `AUTH_USER_CANCEL`. Since Node-RED fills a stored password field with `__PWRD__` itself, **every re-login of an account with two-step verification failed** unless the field was cleared first. That is what made it look like a rule about the order of entry

### changed the login panel to ask for one thing at a time: after **Login** only the code is asked for, with a tip that says leaving the field is what submits it; the password appears afterwards and only if it is still needed. A password that came with the login request is used instead of asked for again, and nothing is posted while the server is not waiting for it. See [ADR 0026](doc/architecture/adr/0026-one-login-step-at-a-time.md)

### the editor dialog is now testable: `test-helpers/editor-dialog.js` runs the shipped editor script against a stand-in for jQuery. It caught that hiding the password field by default would have broken the **QR** login, which has no code step but shares the same password prompt

# [1.7.6] - 2026-08-04

### changed the config dialog so the session field and the login buttons come directly above "Device Model". The optional client parameters added since 0.1.x had grown to seven rows and pushed the one control the dialog exists for below the fold

# [1.7.5] - 2026-08-04

### fixed the session leaking into every message a node sent. teleproto hangs the client on every event it builds (`event._client = client`), and the client owns `session._authKey` - which authenticates the whole Telegram account - next to the api id and hash. Node-RED's debug sidebar printed it: the event wrappers `NewMessageEvent` and `UpdateConnectionState` have no `toJSON`, so the encoder followed the reference all the way to the auth key. Attaching a debug node and copying the output into a bug report published the account

### the reference is now non-enumerable rather than removed, so `message.reply()`, `download()`, `getSender()` and the `client` getter keep working while no serialiser can see it. Applied to the receiver's six event types, the sender's result, the upload node's sent message and both list modes. See [ADR 0025](doc/architecture/adr/0025-keep-the-client-out-of-msg.md)

### if you have ever pasted a debug output of one of these nodes anywhere, treat the session as compromised: end the session in Telegram under Settings, Devices, and log in again

# [1.7.4] - 2026-08-04

### removed a dead link from the README and from the config node's help. It pointed at a third-party website that would generate a session string for you, and it now 404s. It is not replaced: a session string authenticates the whole Telegram account, so producing one on someone else's site means handing over the phone number, the login code and the account with them. Both routes in the config node - phone code and QR - keep it on your own machine

# [1.7.3] - 2026-08-04

### changed an expired session to be logged as one line instead of a seven-frame stack trace of teleproto internals. The behaviour was already right - the error is reported rather than a login started - but it read like a crash, which is how it was reported. A failure that is genuinely a bug still keeps its stack

# [1.7.2] - 2026-08-04

### fixed a typo in the receiver node: the checkbox read "Albums (list of mesages)"

# [1.7.1] - 2026-08-04

### fixed the sender node giving no hint when a **username** could not be resolved. teleproto has two different messages for an unresolvable peer and only one was matched, so the explanation added in #24 never appeared for a misspelled or placeholder username - including the `"to username"` left in the SendMessage example flow

### the two cases now get different advice, because the old text says "a username always works" - which is exactly wrong when the username is what Telegram could not find

# [1.7.0] - 2026-08-03

### changed a failed connect to show **why** on the node status instead of a generic `disconnected`: `no session: login first`, `session invalid: login again`, `api id or hash is wrong`, or Telegram's own error code for anything else. A red filled dot, because unlike a dropped connection this one needs you to do something. It turns green as soon as a connection works

# [1.6.1] - 2026-08-03

### fixed a deploy being able to trigger a Telegram login code. When the stored session was no longer valid, the runtime connect passed a phone number to the client, which sent the account a login code and only then failed with `Code is empty` and `AUTH_USER_CANCEL` - and it did that again on every redeploy, which is how an account earns a `FLOOD_WAIT` on the code endpoint. A stale session now reports the real reason instead, and the deploy path cannot start a login at all

### note bot mode is unchanged: re-authorising from a bot token is a single silent request and stays. Only the interactive user login was ever the problem, and it belongs to the editor

# [1.6.0] - 2026-08-03

### fixed the download node's **Max size** limit understating a photo, often badly. Only one of Telegram's five photo-size variants carries a plain size, and the largest entry of a real photo is usually one of the others - measured on a realistic photo, the node reported 90 KB for a 4.5 MB download, so a 1 MB limit let it through. Photos that only offer progressive sizes reported nothing at all and skipped the check entirely

### added download progress (`downloading 42%`) and cancellation: a redeploy now stops a download in flight instead of letting it stream into a closed node. The upload node has had both since 1.2.0

### changed `deviceModel` / `systemVersion` / `appVersion` to be passed through even when empty. They were being omitted on the stated grounds that an empty string would override teleproto's defaults; it does not, and the checks that enforced that did nothing. Nothing changes on the wire

# [1.5.0] - 2026-08-03

### added a **Login with QR** button to the config node: scan a code with a Telegram app that is already signed in instead of waiting for a phone code. Two-step verification uses the same password field as before, and both routes produce the same session string - [#28](https://github.com/windkh/node-red-node-telegrambot/issues/28)

### the code is rendered on the server and refreshed every half minute until it is scanned, so the editor needs no QR library. Adds one small dependency, `qrcode-generator` (MIT, no dependencies of its own)

### added the admin routes `node-red-node-telegrambot-loginqr` and `-loginqrstatus`. The three existing login routes are unchanged

# [1.4.0] - 2026-08-03

### added a **Catch up** option to the config node. With it on, the position in the update stream is remembered, and messages that arrived while Node-RED was stopped or redeploying are fetched on the next start and emitted through the receiver as if they had just come in - [#21](https://github.com/windkh/node-red-node-telegrambot/issues/21)

### replayed messages travel the same path as live ones, so flows need no changes and cannot tell them apart

### it is **off by default**: after a long outage on a busy account the whole backlog arrives at once. Note also that Telegram decides how far back it will replay, and that a message may be delivered twice around the boundary - most duplicates are filtered, but a flow that must not act twice should be idempotent

# [1.3.0] - 2026-08-03

### added a **Remember peers** option to the config node. With it on, resolved peers are kept on disk, so a chat or user addressed by a bare numeric id keeps working after a restart instead of failing with `Could not find the input entity` - [#32](https://github.com/windkh/node-red-node-telegrambot/issues/32)

### it is **off by default, and should stay off unless you need it**: the directory it uses also holds this account's session key, which otherwise lives only in Node-RED's encrypted credentials file. Anyone who can read the directory can act as your account. Flows that address peers by username never needed this

### the store lives in `<user directory>/telegram-sessions/<node id>`, is seeded from the session credential on first use, and is discarded and rebuilt if you log in again with a different account

# [1.2.0] - 2026-08-03

### added album support to the upload node: an array in `msg.payload` is sent as one album, with `msg.filename` as an array of names aligned by index. A wrong item names its position and the whole album is refused rather than half of it being sent - [#23](https://github.com/windkh/node-red-node-telegrambot/issues/23)

### added a `Silent` option and `msg.silent` to the upload node, and `msg.replyTo` for replying to a message - [#23](https://github.com/windkh/node-red-node-telegrambot/issues/23)

### added upload progress to the node status (`uploading 42%`), and a redeploy now cancels an upload still in flight instead of letting it push bytes into a closed node - [#23](https://github.com/windkh/node-red-node-telegrambot/issues/23)

### fixed a `msg.filename` of `null` being accepted for a Buffer, which named the file `null` in the chat. It is now reported like a missing name

# [1.1.0] - 2026-08-03

### added a `telegram client list` node that reads message history, dialogs (the chat list) and the participants of a chat. These use Telegram's async-iterator APIs, which the sender node cannot usefully expose - it would put an iterator object into `msg.payload` - [#25](https://github.com/windkh/node-red-node-telegrambot/issues/25)

### the node emits one message per item by default, with `msg.parts` set so a standard join node reassembles the array. A large history therefore never has to fit in memory. An array mode is available for small reads, where it also sets `msg.total`

### note the limit: blank means **100**, and `0` means no limit. Telegram's own default is unbounded, which on a busy channel reads it back to the first message and is a realistic way to earn a `FLOOD_WAIT` on a user account

# [1.0.2] - 2026-08-03

### fixed the download and upload nodes still showing the old `session invalid: login again` status for a broken connection. 1.0.0 corrected that text in the receiver and sender only, so two nodes disagreed with the other two about a status a flow can route on

### changed the node statuses to live in one module instead of being declared in each node, which is why the above could happen at all. No status text changed as part of this

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
