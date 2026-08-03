// Created by Karl-Heinz Wind
'use strict';

// Framework-independent inspection of the media attached to a received Telegram message: finding it,
// naming it, and working out how big the download will be before starting it.
//
// Everything here keys off `className` rather than `instanceof Api.X`. That is the discriminator teleproto
// puts on every TL object, and it lets these functions be unit-tested against plain objects with no
// client and no network.

// Only the cases where the extension is unambiguous. A document usually carries its own filename, so
// this is the fallback, not the main path.
const EXTENSION_BY_MIME_TYPE = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'text/plain': '.txt',
};

// The receiver emits `{ type, message, sender, chat, event }`, but a flow may also pass a bare message.
// Accept both rather than making the user unwrap it.
function findMessage(payload) {
    let message;

    if (payload !== null && typeof payload === 'object') {
        if (payload.message !== null && typeof payload.message === 'object') {
            message = payload.message;
        } else if (payload.media !== undefined) {
            message = payload;
        }
    }

    return message;
}

function findDocument(media) {
    let document;

    if (media !== undefined && media.className === 'MessageMediaDocument') {
        document = media.document;
    }

    return document;
}

function findPhotoSizes(media) {
    let sizes;

    if (media !== undefined && media.className === 'MessageMediaPhoto' && media.photo !== undefined) {
        sizes = media.photo.sizes;
    }

    return sizes;
}

function findFilenameAttribute(document) {
    let fileName;

    if (document !== undefined && Array.isArray(document.attributes)) {
        const attribute = document.attributes.find((entry) => entry.className === 'DocumentAttributeFilename');
        if (attribute !== undefined) {
            fileName = attribute.fileName;
        }
    }

    return fileName;
}

// How many bytes downloadMedia will fetch, or undefined when that cannot be determined — in which case
// the caller must skip its size check rather than guess.
//
// `thumb` matters: with a thumbnail index the download is that size, not the full photo.
function mediaSize(media, thumb) {
    let size;

    const document = findDocument(media);
    const sizes = findPhotoSizes(media);

    if (document !== undefined && document.size !== undefined) {
        // teleproto models this as a BigInt.
        size = Number(document.size);
    } else if (Array.isArray(sizes)) {
        const selected = typeof thumb === 'number' ? [sizes[thumb]] : sizes;
        const known = selected.filter((entry) => entry !== undefined && typeof entry.size === 'number');
        if (known.length > 0) {
            size = Math.max(...known.map((entry) => entry.size));
        }
    }

    return size;
}

function mediaMimeType(media) {
    let mimeType;

    const document = findDocument(media);
    if (document !== undefined) {
        mimeType = document.mimeType;
    } else if (findPhotoSizes(media) !== undefined) {
        // Telegram always re-encodes photos as JPEG.
        mimeType = 'image/jpeg';
    }

    return mimeType;
}

// A document's own filename when it has one; otherwise something stable and recognisable, since the
// name is what a following `file out` node will write to disk.
function mediaFilename(media, mimeType) {
    let filename = findFilenameAttribute(findDocument(media));

    if (filename === undefined) {
        const document = findDocument(media);
        const identifier =
            document !== undefined
                ? document.id
                : media !== undefined && media.photo !== undefined
                  ? media.photo.id
                  : undefined;
        const extension = EXTENSION_BY_MIME_TYPE[mimeType] || '';
        filename = 'telegram-' + String(identifier) + extension;
    }

    return filename;
}

function describeMedia(media, thumb) {
    const mimeType = mediaMimeType(media);

    return {
        filename: mediaFilename(media, mimeType),
        mimeType: mimeType,
        size: mediaSize(media, thumb),
    };
}

module.exports = {
    findMessage,
    describeMedia,
    mediaSize,
};
