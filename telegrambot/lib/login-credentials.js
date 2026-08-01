// Created by Karl-Heinz Wind
'use strict';

// Node-RED never hands a `password`-typed credential back to the editor. It sends a `has_<name>` flag
// instead, and the editor puts this placeholder in the input (`populateCredentialsInputs` in
// editor-client/public/red/red.js):
const PLACEHOLDER = '__PWRD__';

// So when the editor starts a login it can only post what it actually has: real values for a config node
// that has not been saved yet, and the placeholder for one whose secrets are already stored. Wherever the
// placeholder arrives, the stored value is used instead.
//
// This is what lets the secrets be `password`-typed without breaking a re-login: the editor never needs
// to know them, and they never travel back out of the runtime.
function resolveSecret(posted, stored) {
    let value = posted;

    if (posted === PLACEHOLDER) {
        value = stored;
    }

    return value;
}

// `stored` is whatever RED.nodes.getCredentials returned — undefined for a node that was never deployed.
function resolveLoginSecrets(parameters, stored) {
    const credentials = stored || {};

    return {
        ...parameters,
        apiHash: resolveSecret(parameters.apiHash, credentials.apihash),
        botToken: resolveSecret(parameters.botToken, credentials.bottoken),
        // The login's `password` is the account's two-step-verification password, stored under
        // `twofapassword` — not the proxy password, which is a plain config property.
        password: resolveSecret(parameters.password, credentials.twofapassword),
    };
}

module.exports = {
    PLACEHOLDER,
    resolveSecret,
    resolveLoginSecrets,
};
