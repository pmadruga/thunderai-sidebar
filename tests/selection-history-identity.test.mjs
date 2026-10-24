import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatSelectionState } from '../js/mzta-selection-state.js';
import { providerDestination, historyDestinationKey } from '../api_webchat/historyIdentity.js';

test('selection tickets reject slow previous selection while preserving other windows', () => {
    const selections = new ChatSelectionState();
    const first = selections.begin(1), independent = selections.begin(2);
    selections.state(1).key = 'thread-a';
    const latest = selections.begin(1);
    assert.equal(selections.current(first), false);
    assert.equal(selections.current(latest), true);
    assert.equal(selections.current(independent), true);
    assert.equal(selections.state(1).key, 'thread-a');
    assert.equal(selections.state(2).key, null);
    selections.forget(1);
    assert.equal(selections.current(latest), false);
    assert.equal(selections.current(independent), true);
    selections.begin(1);
    assert.equal(selections.current(first), false);
});

test('selection debounce cancellation removes previous scheduled work', async () => {
    const selections = new ChatSelectionState();
    selections.begin(1);
    let called = false;
    selections.state(1).timer = setTimeout(() => { called = true; }, 1);
    selections.begin(1);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(called, false);
    assert.equal(selections.state(1).timer, null);
});

test('provider identity normalizes case, default ports and trailing slashes without retaining secrets', () => {
    assert.deepEqual(providerDestination('openai_comp', { openai_comp_host: 'HTTPS://Example.TEST:443/v1///?key=private#fragment' }),
        { integration: 'openai_comp', endpoint: 'https://example.test/v1' });
    assert.equal(providerDestination('chatgpt', {}).endpoint, 'https://api.openai.com');
    assert.equal(providerDestination('openai_comp', { openai_comp_host: 'https://user:secret@example.test' }).endpoint, 'unconfigured');
    assert.equal(providerDestination('openai_comp', { openai_comp_host: 'file:///private' }).endpoint, 'unconfigured');
});

test('history is partitioned by thread, integration, endpoint origin and path', async () => {
    const local = providerDestination('openai_comp', { openai_comp_host: 'http://127.0.0.1:9292/v1' });
    const base = await historyDestinationKey('thread-one', local);
    assert.equal(await historyDestinationKey('thread-one', providerDestination('openai_comp', { openai_comp_host: 'http://127.0.0.1:9292/v1/' })), base);
    for (const destination of [
        { ...local, integration: 'ollama' },
        { ...local, endpoint: 'https://api.openai.com/v1' },
        { ...local, endpoint: 'http://127.0.0.1:9293/v1' },
        { ...local, endpoint: 'http://127.0.0.1:9292/other' },
    ]) assert.notEqual(await historyDestinationKey('thread-one', destination), base);
    assert.notEqual(await historyDestinationKey('thread-two', local), base);
});
