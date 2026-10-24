import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamDecoder, MAX_STREAM_EVENT_CHARS } from '../js/workers/stream-transport.js';
import { ChatSession } from '../js/workers/chat-session.js';
const encoder = new TextEncoder();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function streamResponse(text, { keepOpen = false } = {}) {
    let cancelled = false;
    const response = { ok: true, body: new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode(text)); if (!keepOpen) controller.close(); },
        cancel() { cancelled = true; },
    }) };
    return { response, get cancelled() { return cancelled; } };
}

function session(provider, response, extra = {}) {
    const events = [];
    const requests = [];
    const client = { async fetchResponse(...args) { requests.push(args); return typeof response === 'function' ? response() : response; } };
    const instance = new ChatSession({ provider, client, history: [], emit: event => events.push(structuredClone(event)), ...extra });
    return { instance, events, requests };
}

const terminal = events => events.filter(event => ['error', 'tokensDone'].includes(event.type));

test('SSE decoder preserves Unicode at every byte boundary, CRLF, metadata and multiline data', () => {
    const bytes = encoder.encode(': ping\r\nevent: answer\r\nid: 1\r\ndata: {"text":\r\ndata: "æøå 🔒"}\r\n\r\ndata:[DONE]\n\n');
    for (let i = 0; i <= bytes.length; i++) {
        const parser = new StreamDecoder();
        const events = [...parser.feed(bytes.slice(0, i)), ...parser.feed(bytes.slice(i)), ...parser.feed(undefined, true)];
        assert.deepEqual(events, [{ text: 'æøå 🔒' }, { type: '__done' }], `boundary ${i}`);
    }
});

test('newline JSON decoder preserves chunk boundaries and final unterminated line', () => {
    const parser = new StreamDecoder('ndjson');
    assert.deepEqual(parser.feed(encoder.encode('{"a":1}\n{"b":')), [{ a: 1 }]);
    assert.deepEqual(parser.feed(encoder.encode('2}'), true), [{ b: 2 }]);
});

test('invalid and oversized events fail without including response contents in errors', () => {
    assert.throws(() => new StreamDecoder().feed(encoder.encode('data: private-invalid-content\n\n')), error => !error.message.includes('private-invalid-content'));
    assert.throws(() => new StreamDecoder().feed(encoder.encode('data: ' + 'x'.repeat(MAX_STREAM_EVENT_CHARS + 1))), /limit/);
});

const providerEvents = {
    openai_comp: 'data: {"choices":[{"delta":{"content":"æøå 🔒"}}]}\n\ndata: [DONE]\n\n',
    chatgpt: 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"æøå 🔒"}\n\ndata: {"type":"response.completed"}\n\n',
    anthropic: 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"æøå 🔒"}}\n\ndata: {"type":"message_stop"}\n\n',
    google_gemini: 'data: {"candidates":[{"content":{"parts":[{"text":"æøå 🔒"}]}}]}\n\n',
    ollama: '{"message":{"content":"æøå 🔒"},"done":true}\n',
};

for (const [provider, text] of Object.entries(providerEvents)) {
    test(`${provider}: streams content, preserves history and forwards AbortSignal`, async () => {
        const transport = streamResponse(text);
        const { instance, events, requests } = session(provider, transport.response);
        await instance.send('Question');
        assert.equal(events.filter(event => event.type === 'newToken').map(event => event.payload.token).join(''), 'æøå 🔒');
        assert.equal(terminal(events).length, 1);
        assert.equal(instance.history.length, 2);
        assert.ok(requests[0].at(-1).signal instanceof AbortSignal);
    });

    test(`${provider}: Stop cancels a stalled read and emits exactly one terminal event`, async () => {
        let cancelled = false;
        const response = { ok: true, body: new ReadableStream({ cancel() { cancelled = true; } }) };
        const { instance, events } = session(provider, response);
        const work = instance.send('Question');
        await tick();
        instance.stop(); instance.stop();
        await work;
        await tick();
        assert.equal(cancelled, true);
        assert.equal(terminal(events).length, 1);
        assert.equal(terminal(events)[0].payload.interrupted, true);
    });

    test(`${provider}: Stop before response headers completes promptly`, async () => {
        const { instance, events } = session(provider, () => new Promise(() => {}));
        const work = instance.send('Question');
        await tick(); instance.stop(); await work;
        assert.equal(terminal(events).length, 1);
        assert.equal(instance.current, null);
    });

    test(`${provider}: stream failure emits a terminal error and permits another request`, async () => {
        const response = { ok: true, body: new ReadableStream({ start(controller) { controller.error(new Error('Disconnected')); } }) };
        const { instance, events } = session(provider, response);
        await instance.send('Question');
        assert.equal(terminal(events).length, 1);
        assert.equal(terminal(events)[0].type, 'error');
        assert.equal(instance.current, null);
        instance.client.fetchResponse = async () => streamResponse(text).response;
        await instance.send('Retry');
        assert.equal(terminal(events).length, 2);
        assert.equal(terminal(events)[1].type, 'tokensDone');
    });
}

test('idle deadline terminates a fetch that does not answer', async () => {
    const { instance, events } = session('openai_comp', () => new Promise(() => {}), { idleTimeout: 10 });
    await instance.send('Question');
    assert.equal(terminal(events).length, 1);
    assert.match(terminal(events)[0].payload, /stopped responding/);
});

test('terminal SSE event cancels a connection that remains open', async () => {
    const transport = streamResponse(providerEvents.anthropic, { keepOpen: true });
    const { instance, events } = session('anthropic', transport.response);
    await instance.send('Question'); await tick();
    assert.equal(transport.cancelled, true);
    assert.equal(terminal(events).length, 1);
});

test('Stop during tool confirmation closes tool history and ignores late results', async () => {
    const text = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"sp_get_tasks","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n';
    const { instance, events, requests } = session('openai_comp', streamResponse(text).response);
    await instance.send('Question');
    const call = events.find(event => event.type === 'toolCalls');
    assert.ok(call.payload.requestId);
    instance.stop();
    await instance.toolResults([{ tool_call_id: 'call-1', content: 'Late result' }], call.payload.requestId);
    assert.equal(requests.length, 1);
    assert.equal(terminal(events).length, 1);
    assert.equal(instance.history.at(-1).role, 'tool');
    assert.match(instance.history.at(-1).content, /cancelled/);
});
