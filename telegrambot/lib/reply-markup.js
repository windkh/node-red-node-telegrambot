// Created by Karl-Heinz Wind
'use strict';

const { Button } = require('teleproto/tl/custom/button');

// Turns a plain-JSON button description into the teleproto `Button` objects that `sendMessage` and
// `sendFile` accept as their `buttons` option.
//
// This exists because a Function node cannot `require` teleproto: a flow can only produce JSON, so
// something in the package has to do the conversion.
//
// Shape — an array of rows, each row an array of buttons:
//
//     [
//         [{ type: 'url', text: 'Open', url: 'https://example.com' }],
//         [{ type: 'callback', text: 'Yes', data: 'yes' }, { type: 'callback', text: 'No', data: 'no' }]
//     ]
//
// A single row may be given flat, and a single button on its own, mirroring what teleproto itself accepts.

// `auth` needs a bot entity, and `requestPoll` / `clear` / `forceReply` describe the markup rather than a
// button, so none of them fit this shape. Left out rather than half-supported.
const BUILDERS = {
    url: (button) => Button.url(button.text, button.url),
    callback: (button) => Button.inline(button.text, Buffer.from(String(button.data))),
    switchInline: (button) => Button.switchInline(button.text, button.query || '', button.samePeer || false),
    text: (button) => Button.text(button.text),
    requestLocation: (button) => Button.requestLocation(button.text),
    requestPhone: (button) => Button.requestPhone(button.text),
};

const REQUIRED_FIELD = {
    url: 'url',
    callback: 'data',
};

// `where` names the position so an error points at the offending button rather than the whole keyboard.
function buildButton(button, where) {
    let built;

    if (button === null || typeof button !== 'object') {
        throw new Error(`${where}: each button must be an object.`);
    } else if (BUILDERS[button.type] === undefined) {
        throw new Error(
            `${where}: unknown button type '${button.type}'. Known types: ${Object.keys(BUILDERS).join(', ')}.`
        );
    } else if (typeof button.text !== 'string' || button.text === '') {
        throw new Error(`${where}: a button needs a text.`);
    } else if (REQUIRED_FIELD[button.type] !== undefined && !button[REQUIRED_FIELD[button.type]]) {
        throw new Error(`${where}: a '${button.type}' button needs a '${REQUIRED_FIELD[button.type]}'.`);
    } else {
        built = BUILDERS[button.type](button);
    }

    return built;
}

// Accepts rows of buttons, a single flat row, or one button on its own.
function toRows(description) {
    let rows;

    if (!Array.isArray(description)) {
        rows = [[description]];
    } else if (description.length > 0 && !Array.isArray(description[0])) {
        rows = [description];
    } else {
        rows = description;
    }

    return rows;
}

function buildButtons(description) {
    return toRows(description).map((row, rowIndex) => {
        const entries = Array.isArray(row) ? row : [row];

        return entries.map((button, index) => buildButton(button, `buttons[${rowIndex}][${index}]`));
    });
}

// The client methods take their options as the last argument, and that is where `buttons` belongs. Only
// a plain-JSON description is converted: anything already built is passed through untouched, so a flow
// that somehow has real Button objects is not broken by this.
function convertButtonsInArgs(args) {
    const converted = [...args];
    const last = converted[converted.length - 1];

    if (last !== null && typeof last === 'object' && !Array.isArray(last) && Array.isArray(last.buttons)) {
        converted[converted.length - 1] = { ...last, buttons: buildButtons(last.buttons) };
    }

    return converted;
}

module.exports = {
    buildButtons,
    convertButtonsInArgs,
};
