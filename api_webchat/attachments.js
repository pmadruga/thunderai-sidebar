/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Document attachments for the chat (ThunderAI Side Panel fork): turns a
// user-chosen file into plain text that is sent along with the next message.
// Supported: text-like files, PDF (bundled pdf.js) and Word .docx.

// Per-file cap, so a huge file can't swamp the model's context window.
export const MAX_DOCUMENT_CHARS = 120000;

const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'yaml', 'yml',
    'ini', 'toml', 'log', 'eml', 'ics', 'vcf', 'rtf', 'tex', 'srt', 'sql', 'sh', 'py',
    'js', 'mjs', 'ts', 'css', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php',
    'swift', 'kt', 'lua', 'pl', 'r',
]);

export class UnsupportedDocumentError extends Error {}

function extensionOf(name) {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * @param {File} file
 * @returns {Promise<{name: string, text: string, truncated: boolean}>}
 */
export async function extractDocumentText(file) {
    const ext = extensionOf(file.name);
    let text;
    if (ext === 'pdf' || file.type === 'application/pdf') {
        text = await extractPdfText(file);
    } else if (ext === 'docx') {
        text = await extractDocxText(file);
    } else if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/') || file.type === 'application/json') {
        text = await file.text();
        if (ext === 'html' || ext === 'htm') {
            text = new DOMParser().parseFromString(text, 'text/html').body?.innerText ?? text;
        }
    } else {
        throw new UnsupportedDocumentError(file.name);
    }
    text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const truncated = text.length > MAX_DOCUMENT_CHARS;
    return { name: file.name, text: truncated ? text.slice(0, MAX_DOCUMENT_CHARS) : text, truncated };
}

// ── PDF ─────────────────────────────────────────────────────────────────────

let pdfjsPromise = null;

function loadPdfJs() {
    if (!pdfjsPromise) {
        pdfjsPromise = import('../js/lib/pdfjs/pdf.min.mjs').then(pdfjs => {
            pdfjs.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('js/lib/pdfjs/pdf.worker.min.mjs');
            return pdfjs;
        });
    }
    return pdfjsPromise;
}

async function extractPdfText(file) {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        isEvalSupported: false,   // extension pages forbid eval; not needed for text
    });
    const pdf = await loadingTask.promise;
    const pages = [];
    let total = 0;
    for (let i = 1; i <= pdf.numPages && total <= MAX_DOCUMENT_CHARS; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
            .map(item => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
            .join('')
            .trim();
        pages.push(pageText);
        total += pageText.length;
    }
    await loadingTask.destroy();   // pdf.js 6: cleanup goes through the loading task
    return pages.join('\n\n');
}

// ── DOCX ────────────────────────────────────────────────────────────────────
// A .docx is a zip; the text lives in word/document.xml. Read the zip's central
// directory, inflate that one entry with DecompressionStream, and keep the
// text of each paragraph.

async function readZipEntry(buffer, wantedName) {
    const view = new DataView(buffer);
    // End of central directory record: signature 0x06054b50, within the last 64 KiB.
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error('Not a valid .docx (zip) file');
    }
    const entries = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let n = 0; n < entries; n++) {
        if (view.getUint32(offset, true) !== 0x02014b50) {
            break;
        }
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeader = view.getUint32(offset + 42, true);
        const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
        if (name === wantedName) {
            const localNameLength = view.getUint16(localHeader + 26, true);
            const localExtraLength = view.getUint16(localHeader + 28, true);
            const start = localHeader + 30 + localNameLength + localExtraLength;
            const data = new Uint8Array(buffer, start, compressedSize);
            if (method === 0) {
                return decoder.decode(data);
            }
            if (method !== 8) {
                throw new Error('Unsupported compression in .docx');
            }
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return await new Response(stream).text();
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error('No document text found in .docx');
}

async function extractDocxText(file) {
    const xml = await readZipEntry(await file.arrayBuffer(), 'word/document.xml');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paragraphs = [];
    for (const p of doc.getElementsByTagNameNS(W, 'p')) {
        let line = '';
        for (const node of p.getElementsByTagNameNS(W, '*')) {
            if (node.localName === 't') line += node.textContent;
            else if (node.localName === 'tab') line += '\t';
            else if (node.localName === 'br') line += '\n';
        }
        paragraphs.push(line);
    }
    return paragraphs.join('\n');
}
