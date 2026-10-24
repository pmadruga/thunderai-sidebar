import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../api_webchat/messageInput.js', import.meta.url), 'utf8');
function setup(overrides = {}) {
    const context = vm.createContext({ HTMLElement: class {}, AbortController, File, MAX_EMAIL_ATTACHMENTS: 5,
        MAX_EMAIL_ATTACHMENT_BYTES: 25 * 1024 * 1024, UnsupportedDocumentError: class extends Error {},
        isSupportedDocument: () => true, extractDocumentText: async () => ({ text: 'document' }),
        browser: { i18n: { getMessage: key => key }, messages: {} }, ...overrides });
    vm.runInContext(source.slice(source.indexOf('class MessageInput'), source.indexOf("customElements.define('message-input'")) + '\nthis.input = Object.create(MessageInput.prototype);', context);
    Object.assign(context.input, { _attachments: [], _renderAttachments() {}, showErrorStatus(message) { this.error = message; } });
    return context;
}

test('simultaneous batches reserve at most five slots before reads finish', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const { input } = setup({ extractDocumentText: () => pending });
    const first = input._addAttachments(Array.from({ length: 4 }, (_, i) => ({ name: String(i) })));
    const second = input._addAttachments([{ name: 'fifth' }, { name: 'sixth' }]);
    assert.equal(input._attachments.length, 5);
    assert.match(input.error, /5 documents/);
    release({ text: 'done' });
    await Promise.all([first, second]);
});

test('clear aborts active extraction and prevents pending files from loading', async () => {
    let signal, release, loads = 0;
    const { input } = setup({ extractDocumentText: (_, options) => {
        signal = options.signal;
        return new Promise(resolve => { release = resolve; });
    } });
    const reading = input._queueAttachments([1, 2].map(name => ({ name, load: async () => { loads++; return {}; } })));
    await new Promise(setImmediate);
    input._clearAttachments();
    assert.equal(signal.aborted, true);
    release({ text: 'stale' });
    await reading;
    assert.equal(loads, 1);
    assert.equal(input._attachments.length, 0);
});

test('email duplicate selection retains newest matching name and size', async () => {
    const { input } = setup();
    let entries;
    input._queueAttachments = value => { entries = value; };
    await input.addEmailAttachments([{ name: 'same.txt', size: 10, messageId: 1 }, { name: 'same.txt', size: 10, messageId: 2 }]);
    const ids = [];
    // Inspect actual deferred file request to prove which duplicate was retained.
    const context = setup({ browser: { messages: { getAttachmentFile: async id => { ids.push(id); return new File(['x'], 'same.txt'); } } } });
    context.input._queueAttachments = async values => { for (const item of values) await item.load(); };
    await context.input.addEmailAttachments([{ name: 'same.txt', size: 10, messageId: 1 }, { name: 'same.txt', size: 10, messageId: 2 }]);
    assert.equal(entries.length, 1);
    assert.deepEqual(ids, [2]);
});

test('send while reading preserves draft and does not dispatch to worker', () => {
    const { input } = setup();
    input._attachments = [{ status: 'reading' }];
    input._messageInputField = { value: 'draft', disabled: false };
    input.worker = { postMessage() { assert.fail('must not send'); } };
    input._handleNewChatMessage();
    assert.equal(input._messageInputField.value, 'draft');
    assert.match(input.error, /finish reading/);
});

test('destination change during connection verification cannot enable tools', async () => {
    let release;
    const { input } = setup({ requestToolReadConsent: () => true,
        verifySpConnection: () => new Promise(resolve => { release = resolve; }) });
    input._setSpState = on => { input.enabled = on; };
    input._closeSpSetup = () => {};
    input.setProviderDestination({ integration: 'openai_comp', endpoint: 'https://first.example' });
    const enabling = input._enableSuperProductivity(Promise.resolve(true));
    await new Promise(setImmediate);
    input.setProviderDestination({ integration: 'openai_comp', endpoint: 'https://second.example' });
    release();
    assert.equal(await enabling, false);
    assert.equal(input.enabled, false);
});

test('conversation revocation cancels pending consent for the same destination', async () => {
    let release;
    const { input } = setup({ requestToolReadConsent: () => true,
        verifySpConnection: () => new Promise(resolve => { release = resolve; }) });
    input._setSpState = on => { input.enabled = on; input._spOn = on; };
    input._closeSpSetup = () => {};
    const destination = { integration: 'openai_comp', endpoint: 'https://first.example' };
    input.setProviderDestination(destination);
    const enabling = input._enableSuperProductivity(Promise.resolve(true));
    await new Promise(setImmediate);
    input.revokeToolConsent();
    release();
    assert.equal(await enabling, false);
    assert.equal(input.hasToolConsent(destination), false);
});
