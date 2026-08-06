// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { buildProxy } = require('../telegrambot/lib/proxy');

// A valid 16-byte plain secret. Nothing here parses it — teleproto does that at connect time — but a
// real one keeps the fixture honest about what the field holds.
const MTPROXY_SECRET = '0123456789abcdef'.repeat(2);

// What the editor's login panel posts: every field at once, both proxy types mixed, with the
// checkboxes as booleans. The runtime built the same flat object before this module existed.
const editorFields = {
    ip: '127.0.0.1',
    socksType: 5,
    port: 1080,
    username: 'user',
    password: 'proxy-pw',
    secret: '',
    MTProxy: false,
    timeout: 2,
};

describe('buildProxy', () => {
    it('leaves the MTProxy key out for a SOCKS proxy', () => {
        // The whole point of this module. teleproto asks `'MTProxy' in proxy`, so a `false` here is
        // still an MTProxy to it — the key has to be absent, not falsy.
        const proxy = buildProxy(editorFields);

        assert.ok(!('MTProxy' in proxy), 'a SOCKS proxy must not carry the MTProxy discriminant');
        assert.ok(!('secret' in proxy), 'the MTProxy secret has no meaning for SOCKS');
    });

    it('keeps the SOCKS fields, including the proxy password', () => {
        const proxy = buildProxy(editorFields);

        assert.strictEqual(proxy.ip, '127.0.0.1');
        assert.strictEqual(proxy.port, 1080);
        assert.strictEqual(proxy.socksType, 5);
        assert.strictEqual(proxy.username, 'user');
        // The SOCKS password, not the account's two-step-verification password. They used to share a
        // name and a DOM id; keeping them apart is a rule, so assert it here too.
        assert.strictEqual(proxy.password, 'proxy-pw');
        assert.strictEqual(proxy.timeout, 2);
    });

    it('emits only the MTProxy arm when MTProxy is on', () => {
        const proxy = buildProxy({ ...editorFields, MTProxy: true, secret: MTPROXY_SECRET });

        assert.strictEqual(proxy.MTProxy, true);
        assert.strictEqual(proxy.secret, MTPROXY_SECRET);
        assert.ok(!('socksType' in proxy), 'socksType has no meaning for an MTProxy');
        assert.ok(!('username' in proxy), 'MTProxy has no username/password authentication');
        assert.ok(!('password' in proxy));
    });

    it('keeps the address fields for both types', () => {
        for (const mtProxy of [false, true]) {
            const proxy = buildProxy({ ...editorFields, MTProxy: mtProxy, secret: MTPROXY_SECRET });

            assert.deepStrictEqual(
                { ip: proxy.ip, port: proxy.port, timeout: proxy.timeout },
                { ip: '127.0.0.1', port: 1080, timeout: 2 },
                `address fields lost with MTProxy=${mtProxy}`
            );
        }
    });

    it('builds nothing when no proxy is configured', () => {
        assert.strictEqual(buildProxy(undefined), undefined);
    });

    it('is a no-op on a proxy it built', () => {
        // The config node builds one and buildClientParams runs the same function over it again, so
        // a second pass must not turn a SOCKS proxy into something else.
        for (const fields of [editorFields, { ...editorFields, MTProxy: true, secret: MTPROXY_SECRET }]) {
            const once = buildProxy(fields);

            assert.deepStrictEqual(buildProxy(once), once);
        }
    });
});

describe('buildProxy against teleproto', () => {
    // Asserted against the library rather than against a restatement of it: what makes the `MTProxy`
    // key dangerous is a branch inside teleproto, and only teleproto can be held to it. Nothing here
    // connects — the constructor only picks the connection class and builds the InitConnection.
    const { TelegramClient } = require('teleproto');
    const { StringSession } = require('teleproto/sessions');
    const { Logger } = require('teleproto/extensions');
    const { ConnectionTCPFull } = require('teleproto/network');

    const connect = (proxy) =>
        new TelegramClient(new StringSession(''), 12345, 'hash', {
            baseLogger: new Logger(undefined),
            proxy: proxy,
        });

    it('lets a SOCKS proxy keep the ordinary TCP connection', () => {
        const client = connect(buildProxy(editorFields));

        assert.strictEqual(client._connection, ConnectionTCPFull, 'SOCKS runs over the normal connection');
        // InputClientProxy tells Telegram it is being reached through an MTProxy. A SOCKS proxy is
        // invisible to the server, so this must stay unset.
        assert.strictEqual(client._initRequest.proxy, undefined);
    });

    it('selects the MTProxy connection when MTProxy is on', () => {
        const client = connect(buildProxy({ ...editorFields, MTProxy: true, secret: MTPROXY_SECRET }));

        assert.notStrictEqual(client._connection, ConnectionTCPFull);
        assert.strictEqual(client._connection.name, 'ConnectionTCPMTProxyAbridged');
        assert.notStrictEqual(client._initRequest.proxy, undefined, 'Telegram is told about an MTProxy');
    });

    it('is why the flat object could not connect', () => {
        // The bug this module fixes, pinned so it cannot come back unnoticed: hand teleproto the
        // editor's object as it comes, and a SOCKS proxy becomes an MTProxy with an empty secret —
        // which fails at connect time with `MTProxy: secret is required`, naming a proxy type the
        // user never configured.
        const client = connect({ ...editorFields });

        assert.strictEqual(client._connection.name, 'ConnectionTCPMTProxyAbridged');
    });
});
