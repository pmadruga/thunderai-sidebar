import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { redactLogMessage } from '../js/mzta-logger.js';
import { configureSecureSettingsBackground, migrateSecureSettings, getSecureSettings,
    setSecureSettings, protectPromptSecrets, hydratePromptSecrets, getLocalSecret } from '../js/secure-settings.js';
import { describeSpTool, validateToolArguments } from '../api_webchat/superproductivity.js';
import { validateEndpoint, configureEndpointPolicy, secureFetch } from '../js/endpoint-policy.js';

const sync = { openai_comp_api_key: 'synthetic-secret', openai_comp_model: 'local-model' };
const local = { sp_api_token: 'synthetic-task-token' };
let cryptoFailure = false;
function area(data) {
    return {
        async get(query) {
            if (query === null) return structuredClone(data);
            if (typeof query === 'string') return Object.hasOwn(data, query) ? { [query]: data[query] } : {};
            if (Array.isArray(query)) return Object.fromEntries(query.filter(k => Object.hasOwn(data, k)).map(k => [k, data[k]]));
            return { ...query, ...Object.fromEntries(Object.keys(query).filter(k => Object.hasOwn(data, k)).map(k => [k, data[k]])) };
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    };
}
globalThis.browser = { storage: { sync: area(sync), local: area(local) }, chatPanel: {
    async createChatHistoryKey() {},
    async encryptChatHistory(id, text) { if (cryptoFailure) throw new Error('locked'); return Buffer.from(text).toString('base64'); },
    async decryptChatHistory(id, text) { if (cryptoFailure) throw new Error('locked'); return Buffer.from(text, 'base64').toString(); },
} };
configureSecureSettingsBackground();

test('migrates credentials to encrypted local envelope before removing legacy values', async () => {
    await migrateSecureSettings();
    assert.equal(sync.openai_comp_api_key, undefined);
    assert.equal(local.sp_api_token, undefined);
    assert.equal(local.secure_credentials_v1.version, 1);
    assert.equal(JSON.stringify(local).includes('synthetic-secret'), false);
    assert.equal((await getSecureSettings({ openai_comp_api_key: '', openai_comp_model: '' })).openai_comp_api_key, 'synthetic-secret');
    assert.equal(await getLocalSecret('sp_api_token'), 'synthetic-task-token');
});

test('failed migration keeps legacy credential rather than losing it or writing plaintext', async () => {
    sync.anthropic_api_key = 'synthetic-legacy';
    const before = structuredClone(local);
    cryptoFailure = true;
    await assert.rejects(migrateSecureSettings());
    assert.equal(sync.anthropic_api_key, 'synthetic-legacy');
    assert.deepEqual(local, before);
    cryptoFailure = false;
    await migrateSecureSettings();
});

test('secure settings keep ordinary preferences in sync and serialize concurrent credential writes', async () => {
    await Promise.all([setSecureSettings({ chatgpt_api_key: 'first', chatgpt_model: 'model' }), setSecureSettings({ google_gemini_api_key: 'second' })]);
    const result = await getSecureSettings(null);
    assert.equal(result.chatgpt_api_key, 'first');
    assert.equal(result.google_gemini_api_key, 'second');
    assert.equal(sync.chatgpt_model, 'model');
    assert.equal(sync.chatgpt_api_key, undefined);
});

test('prompt metadata excludes keys and hydrates only its own credentials', async () => {
    const saved = await protectPromptSecrets({ id: 'prompt_123', text: 'Task', openai_comp_api_key: 'prompt-secret' });
    assert.equal(saved.openai_comp_api_key, undefined);
    assert.equal(JSON.stringify(saved).includes('prompt-secret'), false);
    assert.equal((await hydratePromptSecrets(saved)).openai_comp_api_key, 'prompt-secret');
    assert.equal((await hydratePromptSecrets({ ...saved, id: 'prompt_456' })).openai_comp_api_key, '');
});

test('credential and model payload logs are redacted regardless of visible input type', async () => {
    assert.equal(redactLogMessage('openai_comp_api_key = synthetic'), '[credential-bearing log omitted]');
    assert.equal(redactLogMessage('AI full response: private'), '[message content omitted]');
    assert.equal(redactLogMessage('Prompt length: 12'), 'Prompt length: 12');
    const source = await readFile(new URL('../options/mzta-options.js', import.meta.url), 'utf8');
    assert.equal(source.includes("' = ' + element.value"), false);
});

test('endpoint policy requires exact acknowledged remote HTTP origins and rejects URL credentials', () => {
    for (const url of ['https://api.example.test/v1', 'http://127.0.0.1:9292/v1', 'http://[::1]:9292', 'http://localhost:9292']) assert.doesNotThrow(() => validateEndpoint(url));
    for (const url of ['http://localhost.attacker.test', 'http://192.168.1.2:9292', 'file:///tmp/key', 'https://user:pass@example.test']) assert.throws(() => validateEndpoint(url));
    assert.doesNotThrow(() => validateEndpoint('http://192.168.1.2:9292/v1', { allowedHttpOrigins: ['http://192.168.1.2:9292'] }));
    assert.throws(() => validateEndpoint('http://192.168.1.2:9293/v1', { allowedHttpOrigins: ['http://192.168.1.2:9292'] }));
});

test('secure fetch prevents redirects and rejects unacknowledged traffic before fetching', async () => {
    let calls = 0;
    globalThis.fetch = async (url, options) => { calls++; assert.equal(options.redirect, 'error'); return { ok: true }; };
    configureEndpointPolicy([]);
    await assert.rejects(secureFetch('http://remote.example.test/v1'));
    assert.equal(calls, 0);
    await secureFetch('https://remote.example.test/v1', { redirect: 'follow' });
    assert.equal(calls, 1);
});

test('tool write preview includes every accepted mutation and validates types', () => {
    browser.i18n = { getMessage: (key, values = []) => key + ':' + values.join(',') };
    const args = { task_id: 'task', title: '', notes: 'Private note preview', project_id: 'project-2', time_estimate_minutes: 0, is_done: false, due_day: '' };
    validateToolArguments('sp_update_task', args);
    const preview = describeSpTool('sp_update_task', args);
    for (const expected of ['Private note preview', 'project-2', 'Title:', 'sp_estimate:0', 'sp_mark_not_done']) assert.ok(preview.includes(expected));
    assert.throws(() => validateToolArguments('sp_update_task', { task_id: 'task', is_done: 'false' }));
    assert.throws(() => validateToolArguments('sp_update_task', { task_id: 'task', hidden_field: 'value' }));
});

test('legacy prompt collections migrate without persisting hydrated credentials', async () => {
    const { promptStorage } = await import('../js/secure-settings.js');
    local._custom_prompt = [{ id: 'legacy-prompt', text: 'Keep text', anthropic_api_key: 'nested-secret' }];
    const hydrated = await promptStorage.get({ _custom_prompt: null });
    assert.equal(hydrated._custom_prompt[0].anthropic_api_key, 'nested-secret');
    assert.equal(local._custom_prompt[0].anthropic_api_key, undefined);
    await promptStorage.set(hydrated);
    assert.equal(JSON.stringify(local._custom_prompt).includes('nested-secret'), false);
    assert.equal((await promptStorage.get({ _custom_prompt: null }))._custom_prompt[0].anthropic_api_key, 'nested-secret');
});

test('summary, translation and spam cache migration encrypts content and preserves failure data', async () => {
    const { secureLocalRecords, migrateSensitiveLocalData } = await import('../js/secure-settings.js');
    const record = { v: 1, summary: { summary: 'Synthetic private summary' }, translation: { translated_text: 'Synthetic translation' }, spam: { from: 'example@example.test', explanation: 'Synthetic reason' } };
    local['msg:test'] = structuredClone(record);
    cryptoFailure = true;
    await assert.rejects(migrateSensitiveLocalData());
    assert.deepEqual(local['msg:test'], record);
    cryptoFailure = false;
    await migrateSensitiveLocalData();
    assert.equal(local['msg:test'].secureCacheVersion, 1);
    assert.equal(JSON.stringify(local['msg:test']).includes('Synthetic'), false);
    assert.deepEqual((await secureLocalRecords.get('msg:test'))['msg:test'], record);
    await secureLocalRecords.set({ 'msg:new': { summary: 'New summary' } });
    assert.equal(local['msg:new'].summary, undefined);
    assert.equal((await secureLocalRecords.get(null))['msg:new'].summary, 'New summary');
    assert.equal((await secureLocalRecords.get(null)).secure_credentials_v1, undefined);
    await secureLocalRecords.remove(['msg:test', 'msg:new']);
    assert.equal(local['msg:test'], undefined);
    await assert.rejects(secureLocalRecords.set({ ordinary: 'bad' }));
});

test('legacy synchronized prompt credentials are encrypted before nested sync replacement', async () => {
    sync._custom_prompt = [{ id: 'sync-prompt', text: 'Keep prompt', chatgpt_api_key: 'sync-nested-secret' }];
    cryptoFailure = true;
    await assert.rejects(migrateSecureSettings());
    assert.equal(sync._custom_prompt[0].chatgpt_api_key, 'sync-nested-secret');
    cryptoFailure = false;
    await migrateSecureSettings();
    assert.equal(sync._custom_prompt[0].chatgpt_api_key, undefined);
    assert.equal((await hydratePromptSecrets(sync._custom_prompt[0])).chatgpt_api_key, 'sync-nested-secret');
});

test('prompt exports never disclose hydrated keys or local vault references', async () => {
    const { preparePromptsForExport } = await import('../js/mzta-prompts.js');
    const prompt = { id: 'export-prompt', text: 'Shareable instructions', api_type: 'openai_comp_api', openai_comp_api_key: 'never-export-secret', openai_comp_model: 'model', _secure_credentials: ['openai_comp_api_key'] };
    for (const includeApi of [false, true]) {
        const output = preparePromptsForExport([prompt], includeApi)[0];
        assert.equal(output.openai_comp_api_key, undefined);
        assert.equal(output._secure_credentials, undefined);
        assert.equal(output.text, prompt.text);
    }
});

test('cache forgetting remains possible while the key store is locked', async () => {
    const { secureLocalRecords } = await import('../js/secure-settings.js');
    await secureLocalRecords.set({ 'msg:forget': { summary: 'Forget me' } });
    cryptoFailure = true;
    assert.ok((await secureLocalRecords.keys()).includes('msg:forget'));
    await secureLocalRecords.remove('msg:forget');
    assert.equal(local['msg:forget'], undefined);
    cryptoFailure = false;
});

test('legacy raw-mail and completed-response debug labels are redacted', async () => {
    for (const label of ['tokensDone','raw_text','raw_html','raw_selection','raw_selection_html','raw_only_typed_html','mail_plain_text_part','curr_prompt']) {
        assert.equal(redactLogMessage(`${label}: synthetic private content`),'[message content omitted]');
    }
    const special = await readFile(new URL('../js/mzta-special-commands.js',import.meta.url),'utf8');
    assert.equal(special.includes('this.logger.log("tokensDone: " + cleaned)'),false);
    assert.equal(special.includes("console.error('[ThunderAI] Error from API worker:', payload)"),false);
    assert.equal(special.includes("console.error('Event:', error)"),false);
});

test('API console diagnostics never append provider response bodies or JSON parser errors', async () => {
    for (const file of ['anthropic','google_gemini','ollama','openai_comp','openai_responses','api-utils']) {
        const source = await readFile(new URL(`../js/api/${file}.js`,import.meta.url),'utf8');
        const logs = source.split('\n').filter(line => !line.trim().startsWith('//') && /console\.(error|warn|log)\(/.test(line));
        for (const log of logs) assert.doesNotMatch(log,/err_msg|errorDetail|\+ error\b|, error\b/);
    }
});

test('delayed sync arrivals migrate through the background watcher without exposing raw keys', async () => {
    const listeners = [];
    browser.storage.onChanged = {addListener: listener => listeners.push(listener)};
    configureSecureSettingsBackground();
    configureSecureSettingsBackground();
    assert.equal(listeners.length,1);
    sync.delayed_api_key = 'synthetic-delayed-secret';
    // Before event delivery, broad reads must not fall through to raw sync.
    assert.equal((await getSecureSettings(null)).delayed_api_key,undefined);
    await listeners[0]({delayed_api_key:{newValue:sync.delayed_api_key}},'sync');
    assert.equal(sync.delayed_api_key,undefined);
    assert.equal((await getSecureSettings(null)).delayed_api_key,'synthetic-delayed-secret');
    sync._special_prompts = [{id:'delayed-prompt',anthropic_api_key:'synthetic-delayed-prompt'}];
    assert.equal((await getSecureSettings(null))._special_prompts[0].anthropic_api_key,undefined);
    assert.equal((await getSecureSettings({_special_prompts:null}))._special_prompts[0].anthropic_api_key,undefined);
    await listeners[0]({_special_prompts:{newValue:sync._special_prompts}},'sync');
    assert.equal(sync._special_prompts[0].anthropic_api_key,undefined);
    assert.equal((await hydratePromptSecrets(sync._special_prompts[0])).anthropic_api_key,'synthetic-delayed-prompt');
    // Sanitized replacement events do not recurse or need an unlocked vault.
    cryptoFailure = true;
    assert.equal(listeners[0]({_special_prompts:{newValue:sync._special_prompts}},'sync'),undefined);
    assert.equal(listeners[0]({delayed_api_key:{oldValue:'removed'}},'sync'),undefined);
    cryptoFailure = false;
});
