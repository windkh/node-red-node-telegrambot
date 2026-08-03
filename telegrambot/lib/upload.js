// Created by Karl-Heinz Wind
'use strict';

const { CustomFile } = require('teleproto/client/uploads');

// Turns what a Node-RED flow has into what teleproto wants to upload.
//
// teleproto does accept a bare Buffer, but look at how it names one (`_fileToMedia` in
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
// A path needs nothing: teleproto stats it and uses the basename.

// One file. `position` is the album index, or undefined for a single file — it only affects the wording
// of an error, so that "which of the five did I get wrong" is answerable.
//
// The size comes from the Buffer's own length and nowhere else. `CustomFile(name, size, path, buffer)`
// takes a size, and accepting one from the caller would let the two disagree.
function describeFile(payload, filename, position) {
    const at = position === undefined ? '' : '[' + position + ']';
    let described;

    if (Buffer.isBuffer(payload)) {
        // A non-empty string, not merely "present": `null` is what a Change node leaves behind when it
        // clears the property, and CustomFile would take it and name the file `null`.
        if (typeof filename === 'string' && filename !== '') {
            described = { file: new CustomFile(filename, payload.length, '', payload) };
        } else {
            // Not guessed at: an invented name only moves the surprise to the recipient's chat.
            described = { error: 'msg.filename' + at + ' is required when msg.payload' + at + ' is a Buffer.' };
        }
    } else if (typeof payload === 'string' && payload !== '') {
        described = { file: payload };
    } else {
        described = { error: 'msg.payload' + at + ' must be a Buffer or a file path.' };
    }

    return described;
}

// An album. teleproto's sendFile takes an array for `file`, and Telegram groups them into one album.
// Every Buffer in it still needs its own name, so `msg.filename` is an array aligned by index; a path
// in the array needs no entry.
//
// The first bad item stops the whole album rather than sending a partial one — an album is a unit, and
// half of it arriving is worse than none.
function describeAlbum(payloads, filenames) {
    const names = Array.isArray(filenames) ? filenames : [];
    const files = [];
    let error;

    if (payloads.length > 0) {
        for (const [position, payload] of payloads.entries()) {
            const described = describeFile(payload, names[position], position);

            if (described.error === undefined) {
                files.push(described.file);
            } else {
                error = described.error;
                break;
            }
        }
    } else {
        error = 'msg.payload is an empty array: nothing to send.';
    }

    return error === undefined ? { file: files } : { error: error };
}

// What the node calls: one file or an album, with the error already worded.
function describeUpload(payload, filename) {
    let described;

    if (Array.isArray(payload)) {
        described = describeAlbum(payload, filename);
    } else {
        described = describeFile(payload, filename, undefined);
    }

    return described;
}

module.exports = {
    describeUpload,
};
