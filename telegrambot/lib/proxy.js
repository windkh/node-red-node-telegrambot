// Created by Karl-Heinz Wind
'use strict';

// Builds the `proxy` client parameter.
//
// teleproto's proxy option is a union of two unrelated shapes — SOCKS (`socksType`, `username`,
// `password`) and MTProxy (`MTProxy`, `secret`) — and it tells them apart by asking whether the
// `MTProxy` **key exists**, not whether it is true:
//
//     if (this._proxy && 'MTProxy' in this._proxy)   // client/telegramBaseClient.js
//
// The config node and the editor's login panel both used to build one flat object carrying every
// field, `MTProxy: false` included. That key made every SOCKS proxy look like an MTProxy: teleproto
// selected ConnectionTCPMTProxyAbridged, TCPMTProxy parsed the empty `secret` and threw
// `MTProxy: secret is required`, and PromisedNetSockets — which guards the SOCKS tunnel with the same
// check inverted — never opened the tunnel at all. So a SOCKS proxy could not connect, and failed in
// the vocabulary of a proxy type the user had not configured.
//
// Hence one function that emits one arm of the union and nothing of the other. It runs on the runtime
// path and on both login routes, whose parameters come from the browser in exactly the flat shape
// described above. Applying it to a proxy it already built is a no-op, which is what lets the config
// node hold the right shape and buildClientParams still normalise what the editor posts.
function buildProxy(fields) {
    let proxy;

    if (fields !== undefined) {
        proxy = {
            ip: fields.ip,
            port: fields.port,
            timeout: fields.timeout,
        };

        if (fields.MTProxy) {
            proxy.MTProxy = true;
            proxy.secret = fields.secret;
        } else {
            proxy.socksType = fields.socksType;
            proxy.username = fields.username;
            proxy.password = fields.password;
        }
    }

    return proxy;
}

module.exports = {
    buildProxy,
};
