// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { buildClientParams } = require('../telegrambot/lib/client-params');

describe('buildClientParams', () => {
    it('always sets the retry count and passes proxy and useWSS through', () => {
        const proxy = { ip: '127.0.0.1', port: 1080 };
        const params = buildClientParams({ proxy: proxy, useWSS: true });

        assert.strictEqual(params.connectionRetries, 5);
        assert.strictEqual(params.proxy, proxy);
        assert.strictEqual(params.useWSS, true);
    });

    it('omits the optional version fields when they are absent', () => {
        const params = buildClientParams({});

        assert.deepStrictEqual(Object.keys(params).sort(), ['connectionRetries', 'proxy', 'useWSS']);
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
