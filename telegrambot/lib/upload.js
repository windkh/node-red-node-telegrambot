// Created by Karl-Heinz Wind
'use strict';

const { CustomFile } = require('telegram/client/uploads');

// Turns what a Node-RED flow has into what GramJS wants to upload.
//
// GramJS does accept a bare Buffer, but look at how it names one (`_fileToMedia` in
// client/uploads.js):
//
//     let name;
//     if ("name" in file) { name = file.name; } else { name = "unnamed"; }
//     if (Buffer.isBuffer(file)) { createdFile = new CustomFile(name, file.length, "", file); }
//
// A Buffer has no `name`, so the file arrives in the chat called "unnamed". Wrapping it in a
// CustomFile ourselves is what makes it arrive with the name the flow intended — and CustomFile is not
// something a Function node can require, which is why this belongs in the package.
//
// A path needs nothing: GramJS stats it and uses the basename.
//
// Returns undefined for anything that is not uploadable, leaving the caller to report it.
function toUploadFile(payload, filename) {
    let file;

    if (Buffer.isBuffer(payload)) {
        file = new CustomFile(filename, payload.length, '', payload);
    } else if (typeof payload === 'string' && payload !== '') {
        file = payload;
    }

    return file;
}

// A Buffer carries no name of its own, so one has to be supplied. A path does not need one.
function needsFilename(payload) {
    return Buffer.isBuffer(payload);
}

module.exports = {
    toUploadFile,
    needsFilename,
};
