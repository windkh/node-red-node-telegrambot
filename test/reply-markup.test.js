// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { buildButtons, convertButtonsInArgs } = require('../telegrambot/lib/reply-markup');

// GramJS is not uniform here: the inline factories (url, inline, switchInline) return the TL object
// directly, while the keyboard ones (text, requestLocation, requestPhone) return a `Button` wrapper with
// the TL object on `.button`. buildReplyMarkup unwraps both, so both are valid to pass on.
function tlObject(button) {
    return button.button !== undefined ? button.button : button;
}

function classNames(rows) {
    return rows.map((row) => row.map((button) => tlObject(button).className));
}

describe('buildButtons', () => {
    it('builds a url button', () => {
        const rows = buildButtons([[{ type: 'url', text: 'Open', url: 'https://example.com' }]]);

        assert.deepStrictEqual(classNames(rows), [['KeyboardButtonUrl']]);
        assert.strictEqual(tlObject(rows[0][0]).text, 'Open');
        assert.strictEqual(tlObject(rows[0][0]).url, 'https://example.com');
    });

    it('builds a callback button with its data as bytes', () => {
        const rows = buildButtons([[{ type: 'callback', text: 'Yes', data: 'yes' }]]);

        assert.deepStrictEqual(classNames(rows), [['KeyboardButtonCallback']]);
        // Telegram carries callback data as bytes, so a JSON string has to be encoded.
        assert.strictEqual(tlObject(rows[0][0]).data.toString(), 'yes');
    });

    it('keeps the row and column layout', () => {
        const rows = buildButtons([
            [
                { type: 'callback', text: 'A', data: '1' },
                { type: 'callback', text: 'B', data: '2' },
            ],
            [{ type: 'url', text: 'C', url: 'https://example.com' }],
        ]);

        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].length, 2);
        assert.strictEqual(rows[1].length, 1);
    });

    it('accepts a flat row and a lone button', () => {
        const flat = buildButtons([{ type: 'url', text: 'A', url: 'https://example.com' }]);
        assert.strictEqual(flat.length, 1);
        assert.strictEqual(flat[0].length, 1);

        const lone = buildButtons({ type: 'url', text: 'A', url: 'https://example.com' });
        assert.strictEqual(lone.length, 1);
        assert.strictEqual(lone[0].length, 1);
    });

    it('names the offending position when a button is wrong', () => {
        // A keyboard is built once and sent many times; an error has to say which button is broken.
        assert.throws(
            () =>
                buildButtons([
                    [{ type: 'url', text: 'ok', url: 'https://example.com' }],
                    [{ type: 'url', text: 'no url here' }],
                ]),
            /buttons\[1\]\[0\].*'url'/
        );
    });

    it('rejects an unknown type and lists the known ones', () => {
        assert.throws(() => buildButtons([[{ type: 'teleport', text: 'x' }]]), /unknown button type 'teleport'/);
        assert.throws(() => buildButtons([[{ type: 'teleport', text: 'x' }]]), /url, callback/);
    });

    it('rejects a button with no text', () => {
        assert.throws(() => buildButtons([[{ type: 'url', url: 'https://example.com' }]]), /needs a text/);
        assert.throws(() => buildButtons([[{ type: 'url', text: '', url: 'https://example.com' }]]), /needs a text/);
    });

    it('rejects a callback button with no data', () => {
        assert.throws(() => buildButtons([[{ type: 'callback', text: 'x' }]]), /needs a 'data'/);
    });

    it('rejects something that is not an object', () => {
        assert.throws(() => buildButtons([['just a string']]), /must be an object/);
    });
});

describe('convertButtonsInArgs', () => {
    it('converts buttons in the options object, which is the last argument', () => {
        const args = ['someone', { message: 'hi', buttons: [[{ type: 'url', text: 'Open', url: 'https://x.dev' }]] }];

        const converted = convertButtonsInArgs(args);

        assert.strictEqual(converted[0], 'someone', 'the entity is untouched');
        assert.strictEqual(converted[1].message, 'hi', 'the other options survive');
        assert.strictEqual(tlObject(converted[1].buttons[0][0]).className, 'KeyboardButtonUrl');
    });

    it('leaves args without buttons exactly as they were', () => {
        const args = ['someone', { message: 'hi' }];

        assert.deepStrictEqual(convertButtonsInArgs(args), args);
        assert.deepStrictEqual(convertButtonsInArgs([]), []);
        assert.deepStrictEqual(convertButtonsInArgs(['only-a-string']), ['only-a-string']);
    });

    it('does not mutate the args it was given', () => {
        const options = { message: 'hi', buttons: [[{ type: 'url', text: 'Open', url: 'https://x.dev' }]] };
        const args = ['someone', options];

        convertButtonsInArgs(args);

        // The node reuses msg between retries and Catch nodes; rewriting it in place would surprise.
        assert.deepStrictEqual(options.buttons, [[{ type: 'url', text: 'Open', url: 'https://x.dev' }]]);
    });

    it('ignores a buttons property that is not an array', () => {
        const args = ['someone', { message: 'hi', buttons: 'nonsense' }];

        assert.deepStrictEqual(convertButtonsInArgs(args), args);
    });
});
