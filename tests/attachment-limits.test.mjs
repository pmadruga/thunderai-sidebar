import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOCUMENT_BYTES, assertDocumentSize, readBoundedText } from '../api_webchat/attachment-limits.js';
import { extractDocumentText } from '../api_webchat/attachments.js';

test('file size is checked before reading any content', async () => {
    let read = false;
    const file = { name: 'large.txt', type: 'text/plain', size: MAX_DOCUMENT_BYTES + 1, text() { read = true; } };
    await assert.rejects(extractDocumentText(file), /25 MiB/);
    assert.equal(read, false);
    assert.doesNotThrow(() => assertDocumentSize({ size: MAX_DOCUMENT_BYTES }));
});

test('expanded text limits stop reading and cancel the decompression source', async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(100)); c.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } });
    await assert.rejects(readBoundedText(stream, 150), /extraction limit/);
    assert.equal(cancelled, true);
});

test('bounded text preserves Unicode at chunk boundaries', async () => {
    const bytes = new TextEncoder().encode('æøå 🔒');
    const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
    assert.equal(await readBoundedText(stream, 100), 'æøå 🔒');
});

test('cancelling a stalled extraction cancels its source', async () => {
    let cancelled = false;
    const controller = new AbortController();
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    const reading = readBoundedText(stream, 100, controller.signal);
    controller.abort();
    await assert.rejects(reading, /abort/i);
    assert.equal(cancelled, true);
});

test('stored DOCX entry size is checked before XML parsing', async () => {
    const filename = new TextEncoder().encode('word/document.xml');
    const bytes = new Uint8Array(46 + filename.length + 22);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(24, 9 * 1024 * 1024, true);
    view.setUint16(28, filename.length, true);
    bytes.set(filename, 46);
    const end = 46 + filename.length;
    view.setUint32(end, 0x06054b50, true);
    view.setUint16(end + 10, 1, true);
    const file = new File([bytes], 'bomb.docx');
    await assert.rejects(extractDocumentText(file), /extraction limit/);
});
