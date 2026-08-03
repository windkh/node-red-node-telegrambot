// Created by Karl-Heinz Wind
'use strict';

// Registered entry point (see package.json node-red.nodes). It only wires up the modules in
// ./nodes — all logic lives there and in ./lib. Registration order is significant: the config node
// must exist before the nodes that reference it.
module.exports = function (RED) {
    const pkg = require('./../package.json');
    RED.log.info('node-red-node-telegrambot version: v' + pkg.version);

    require('./nodes/login-endpoints')(RED);
    require('./nodes/config-node')(RED);
    require('./nodes/receiver-node')(RED);
    require('./nodes/sender-node')(RED);
    require('./nodes/download-node')(RED);
    require('./nodes/upload-node')(RED);
    require('./nodes/list-node')(RED);
};
