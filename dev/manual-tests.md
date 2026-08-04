# Manual test plan

Everything in this package that a test suite cannot reach, in an order where each step only needs the ones
before it. The 303 automated tests never talk to Telegram; this is the other half.

Work top to bottom. Field names match the labels in the editor.

## Before you start

**Use a test account if you can.** This is a userbot: the README's warning is real, and a few of the steps
below deliberately provoke rate limits. If you only have your main account, skip the steps marked
**⚠ costs a rate limit**.

Two things make the difference between a useful session and a confusing one:

- **Run it under the debugger** (F5, _Run Node-RED_) so you can break where something surprises you. See
  [README.md](README.md).
- **Watch the node status and the log together.** Most of what is worth checking here is visible on the
  canvas, and the status is the thing most likely to be wrong.

Tick as you go:

---

## 1 · Config node and login

Nothing else works until this does.

- [ ] **1.1 Fresh config, phone-code login.** New _telegram client config_, enter ApiID and ApiHash, Login
      Mode `user`, Phone-Number. Click **Login**. Expect: the tip says a code was requested, you get a code,
      entering it in **Phone-Code** fills **Session**. Click Done, Deploy.
- [ ] **1.2 Two-step verification.** If the account has it, 1.1 should ask for **Password** after the code.
      Expect: an empty password aborts the login rather than hanging.
- [ ] **1.3 Secrets are not shown back.** Reopen the config node. Expect: ApiHash, Session, Bot-Token and
      Password show `__PWRD__`, not their values. Click Done without touching them and Deploy. Expect: the
      login still works, i.e. nothing was overwritten with the placeholder.
- [ ] **1.4 QR login.** In a second config node, ApiID and ApiHash only, then **Login with QR**. Expect: a
      QR code appears within a couple of seconds, and it is **replaced roughly every 30 seconds**. Scan it in
      Telegram → _Settings, Devices, Link Desktop Device_. Expect: Session fills.
- [ ] **1.5 QR link fallback.** Before scanning, click _Open the login link_ under the code on a machine
      where Telegram Desktop is installed. Expect: the same login completes.
- [ ] **1.6 QR replaces a running attempt.** Click **Login with QR** twice in a row. Expect: the second code
      works; the first is abandoned without leaving an error on screen.
- [ ] **1.7 Bot mode.** Login Mode `bot`, a token from @BotFather, **Login**. Expect: Phone-Number and
      Password hide, Bot-Token shows, and a session comes back without any code.
- [ ] **1.8 Verbose logging.** Tick it and Deploy. Expect: noticeably more from teleproto in the log.
- [ ] **1.9 Device fields.** Set Device Model / System Version / App Version, Deploy, then check the session
      in Telegram → _Settings, Devices_. Expect: the entry shows what you typed. Clear them and expect your
      host's real values instead.

## 2 · Connection status

The part most likely to be quietly wrong, and now the part that tells you why.

- [ ] **2.1 Green.** With a valid session deployed, every telegram node shows a green ring `connected`.
- [ ] **2.2 No session.** New config node, no login, wired to a sender. Expect a **red dot**
      `no session: login first` — not a generic `disconnected`.
- [ ] **2.3 Wrong credentials.** Put a wrong ApiID or ApiHash in a config node and Deploy. Expect a red dot
      naming it, e.g. `api id or hash is wrong`.
- [ ] **2.4 Revoked session.** In Telegram → _Settings, Devices_, terminate the session this config node
      uses. Redeploy. Expect a red dot `session invalid: login again` — **and no login code arriving on your
      phone.** A code here would mean the deploy-time login is back (ADR 0022).
- [ ] **2.5 Recovery is green again.** Log in again from the editor and Deploy. Expect green, and the failure
      text gone rather than lingering.
- [ ] **2.6 Connection drop.** Pull the network for a minute. Expect a red **ring** `disconnected` — a ring,
      because this one heals itself — then green when it comes back.

## 3 · Receiver

Import **EchoMessage** from Import → Examples for a working starting point.

- [ ] **3.1 New messages.** Tick _New messages_ only. Send yourself a message from another account. Expect
      one `msg.payload` with `type`, `message`, `sender`, `chat`.
- [ ] **3.2 Edited messages.** Tick _Edited messages_, edit a message. Expect an event.
- [ ] **3.3 Deleted messages.** Tick _Deleted messages_, delete one. Expect an event.
- [ ] **3.4 Albums.** Tick _Albums_, send several photos as one group. Expect **one** event with the group,
      not one per photo.
- [ ] **3.5 Raw events.** Tick _Raw events_. Expect a much noisier stream, and note the deliberate oddity:
      raw events carry `msg.type = 'Raw'` at the **top level** while everything else uses
      `msg.payload.type`.
- [ ] **3.6 Callback query.** Only reachable in **bot** mode — see 5.6. In user mode this stays silent by
      design: Telegram sends the press to the bot that created the button.
- [ ] **3.7 Filter: Chats.** Put one username in _Chats_. Expect messages from anywhere else to stop
      arriving at all, not merely to be dropped downstream.
- [ ] **3.8 Filter: Exclude.** Same chat, tick _Exclude_. Expect the inverse.
- [ ] **3.9 Filter: Direction.** `outgoing only`, then send a message **from** this account. Expect only your
      own messages. Switch to `incoming only` and expect the opposite.
- [ ] **3.10 Filter: From users.** A username in _From users_ with _Chats_ empty. Expect only that sender,
      across chats.
- [ ] **3.11 Filter: Pattern.** A regex like `^report`. Expect only matching text.
- [ ] **3.12 Bad pattern.** Enter `[unclosed`. Expect a red `invalid filter` status and an error in the log —
      not a crash, and not silent acceptance.
- [ ] **3.13 Redeploy leaves nothing behind.** With the receiver running, Deploy several times, then send one
      message. Expect it **once**, not once per deploy. (This is what ADR 0003 is about.)

## 4 · Sender

Import **Client.sendMessage** and **Api.messages.SendMessage**.

- [ ] **4.1 Client method.** `msg.payload = { func: 'sendMessage', args: ['<username>', { message: 'hi' }] }`.
      Expect the message to arrive and `msg.payload` to come back as the sent Message — **not** a pending
      Promise.
- [ ] **4.2 Raw API.** The SendMessage example, with `peer` set to a real username. Note it needs `randomId`.
- [ ] **4.3 Placeholder left in.** Run the SendMessage example **unedited**, with `peer: "to username"`.
      Expect an error _and_ a hint saying Telegram does not know that username — mentioning that a space is
      not part of a username. This is the case that had no hint before 1.7.1.
- [ ] **4.4 Numeric id, fresh restart.** Address a peer by numeric id, confirm it works, then restart
      Node-RED and send again **without** _Remember peers_. Expect a failure and a hint about the in-memory
      entity cache. Then tick _Remember peers_, restart, and expect it to work.
- [ ] **4.5 Missing payload.** Send `msg` with no payload. Expect a clear error reaching a Catch node, not a
      silently dropped message.
- [ ] **4.6 Wrong args shape.** `{ func: 'sendMessage', args: { peer: 'x' } }` — an object where an array is
      required. Expect the error to say so.
- [ ] **4.7 Complete node.** Wire a Complete node to the sender. Expect it to fire, i.e. the message
      lifecycle is closed.
- [ ] **4.8 Buttons.** `args: ['<username>', { message: 'Pick', buttons: [[{ type: 'url', text: 'Docs', url: 'https://docs.teleproto.dev' }]] }]`.
      Expect a URL button. A `callback` button will render but its press only reaches a bot.
- [ ] **4.9 Bad button.** Give a `url` button no `url`. Expect an error naming the **position**, like
      `buttons[0][0]`.
- [ ] **4.10 Parse mode.** Set _Parse mode_ `Markdown` on the config node and send `*bold*`. Expect
      formatting. Set it back to none and expect the asterisks verbatim.
- [ ] **4.11 ⚠ costs a rate limit — Flood wait.** Send in a tight loop until Telegram throttles. Expect a
      yellow `flood wait Ns` status that reverts on its own, and `err.seconds` available to a Catch node.
      Set _Flood wait_ to `0` first to see it sooner.

## 5 · Bot mode specifics

Needs the bot config from 1.7, and the bot must be in a chat with you.

- [ ] **5.1 Send as the bot.** Same as 4.1 through the bot config node.
- [ ] **5.2 Bot token survives a redeploy.** Reopen the config node, Done, Deploy, and send again. Expect it
      to still work — the token is stored (this is what #17 fixed).
- [ ] **5.3 Callback buttons.** Send a message with a `callback` button from the bot.
- [ ] **5.4 Callback query arrives.** With a receiver on the **bot** config and _Callback query_ ticked,
      press the button. Expect an event. This is the pairing 3.6 could not test.
- [ ] **5.5 Wrong mode does not hijack.** Switch a config node with a stored bot token back to Login Mode
      `user`. Expect it to authenticate as the user, not the bot.
- [ ] **5.6 Bot with no token.** Login Mode `bot`, no token. Expect a warning naming exactly that.

## 6 · Download

Import **DownloadMedia**.

- [ ] **6.1 Photo.** Receiver → download → Debug. Expect a Buffer in `msg.payload`, a filename, `image/jpeg`,
      and the original message still at `msg.telegram`.
- [ ] **6.2 Document.** Send yourself a PDF. Expect its **own** filename, not a generated one.
- [ ] **6.3 Video, and progress.** Something big enough to take a moment. Expect the status to count
      `downloading 42%`.
- [ ] **6.4 Thumbnail.** Set _Thumbnail_ `0`. Expect a much smaller file than 6.1 for the same photo.
- [ ] **6.5 Max size refuses.** Set _Max size_ `1` and download a photo over 1 MB. Expect an error naming the
      size, and **no** download. This is what 1.6.0 fixed — before it, a 4.5 MB photo passed a 1 MB limit.
- [ ] **6.6 Max size 0.** Expect no limit.
- [ ] **6.7 Cancel.** Start a large download and Deploy while it runs. Expect it to stop, not to finish into
      a node that no longer exists.
- [ ] **6.8 No media.** Feed it a text message. Expect a clear error.
- [ ] **6.9 File out.** Wire download → file out with no Change node in between. Expect a correct file on
      disk — `payload` and `filename` are already the right shape.

## 7 · Upload

Import **UploadFile** and **UploadAlbum**.

- [ ] **7.1 Path.** `msg.payload = '/path/to/file.jpg'`, _Send to_ a username. Expect it to arrive with the
      file's own name.
- [ ] **7.2 Buffer with a name.** file in → upload, `msg.filename` set. Expect that name in the chat.
- [ ] **7.3 Buffer without a name.** Remove `msg.filename`. Expect a **refusal** with a clear error — not a
      file called `unnamed`.
- [ ] **7.4 `msg.filename = null`.** Expect the same refusal. (Fixed in 1.2.0; it used to name the file
      `null`.)
- [ ] **7.5 Caption.** Set _Caption_, then override it with `msg.caption`.
- [ ] **7.6 As document.** Send a `.jpg` with _As document_ ticked. Expect a file, not a re-encoded photo.
- [ ] **7.7 Silent.** Tick _Silent_, expect no notification sound. Then send `msg.silent = false` and expect
      the sound back — an explicit `false` must win over the ticked box.
- [ ] **7.8 Reply.** `msg.replyTo = <a message id>`. Expect it to arrive as a reply.
- [ ] **7.9 Album.** The UploadAlbum example: an array in `msg.payload`, `msg.filename` an array aligned by
      index. Expect **one** album post, and `msg.payload` back as an array of messages.
- [ ] **7.10 Broken album.** Remove one entry from the filename array. Expect the error to name the
      **position**, e.g. `msg.filename[2] …`, and **nothing** sent — not a partial album.
- [ ] **7.11 Progress and cancel.** A large file: expect `uploading 42%`, and a Deploy mid-upload to cancel
      it.

## 8 · List

Import **ReadHistory**.

- [ ] **8.1 History, streaming.** _Read_ `message history`, _Read from_ a chat, _Limit_ `50`, _Output_
      `one message per item`. Wire to a **join** in automatic mode. Expect one array of 50.
- [ ] **8.2 parts are right.** Look at a single message before the join: `msg.parts` with `id`, `index`,
      `count`, `type: 'array'`, and the same `id` across all of them.
- [ ] **8.3 Array mode.** _Output_ `one message with an array`. Expect one message, plus `msg.total`.
- [ ] **8.4 Default limit.** Clear _Limit_ entirely. Expect **100** items — not the whole channel.
- [ ] **8.5 ⚠ costs time — Limit 0.** On a **small** chat, `0`. Expect everything. Do not try this on a busy
      channel.
- [ ] **8.6 Dialogs.** _Read_ `dialogs`. Expect your chat list, and note that _Read from_ and _Search_
      disappear from the dialog — Telegram takes neither here.
- [ ] **8.7 Participants.** _Read_ `participants` on a group you are in.
- [ ] **8.8 Search.** A word you know is in the history. Expect only matches.
- [ ] **8.9 Progress.** A large read: expect the status to count `read 250`.
- [ ] **8.10 Cancel.** Deploy during a long read. Expect it to stop at the next item.
- [ ] **8.11 Missing chat.** _Read from_ empty with `message history`. Expect an error saying so, and no
      request.

## 9 · Catch up

- [ ] **9.1 Off by default.** Confirm _Catch up_ is unticked on an existing config node.
- [ ] **9.2 Messages while stopped are lost.** With it **off**: stop Node-RED, have someone message you,
      start it again. Expect the receiver **not** to emit that message.
- [ ] **9.3 And with it on, they arrive.** Tick _Catch up_, Deploy, stop Node-RED, get a message, start
      again. Expect it to arrive as though it had just come in, indistinguishable from a live one.
- [ ] **9.4 The position survives.** Check that
      `<user directory>/telegram-updates/<config node id>.json` exists and holds four numbers.
- [ ] **9.5 ⚠ a flood — a long gap.** Leave it off for a day on a busy account, then turn it on. Expect the
      backlog at once. This is why it is off by default.

## 10 · Remember peers

- [ ] **10.1 Off by default.** Confirm it is unticked.
- [ ] **10.2 Directory appears.** Tick it, Deploy, and expect
      `<user directory>/telegram-sessions/<config node id>/` to appear.
- [ ] **10.3 Numeric ids survive a restart.** The second half of 4.4.
- [ ] **10.4 It holds a key.** Look in that directory and confirm for yourself that it contains an auth key.
      That is the trade the dialog warns about, and worth seeing once.
- [ ] **10.5 A new login discards the cache.** Log in again with a different account. Expect a warning that
      the cached peers were dropped.

## 11 · Proxy

Only if you have one.

- [ ] **11.1 SOCKS5.** _Use Proxy_, Socks Type `5`, host, port, username, password. Expect a connection.
- [ ] **11.2 Proxy password is its own field.** Confirm the account password and the proxy password are two
      separate fields that do not overwrite each other. (They shared a DOM id before 0.1.11.)
- [ ] **11.3 MTProxy.** Tick _MT-Proxy_, set _Secret_.
- [ ] **11.4 Timeout.** Set _Timeout s_ to `1` and point the proxy at an address that swallows packets.
      Expect it to give up after about a second rather than hanging.
- [ ] **11.5 Wrong proxy.** A bad port. Expect a red status naming a failure, not a hang.

## 12 · Housekeeping

- [ ] **12.1 All eight examples import.** Import → Examples → node-red-node-telegrambot. Expect
      Api.account.CheckUsername, Api.messages.SendMessage, Client.sendMessage, DownloadMedia, EchoMessage,
      ReadHistory, UploadAlbum, UploadFile.
- [ ] **12.2 Node help.** Open the help sidebar for each of the six node types. Expect no empty panes.
- [ ] **12.3 Two config nodes at once.** Two accounts, two config nodes, one flow. Expect both to work and
      neither to steal the other's session.
- [ ] **12.4 Removing a node.** Delete a receiver and Deploy. Expect no leftover event handlers — messages
      for it stop.

---

## Known to be untestable here

Not gaps in the plan; gaps in what can be observed from the outside.

| What                                  | Why                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `differenceTooLong` on catch-up       | Needs a gap longer than Telegram's own replay window, and it only logs at debug level.                                                 |
| A `broken` status from a bad auth key | teleproto reports it for a failed reconnect too; provoking specifically the auth-key path is not something you can do from the editor. |
| Callback presses in user mode         | Telegram sends them to the bot that created the button. Silence is correct.                                                            |
| Upload thumbnails                     | Not exposed — Telegram ignores `thumb` without raw TL attributes. See ADR 0017.                                                        |
