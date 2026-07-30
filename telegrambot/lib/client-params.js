// Created by Karl-Heinz Wind
'use strict';

// Builds the TelegramClient constructor options. The device/system/app version are optional:
// GramJS applies its own defaults when they are absent, so an empty string must not be passed on.
//
// `connectionRetries` is deliberately not set. GramJS defaults it to Infinity, which is what a
// long-running Node-RED flow wants: a router reboot or a brief ISP outage must not kill a receiver for
// good. This used to be pinned to 5 which, with the 1s retryDelay, meant roughly five seconds of
// network trouble left the client permanently dead — and because the config node caches it,
// getTelegramClient kept handing back the same dead object until the next redeploy.
//
// `retryDelay`, `timeout` and `autoReconnect` are left at their defaults too, for the same reason:
// GramJS recovers from transient failures on its own, and a second recovery mechanism racing it would
// be worse than none. See doc/architecture/adr/0006-connection-state.md.
// Unlike the string options, 0 is a meaningful value here — it means "never sleep, fail immediately" —
// so emptiness cannot be tested with a plain falsy check.
function parseOptionalSeconds(value) {
    let seconds;

    if (value !== undefined && value !== null && value !== '') {
        const candidate = Number(value);
        if (Number.isFinite(candidate) && candidate >= 0) {
            seconds = candidate;
        }
    }

    return seconds;
}

function buildClientParams(options) {
    const clientParams = {
        proxy: options.proxy,
        useWSS: options.useWSS,
    };

    // How long GramJS silently sleeps through a FLOOD_WAIT before giving up and throwing. Omitted when
    // unset so the library default (60s) applies.
    const floodSleepThreshold = parseOptionalSeconds(options.floodSleepThreshold);
    if (floodSleepThreshold !== undefined) {
        clientParams.floodSleepThreshold = floodSleepThreshold;
    }

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
