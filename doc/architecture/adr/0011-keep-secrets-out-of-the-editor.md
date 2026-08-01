# 0011 — Keep the secrets out of the editor and out of the URL

## Context

Two exposures, both following from the same cause: the editor drove the login, so it needed values it
should never have been given.

**Credentials were sent to the browser in clear.** The Node-RED credential type controls more than
masking. In `@node-red/runtime/lib/api/flows.js`:

```js
if (definition[cred].type == 'password') {
    sendCredentials['has_' + cred] = credentials[cred] != null && credentials[cred] !== '';
    continue;
}
sendCredentials[cred] = credentials[cred] || '';
```

`session` had already been switched to `password`. `apihash`, `bottoken` and `twofapassword` had not,
because the editor's login panel read their values back to build the request and would have received the
`__PWRD__` placeholder instead — breaking a re-login on any existing config.

**Secrets travelled as URL query parameters.** The three admin routes were `GET`, and `$.getJSON` puts
its parameters in the query string. So the api hash, phone number, 2FA password and bot token reached
reverse-proxy and web-server access logs, browser history and `Referer` headers. This was the worse half
of the two.

## Decision

**Substitute the placeholder server-side.** The editor posts whatever it actually has: real values for a
config node that was never saved, and `__PWRD__` for one whose secrets are stored. The login route looks
the stored credentials up by the posted node id and swaps the placeholder for the real value
(`lib/login-credentials.js`).

This is what dissolves the problem the issue called hard. It listed three options — require a deploy
first, accept values only when nothing is stored, or store them via a separate route — and all three
trade away either the first-login flow or the security. Keying on the placeholder needs none of that:

- a **new** config node has nothing stored, posts real values, and they are used as posted;
- an **existing** one posts placeholders, and storage supplies the values.

No deploy-first requirement, no chicken-and-egg. Verified that `RED.nodes.getCredentials(id)` is
available to a node module, and that the editor really does put the literal `'__PWRD__'` in a
password-typed input (`populateCredentialsInputs`, `editor-client/public/red/red.js`).

**POST, not GET.** Verified that `bodyParser.json()` and `bodyParser.urlencoded()` are already applied to
the admin app (`editor-api/lib/index.js`), so `req.body` is parsed with no new dependency — which was the
open question in the issue.

The route **paths** are unchanged and remain public API. The **method** is not: anything scripted against
these as `GET` will break. They are editor-support endpoints tied to a browser dialog, so that is
unlikely, but it is a breaking change and is called out in the CHANGELOG rather than buried.

**What stays `text`, and why.** `apiid` is an application id, not a secret. `phonenumber` is personal
data but has to stay legible: masking it would make several config nodes indistinguishable in the editor,
and the user needs to see which account they are configuring.

## Consequences

- No secret leaves the runtime for the editor any more, and none appears in a query string.
- The server-side `registerType` block is the one that matters. Updating only the editor's `credentials`
  block would have changed nothing about what is sent — the runtime consults
  `getCredentialDefinition`, which comes from `registerType`. The test caught exactly that mistake
  during this change.
- A re-login works without the user re-entering the api hash, because the placeholder resolves. A user
  who _wants_ to change it types over the field, which posts a real value that wins.
- Users see masked fields where they previously saw their api hash and bot token. Nothing is lost —
  the values are still stored — but the editor no longer shows them back.
- `lib/login.js` and `lib/telegram-client.js` both `console.log` a GramJS auth error in their `onError`
  callbacks. The issue asked whether such an error can carry the hash or token into the log. Not audited
  here — it needs looking at what GramJS puts on an auth error object, and it is a separate concern from
  the transport. Left as a known gap rather than claimed as done.
- Verified by reversing each of the three halves independently: putting a credential back to `text` fails
  the registration test, putting the routes back to `GET` fails all five endpoint tests, and skipping the
  placeholder substitution fails three.
