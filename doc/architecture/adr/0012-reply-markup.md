# 0012 — Build reply markup from JSON, and be honest about who callbacks reach

## Context

The receiver has handled `CallbackQuery` events since issue #3, but there was no way to **send** the
buttons that produce them — leaving that support a dead end: a flow could handle button presses it had no
way to create.

`buildReplyMarkup` exists on the client, and `sendMessage` / `sendFile` take a `buttons` option. The
obstacle is that those buttons must be GramJS `Button` objects, and a Function node cannot `require`
GramJS. A flow can only produce JSON, so the conversion has to live in the package.

## What the investigation found

The issue said to verify the bot-only constraint before building. The answer is split, and only half of
it is documented:

**Callback buttons are useless for a userbot.** From
[core.telegram.org/api/bots/buttons](https://core.telegram.org/api/bots/buttons): after the user presses
an inline callback button, an `updateBotCallbackQuery` "is generated and **sent to the bot**". The bot
that created the button receives it. A user account has no bot, so it will never see the press.

**Sending reply markup is not documented as bot-only.**
[messages.sendMessage](https://core.telegram.org/method/messages.sendMessage) says "Both users and bots
can use this method", and its error list contains no bot restriction for `reply_markup` — only
`REPLY_MARKUP_INVALID` and `REPLY_MARKUP_TOO_LONG`. Whether Telegram accepts markup from a user account
in practice could not be verified here: it needs a real account, and the test suite runs offline.

So the honest position, and what the documentation now says: **callback buttons need bot mode**
(which #17 made work at runtime). URL buttons carry no callback and should work wherever markup is
accepted at all. Neither claim is stated more strongly than the evidence supports.

## Decision

**Convert in `lib/reply-markup.js`, not in a new node.** Unlike download (ADR 0009) and upload (ADR
0010), this is not an operation — it is the marshalling of one argument, the same category as the `args`
defaults in ADR 0002. A node would add a type for something that is a detail of sending.

The sender converts a plain-JSON `buttons` found in the **options object**, which is the last argument of
every client method that takes one. Anything already built is passed through untouched, so a flow that
somehow holds real `Button` objects is not broken.

**Errors name the position.** A keyboard is built once and sent many times, so `buttons[1][0]: a 'url'
button needs a 'url'` is worth more than a stack trace. Unknown types list the known ones.

**`auth`, `requestPoll`, `clear` and `forceReply` are left out.** `auth` needs a bot entity; the other
three describe the markup rather than a button and do not fit the shape. Left out rather than
half-supported.

**The conversion does not mutate its input.** The node reuses `msg` across a Catch node and any retry;
rewriting `msg.payload.args` in place would surprise.

## A GramJS asymmetry worth knowing

The factories are not uniform, which the tests had to account for:

| Factory                                   | Returns                                            |
| ----------------------------------------- | -------------------------------------------------- |
| `url`, `inline`, `switchInline`           | the TL object directly, with `className`           |
| `text`, `requestLocation`, `requestPhone` | a `Button` wrapper with the TL object on `.button` |

`buildReplyMarkup` unwraps both, so either is valid to pass on — but a test that assumes one shape fails
on the other.

## Consequences

- The `CallbackQuery` support added in #3 is reachable end to end, for bot-mode configs.
- No new node type; the change is one lib module plus one line in the sender.
- Verified by reversing three things. Two bit immediately. The third — removing the conversion from the
  sender entirely — **did not fail anything**: the lib was tested but the wiring was not. A test that the
  client actually receives real buttons was added, and the reversal then failed as it should. That is the
  fourth time this step has found one of my own tests not to be load-bearing.
- Whether a user-mode account can send markup at all remains unverified. If it turns out it cannot, the
  documentation needs narrowing to bot mode entirely — worth a note from anyone who tries it.
