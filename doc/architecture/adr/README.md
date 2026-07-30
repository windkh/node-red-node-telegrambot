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
