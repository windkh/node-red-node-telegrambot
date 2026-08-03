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
