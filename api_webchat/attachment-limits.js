export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_XML_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;

export function assertDocumentSize(file) {
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_DOCUMENT_BYTES) {
        throw new Error('Document exceeds the 25 MiB file limit');
    }
}

export function checkAbort(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException('Document extraction cancelled', 'AbortError');
}

export async function readBoundedText(stream, maxBytes, signal) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const parts = [];
    let bytes = 0;
    const abort = () => { Promise.resolve(reader.cancel()).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            checkAbort(signal);
            const { value, done } = await reader.read();
            checkAbort(signal);
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) throw new Error('Expanded document exceeds the extraction limit');
            parts.push(decoder.decode(value, { stream: true }));
        }
        parts.push(decoder.decode());
        return parts.join('');
    } finally {
        signal?.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
