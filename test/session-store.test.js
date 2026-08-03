// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AuthKey } = require('teleproto/crypto/AuthKey');
const { StringSession } = require('teleproto/sessions');

const {
    SESSION_DIRECTORY,
    describeSessionStore,
    holdsSameAccount,
    openStoredSession,
} = require('../telegrambot/lib/session-store');
const { openSession } = require('../telegrambot/lib/telegram-client');

// Not a real key and not a real account — 256 bytes of a repeated byte is enough for AuthKey, and
// AGENTS.md forbids a real session in a fixture.
async function fakeAuthKey(fill) {
    const key = new AuthKey();
    await key.setKey(Buffer.alloc(256, fill));

    return key;
}

// A session string of the shape the credential holds, built rather than pasted.
async function fakeSessionString(fill) {
    const session = new StringSession('');
    session.setDC(2, '149.154.167.51', 443);
    session.setAuthKey(await fakeAuthKey(fill));

    return session.save();
}

describe('describeSessionStore', () => {
    it('puts the store under the user directory, expressed relative to the working directory', () => {
        // StoreSession hardcodes `new LocalStorage('./' + name)`, so a relative name is the only way to
        // choose the location at all. This asserts where it lands, not how the string looks.
        const described = describeSessionStore('/opt/node-red-data', 'abc123', '/opt/node-red-data');

        assert.strictEqual(described.asAsked, true);
        assert.strictEqual(
            path.resolve('/opt/node-red-data', described.name),
            path.resolve('/opt/node-red-data', SESSION_DIRECTORY, 'abc123')
        );
    });

    it('still resolves correctly when the working directory is somewhere else entirely', () => {
        const described = describeSessionStore('/opt/node-red-data', 'abc123', '/usr/src/node-red');

        assert.strictEqual(described.asAsked, true);
        assert.ok(!path.isAbsolute(described.name), 'an absolute name would be mangled by the ./ prefix');
        assert.strictEqual(
            path.resolve('/usr/src/node-red', described.name),
            path.resolve('/opt/node-red-data', SESSION_DIRECTORY, 'abc123')
        );
    });

    it('gives every config node its own store', () => {
        // store2 keys its areas by name for the whole process, so two config nodes sharing a name would
        // share one store — and with it one account's auth key.
        const first = describeSessionStore('/data', 'aaa', '/data');
        const second = describeSessionStore('/data', 'bbb', '/data');

        assert.notStrictEqual(first.name, second.name);
    });

    it('never asks StoreSession for the one name it rejects', () => {
        // `new StoreSession('session')` throws. The name always carries the directory prefix, so it
        // cannot come out as exactly that — this says so out loud.
        const described = describeSessionStore('/data', 'session', '/data');

        assert.notStrictEqual(described.name, 'session');
    });
});

describe('holdsSameAccount', () => {
    it('is false when the store is empty, which is what makes a first run seed itself', async () => {
        const credential = { authKey: await fakeAuthKey(7) };

        assert.strictEqual(holdsSameAccount({ authKey: undefined }, credential), false);
    });

    it('is false when the keys differ, which is what makes a re-login re-seed', async () => {
        const stored = { authKey: await fakeAuthKey(7) };
        const credential = { authKey: await fakeAuthKey(9) };

        assert.strictEqual(holdsSameAccount(stored, credential), false);
    });

    it('is true for the same key, so a normal restart keeps the cached peers', async () => {
        const stored = { authKey: await fakeAuthKey(7) };
        const credential = { authKey: await fakeAuthKey(7) };

        assert.strictEqual(holdsSameAccount(stored, credential), true);
    });
});

// These write to disk, which is the whole point of the feature, so they run in a temporary working
// directory and clean up after themselves. Nothing here talks to Telegram.
describe('openStoredSession', () => {
    let temporary;
    let previous;

    before(() => {
        previous = process.cwd();
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'telegrambot-store-'));
        process.chdir(temporary);
    });

    after(() => {
        process.chdir(previous);
        fs.rmSync(temporary, { recursive: true, force: true });
    });

    it('seeds an empty store from the session credential', async () => {
        const sessionString = await fakeSessionString(7);
        const warnings = [];

        const stored = await openStoredSession('store-seed', sessionString, (message) => warnings.push(message));

        assert.strictEqual(stored.dcId, 2);
        assert.strictEqual(stored.serverAddress, '149.154.167.51');
        assert.strictEqual(stored.port, 443);
        assert.ok(stored.authKey.getKey().equals(Buffer.alloc(256, 7)), 'the credential key must be adopted');
        // Nothing was discarded, so there is nothing to report.
        assert.deepStrictEqual(warnings, []);
    });

    it('keeps the cached peers across a restart with the same credential', async () => {
        const sessionString = await fakeSessionString(7);

        const first = await openStoredSession('store-keep', sessionString, () => {});
        // The shape MemorySession._entitiesToRows produces: [id, hash, username, phone, name].
        first.store.set(first.sessionName + '4242', ['4242', '99', 'someone', '', 'Someone']);

        // A second open is what a Node-RED restart looks like from here.
        const second = await openStoredSession('store-keep', sessionString, () => {});

        assert.deepStrictEqual(second.getEntityRowsById('4242'), ['4242', '99', 'someone', '', 'Someone']);
    });

    it('discards the cached peers when the credential changed, and says so', async () => {
        const original = await fakeSessionString(7);
        const replacement = await fakeSessionString(9);

        const first = await openStoredSession('store-relogin', original, () => {});
        first.store.set(first.sessionName + '4242', ['4242', '99', 'someone', '', 'Someone']);

        const warnings = [];
        const second = await openStoredSession('store-relogin', replacement, (message) => warnings.push(message));

        // An access hash from another account is worse than no cache: it would be sent and rejected.
        // store2 answers a missing key with null rather than undefined, so this accepts either kind of
        // nothing and reports what it actually found.
        const stale = second.getEntityRowsById('4242');
        assert.ok(stale === null || stale === undefined, 'stale peers must not survive, got ' + JSON.stringify(stale));
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /cached peers/);
        assert.ok(second.authKey.getKey().equals(Buffer.alloc(256, 9)), 'the new credential wins');
    });

    it('uses the on-disk session only when the option is set', async () => {
        // The switch itself, which nothing covered: removing the branch in either direction passed the
        // whole suite. What it decides is whether this account's auth key is written to disk.
        const sessionString = await fakeSessionString(7);

        const off = await openSession({ session: sessionString, sessionStore: '' }, () => {});
        assert.strictEqual(off.constructor.name, 'StringSession', 'the default must keep nothing on disk');
        assert.strictEqual(fs.existsSync(path.join(temporary, 'store-switch')), false, 'nothing may be written');

        const on = await openSession({ session: sessionString, sessionStore: 'store-switch' }, () => {});
        assert.strictEqual(on.constructor.name, 'StoreSession');
        assert.ok(fs.existsSync(path.join(temporary, 'store-switch')), 'the store must be written when asked for');
    });

    it('treats an absent sessionStore the same as an empty one', async () => {
        const off = await openSession({ session: await fakeSessionString(7) }, () => {});

        assert.strictEqual(off.constructor.name, 'StringSession');
    });

    it('writes where it was told to', async () => {
        await openStoredSession(path.join('nested', 'store-here'), await fakeSessionString(7), () => {});

        assert.ok(
            fs.existsSync(path.join(temporary, 'nested', 'store-here')),
            'the store directory is not where it was asked for'
        );
    });
});
