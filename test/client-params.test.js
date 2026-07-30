// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { buildClientParams } = require('../telegrambot/lib/client-params');

describe('buildClientParams', () => {
    it('passes proxy and useWSS through', () => {
        const proxy = { ip: '127.0.0.1', port: 1080 };
        const params = buildClientParams({ proxy: proxy, useWSS: true });

        assert.strictEqual(params.proxy, proxy);
        assert.strictEqual(params.useWSS, true);
    });

    it('leaves the retry and timeout behaviour to GramJS', () => {
        const params = buildClientParams({ proxy: undefined, useWSS: false });

        // This used to pin connectionRetries to 5, which with the 1s retryDelay meant about five
        // seconds of network trouble left the client permanently dead. GramJS defaults it to Infinity,
        // which is what a long-running flow needs — so the key must not be set at all.
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
        // rather than handing GramJS a NaN.
        assert.ok(!('floodSleepThreshold' in buildClientParams({ floodSleepThreshold: 'soon' })));
        assert.ok(!('floodSleepThreshold' in buildClientParams({ floodSleepThreshold: '-5' })));
    });

    it('omits the optional version fields when they are absent', () => {
        const params = buildClientParams({});

        assert.deepStrictEqual(Object.keys(params).sort(), ['proxy', 'useWSS']);
    });

    it('omits the optional version fields when they are empty strings', () => {
        const params = buildClientParams({ deviceModel: '', systemVersion: '', appVersion: '' });

        assert.ok(!('deviceModel' in params));
        assert.ok(!('systemVersion' in params));
        assert.ok(!('appVersion' in params));
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
