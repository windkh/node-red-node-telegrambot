// Created by Karl-Heinz Wind
'use strict';

// The node statuses, in one place.
//
// These texts are part of the package's public contract — a flow can route on them through a Status
// node — so every node has to report the same thing. They used to be declared separately in the
// receiver, sender, download and upload nodes. ADR 0010 recorded that as a liability and said the next
// node in this area should extract it rather than make a fifth copy; ADR 0015 is that extraction, and it
// happened because the liability had already come due: the `broken` text was corrected in two of the
// four nodes and left stale in the other two.
//
// `broken` gets a filled dot rather than a ring because it will not fix itself. teleproto reports it
// either for an unusable authorization key or for a reconnect that gave up, and both leave the sender
// dead — so the text names both remedies.
const CONNECTED = { fill: 'green', shape: 'ring', text: 'connected' };
const DISCONNECTED = { fill: 'red', shape: 'ring', text: 'disconnected' };
const BROKEN = { fill: 'red', shape: 'dot', text: 'broken: login again or redeploy' };

// The config node reports connection states by name; this is how a node turns one into a status.
const STATUS_BY_STATE = {
    connected: CONNECTED,
    disconnected: DISCONNECTED,
    broken: BROKEN,
};

// Yellow, because unlike the red states this is Telegram throttling a working connection.
function floodWaitStatus(seconds) {
    return { fill: 'yellow', shape: 'ring', text: 'flood wait ' + seconds + 's' };
}

// Blue and a filled dot for work in progress, so it reads as "busy", not "broken".
function busyStatus(text) {
    return { fill: 'blue', shape: 'dot', text: text };
}

// Subscribes a node to its config node's connection state.
//
// `apply` is how the state reaches the node, and it is a parameter because the nodes differ: most just
// call `node.status`, while the sender has to remember the state so a flood wait can revert to it.
//
// No `RED` here, and none needed: this only ever touches the object it is handed.
function attachConnectionStatus(node, apply) {
    node.onConnectionState = (state) => {
        const status = STATUS_BY_STATE[state];

        // A state this package does not map is not an error — it is a state it does not care about.
        if (status !== undefined) {
            apply(status);
        }
    };

    // A node with no config node has nothing to subscribe to; it reports `disconnected` and stays put.
    if (node.config) {
        node.config.addStatusListener(node);
    }
}

// The counterpart, for the node's close handler. Without it the config node keeps a reference to a
// closed node and writes statuses into it after a redeploy.
function detachConnectionStatus(node) {
    if (node.config) {
        node.config.removeStatusListener(node);
    }
}

module.exports = {
    CONNECTED,
    DISCONNECTED,
    BROKEN,
    STATUS_BY_STATE,
    floodWaitStatus,
    busyStatus,
    attachConnectionStatus,
    detachConnectionStatus,
};
