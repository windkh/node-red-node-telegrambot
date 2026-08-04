# ADR log

One file per decision: NNNN-title.md (Context / Decision / Consequences).

| ADR                                                | Decision                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| [0001](0001-modular-layout.md)                     | Split the monolithic entry file into nodes/ and lib/              |
| [0002](0002-await-the-client-method-path.md)       | Await the sender's client-method path                             |
| [0003](0003-destroy-the-client-on-close.md)        | Destroy the client on close, never create one while stopping      |
| [0004](0004-persist-bot-token-and-2fa-password.md) | Persist the bot token and 2FA password, select auth by login mode |
| [0005](0005-receiver-event-filters.md)             | Filter events in Telegram's builders, not downstream              |
| [0006](0006-connection-state.md)                   | Let GramJS reconnect; report the state it publishes               |
| [0007](0007-flood-wait.md)                         | Make FLOOD_WAIT visible without changing the error                |
| [0008](0008-entity-resolution.md)                  | Explain unresolvable peers instead of resolving them again        |
| [0009](0009-download-node.md)                      | A separate node for downloading media                             |
| [0010](0010-upload-node.md)                        | A separate node for uploading files                               |
| [0011](0011-keep-secrets-out-of-the-editor.md)     | Keep the secrets out of the editor and out of the URL             |
| [0012](0012-reply-markup.md)                       | Build reply markup from JSON; be honest about callbacks           |
| [0013](0013-migrate-to-teleproto.md)               | Move off the archived GramJS to its maintained fork               |
| [0014](0014-release-as-1-0-0.md)                   | Release the teleproto move as 1.0.0                               |
| [0015](0015-share-the-node-status-plumbing.md)     | Share the node status plumbing, and fix the text it hid           |
| [0016](0016-list-node.md)                          | A node for the async-iterator reads, streaming by default         |
| [0017](0017-finish-the-upload-node.md)             | Finish the upload node: albums, silent, replyTo, progress         |
| [0018](0018-persist-the-entity-cache.md)           | Persist the peer cache with StoreSession, opt-in                  |
| [0019](0019-catch-up-on-missed-updates.md)         | Catch up on missed updates by persisting the position, opt-in     |
| [0020](0020-qr-code-login.md)                      | QR-code login, rendered on the server                             |
| [0021](0021-lean-on-the-library.md)                | Three things the teleproto audit turned up                        |
| [0022](0022-never-log-in-at-deploy-time.md)        | The runtime connect must not be able to start a login             |
| [0023](0023-put-the-reason-in-the-status.md)       | Put the reason for a failed connect in the node status            |
| [0024](0024-log-an-expired-session-as-a-line.md)   | Log an expired session as a line, not a stack                     |
| [0025](0025-keep-the-client-out-of-msg.md)         | Keep the TelegramClient out of the messages a flow sees           |
| [0026](0026-one-login-step-at-a-time.md)           | One login step at a time, and a password that is a function       |
