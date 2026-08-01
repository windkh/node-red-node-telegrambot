// Created by Karl-Heinz Wind
'use strict';

// Registered entry point (see package.json node-red.nodes). It only wires up the modules in
// ./nodes — all logic lives there and in ./lib. Registration order is significant: the config node
// must exist before the nodes that reference it.
module.exports = function (RED) {
    require('./nodes/login-endpoints')(RED);
    require('./nodes/config-node')(RED);
    require('./nodes/receiver-node')(RED);
    require('./nodes/sender-node')(RED);
    require('./nodes/download-node')(RED);
    require('./nodes/upload-node')(RED);
};
