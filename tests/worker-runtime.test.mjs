import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createWorkerHandler } from '../js/workers/worker-runtime.js';
import { providerConfig } from '../js/api/provider-config.js';

for (const [name, provider, className] of [
    ['anthropic', 'anthropic', 'Anthropic'], ['google_gemini', 'google_gemini', 'GoogleGemini'],
    ['ollama', 'ollama', 'Ollama'], ['openai_comp', 'openai_comp', 'OpenAIComp'],
    ['openai_responses', 'chatgpt', 'OpenAI'],
]) {
    test(`${name} restores history without generating, then sends it on the next message`, async () => {
        const requests = [], events = [], configs = [];
        class Client {
            constructor(config) { configs.push(config); }
            async fetchResponse(history) {
                requests.push(structuredClone(history));
                return new Response('');
            }
        }
        const source = (await readFile(new URL(`../js/workers/model-worker-${name}.js`, import.meta.url), 'utf8'))
            .replace(/^import [\s\S]*?;\n/gm, '');
        const context = vm.createContext({ self: {}, [className]: Client, describeAnthropicError: text => text,
            createWorkerHandler: options => createWorkerHandler({ ...options, emit: event => events.push(event) }) });
        vm.runInContext(source, context);
        const send = data => context.self.onmessage({ data });
        await send({ type: 'init', [`${provider}_model`]: 'demo', [`${provider}_api_key`]: 'synthetic' });
        const history = provider === 'google_gemini'
            ? [{ role: 'user', parts: [{ text: 'Saved question' }] }]
            : [{ role: 'user', content: 'Saved question' }];
        await send({ type: 'restoreHistory', history: structuredClone(history) });
        assert.equal(requests.length, 0);
        await send({ type: 'chatMessage', message: 'Continue' });
        assert.deepEqual(requests[0][0], history[0]);
        assert.equal(requests[0].length, 2);
        assert.deepEqual(configs[0], { stream: true, model: 'demo', apiKey: 'synthetic' });
        assert.ok(events.some(event => event.type === 'tokensDone'));
        await send({ type: 'restoreHistory', history: [] });
        await send({ type: 'chatMessage', message: 'Fresh conversation' });
        assert.equal(requests[1].length, 1);
    });
}

test('provider configuration excludes other providers and ChatGPT Web settings', () => {
    assert.deepEqual(providerConfig('chatgpt', { chatgpt_model: 'demo', chatgpt_api_key: 'synthetic',
        chatgpt_web_model: 'web-only', ollama_model: 'different', type: 'init' }),
    { model: 'demo', apiKey: 'synthetic' });
});
