# Changelog

All notable changes to this project will be documented in this file.

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
