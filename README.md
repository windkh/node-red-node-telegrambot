# Telegram client nodes for Node-RED

[![Platform](https://img.shields.io/badge/platform-Node--RED-red)](https://nodered.org)
![License](https://img.shields.io/github/license/windkh/node-red-node-telegrambot.svg)
[![Downloads](https://img.shields.io/npm/dm/node-red-node-telegrambot.svg)](https://www.npmjs.com/package/node-red-node-telegrambot)
[![Total Downloads](https://img.shields.io/npm/dt/node-red-node-telegrambot.svg)](https://www.npmjs.com/package/node-red-node-telegrambot)
[![NPM](https://img.shields.io/npm/v/node-red-node-telegrambot?logo=npm)](https://www.npmjs.org/package/node-red-node-telegrambot)
[![Known Vulnerabilities](https://snyk.io/test/npm/node-red-node-telegrambot/badge.svg)](https://snyk.io/test/npm/node-red-node-telegrambot)
[![Telegram](https://img.shields.io/badge/Join-Telegram%20Chat-blue.svg?logo=telegram)](https://t.me/nodered_telegrambot)
[![Package Quality](https://packagequality.com/shield/node-red-node-telegrambot.svg)](https://packagequality.com/#?package=node-red-node-telegrambot)
![Build](https://img.shields.io/github/actions/workflow/status/windkh/node-red-node-telegrambot/node.js.yml)
[![Open Issues](https://img.shields.io/github/issues-raw/windkh/node-red-node-telegrambot.svg)](https://github.com/windkh/node-red-node-telegrambot/issues)
[![Closed Issues](https://img.shields.io/github/issues-closed-raw/windkh/node-red-node-telegrambot.svg)](https://github.com/windkh/node-red-node-telegrambot/issues?q=is%3Aissue+is%3Aclosed)
...

This package contains a node which act as a Telegram Client. It is based on [teleproto](https://github.com/sanyok12345/teleproto) which implements the mtproto mobile protocol. (see https://core.telegram.org/mtproto). Unlike node-red-contrib-telegrambot it does not support the telegram bot api. The package can be used to create so-called userbots or selfbots which to automate things under your own user-name. However you should be aware of the fact, that if you cause flooding and other havoc telegram will quickly ban your account either for 24h or even forever. It is recommended to use a test account while developing.

# Thanks for your donation

If you want to support this free project. Any help is welcome. You can donate by clicking one of the following links:
<a target="blank" href="https://blockchain.com/btc/payment_request?address=1PBi7BoZ1mBLQx4ePbwh1MVoK2RaoiDsp5"><img src="https://img.shields.io/badge/Donate-Bitcoin-green.svg"/></a>
<a target="blank" href="https://www.paypal.me/windkh"><img src="https://img.shields.io/badge/Donate-PayPal-blue.svg"/></a>

<a href="https://www.buymeacoffee.com/windka" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

# Credits

-

# Installation

[![NPM](https://nodei.co/npm/node-red-node-telegrambot.png?downloads=true)](https://nodei.co/npm/node-red-node-telegrambot/)

You can install the nodes using node-red's "Manage palette" in the side bar.

Or run the following command in the root directory of your Node-RED installation

    npm install node-red-node-telegrambot --save

Note that the minimum node-red version 1.3.7 and minimum nodejs version is 20.x.

# Dependencies

The nodes are tested with `Node.js v18.12.1` and `Node-RED v3.0.2`.

- [teleproto docs](https://docs.teleproto.dev/)
- [teleproto API reference](https://ref.teleproto.dev/classes/TelegramClient.html)
- [teleproto github](https://github.com/sanyok12345/teleproto)

Up to version 0.2.1 this package used [GramJS](https://github.com/gram-js/gramjs), which was archived in 2026. teleproto is a maintained fork of it. Your stored session keeps working — see
[ADR 0013](doc/architecture/adr/0013-migrate-to-teleproto.md).

# Upgrading

Coming from an earlier version? [MIGRATION.md](/MIGRATION.md) has the upgrade path, including the two
manual steps anyone on 0.1.x needs.

# Changelog

Changes can be followed [here](/CHANGELOG.md).

# Usage

## Basics

### Authentication

The _Telegram client receiver_ node receives messages from like a telegram client. You need to login with a phone-number and an API ID and API Hash in order to be able to receive message under your own user name.
In addition to that you can also login using a bot token retrieved from @botfather.

You can create an API ID and Hash when you login to your telegram account here https://my.telegram.org/auth
Then go to 'API Development Tools' and create your API ID and API Hash. Both are required when configuring your nodes. The nodes login only once to create a so-called session string. This string can be created from within
the config node or as an alternative you can also create it online here https://tgsnake.js.org/login
This session string is used instead of interactive login (where you need to enter a phone-code and your password if set).

#### Login with a QR code

Instead of waiting for a phone code, click **Login with QR** and scan the code with a Telegram app that is
already signed in — in the app: **Settings, Devices, Link Desktop Device**.

The code is replaced every half minute until you scan it. If your account has two-step verification, enter
the password in the same field the phone-code login uses. On a machine where Telegram is installed you can
click the link under the code instead of scanning.

Both routes produce the same session string, so it makes no difference afterwards which one you used.

### Receiver Node

The _Telegram client receiver_ node receives message which are sent to your account or bot. Just add a debug node to the
output and investigate the objects in `msg.payload`.

#### Filters

Tick the event types you want, and optionally narrow them down. Filtering is done by Telegram's event
builders, so traffic you are not interested in never reaches the flow at all — which matters on a busy
account, because every message that does arrive costs a sender and chat lookup.

| Field          | Effect                                                                                |
| -------------- | ------------------------------------------------------------------------------------- |
| **Chats**      | Comma separated usernames or ids. Empty means every chat.                             |
| **Exclude**    | Turns the chat list into an exclude list.                                             |
| **Direction**  | `incoming only` or `outgoing only`. Mutually exclusive in Telegram, hence one choice. |
| **From users** | Comma separated senders, independent of the chat.                                     |
| **Pattern**    | A regular expression the message text must match.                                     |

Not every filter applies to every event type, because Telegram's builders differ:

- **New messages** and **Edited messages** support all of them.
- **Callback query** supports Chats, Exclude and Pattern.
- **Deleted messages** and **Albums** support Chats and Exclude only.
- **Raw events** support none — raw updates arrive before Telegram resolves entities, so there is
  nothing to match a chat against.

Leaving every field empty reproduces the behaviour of earlier versions: no filtering.

### Download Node

The _Telegram client download_ node fetches the media on a received message — a photo, video, voice note
or document. Wire it straight to a receiver output; it accepts what the receiver emits, so nothing has to
be unwrapped.

```
[client receiver] --> [client download] --> [file out]
```

Output:

| Property       | Contents                                                    |
| -------------- | ----------------------------------------------------------- |
| `msg.payload`  | the file as a Buffer                                        |
| `msg.filename` | the document's own name, or a generated one                 |
| `msg.mimetype` | the mime type (photos are always `image/jpeg`)              |
| `msg.telegram` | the original message, so the sender and chat stay reachable |

That is the shape **file out** and **http response** already expect, so they can follow directly.

Two settings matter:

- **Thumbnail** — leave empty for the media itself, or give an index to fetch a thumbnail instead
  (`0` is the smallest). Useful when you want a preview rather than a 40 MB original.
- **Max size** — in megabytes. A larger download is refused with an error instead of being read into
  memory. `0` disables the check. The size is not known in advance for every kind of media, and the check
  is skipped when it cannot be determined — a safeguard, not a guarantee.

The node shows `downloading 42%` while it works, and a redeploy stops a download in flight rather than
letting it stream into a node that no longer exists.

[**download media flow**](examples/DownloadMedia.json)

### Upload Node

The _Telegram client upload_ node sends a file to a chat — the mirror of the download node.

```
[file in] --> [client upload]
```

Inputs:

| Property       | Contents                                                        |
| -------------- | --------------------------------------------------------------- |
| `msg.payload`  | the file: a **Buffer** or a **path** as a string                |
| `msg.filename` | **required for a Buffer** — a Buffer carries no name of its own |
| `msg.peer`     | overrides the configured **Send to**                            |
| `msg.caption`  | overrides the configured **Caption**                            |

`msg.payload` becomes the message Telegram created, so a following node can reply to it, edit it or pin
it. The Buffer is not carried through.

Why `msg.filename` is required: teleproto names an unnamed Buffer literally `unnamed`, so the file would
arrive in the chat called that. The node reports an error instead of sending it wrongly. A path needs no
filename — Telegram uses the file's basename.

For large files pass a **path** rather than a Buffer: the whole file otherwise has to fit in memory
before it can be sent.

#### Albums

An **array** in `msg.payload` is sent as one album, which is how Telegram groups several photos or videos
into a single post. Every Buffer in it still needs its own name, so `msg.filename` is an array aligned by
index; a path in the array needs no entry.

```javascript
msg.payload = [bufferOne, '/tmp/second.jpg', bufferThree];
msg.filename = ['first.jpg', undefined, 'third.jpg'];
```

If any item is wrong the whole album is refused, naming the position — `msg.filename[2] is required when
msg.payload[2] is a Buffer.` An album is a unit, and half of one arriving is worse than none.

The output is an array of the messages Telegram created, one per item.

#### Other options

| Property      | Effect                                                                 |
| ------------- | ---------------------------------------------------------------------- |
| `msg.silent`  | overrides **Silent** — deliver without a notification sound.           |
| `msg.replyTo` | a message id to reply to. Left out of the request entirely when unset. |
| `msg.caption` | overrides **Caption**. An array is accepted for an album.              |

The node shows `uploading 42%` while the file goes up, so a large one does not look like a hang. A
redeploy cancels an upload in flight rather than letting it finish into a node that no longer exists.

There is no thumbnail option. Telegram ignores `thumb` unless the file is a JPEG under roughly 20 kB and
320×320 **and** the underlying media's dimensions are supplied through the raw TL attributes, which this
node does not expose — a field that mostly does nothing is worse than no field.

[**upload file flow**](examples/UploadFile.json) &nbsp; [**upload album flow**](examples/UploadAlbum.json)

### List Node

The _Telegram client list_ node reads existing data: a chat's **message history**, your **dialogs** (the
chat list), or the **participants** of a group or channel.

None of these work through the sender node, because Telegram returns them as _async iterators_ — putting
one into `msg.payload` gives a flow an object it cannot use. This node iterates and decides how the items
become messages.

#### Output modes

**one message per item** (the default) emits each item separately with `msg.parts` set, so a standard
**join** node in automatic mode reassembles the array:

```
[inject] --> [client list] --> [join] --> [debug]
```

Use this for history: a large one never has to fit in memory at once. `msg.parts.count` comes from
Telegram's own total for the query, capped at the limit.

**one message with an array** emits a single message whose `msg.payload` is the whole array, with
`msg.total` alongside. Simpler for small reads — a chat list, the members of a group — but everything is
held in memory first.

#### The limit is not a formality

| Limit    | Meaning         |
| -------- | --------------- |
| blank    | 100 items       |
| a number | that many items |
| `0`      | no limit        |

Telegram's own default here is **unbounded**. Iterating a busy channel back to its first message takes a
long time and can earn a `FLOOD_WAIT`; on a user account, repeatedly, that risks the account. `0` is
available, but it has to be asked for — the same convention as **Max size** on the download node.

#### Inputs

| Property     | Effect                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| `msg.peer`   | overrides **Read from**. Ignored for dialogs.                                 |
| `msg.limit`  | overrides **Limit**.                                                          |
| `msg.search` | overrides **Search**. Ignored for dialogs, which Telegram cannot search here. |

Any message triggers a read; its payload is not used, and its other properties are carried through to
every emitted message.

The node shows `read n` while it works, so a long read does not look like a hang. A redeploy stops it at
the next item rather than continuing to pull from Telegram.

[**read history flow**](examples/ReadHistory.json)

### Sender Node

The _Telegram client sender_ node is able to call nearly all functions provided by teleproto.
For a full list of client methods see the
[TelegramClient reference](https://ref.teleproto.dev/classes/TelegramClient.html); for the raw MTProto
requests see [core.telegram.org/methods](https://core.telegram.org/methods).

#### Two calling conventions

Leaving `api` out calls a method on the teleproto client directly, with `args` spread as its arguments —
so `args` must be an **array**:

```javascript
msg.payload = { func: 'sendMessage', args: ['someone', { message: 'Hello' }] };
```

Setting `api` builds a raw MTProto request, which takes a single options **object**:

```javascript
msg.payload = { api: 'messages', func: 'SendMessage', args: { peer: 'someone' } };
```

#### Formatting message text

By default text is sent exactly as given. To get **bold**, links or code blocks, Telegram has to be told
to interpret the text — either per message, which is usually what you want:

```javascript
msg.payload = {
    func: 'sendMessage',
    args: ['someone', { message: '*bold* and _italic_', parseMode: 'md' }],
};
```

or for every message this client sends, via **Parse mode** on the config node (`Markdown`,
`MarkdownV2` or `HTML`).

> **Escaping:** with a parse mode active, any text your flow did not write itself — a user's name, a
> value from an API, an error message — must be escaped first. A stray `*`, `_` or `<` will render
> wrongly or make Telegram reject the message outright. If only some of your messages are formatted,
> leave the config-node setting off and pass `parseMode` per message.

#### Catching up after a restart

Messages that arrive while Node-RED is stopped or redeploying are normally lost — the receiver subscribes
to the live stream and has no idea what it missed.

**Catch up** on the config node changes that. The position in the update stream is remembered in
`<user directory>/telegram-updates/<node id>.json`, and on the next start everything since is fetched and
emitted through the receiver. Replayed messages travel the same path as live ones, so **a flow needs no
changes and cannot tell the difference.**

**Off by default, on purpose:** after a long outage on a busy account this arrives as a flood the moment
you deploy.

Two limits worth knowing:

- Telegram decides how far back it will replay. Past that it refuses, those messages are gone, and the log
  says `getDifference: too long`.
- A message may be delivered twice around the boundary. Most duplicates are filtered out, but a flow that
  must not act twice should be idempotent.

#### Remembering peers across a restart

Telegram will not let a client address a user by **numeric id** alone — it needs an access hash, which the
client only holds for peers it has already seen. That list normally lives in memory, so it is empty after
every restart: a flow that addresses peers by id works while you build it and then fails with
`Could not find the input entity` after a redeploy.

**Remember peers** on the config node keeps the list on disk, in
`<user directory>/telegram-sessions/<node id>`, so numeric ids keep working.

It is **off by default, deliberately.** That directory also holds this account's session key — the same
secret as the session string, which otherwise lives only in Node-RED's encrypted credentials file. Anyone
who can read the directory can act as your account. Turn it on only if you address peers by numeric id, and
treat the directory like the credentials file.

Usernames and invite links never needed it: they are resolved on demand.

#### Addressing a chat or user

You do not need to resolve peers yourself — both calling conventions accept a username and let teleproto
look it up. **How you address a peer decides whether it keeps working, though:**

| You pass       | Works                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `'username'`   | Always. Costs one lookup, which Telegram then caches for the session. |
| An invite link | Always.                                                               |
| A numeric id   | **Only while that peer is in the session's cache.**                   |
| A phone number | Only if that person is in your account's contacts.                    |

The catch is the numeric id. Telegram will not let you address an arbitrary user by id alone — it needs
an `access_hash`, which the client only holds for peers it has already seen in this session. That cache
lives in memory and is **lost on every restart**, so a flow that works while you are building it can
fail after a redeploy with:

```
Could not find the input entity for ...
```

Address peers by **username** and this never happens. If you only have an id, resolve it once in the
same flow with `getEntity` and pass the result on:

```javascript
msg.payload = { func: 'getEntity', args: ['username'] };
// then send to msg.payload from the next node
```

#### Buttons

Pass a plain-JSON `buttons` description in the options object and the node turns it into the objects
Telegram needs — an array of rows, each row an array of buttons:

```javascript
msg.payload = {
    func: 'sendMessage',
    args: [
        'someone',
        {
            message: 'Pick one',
            buttons: [
                [{ type: 'url', text: 'Open the docs', url: 'https://docs.teleproto.dev' }],
                [
                    { type: 'callback', text: 'Yes', data: 'yes' },
                    { type: 'callback', text: 'No', data: 'no' },
                ],
            ],
        },
    ],
};
```

| `type`            | Needs  | Effect                                                 |
| ----------------- | ------ | ------------------------------------------------------ |
| `url`             | `url`  | opens a link                                           |
| `callback`        | `data` | sends `data` back — **bot mode only**, see below       |
| `switchInline`    | —      | starts an inline query, optional `query`, `samePeer`   |
| `text`            | —      | a plain keyboard button; the text is sent as a message |
| `requestLocation` | —      | asks the user to share their location                  |
| `requestPhone`    | —      | asks the user to share their phone number              |

An invalid button is reported with its position, for example
`buttons[1][0]: a 'url' button needs a 'url'`.

> **Callback buttons only work in bot mode.** Telegram sends the button press to _the bot that created
> the button_ — [the API documentation](https://core.telegram.org/api/bots/buttons) is explicit that the
> update is "sent to the bot". A user account has no bot, so it will never receive the press, and the
> receiver's **Callback query** event will stay silent. Use `url` buttons for userbot flows, or set the
> config node's login mode to **bot**.

#### Useful client methods

Anything on the client is reachable by name. The ones worth knowing:

| Area     | Methods                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| Sending  | `sendMessage`, `sendFile`, `forwardMessages`, `editMessage`, `deleteMessages` |
| Chats    | `pinMessage`, `unpinMessage`, `markAsRead`, `kickParticipant`                 |
| Reading  | `getMessages`, `getDialogs`, `getParticipants`                                |
| Media    | `downloadMedia`, `downloadFile`, `downloadProfilePhoto`, `uploadFile`         |
| Entities | `getEntity`, `getInputEntity`, `getPeerId`                                    |
| Account  | `getMe`, `isBot`, `isUserAuthorized`, `checkAuthorization`                    |

The `iter*` variants (`iterMessages`, `iterDialogs`, `iterParticipants`) return async iterators, which
do not survive being placed in `msg.payload`. Use the non-iterating methods until dedicated support
exists.

> **Careful:** the client is shared by every node using the same config node. Connection and
> authentication methods — `connect`, `disconnect`, `destroy`, `start`, `signIn…`, `addEventHandler` —
> are reachable too, and calling them from a flow will disrupt the other nodes.

### Examples

#### Api.messages.SendMessage

To call the [SendMessage](https://core.telegram.org/method/messages.sendMessage) function, you must do the following:
Create a function node and enter 'messages' for the api property and 'SendMessage' for the func property.
The arguments described in the api must be added to args. SendMessage contains a field randomId which must be
set by the user to a random number to prevent message looping in the telegram server. Peer must be set to the
name of the user you want to send the message to.

```javascript
let randomId = BigInt(Math.floor(Math.random() * 1e15));
let username = msg.payload;
msg.payload = {
    api: 'messages',
    func: 'SendMessage',
    args: {
        peer: 'to username',
        message: 'Test1',
        randomId: randomId,
        noWebpage: true,
        noforwards: true,
        scheduleDate: 0,
        // sendAs: "from username",
    },
};
return msg;
```

[**send message flow**](examples/Api.messages.SendMessage.json)

#### Api.account.CheckUsername

To call the [CheckUsername](https://core.telegram.org/method/account.checkUsername) function, you must do the following:
Create a function node and enter 'account' for the api property and 'CheckUsername' for the func property.
The arguments described in the api must be added to args. In this case it is only the username property.

```javascript
let username = msg.payload;
msg.payload = {
    api: 'account',
    func: 'CheckUsername',
    args: {
        username: 'usernameToCheckHere',
    },
};
return msg;
```

[**check username flow**](examples/Api.account.CheckUsername.json)
