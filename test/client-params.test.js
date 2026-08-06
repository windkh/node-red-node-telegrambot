// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { buildClientParams } = require('../telegrambot/lib/client-params');

describe('buildClientParams', () => {
    it('passes the proxy through', () => {
        const proxy = { ip: '127.0.0.1', port: 1080, socksType: 5 };
        const params = buildClientParams({ proxy: proxy });

        assert.strictEqual(params.proxy.ip, '127.0.0.1');
        assert.strictEqual(params.proxy.port, 1080);
        assert.strictEqual(params.proxy.socksType, 5);
    });

    it('normalises what the editor posts, which is both proxy types at once', () => {
        // The login routes take their proxy straight from the browser, where every field is filled in
        // and `MTProxy` is a checkbox — so it arrives as `false` rather than absent, and teleproto
        // reads the mere presence of that key as "this is an MTProxy". See lib/proxy.js.
        const params = buildClientParams({
            proxy: { ip: '127.0.0.1', port: 1080, socksType: 5, secret: '', MTProxy: false },
        });

        assert.ok(!('MTProxy' in params.proxy), 'a SOCKS proxy must not reach teleproto with the key set');
        assert.strictEqual(params.proxy.socksType, 5);
    });

    it('never passes useWSS, which teleproto does not have', () => {
        // teleproto removed the option. Passing an unknown key would be silently ignored rather than
        // rejected, so nothing would fail loudly — hence this assertion.
        const params = buildClientParams({ proxy: undefined, useWSS: true });

        assert.ok(!('useWSS' in params), 'useWSS is not a teleproto client parameter');
    });

    it('leaves the retry and timeout behaviour to the library', () => {
        const params = buildClientParams({ proxy: undefined });

        // This used to pin connectionRetries to 5, which with the 1s retryDelay meant about five
        // seconds of network trouble left the client permanently dead. The library defaults it to
        // Infinity, which is what a long-running flow needs — so the key must not be set at all.
        assert.ok(!('connectionRetries' in params), 'connectionRetries must be left to the library');
        assert.ok(!('retryDelay' in params));
        assert.ok(!('timeout' in params));
        assert.ok(!('autoReconnect' in params));
    });

    it('omits floodSleepThreshold when it is unset', () => {
        assert.ok(!('floodSleepThreshold' in buildClientParams({})));
        assert.ok(!('floodSleepThreshold' in buildClientParams({ floodSleepThreshold: '' })));
    });

    it('passes a configured floodSleepThreshold through', () => {
        assert.strictEqual(buildClientParams({ floodSleepThreshold: '120' }).floodSleepThreshold, 120);
        assert.strictEqual(buildClientParams({ floodSleepThreshold: 120 }).floodSleepThreshold, 120);
    });

    it('keeps a floodSleepThreshold of zero, which means never sleep', () => {
        // 0 is meaningful here, so emptiness cannot be a falsy check. The editor stores '0' as a
        // string, but a numeric 0 is what actually catches a falsy guard — assert both.
        assert.strictEqual(buildClientParams({ floodSleepThreshold: '0' }).floodSleepThreshold, 0);
        assert.strictEqual(buildClientParams({ floodSleepThreshold: 0 }).floodSleepThreshold, 0);
    });

    it('ignores a floodSleepThreshold that is not a usable number', () => {
        // The editor validates this; if something invalid gets through, fall back to the library default
        // rather than handing teleproto a NaN.
        assert.ok(!('floodSleepThreshold' in buildClientParams({ floodSleepThreshold: 'soon' })));
        assert.ok(!('floodSleepThreshold' in buildClientParams({ floodSleepThreshold: '-5' })));
    });

    it('passes the version fields through, empty included', () => {
        const params = buildClientParams({});

        assert.deepStrictEqual(Object.keys(params).sort(), ['appVersion', 'deviceModel', 'proxy', 'systemVersion']);
        assert.strictEqual(params.deviceModel, '');
    });

    it('is safe to pass them empty, which is why they are no longer omitted', () => {
        // The premise the simplification rests on, asserted against the library rather than against a
        // restatement of it: teleproto's defaults set all three to '' and then fall back on any falsy
        // value, so absent and empty produce the same InitConnection. If that ever stops being true,
        // this fails and the omission has to come back.
        const { TelegramClient } = require('teleproto');
        const { StringSession } = require('teleproto/sessions');
        const { Logger } = require('teleproto/extensions');

        // A silent logger, because constructing a client otherwise prints a version banner. Nothing here
        // connects — the constructor only builds the InitConnection.
        const quiet = () => new Logger(undefined);
        const build = (options) =>
            new TelegramClient(new StringSession(''), 12345, 'hash', { baseLogger: quiet(), ...options });

        const withEmpty = build(buildClientParams({ deviceModel: '', systemVersion: '', appVersion: '' }));
        const withNothing = build({});

        for (const field of ['deviceModel', 'systemVersion', 'appVersion']) {
            assert.strictEqual(
                withEmpty._initRequest[field],
                withNothing._initRequest[field],
                `an empty ${field} must reach Telegram as the library's own default`
            );
            assert.notStrictEqual(withEmpty._initRequest[field], '', `${field} must not go out empty`);
        }
    });

    it('includes the optional version fields when they are set', () => {
        const params = buildClientParams({
            deviceModel: 'Pixel',
            systemVersion: 'Android 14',
            appVersion: '1.2.3',
        });

        assert.strictEqual(params.deviceModel, 'Pixel');
        assert.strictEqual(params.systemVersion, 'Android 14');
        assert.strictEqual(params.appVersion, '1.2.3');
    });
});
