// Created by Karl-Heinz Wind
'use strict';

// Builds the TelegramClient constructor options. The device/system/app version are optional:
// GramJS applies its own defaults when they are absent, so an empty string must not be passed on.
function buildClientParams(options) {
    const clientParams = {
        connectionRetries: 5,
        proxy: options.proxy,
        useWSS: options.useWSS,
    };

    const deviceModel = options.deviceModel || '';
    const systemVersion = options.systemVersion || '';
    const appVersion = options.appVersion || '';

    if (deviceModel !== '') {
        clientParams.deviceModel = deviceModel;
    }
    if (systemVersion !== '') {
        clientParams.systemVersion = systemVersion;
    }
    if (appVersion !== '') {
        clientParams.appVersion = appVersion;
    }

    return clientParams;
}

module.exports = {
    buildClientParams,
};
