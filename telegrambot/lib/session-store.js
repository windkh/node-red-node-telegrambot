// Created by Karl-Heinz Wind
'use strict';

const path = require('node:path');

const { StoreSession, StringSession } = require('teleproto/sessions');

// Keeps the entity rows across a restart, so a peer addressed by numeric id keeps resolving.
//
// MTProto will not let a client address a user by id alone — it needs an `InputPeer` carrying an
// `access_hash`, and the client only holds one for peers it has already seen. `StringSession.save()`
// serialises the dc id, address, port and auth key and nothing else, so those rows die with the process:
// a flow that addresses peers by id works while it is being built and fails after the next redeploy.
// See doc/architecture/adr/0008-entity-resolution.md for the symptom and 0018 for this.
//
// `StoreSession` already solves it — it overrides `processEntities` and `getEntityRowsById` on top of
// node-localstorage. The price is that it also writes the **auth key** to disk, outside Node-RED's
// credential store. That is why this is opt-in and not the default.

const SESSION_DIRECTORY = 'telegram-sessions';

// Where the store ends up, expressed as the name StoreSession wants.
//
// The constructor does `new LocalStorage('./' + sessionName)` — hardcoded, working-directory relative.
// An absolute name is mangled (`./D:/x` becomes a directory literally called `D:`), so the only way to
// choose the location is to hand it a relative path. Node-RED's user directory is the right home: it is
// where the flows and the credentials file already live, and unlike the working directory it does not
// depend on how Node-RED was started.
//
// A target on another Windows drive has no relative form. Then `path.relative` returns an absolute path,
// which would be mangled, so the name falls back to a plain working-directory-relative one — and
// `directory` says where that actually is, which is what the caller reports.
function describeSessionStore(baseDirectory, nodeId, workingDirectory) {
    const target = path.join(baseDirectory, SESSION_DIRECTORY, nodeId);
    const relative = path.relative(workingDirectory, target);
    let described;

    if (path.isAbsolute(relative)) {
        const fallback = path.join(SESSION_DIRECTORY, nodeId);
        described = { name: fallback, directory: path.resolve(workingDirectory, fallback), asAsked: false };
    } else {
        described = { name: relative, directory: target, asAsked: true };
    }

    return described;
}

// True when the store holds the same account as the credential.
//
// The credential is the source of truth: it is what the user manages, backs up and replaces by logging
// in again. A stored key that disagrees with it is stale — and possibly a different account entirely, in
// which case the cached rows carry access hashes that mean nothing.
function holdsSameAccount(stored, credential) {
    const storedKey = stored.authKey === undefined ? undefined : stored.authKey.getKey();
    const credentialKey = credential.authKey === undefined ? undefined : credential.authKey.getKey();

    return storedKey !== undefined && credentialKey !== undefined && storedKey.equals(credentialKey);
}

// Opens the on-disk session, seeding it from the stored session string when it is empty or stale.
//
// **`setDC` before `authKey`, and the order is not arbitrary.** `MemorySession.setDC` replaces the auth
// key with whichever one it has cached for the new data centre whenever the id changes — so on a fresh
// store, which starts at dc 0, setting the key first and the data centre second throws the key away.
// Assigning the key afterwards also persists it, because that is a setter on StoreSession.
async function openStoredSession(name, sessionString, warn) {
    const stored = new StoreSession(name);
    await stored.load();

    const credential = new StringSession(sessionString);
    await credential.load();

    if (!holdsSameAccount(stored, credential)) {
        if (stored.authKey !== undefined) {
            // Dropped rather than merged. The rows are keyed by peer id, and an access hash from another
            // account is worse than no cache at all.
            stored.delete();
            warn('The stored session changed, so the cached peers were discarded. They will rebuild.');
        }

        stored.setDC(credential.dcId, credential.serverAddress, credential.port);
        stored.authKey = credential.authKey;
    }

    return stored;
}

module.exports = {
    SESSION_DIRECTORY,
    describeSessionStore,
    holdsSameAccount,
    openStoredSession,
};
