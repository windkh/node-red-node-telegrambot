// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { findMessage, describeMedia, mediaSize } = require('../telegrambot/lib/media');

// Plain objects with the `className` discriminator teleproto puts on every TL object. Verified against the
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

// Photo sizes: only `PhotoSize` carries a plain `size`, and reading just that one is what made the
// download node's limit understate a real photo by a factor of fifty. Telegram sends a mix, and the
// biggest entry is usually the `PhotoSizeProgressive` that has `sizes` instead.
describe('the size of a photo', () => {
    const stripped = (length, first) => {
        const bytes = Buffer.alloc(length);
        bytes[0] = first;
        return { className: 'PhotoStrippedSize', type: 'i', bytes: bytes };
    };
    const photo = (sizes) => ({ className: 'MessageMediaPhoto', photo: { id: 7, sizes: sizes } });

    it('counts a progressive size, which is usually the largest one Telegram offers', () => {
        // The regression this file exists for. Before, the progressive entry was ignored and the answer
        // was 90000 — so a 4.5 MB photo sailed past a 1 MB limit.
        const realistic = photo([
            stripped(200, 1),
            { className: 'PhotoSize', type: 'm', size: 12000 },
            { className: 'PhotoSize', type: 'x', size: 90000 },
            { className: 'PhotoSizeProgressive', type: 'y', sizes: [20000, 300000, 4500000] },
        ]);

        assert.strictEqual(mediaSize(realistic, undefined), 4500000);
    });

    it('takes the last progressive size, because that is the whole image', () => {
        // Ascending per the TL schema, and a download of this entry fetches all of it.
        const progressive = photo([{ className: 'PhotoSizeProgressive', type: 'y', sizes: [1000, 2000, 3000] }]);

        assert.strictEqual(mediaSize(progressive, undefined), 3000);
    });

    it('counts a stripped size, adding back the header teleproto reconstructs', () => {
        // 622 bytes is the common JPEG header the stripped form leaves out; teleproto adds it back, and a
        // count that ignored it would be wrong by more than the payload itself.
        assert.strictEqual(mediaSize(photo([stripped(100, 1)]), undefined), 722);
    });

    it('counts a stripped size as its bytes when it carries no header marker', () => {
        assert.strictEqual(mediaSize(photo([stripped(100, 0)]), undefined), 100);
        assert.strictEqual(mediaSize(photo([stripped(2, 1)]), undefined), 2);
    });

    it('counts a cached size as its bytes', () => {
        const cached = { className: 'PhotoCachedSize', type: 'x', bytes: Buffer.alloc(4096) };

        assert.strictEqual(mediaSize(photo([cached]), undefined), 4096);
    });

    it('counts an empty size as nothing rather than as unknown', () => {
        assert.strictEqual(mediaSize(photo([{ className: 'PhotoSizeEmpty', type: 'x' }]), undefined), 0);
    });

    it('still honours the thumbnail index, whatever kind that entry is', () => {
        const mixed = photo([
            { className: 'PhotoSize', type: 's', size: 500 },
            { className: 'PhotoSizeProgressive', type: 'y', sizes: [1000, 900000] },
        ]);

        assert.strictEqual(mediaSize(mixed, 0), 500, 'index 0 is the small one');
        assert.strictEqual(mediaSize(mixed, 1), 900000, 'index 1 is the progressive one');
    });

    it('is unknown only when no entry can be counted at all', () => {
        // Then the download node has to skip its check — which is fine, as long as it is rare rather than
        // the common case it used to be.
        assert.strictEqual(mediaSize(photo([{ className: 'PhotoSizeSomethingNew', type: 'z' }]), undefined), undefined);
    });
});
