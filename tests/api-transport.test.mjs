import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIComp } from '../js/api/openai_comp.js';
import { OpenAI } from '../js/api/openai_responses.js';
import { Ollama } from '../js/api/ollama.js';
import { Anthropic } from '../js/api/anthropic.js';
import { GoogleGemini } from '../js/api/google_gemini.js';
import { configureEndpointPolicy } from '../js/endpoint-policy.js';
import { redactApiError } from '../js/api/api-utils.js';
configureEndpointPolicy([]);

const cases = [
    ['openai_comp', () => new OpenAIComp({ host: 'http://127.0.0.1:1234', model: 'test', stream: true }), (api, signal) => api.fetchResponse([], 0, null, { signal })],
    ['chatgpt', () => new OpenAI({ apiKey: 'test-key', model: 'test', stream: true }), (api, signal) => api.fetchResponse([], 0, null, { signal })],
    ['ollama', () => new Ollama({ host: 'http://127.0.0.1:1234', model: 'test', stream: true, num_ctx: 8192, temperature: '0.3' }), (api, signal) => api.fetchResponse([], { signal })],
    ['anthropic', () => new Anthropic({ apiKey: 'test-key', model: 'test', stream: true }), (api, signal) => api.fetchResponse([], { signal })],
    ['google_gemini', () => new GoogleGemini({ apiKey: 'test-key', model: 'test', stream: true }), (api, signal) => api.fetchResponse([], { signal })],
];
for (const [name, make, run] of cases) {
    test(`${name} forwards cancellation and rejects redirects at the actual fetch boundary`, async () => {
        const original = globalThis.fetch;
        const controller = new AbortController();
        let options;
        globalThis.fetch = async (url, init) => { options = init; return { ok: true }; };
        try {
            const response = await run(make(), controller.signal);
            assert.equal(response.ok, true);
            assert.equal(options.signal, controller.signal);
            assert.equal(options.redirect, 'error');
            if (name === 'ollama') assert.deepEqual(JSON.parse(options.body).options, { num_ctx: 8192, temperature: 0.3 });
            globalThis.fetch = async () => { throw new DOMException('Cancelled', 'AbortError'); };
            await assert.rejects(run(make(), controller.signal), { name: 'AbortError' });
        } finally { globalThis.fetch = original; }
    });
}

test('API errors redact configured keys and query tokens before persistence', () => {
    const result = redactApiError(new Error('Failed https://example.test/?key=private-value&access_token=another-secret secret-key'), 'secret-key');
    for (const secret of ['private-value', 'another-secret', 'secret-key']) assert.equal(result.includes(secret), false);
});

for (const [name, make] of cases) {
    test(`${name} model discovery propagates cancellation to fetch`, async () => {
        const original = globalThis.fetch;
        const controller = new AbortController();
        let options;
        globalThis.fetch = async (url, init) => {options = init;throw new DOMException('Cancelled','AbortError');};
        try {
            await assert.rejects(make().fetchModels(controller.signal), {name:'AbortError'});
            assert.equal(options.signal,controller.signal);
            assert.equal(options.redirect,'error');
        } finally {globalThis.fetch = original;}
    });
}
