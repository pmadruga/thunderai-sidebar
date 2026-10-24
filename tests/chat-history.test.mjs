import test from 'node:test';
import assert from 'node:assert/strict';
import { EmailChatHistory } from '../api_webchat/chatHistory.js';
import { ChatHistoryStore, emailThreadKey } from '../js/mzta-chathistory.js';
const key = 'a'.repeat(64), other = 'b'.repeat(64);
const ROOT = 'email_chat_v2_', INDEX = 'email_chat_index_v2';
const tick = () => new Promise(setImmediate);
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness() {
    const data = {}, encrypted = [], notifications = [];
    let fail = false, keysDeleted = 0;
    const storage = {
        async get(query) {
            if (query === null) return structuredClone(data);
            const keys = typeof query === 'string' ? [query] : Array.isArray(query) ? query : Object.keys(query);
            return Object.fromEntries(keys.filter(k => k in data || typeof query === 'object' && !Array.isArray(query)).map(k => [k, structuredClone(data[k] ?? query[k])]));
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
    };
    const store = new ChatHistoryStore(storage, async text => {
        if (fail) throw new Error('Key store locked');
        encrypted.push(text);
        return Buffer.from(text).toString('base64'); // Mock transport, not a cryptography assertion.
    }, async text => Buffer.from(text, 'base64').toString(), k => notifications.push(k), async () => { keysDeleted++; });
    globalThis.browser = { runtime: { sendMessage: ({ key, operation, value }) => store.operation(key, operation, value) } };
    return { store, data, encrypted, notifications, set fail(value) { fail = value; }, get keysDeleted() { return keysDeleted; } };
}
const patch = text => ({ turns: [{ index: 0, value: { role: 'user', text, content: text } }], history: [{ index: 0, value: { role: 'user', content: text } }], turnsLength: 1, historyLength: 1, integration: 'openai_comp' });
async function save(store, k, base, changes) { return store.operation(k, 'save', { generation: base.generation, revision: base.revision, patch: changes }); }

test('thread identity survives replies and distinguishes accounts and unrelated selections', async () => {
    globalThis.browser = { chatPanel: { getChatThreadRoots: async ids => ids.map(id => id < 3 ? '<root@example.test>' : '<other@example.test>') } };
    const first = await emailThreadKey([{ id: 1 }]);
    assert.equal(await emailThreadKey([{ id: 2 }, { id: 1 }]), first);
    assert.notEqual(await emailThreadKey([{ id: 3 }]), first);
    assert.notEqual(await emailThreadKey([{ id: 1, folder: { accountId: 'another' } }]), first);
});

test('CAS serializes competing windows and rejects stale delete resurrection', async () => {
    const { store } = harness();
    const initial = await store.operation(key, 'load');
    const result = await Promise.allSettled([save(store, key, initial, patch('first')), save(store, key, initial, patch('stale'))]);
    assert.equal(result[0].status, 'fulfilled');
    assert.equal(result[1].status, 'rejected');
    assert.match(result[1].reason.message, /STALE/);
    assert.equal((await store.operation(key, 'load')).value.turns[0].text, 'first');
    await store.operation(key, 'delete');
    await assert.rejects(save(store, key, result[0].value, patch('resurrect')), /STALE/);
    assert.deepEqual((await store.operation(key, 'load')).value.turns, []);
});

test('encrypted blocks survive fresh cache and failures preserve committed root', async () => {
    const h = harness();
    const initial = await h.store.operation(key, 'load');
    const committed = await save(h.store, key, initial, patch('private message'));
    const before = structuredClone(h.data[ROOT + key]);
    assert.equal(before.encryption, 'oskeystore-v2');
    assert.equal(JSON.stringify(h.data).includes('private message'), false);
    h.fail = true;
    await assert.rejects(save(h.store, key, committed, patch('replacement')), /locked/);
    assert.deepEqual(h.data[ROOT + key], before);
    h.fail = false;
    h.store.cache.clear();
    assert.equal((await h.store.operation(key, 'load')).value.history[0].content, 'private message');
});

test('malformed plaintext root is rejected without overwriting it', async () => {
    const h = harness();
    h.data[ROOT + key] = { generation: 'plain', revision: 1, turns: [] };
    await assert.rejects(h.store.operation(key, 'load'), /Unrecognized/);
    assert.deepEqual(h.data[ROOT + key], { generation: 'plain', revision: 1, turns: [] });
});

test('delete-all erases blocks and key and still rejects old clients after tombstone cleanup', async () => {
    const h = harness();
    const initial = await h.store.operation(key, 'load');
    const committed = await save(h.store, key, initial, patch('private'));
    await h.store.operation(null, 'deleteAll');
    assert.equal(h.keysDeleted, 1);
    assert.equal(Object.keys(h.data).some(k => k.startsWith('email_chat_')), false);
    await assert.rejects(save(h.store, key, committed, patch('stale')), /STALE/);
});

test('retention budget counts retained records, not records already evicted', async () => {
    const h = harness(), third = 'c'.repeat(64);
    h.data.chat_history_max_mb = 50;
    h.data[INDEX] = {};
    for (const [i, k, bytes] of [[0, key, 40], [1, other, 20], [2, third, 5]]) {
        const root = { generation: k, revision: 1, updated: Date.now() - i * 1000, blocks: [], bytes: bytes * 1024 * 1024 };
        h.data[ROOT + k] = root;
        h.data[INDEX][k] = { updated: root.updated, bytes: root.bytes, deleted: false };
    }
    await h.store.operation(null, 'prune');
    assert.equal(h.data[ROOT + key].deleted, undefined);
    assert.equal(h.data[ROOT + other].deleted, true);
    assert.equal(h.data[ROOT + third].deleted, undefined);
});

test('expired records and orphan blocks are removed by maintenance', async () => {
    const h = harness();
    h.data[INDEX] = { [key]: { updated: 1, bytes: 5, deleted: false } };
    h.data[ROOT + key] = { generation: key, revision: 1, updated: 1, blocks: [] };
    h.data.email_chat_block_v2_orphan = { ciphertext: 'unused' };
    await h.store.operation(null, 'prune');
    assert.equal(h.data[ROOT + key].deleted, true);
    assert.equal(h.data.email_chat_block_v2_orphan, undefined);
});

test('partial checkpoints restore native history and immutable context is encrypted once', async () => {
    const h = harness(), errors = [];
    const chat = new EmailChatHistory('openai_comp', e => errors.push(e));
    await chat.load(key);
    const context = 'context '.repeat(20000);
    chat.user({ text: 'Question', content: context + '\nQuestion', context });
    await chat.save();
    chat.token('Partial');
    await chat.save();
    chat.token(' answer');
    await chat.save();
    const restored = new EmailChatHistory('openai_comp', e => errors.push(e));
    await restored.load(key);
    assert.equal(restored.turns[1].incomplete, true);
    assert.equal(restored.history[1].content, 'Partial answer');
    const native = [...restored.history, { role: 'tool', tool_call_id: 'call-1', content: 'result' }];
    chat.done(native);
    await chat.save();
    await restored.load(key);
    assert.deepEqual(restored.history, native);
    assert.equal(restored.turns[1].incomplete, false);
    assert.equal(h.encrypted.filter(text => text === JSON.stringify(context)).length, 1);
    assert.deepEqual(errors, []);
    const gemini = new EmailChatHistory('google_gemini', e => errors.push(e));
    await gemini.load(key);
    assert.equal(gemini.history[1].role, 'model');
    assert.equal(gemini.history[0].parts[0].text, context + '\nQuestion');
});

test('slow writes coalesce to one subsequent checkpoint without concurrent transport', async () => {
    const h = harness(), gate = deferred();
    const transport = browser.runtime.sendMessage;
    let active = 0, peak = 0, saves = 0;
    browser.runtime.sendMessage = async message => {
        if (message.operation !== 'save') return transport(message);
        active++; peak = Math.max(peak, active); saves++;
        if (saves === 1) await gate.promise;
        try { return await transport(message); } finally { active--; }
    };
    const errors = [], chat = new EmailChatHistory('openai_comp', e => errors.push(e));
    await chat.load(key);
    chat.user({ text: 'q', content: 'q' });
    const pending = [];
    for (let i = 0; i < 20; i++) { chat.token('x'); pending.push(chat.save()); }
    assert.equal(saves, 1);
    gate.resolve();
    await Promise.all(pending);
    assert.equal(peak, 1);
    assert.equal(saves, 2);
    assert.equal((await h.store.operation(key, 'load')).value.history[1].content, 'x'.repeat(20));
    assert.deepEqual(errors, []);
});

test('old failed save and out-of-order load cannot invalidate the current chat', async () => {
    const h = harness(), oldSave = deferred(), oldLoad = deferred();
    const transport = browser.runtime.sendMessage;
    browser.runtime.sendMessage = message => message.operation === 'save' ? oldSave.promise : transport(message);
    const errors = [], chat = new EmailChatHistory('openai_comp', e => errors.push(e));
    await chat.load(key);
    chat.user({ text: 'q', content: 'q' });
    await chat.load(other);
    oldSave.reject(new Error('obsolete failure'));
    await tick();
    assert.equal(chat.key, other);
    assert.deepEqual(errors, []);
    browser.runtime.sendMessage = message => message.key === key ? oldLoad.promise : transport(message);
    const stale = chat.load(key);
    await chat.load(other);
    oldLoad.resolve(await h.store.operation(key, 'load'));
    await stale;
    assert.equal(chat.key, other);
});
test('invalidation fences a pending load and clean pagehide never rewrites history', async () => {
    const h = harness(), gate = deferred();
    const initial = await h.store.operation(key, 'load');
    await save(h.store, key, initial, patch('saved'));
    const clean = new EmailChatHistory('openai_comp', assert.fail);
    await clean.load(key);
    const before = h.data[ROOT + key].revision;
    await clean.save();
    assert.equal(h.data[ROOT + key].revision, before);
    browser.runtime.sendMessage = () => gate.promise;
    const pending = clean.load(key);
    clean.invalidate();
    gate.resolve(await h.store.operation(key, 'load'));
    await pending;
    assert.equal(clean.key, null);
});

test('disabled history loads no retained content and rejects new writes', async () => {
    const h = harness();
    const initial = await h.store.operation(key, 'load');
    await save(h.store, key, initial, patch('private retained content'));
    h.data.chat_history_retention_days = 0;
    h.store.decrypt = () => assert.fail('Disabled history must not decrypt old content');
    const disabled = await h.store.operation(key, 'load');
    assert.deepEqual(disabled.value.turns, []);
    assert.equal(h.data[ROOT + key].deleted, true);
    await assert.rejects(save(h.store, key, disabled, patch('new')), /DISABLED/);
});
