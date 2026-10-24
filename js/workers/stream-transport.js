// Shared, bounded decoding for SSE providers and Ollama's newline JSON stream.
export const MAX_STREAM_EVENT_CHARS = 2 * 1024 * 1024;

export class StreamDecoder {
    constructor(format = 'sse') {
        this.format = format;
        this.decoder = new TextDecoder('utf-8', { fatal: true });
        this.buffer = '';
        this.data = [];
        this.eventSize = 0;
    }

    feed(bytes, final = false) {
        this.buffer += this.decoder.decode(bytes, { stream: !final });
        const output = [];
        // Preserve a CR at the end of a chunk until we know whether LF follows.
        let end;
        while ((end = this.buffer.search(/[\r\n]/)) !== -1) {
            if (!final && end === this.buffer.length - 1 && this.buffer[end] === '\r') break;
            const line = this.buffer.slice(0, end);
            const count = this.buffer[end] === '\r' && this.buffer[end + 1] === '\n' ? 2 : 1;
            this.buffer = this.buffer.slice(end + count);
            this.line(line, output);
        }
        if (this.buffer.length > MAX_STREAM_EVENT_CHARS) throw new Error('Stream event exceeds size limit');
        if (final) {
            if (this.buffer) this.line(this.buffer, output);
            this.buffer = '';
            this.flush(output);
        }
        return output;
    }

    line(line, output) {
        if (line.length > MAX_STREAM_EVENT_CHARS) throw new Error('Stream event exceeds size limit');
        if (this.format === 'ndjson') {
            const text = line.replace(/^chunk:\s?/, '').trim();
            if (text && text !== '[DONE]') output.push(this.parse(text));
            return;
        }
        if (line === '') return this.flush(output);
        if (line.startsWith(':')) return;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') {
            this.eventSize += value.length + 1;
            if (this.eventSize > MAX_STREAM_EVENT_CHARS) throw new Error('Stream event exceeds size limit');
            this.data.push(value);
        }
    }

    flush(output) {
        if (!this.data.length) return;
        const text = this.data.join('\n');
        this.data = [];
        this.eventSize = 0;
        if (text.trim() === '[DONE]') output.push({ type: '__done' });
        else if (text.trim()) output.push(this.parse(text));
    }

    parse(text) {
        if (text.length > MAX_STREAM_EVENT_CHARS) throw new Error('Stream event exceeds size limit');
        try { return JSON.parse(text); }
        catch (_) { throw new Error('The server returned an invalid streaming event'); }
    }
}

// Reject promptly even if an adapter or mocked transport ignores AbortSignal.
export function abortable(promise, signal) {
    if (signal.aborted) return Promise.reject(signal.reason || new Error('Request cancelled'));
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || new Error('Request cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
