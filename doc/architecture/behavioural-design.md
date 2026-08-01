# Behavioural design

## Interactive login (editor, once per account)

Telegram's login needs a phone code that only exists _after_ the login has started, so it cannot be a
single request. The editor drives three admin calls instead:

1. The user presses **Login**. `POST …-login` calls `lib/login.js` with an empty `StringSession` and
   parks two pending promises (`lib/auth-prompt.js`). The response is held open.
2. Telegram texts a code. The editor sends `POST …-setphonecode`, which settles the parked phone-code
   promise; the awaiting login continues. If 2FA is on, `POST …-setpassword` does the same for the
   password. An **empty** value rejects instead of resolving, which aborts the login.
3. `client.start()` returns, `client.session.save()` yields the session string, and the held-open
   `…-login` response delivers it. The editor stores it in the config node's credentials.

The routes are `POST` so the api hash, phone number, 2FA password and bot token travel in a body rather
than a query string — a query string would reach access logs, browser history and `Referer` headers. And
every secret credential is `password`-typed, so the runtime never sends its value to the editor at all:
the editor posts the `__PWRD__` placeholder for those and the route substitutes what is stored, looked up
by node id. A config node that was never deployed has nothing stored, posts real values, and they are
used as posted. See [ADR 0011](adr/0011-keep-secrets-out-of-the-editor.md).

The parked resolvers are module state in `lib/auth-prompt.js`: the three requests are separate HTTP
calls with nothing to thread state through, and only one login runs at a time.

Failures never reject the HTTP request. `lib/login.js` reports through its `error` callback and the
route answers `{ type: 'error', error: <message> }`, so the editor can show it inline.

## Runtime connect (deploy)

Receiver and sender both call `configNode.getTelegramClient(node)`, which creates the client on first
call and caches it on the config node. `lib/telegram-client.js` restores the stored session string —
no prompting, no interaction.

Connecting is best effort. A missing session warns `No session: login first.`; any other failure is
warned and the caller gets `undefined`. Nodes then report `disconnected` and stay loaded, so a Telegram
outage or a stale session does not break the flow.

Reconnection is left entirely to GramJS — the library retries and reconnects in several places, and a
second mechanism here would race it. The config node instead _observes_ the state GramJS publishes and
forwards it to the receiver and sender nodes registered with it, so the canvas keeps telling the truth
after `start()` has run:

| State          | Meaning                                           | Node status                      |
| -------------- | ------------------------------------------------- | -------------------------------- |
| `connected`    | connect or reconnect succeeded                    | `connected`                      |
| `disconnected` | connect failed, ping timed out, or disconnected   | `disconnected` — recovers itself |
| `broken`       | the stored session's authorization key is invalid | `session invalid: login again`   |

`broken` is the one that cannot heal: GramJS emits it only for an unusable authorization key, so
rebuilding the client from the same session would fail identically. See
[ADR 0006](adr/0006-connection-state.md).

## Teardown (redeploy)

The config node destroys the client on close and clears its cache, so a redeploy does not leave a live
session behind. `destroy()` is required rather than `disconnect()`: GramJS runs its update loop as
`while (!client._destroyed)` and only `destroy()` sets that flag, so after a plain disconnect the loop
reconnects and the session survives. See [ADR 0003](adr/0003-destroy-the-client-on-close.md).

The teardown is best effort in the same way the connect is: a failure is warned and the close still
completes, because a Telegram outage must not block a redeploy.

Receivers unsubscribe on close, reading the _cached_ client rather than asking for one — requesting a
client during shutdown would log in again just to tear it down. Node-RED closes nodes in an unspecified
order, so either the receiver unsubscribes from a still-live client, or the config node got there first
and there is nothing left to unsubscribe.

## Receiving

The receiver subscribes only to the event types enabled on the node, and records each subscription it
made. On close it removes exactly those handlers again.

Narrowing happens inside Telegram's event builders rather than downstream, so traffic the node is not
interested in never reaches the flow and never costs a `getSender()` / `getChat()` round trip. The
builders accept different option sets, so `lib/event-filters.js` produces one options object per group —
see [ADR 0005](adr/0005-receiver-event-filters.md). Raw events cannot be filtered at all. A filter that
does not compile leaves the node subscribed to nothing, showing `invalid filter`, rather than silently
forwarding everything.

Every event becomes one message. `msg.payload.type` names the event (`NewMessage`, `DeletedMessage`,
`EditedMessage`, `Album`, `CallbackQuery`) alongside the raw `event`. For `NewMessage` and
`EditedMessage` the node additionally awaits `getSender()` and `getChat()`, so flows do not have to.

Raw events are the exception: they emit `msg.type = 'Raw'` with the update in `msg.payload`, rather
than the nested `msg.payload.type` shape. This is kept for backwards compatibility.

## Sending

`msg.payload.func` names what to call, and `msg.payload.api` decides how:

| `api`           | Call                                      | `args`                     |
| --------------- | ----------------------------------------- | -------------------------- |
| absent          | `client[func](...args)`                   | array, spread as arguments |
| e.g. `messages` | `client.invoke(new Api[api][func](args))` | object, single argument    |

A missing `func` is reported through `nodeDone`. Anything thrown by the call — including an unknown
`api`/`func` pair — is reported the same way, so it surfaces on the flow's catch node.
