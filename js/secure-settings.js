// Credentials are encrypted locally. Only the background page owns migrations
// and read/modify/write operations, so concurrent settings pages cannot lose keys.
const VAULT_KEY = 'secure_credentials_v1';
const SYNC_SECRET = /(?:^|_)api_key$/;
let background = false;
let queue = Promise.resolve();
let migrated = false;
let migrationWatchInstalled = false;

export const isSecretSetting = name => !String(name).includes(':') && (SYNC_SECRET.test(name) || name === 'sp_api_token');
function containsLegacyPromptCredentials(collection) {
    if (!collection || typeof collection !== 'object') return false;
    return Object.values(collection).some(prompt => prompt && typeof prompt === 'object' &&
        Object.keys(prompt).some(key => SYNC_SECRET.test(key)));
}
export function configureSecureSettingsBackground() {
    background = true;
    if (migrationWatchInstalled || !browser.storage.onChanged?.addListener) return;
    migrationWatchInstalled = true;
    browser.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const requiresMigration = Object.entries(changes).some(([key, change]) =>
            change.newValue !== undefined && (isSecretSetting(key) ||
                (['_custom_prompt', '_special_prompts', '_default_prompts_properties'].includes(key) && containsLegacyPromptCredentials(change.newValue))));
        if (!requiresMigration) return;
        // Sync can deliver old-device values after background startup. Serialize
        // with ordinary vault writes; our deletions/sanitized objects do not
        // retrigger migration. On failure preserve legacy data for recovery.
        return secureSettingsOperation({ operation: 'migrate' }).catch(() => {
            console.warn('[ThunderAI] Delayed credential migration unavailable; legacy values were preserved');
        });
    });
}

async function readVault() {
    const record = (await browser.storage.local.get(VAULT_KEY))[VAULT_KEY];
    if (!record) return { keyId: null, values: {} };
    if (record.version !== 1 || typeof record.ciphertext !== 'string') throw new Error('Credential store unavailable');
    const values = JSON.parse(await browser.chatPanel.decryptChatHistory(record.keyId, record.ciphertext));
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Credential store unavailable');
    return { keyId: record.keyId, values };
}

async function writeVault(vault) {
    if (!vault.keyId) {
        vault.keyId = crypto.randomUUID();
        await browser.chatPanel.createChatHistoryKey(vault.keyId);
    }
    const ciphertext = await browser.chatPanel.encryptChatHistory(vault.keyId, JSON.stringify(vault.values));
    await browser.storage.local.set({ [VAULT_KEY]: { version: 1, keyId: vault.keyId, ciphertext } });
}

async function migrateLegacy() {
    const sync = await browser.storage.sync.get(null);
    const local = await browser.storage.local.get('sp_api_token');
    const entries = Object.entries(sync).filter(([key]) => isSecretSetting(key));
    if (typeof local.sp_api_token === 'string') entries.push(['sp_api_token', local.sp_api_token]);
    // Older releases also kept entire custom prompt objects in sync.
    const sanitizedPrompts = {};
    for (const name of ['_custom_prompt', '_special_prompts', '_default_prompts_properties']) {
        const collection = structuredClone(sync[name]);
        if (!collection || typeof collection !== 'object') continue;
        const prompts = Array.isArray(collection) ? collection.map(prompt => [prompt.id, prompt]) : Object.entries(collection);
        let changed = false;
        for (const [id, prompt] of prompts) {
            if (!id || String(id).includes(':')) throw new Error('Invalid legacy prompt identity');
            const fields = new Set(prompt._secure_credentials || []);
            for (const [key, value] of Object.entries(prompt)) {
                if (!SYNC_SECRET.test(key)) continue;
                if (typeof value === 'string' && value) { entries.push([`prompt:${id}:${key}`, value]); fields.add(key); }
                delete prompt[key];
                changed = true;
            }
            if (fields.size) prompt._secure_credentials = [...fields];
        }
        if (changed) sanitizedPrompts[name] = collection;
    }
    if (entries.length) {
        const populated = entries.filter(([, value]) => typeof value === 'string' && value !== '');
        if (populated.length) {
            const vault = await readVault();
            for (const [key, value] of populated) vault.values[key] = value;
            // Persist ciphertext successfully before deleting any legacy value.
            await writeVault(vault);
        }
        const syncKeys = Object.keys(sync).filter(isSecretSetting);
        if (syncKeys.length) await browser.storage.sync.remove(syncKeys);
        if ('sp_api_token' in local) await browser.storage.local.remove('sp_api_token');
    }
    if (Object.keys(sanitizedPrompts).length) await browser.storage.sync.set(sanitizedPrompts);
    migrated = true;
}

export function secureSettingsOperation(message) {
    const task = queue.catch(() => {}).then(async () => {
        if (!migrated || message.operation === 'migrate') await migrateLegacy();
        if (message.operation === 'migrate') return true;
        const vault = await readVault();
        if (message.operation === 'get') return vault.values;
        if (message.operation === 'set') {
            for (const [key, value] of Object.entries(message.values || {})) {
                if (!(isSecretSetting(key) || /^prompt:[^:]+:[a-z0-9_]+_api_key$/i.test(key))) throw new Error('Invalid credential setting');
                if (typeof value !== 'string') throw new Error('Invalid credential value');
                if (value) vault.values[key] = value;
                else delete vault.values[key];
            }
            await writeVault(vault);
            return true;
        }
        throw new Error('Invalid credential operation');
    });
    queue = task;
    return task;
}

function request(operation, values) {
    const message = { command: 'secure_settings', operation, values };
    return background ? secureSettingsOperation(message) : browser.runtime.sendMessage(message);
}
export function migrateSecureSettings() { return request('migrate'); }

export async function getSecureSettings(query = null) {
    const requested = typeof query === 'string' ? [query] : Array.isArray(query) ? query : Object.keys(query || {});
    const promptKeys = ['_custom_prompt', '_special_prompts', '_default_prompts_properties'];
    if (query !== null && !requested.some(name => isSecretSetting(name) || promptKeys.includes(name))) return browser.storage.sync.get(query);
    const values = await request('get');
    const result = await browser.storage.sync.get(query);
    // Never return raw sync credentials, even if a sync event and its queued
    // migration have not finished yet. Only decrypted vault values may win.
    for (const name of Object.keys(result)) {
        if (isSecretSetting(name)) { delete result[name]; continue; }
        if (!promptKeys.includes(name) || !result[name] || typeof result[name] !== 'object') continue;
        result[name] = structuredClone(result[name]);
        for (const prompt of Object.values(result[name])) {
            if (!prompt || typeof prompt !== 'object') continue;
            for (const field of Object.keys(prompt)) if (SYNC_SECRET.test(field)) delete prompt[field];
        }
    }
    const names = query === null ? Object.keys(values).filter(isSecretSetting)
        : typeof query === 'string' ? [query] : Array.isArray(query) ? query : Object.keys(query);
    for (const name of names) {
        if (!isSecretSetting(name)) continue;
        if (Object.hasOwn(values, name)) result[name] = values[name];
        else if (query && typeof query === 'object' && !Array.isArray(query)) result[name] = query[name];
        else delete result[name];
    }
    return result;
}

export async function setSecureSettings(values) {
    const secrets = Object.fromEntries(Object.entries(values).filter(([key]) => isSecretSetting(key)));
    const ordinary = Object.fromEntries(Object.entries(values).filter(([key]) => !isSecretSetting(key)));
    if (Object.keys(secrets).length) await request('set', secrets);
    if (Object.keys(ordinary).length) await browser.storage.sync.set(ordinary);
}
export async function getLocalSecret(name) { return (await request('get'))[name] || ''; }
export async function setLocalSecret(name, value) { return request('set', { [name]: value }); }

// Use these at every prompt persistence boundary. Stored prompt objects contain
// a list of credential field names, never their values. Hydration is local-only.
export async function protectPromptSecrets(prompt) {
    const output = structuredClone(prompt);
    if (!output.id || String(output.id).includes(':')) throw new Error('Prompt identity required for secure credentials');
    const fields = new Set(output._secure_credentials || []);
    const changes = {};
    for (const [key, value] of Object.entries(output)) {
        if (!SYNC_SECRET.test(key)) continue;
        if ((typeof value === 'string' && value !== '') || fields.has(key)) {
            changes[`prompt:${output.id}:${key}`] = typeof value === 'string' ? value : '';
            fields.add(key);
        }
        delete output[key];
    }
    if (Object.keys(changes).length) await request('set', changes);
    output._secure_credentials = [...fields];
    return output;
}
export async function hydratePromptSecrets(prompt) {
    const output = structuredClone(prompt);
    const fields = output._secure_credentials || [];
    if (!fields.length) return output;
    const values = await request('get');
    for (const field of fields) {
        if (SYNC_SECRET.test(field)) output[field] = values[`prompt:${output.id}:${field}`] || '';
    }
    return output;
}


// Sensitive legacy caches and prompt credentials share the background queue.
// Cache envelope keys retain the historical message identifier for compatibility;
// their summary, translation, spam explanation and sender fields are encrypted.
const PROMPT_KEYS = ['_custom_prompt', '_special_prompts', '_default_prompts_properties'];
async function protectPromptCollection(key, value) {
    if (value == null) return value;
    if (key === '_default_prompts_properties') {
        const output = {};
        for (const [id, prompt] of Object.entries(value)) output[id] = await protectPromptSecrets({ ...prompt, id });
        return output;
    }
    return Promise.all(value.map(protectPromptSecrets));
}
async function hydratePromptCollection(key, value) {
    if (value == null) return value;
    if (key === '_default_prompts_properties') {
        const output = {};
        for (const [id, prompt] of Object.entries(value)) output[id] = await hydratePromptSecrets({ ...prompt, id });
        return output;
    }
    return Promise.all(value.map(hydratePromptSecrets));
}
export const promptStorage = {
    async get(query) {
        const result = await browser.storage.local.get(query);
        for (const [key, value] of Object.entries(result)) {
            if (!PROMPT_KEYS.includes(key) || value == null) continue;
            const protectedValue = await protectPromptCollection(key, value);
            if (JSON.stringify(value) !== JSON.stringify(protectedValue)) await browser.storage.local.set({ [key]: protectedValue });
            result[key] = await hydratePromptCollection(key, protectedValue);
        }
        return result;
    },
    async set(values) {
        const output = {};
        for (const [key, value] of Object.entries(values)) output[key] = PROMPT_KEYS.includes(key) ? await protectPromptCollection(key, value) : value;
        await browser.storage.local.set(output);
    }
};
let recordQueue = Promise.resolve();
let recordsMigrated = false;
async function encryptRecord(value, prior) {
    const keyId = prior?.secureCacheVersion === 1 ? prior.keyId : crypto.randomUUID();
    if (prior?.secureCacheVersion !== 1) await browser.chatPanel.createChatHistoryKey(keyId);
    const ciphertext = await browser.chatPanel.encryptChatHistory(keyId, JSON.stringify(value));
    return { secureCacheVersion: 1, keyId, ciphertext };
}
export function secureLocalDataOperation(message) {
    const task = recordQueue.catch(() => {}).then(async () => {
        // Forgetting cached data must work even when the keystore is locked.
        if (message.operation === 'keys') return Object.keys(await browser.storage.local.get(null)).filter(key => key.startsWith('msg:'));
        if (message.operation === 'remove') {
            const keys = Array.isArray(message.keys) ? message.keys : [message.keys];
            if (!keys.every(key => typeof key === 'string' && key.startsWith('msg:'))) throw new Error('Invalid cache key');
            const prior = await browser.storage.local.get(keys);
            await browser.storage.local.remove(keys);
            for (const record of Object.values(prior)) {
                if (record?.secureCacheVersion === 1 && browser.chatPanel.deleteChatHistoryKey) {
                    try { await browser.chatPanel.deleteChatHistoryKey(record.keyId); } catch { /* Data remains deleted if native key cleanup fails. */ }
                }
            }
            return true;
        }
        if (!recordsMigrated || message.operation === 'migrate') {
            const all = await browser.storage.local.get(null);
            for (const [key, value] of Object.entries(all)) {
                if (key.startsWith('msg:') && value?.secureCacheVersion !== 1) {
                    await browser.storage.local.set({ [key]: await encryptRecord(value) });
                }
            }
            recordsMigrated = true;
        }
        if (message.operation === 'migrate') return true;
        if (message.operation === 'get') {
            const result = await browser.storage.local.get(message.query ?? null);
            for (const [key, value] of Object.entries(result)) {
                if (!key.startsWith('msg:')) { delete result[key]; continue; }
                if (!value || value.secureCacheVersion !== 1) throw new Error('Encrypted cache unavailable');
                result[key] = JSON.parse(await browser.chatPanel.decryptChatHistory(value.keyId, value.ciphertext));
            }
            return result;
        }
        if (message.operation === 'set') {
            const output = {};
            for (const [key, value] of Object.entries(message.values || {})) {
                if (!key.startsWith('msg:')) throw new Error('Invalid cache key');
                const prior = (await browser.storage.local.get(key))[key];
                output[key] = await encryptRecord(value, prior);
            }
            await browser.storage.local.set(output);
            return true;
        }
        throw new Error('Invalid cache operation');
    });
    recordQueue = task;
    return task;
}
function recordRequest(operation, args = {}) {
    const message = { command: 'secure_local_data', operation, ...args };
    return background ? secureLocalDataOperation(message) : browser.runtime.sendMessage(message);
}
export const secureLocalRecords = {
    keys: () => recordRequest('keys'),
    get: query => recordRequest('get', { query }),
    set: values => recordRequest('set', { values }),
    remove: keys => recordRequest('remove', { keys }),
};
export async function migrateSensitiveLocalData() {
    await promptStorage.get(Object.fromEntries(PROMPT_KEYS.map(key => [key, null])));
    return recordRequest('migrate');
}
