'use strict';

/** Parse one HTTP byte range. Unsupported range units are ignored (full response). */
function rangeFromHeader(value, fileSize) {
    if (!value) return null;
    const header = String(value).trim();
    if (!/^bytes=/i.test(header)) return null;

    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
        throw new TypeError('File size must be a positive safe integer');
    }
    if (header.includes(',')) throw new Error('Multiple byte ranges are not supported');

    const match = header.match(/^bytes=(\d*)-(\d*)$/i);
    if (!match || (!match[1] && !match[2])) throw new Error('Invalid byte range');

    const [, rawStart, rawEnd] = match;
    let start;
    let end;

    if (rawStart === '') {
        const suffixLength = Number(rawEnd);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            throw new Error('Invalid byte range');
        }
        start = Math.max(0, fileSize - suffixLength);
        end = fileSize - 1;
    } else {
        start = Number(rawStart);
        end = rawEnd === '' ? fileSize - 1 : Number(rawEnd);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
            throw new Error('Invalid byte range');
        }
        if (start >= fileSize) throw new Error('Range not satisfiable');
        end = Math.min(end, fileSize - 1);
    }

    return { start, end };
}

module.exports = { rangeFromHeader };
