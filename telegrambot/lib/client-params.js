// Created by Karl-Heinz Wind
'use strict';

const { buildProxy } = require('./proxy');

// Builds the TelegramClient constructor options.
//
// `connectionRetries` is deliberately not set. The library defaults it to Infinity, which is what a
// long-running Node-RED flow wants: a router reboot or a brief ISP outage must not kill a receiver for
// good. This used to be pinned to 5 which, with the 1s retryDelay, meant roughly five seconds of
// network trouble left the client permanently dead — and because the config node caches it,
// getTelegramClient kept handing back the same dead object until the next redeploy.
//
// `retryDelay`, `timeout` and `autoReconnect` are left at their defaults too, for the same reason:
// the library recovers from transient failures on its own, and a second recovery mechanism racing it
// would be worse than none. See doc/architecture/adr/0006-connection-state.md.
//
// There is no `useWSS`: teleproto dropped it, and in Node it never selected a WebSocket transport
// anyway — it only chose port 443 over 80 for a session that had no stored DC yet. teleproto uses 443
// unconditionally, so the one effect the option had is now the default.
// See doc/architecture/adr/0013-migrate-to-teleproto.md.
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
    // Through ./proxy rather than straight across: the two login routes take theirs from the editor,
    // which posts every proxy field at once, and teleproto reads that as an MTProxy. See ./proxy.
    const clientParams = {
        proxy: buildProxy(options.proxy),
    };

    // How long the library silently sleeps through a FLOOD_WAIT before giving up and throwing. Omitted
    // when unset so the library default (60s) applies.
    const floodSleepThreshold = parseOptionalSeconds(options.floodSleepThreshold);
    if (floodSleepThreshold !== undefined) {
        clientParams.floodSleepThreshold = floodSleepThreshold;
    }

    // Passed through as they come, empty included. These used to be omitted when empty, on the stated
    // grounds that an empty string would override the library's defaults. It would not: teleproto's own
    // defaults set all three to `''` and then fall back on a falsy value —
    //
    //     deviceModel: clientParams.deviceModel || os.type().toString() || 'Unknown',
    //
    // so absent and empty are the same thing to it, and the three checks that enforced the distinction
    // did nothing. See doc/architecture/adr/0021-lean-on-the-library.md.
    clientParams.deviceModel = options.deviceModel || '';
    clientParams.systemVersion = options.systemVersion || '';
    clientParams.appVersion = options.appVersion || '';

    return clientParams;
}

module.exports = {
    buildClientParams,
};
