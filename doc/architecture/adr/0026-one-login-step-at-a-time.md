# 0026 — One login step at a time, and a password that is a function

## Context

Reported from the editor: _"when logging a code must be entered. The password field must be empty when the
code is entered. Then if MFA is enabled the password should be entered. If the password is already in the
field when the code is entered, login will be cancelled."_

The rule the user had inferred was real, but it was not a rule — it was a type error. `lib/login.js` only
wrapped the password when there was none:

```js
let password = parameters.password;
if (password === undefined || password === '') {
    password = async () => await getPassword; // only here does it become a function
}
```

teleproto **calls** it ([client/auth.js:491](../../../node_modules/teleproto/client/auth.js)):

```js
const password = await authParams.password(passwordSrpResult.hint);
```

so a non-empty password reached `signInWithPassword` as a `String`, the call threw
`authParams.password is not a function` into `onError`, `onError` returns `true` — abort — and teleproto
raised `AUTH_USER_CANCEL`. Reproduced without a network by running the two fragments against each other:

```
""                     -> typeof password: function   signed in with: from the prompt
undefined              -> typeof password: function   signed in with: from the prompt
"my-2fa-password"      -> typeof password: string     AUTH_USER_CANCEL <- TypeError: …not a function
"__PWRD__ resolved …"  -> typeof password: string     AUTH_USER_CANCEL <- TypeError: …not a function
```

The fourth line is the one that matters. A `password`-typed credential comes back to the editor as the
`__PWRD__` placeholder — Node-RED puts it there, not the user — and `lib/login-credentials.js` resolves it to
the stored password. **Every re-login of an account with two-step verification therefore arrived here with a
non-empty string and could not succeed**, unless the user happened to clear a field that looked like it held
their password. That is what turned a bug into folklore about the order of entry.

The dialog then made it worse by showing the code field and the password field side by side from the moment
it opened, with one tip under the Login button for all of it. Nothing said which to fill, in what order, or
that leaving a field is what submits it.

## Decision

**`passwordSource(supplied, getPassword)` always returns a function.** The supplied password when there is
one, the pending prompt when there is not. A named export rather than two lines inline, because everything
past this point talks to Telegram — the branch that calls it is inside the password check — so this is the
only place a test can hold the rule to. Same reasoning as `openSession` (ADR 0018) and `describeForLog`
(ADR 0024).

**The dialog asks for one thing at a time**, driven by a `loginStage` of `idle`, `code` or `password`:

| Stage      | Shown                   | Tip                                                        |
| ---------- | ----------------------- | ---------------------------------------------------------- |
| `idle`     | Login / Login with QR   | how to start                                               |
| `code`     | Phone-Code              | `Step 1 of 2` … _click outside the field to submit it_     |
| `password` | Password, if still open | `Step 2 of 2` … _if it has none, you are done in a moment_ |

Three things follow from it:

- **The stage gates the posts.** A code or password typed when nothing is waiting for it settles nothing on
  the server, so it is not sent and the "signing in" tip is never a lie.
- **A supplied password skips step 2.** It travelled with the login request, so the dialog says it is being
  used instead of asking for it again — which is now the ordinary path for a re-login, not an edge case.
- **The password field is offered, not demanded.** Whether Telegram asks for one is up to the account and the
  editor is not told. Rather than add a status route to find out (considered and declined as too much for
  this), the field appears with wording that says it may not be needed, and the panel closes on its own when
  the held login response comes back with a session.

The submit-on-blur interaction is kept. It is unobvious, which is why the tip now spells it out.

## The editor script became testable

`test-helpers/editor-dialog.js` runs the shipped `oneditprepare` against a stand-in for jQuery and records
what it showed, hid and posted. The script needs exactly three things from its environment — `$`,
`RED.nodes.registerType` and `RED.validators.number` — which is little enough to fake honestly, and it is the
real script that runs, not a copy of its logic.

This mattered immediately: hiding the password field by default would have broken the **QR** login, which has
no code step but shares the same password prompt (`lib/login-qr.js`) and therefore the same field. A test
caught it as a missing post rather than a user reporting it weeks later.

## Consequences

- An account with two-step verification can be logged in again without emptying a field first, which was
  previously impossible from a saved config node.
- The panel says what it wants, in order, and how to hand it over.
- A QR login shows the password field as soon as it starts, because that is the only thing it can ask for.
- Eight reversals; seven fail a test. The eighth — putting `$('#twofapassword').show()` back into
  `updateLoginMode` — is **not observable**, because the unconditional `showPasswordStep(false)` at the end of
  that function undoes it. Recorded rather than papered over: the end state is what the tests pin, and that
  edit cannot change it.
- The editor script is no longer the one part of this package that could only be checked by clicking. The
  harness is small and its cost is a `new Function`; the alternative was leaving the login panel — the first
  thing a user meets — untested.
