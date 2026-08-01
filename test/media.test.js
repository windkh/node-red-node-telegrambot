// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { findMessage, describeMedia, mediaSize } = require('../telegrambot/lib/media');

// Plain objects with the `className` discriminator GramJS puts on every TL object. Verified against the
// real shapes: Api.Document carries a BigInt `size`, `mimeType` and an attributes array, and
// Api.PhotoSize carries a numeric `size`.
function document(overrides) {
    return {
        className: 'MessageMediaDocument',
        document: {
            className: 'Document',
            id: 555n,
            size: 1234567n,
            mimeType: 'video/mp4',
            attributes: [{ className: 'DocumentAttributeFilename', fileName: 'clip.mp4' }],
            ...overrides,
        },
    };
}

function photo(sizes) {
    return {
        className: 'MessageMediaPhoto',
        photo: { className: 'Photo', id: 777n, sizes: sizes },
    };
}

describe('findMessage', () => {
    it('unwraps what the receiver emits', () => {
        const message = { media: document() };
        const payload = { type: 'NewMessage', message: message, sender: {}, chat: {} };

        assert.strictEqual(findMessage(payload), message);
    });

    it('accepts a bare message too', () => {
        const message = { media: document() };

        assert.strictEqual(findMessage(message), message);
    });

    it('returns nothing for a payload that is not a message', () => {
        for (const payload of [undefined, null, 'text', 42, {}, { foo: 'bar' }]) {
            assert.strictEqual(findMessage(payload), undefined, JSON.stringify(payload));
        }
    });
});

describe('describeMedia for a document', () => {
    it('uses the document filename and mime type', () => {
        const description = describeMedia(document());

        assert.strictEqual(description.filename, 'clip.mp4');
        assert.strictEqual(description.mimeType, 'video/mp4');
    });

    it('converts the BigInt size to a number', () => {
        const description = describeMedia(document());

        assert.strictEqual(description.size, 1234567);
        assert.strictEqual(typeof description.size, 'number', 'a BigInt cannot be compared to a limit');
    });

    it('generates a name with an extension when the document has none', () => {
        const description = describeMedia(document({ attributes: [] }));

        assert.strictEqual(description.filename, 'telegram-555.mp4');
    });

    it('leaves the extension off an unrecognised mime type', () => {
        const description = describeMedia(document({ attributes: [], mimeType: 'application/x-thing' }));

        assert.strictEqual(description.filename, 'telegram-555');
    });
});

describe('describeMedia for a photo', () => {
    const sizes = [
        { className: 'PhotoStrippedSize', type: 'i' },
        { className: 'PhotoSize', type: 'm', size: 16672 },
        { className: 'PhotoSize', type: 'x', size: 64967 },
    ];

    it('names it as a jpeg, because Telegram always re-encodes photos', () => {
        const description = describeMedia(photo(sizes));

        assert.strictEqual(description.mimeType, 'image/jpeg');
        assert.strictEqual(description.filename, 'telegram-777.jpg');
    });

    it('reports the largest size when no thumbnail is selected', () => {
        assert.strictEqual(describeMedia(photo(sizes)).size, 64967);
    });

    it('reports the selected thumbnail size instead', () => {
        // The size guard has to reflect what will actually be downloaded, not the full photo.
        assert.strictEqual(describeMedia(photo(sizes), 1).size, 16672);
    });

    it('reports no size when the selected entry has none', () => {
        // PhotoStrippedSize carries bytes inline and no `size`. Unknown must stay undefined so the
        // caller skips its check rather than guessing.
        assert.strictEqual(describeMedia(photo(sizes), 0).size, undefined);
    });
});

describe('mediaSize', () => {
    it('is undefined for media it cannot measure', () => {
        assert.strictEqual(mediaSize(undefined), undefined);
        assert.strictEqual(mediaSize({ className: 'MessageMediaGeo' }), undefined);
        assert.strictEqual(mediaSize(photo([])), undefined);
    });
});
