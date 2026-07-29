# Behavioural design

## Interactive login (editor, once per account)

Telegram's login needs a phone code that only exists _after_ the login has started, so it cannot be a
single request. The editor drives three admin calls instead:

1. The user presses **Login**. `GET …-login` calls `lib/login.js` with an empty `StringSession` and
   parks two pending promises (`lib/auth-prompt.js`). The response is held open.
2. Telegram texts a code. The editor sends `GET …-setphonecode`, which settles the parked phone-code
   promise; the awaiting login continues. If 2FA is on, `GET …-setpassword` does the same for the
   password. An **empty** value rejects instead of resolving, which aborts the login.
3. `client.start()` returns, `client.session.save()` yields the session string, and the held-open
   `…-login` response delivers it. The editor stores it in the config node's credentials.

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

## Receiving

The receiver subscribes only to the event types enabled on the node, and records each subscription it
made. On close it removes exactly those handlers again — the GramJS event builder passed to
`removeEventHandler` has to match the one used to subscribe.

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
