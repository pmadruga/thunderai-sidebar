// Encrypted, account-scoped email chat storage. Background-owned revisions
// prevent stale windows from overwriting or recreating a deleted conversation.
const PREFIX = 'email_chat_v2_';
const BLOCK = 'email_chat_block_v2_';
const INDEX = 'email_chat_index_v2';
const KEY_PREF = 'email_chat_keystore_id';
export const HISTORY_DEFAULTS = { chat_history_retention_days: 90, chat_history_max_mb: 50 };
let keyPromise;
async function encryptionKey(create) {
    if (!keyPromise) keyPromise = (async () => {
        let id = (await browser.storage.local.get(KEY_PREF))[KEY_PREF];
        if (!id) {
            if (!create) throw new Error('Chat history key unavailable');
            id = crypto.randomUUID();
            await browser.chatPanel.createChatHistoryKey(id);
            await browser.storage.local.set({ [KEY_PREF]: id });
        }
        return id;
    })();
    const task = keyPromise;
    try { return await task; } finally { if (keyPromise === task) keyPromise = null; }
}

export class ChatHistoryStore {
    constructor(storage, encrypt, decrypt, notify = () => {}, deleteKey = async () => {}) {
        this.storage = storage;
        this.encrypt = encrypt;
        this.decrypt = decrypt;
        this.notify = notify;
        this.deleteKey = deleteKey;
        // One queue also makes retention/delete-all atomic with writes.
        this.pending = Promise.resolve();
        this.cache = new Map();
    }

    operation(key, operation, value) {
        if (!['deleteAll', 'prune'].includes(operation) && !/^[a-f0-9]{64}$/.test(key || '')) {
            return Promise.reject(new Error('Invalid email chat key'));
        }
        const task = this.pending.catch(() => {}).then(() => this.run(key, operation, value));
        this.pending = task;
        return task;
    }

    async index(key, root) {
        const index = (await this.storage.get(INDEX))[INDEX] || {};
        index[key] = { updated: root.updated, bytes: root.bytes || 0, deleted: !!root.deleted };
        await this.storage.set({ [INDEX]: index });
    }

    async root(key) {
        return (await this.storage.get(PREFIX + key))[PREFIX + key];
    }

    async state(key, root) {
        const cached = this.cache.get(key);
        if (cached && cached.revision === root.revision && cached.generation === root.generation) return cached;
        const state = { generation: root.generation, revision: root.revision,
            manifest: { version: 2, turns: [], history: [], context: null, integration: null, provenance: null },
            strings: new Map(), blocks: new Map(), decoded: new Map() };
        if (!root.deleted) {
            if (root.encryption !== 'oskeystore-v2') throw new Error('Unrecognized encrypted chat history');
            state.manifest = JSON.parse(await this.decrypt(root.ciphertext));
            if (state.manifest.version !== 2) throw new Error('Unsupported chat history version');
            const entries = await this.storage.get(root.blocks || []);
            state.blocks = new Map(Object.entries(entries));
        }
        this.cache.set(key, state);
        // Bound decrypted in-memory caches. Active pages retain their own state.
        while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
        return state;
    }

    async decode(node, state) {
        if (node[0] === 'p') return node[1];
        if (node[0] === 'a') return Promise.all(node[1].map(item => this.decode(item, state)));
        if (node[0] === 'o') return Object.fromEntries(await Promise.all(node[1].map(async ([k, v]) => [k, await this.decode(v, state)])));
        if (node[0] === 's' || node[0] === 'c') {
            const text = await this.readBlock(node[1], state);
            state.strings.set(JSON.stringify(text), node[1]);
            return node[0] === 'c' ? text + node[2] : text;
        }
        throw new Error('Invalid encrypted history content');
    }

    async readBlock(id, state) {
        if (state.decoded.has(id)) return state.decoded.get(id);
        const envelope = state.blocks.get(id);
        if (!envelope?.ciphertext) throw new Error('Missing encrypted chat block');
        const value = JSON.parse(await this.decrypt(envelope.ciphertext));
        state.decoded.set(id, value);
        return value;
    }

    async unpack(state) {
        const unpackItems = refs => Promise.all(refs.map(async ref => this.decode(await this.readBlock(ref, state), state)));
        return { version: 2, turns: await unpackItems(state.manifest.turns),
            history: await unpackItems(state.manifest.history),
            context: state.manifest.context ? await this.readBlock(state.manifest.context, state) : null,
            integration: state.manifest.integration, provenance: state.manifest.provenance };
    }

    async saveBlock(key, value, state, writes) {
        const serialized = JSON.stringify(value);
        const existing = state.strings.get(serialized);
        if (existing && state.blocks.has(existing)) return existing;
        const id = BLOCK + key + '_' + crypto.randomUUID();
        const envelope = { ciphertext: await this.encrypt(serialized) };
        writes[id] = envelope;
        state.blocks.set(id, envelope);
        state.decoded.set(id, value);
        state.strings.set(serialized, id);
        return id;
    }

    async encode(value, key, state, writes, context) {
        if (typeof value === 'string' && value.length > 2048) {
            if (context && value.startsWith(context) && value !== context) {
                return ['c', await this.saveBlock(key, context, state, writes), value.slice(context.length)];
            }
            return ['s', await this.saveBlock(key, value, state, writes)];
        }
        if (Array.isArray(value)) return ['a', await Promise.all(value.map(item => this.encode(item, key, state, writes, context)))];
        if (value && typeof value === 'object') return ['o', await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await this.encode(v, key, state, writes, context)]))];
        return ['p', value];
    }

    async run(key, operation, value = {}) {
        if (operation === 'deleteAll' || operation === 'prune') return this.prune(operation === 'deleteAll', null, true);
        let root = await this.root(key);
        if (!root) {
            root = { generation: crypto.randomUUID(), revision: 0, deleted: true, updated: Date.now(), blocks: [] };
            await this.storage.set({ [PREFIX + key]: root });
            await this.index(key, root);
        }
        if (operation === 'delete') {
            const tombstone = { generation: crypto.randomUUID(), revision: root.revision + 1, deleted: true, updated: Date.now(), blocks: [] };
            await this.storage.set({ [PREFIX + key]: tombstone });
            await this.index(key, tombstone);
            if (root.blocks?.length) await this.storage.remove(root.blocks);
            this.cache.delete(key);
            this.notify(key);
            return true;
        }
        if (operation === 'load') {
            const prefs = await this.storage.get(HISTORY_DEFAULTS);
            const days = Number(prefs.chat_history_retention_days);
            if (!root.deleted && (days === 0 || (Number.isFinite(days) && days > 0 && root.updated < Date.now() - days * 86400000))) {
                await this.run(key, 'delete');
                root = await this.root(key);
            }
            return { generation: root.generation, revision: root.revision, value: await this.unpack(await this.state(key, root)) };
        }
        if (operation !== 'save') throw new Error('Invalid email chat operation');
        if (value.generation !== root.generation || value.revision !== root.revision) throw new Error('CHAT_HISTORY_STALE: reopen this conversation before saving');
        const prefs = await this.storage.get(HISTORY_DEFAULTS);
        if (Number(prefs.chat_history_retention_days) === 0) throw new Error('CHAT_HISTORY_DISABLED');
        const prior = await this.state(key, root);
        // Mutate a private copy so encryption/storage failures leave cache and
        // the committed manifest intact. Incomplete new blocks are pruned later.
        const state = { ...prior, manifest: structuredClone(prior.manifest), blocks: new Map(prior.blocks),
            decoded: new Map(prior.decoded), strings: new Map(prior.strings) };
        const patch = value.patch || {};
        const writes = {};
        let context = patch.context !== undefined ? patch.context : state.manifest.context ? await this.readBlock(state.manifest.context, state) : null;
        if (patch.context !== undefined) state.manifest.context = context ? await this.saveBlock(key, context, state, writes) : null;
        for (const field of ['integration', 'provenance']) if (patch[field] !== undefined) state.manifest[field] = patch[field];
        for (const field of ['turns', 'history']) {
            for (const { index, value: item } of patch[field] || []) {
                if (!Number.isInteger(index) || index < 0 || index > state.manifest[field].length) throw new Error('Invalid history patch index');
                const encoded = await this.encode(item, key, state, writes, context);
                state.manifest[field][index] = await this.saveBlock(key, encoded, state, writes);
            }
            const length = patch[field + 'Length'];
            if (length !== undefined) {
                if (!Number.isInteger(length) || length < 0 || length > state.manifest[field].length) throw new Error('Invalid history patch length');
                state.manifest[field].length = length;
            }
        }
        const keep = new Set([...state.manifest.turns, ...state.manifest.history]);
        if (state.manifest.context) keep.add(state.manifest.context);
        const collect = node => {
            if (node[0] === 's' || node[0] === 'c') keep.add(node[1]);
            if (node[0] === 'a') node[1].forEach(collect);
            if (node[0] === 'o') node[1].forEach(([, v]) => collect(v));
        };
        for (const id of [...state.manifest.turns, ...state.manifest.history]) collect(await this.readBlock(id, state));
        const ciphertext = await this.encrypt(JSON.stringify(state.manifest));
        const bytes = ciphertext.length + [...keep].reduce((sum, id) => sum + state.blocks.get(id).ciphertext.length, 0);
        const budget = Math.max(1, Math.min(500, Number(prefs.chat_history_max_mb) || 50)) * 1024 * 1024;
        if (bytes > budget) throw new Error('CHAT_HISTORY_FULL: this conversation exceeds the saved-chat budget');
        if (Object.keys(writes).length) await this.storage.set(writes);
        const committed = { encryption: 'oskeystore-v2', generation: root.generation, revision: root.revision + 1,
            updated: Date.now(), bytes, blocks: [...keep], ciphertext };
        await this.storage.set({ [PREFIX + key]: committed });
        await this.index(key, committed);
        const garbage = [...state.blocks.keys()].filter(id => !keep.has(id));
        if (garbage.length) await this.storage.remove(garbage);
        state.revision = committed.revision;
        for (const id of garbage) { state.blocks.delete(id); state.decoded.delete(id); }
        for (const [text, id] of state.strings) if (!keep.has(id)) state.strings.delete(text);
        this.cache.set(key, state);
        await this.prune(false, key);
        return { revision: committed.revision, generation: committed.generation };
    }

    async prune(all, preserveKey = null, sweepOrphans = false) {
        const prefs = await this.storage.get(HISTORY_DEFAULTS);
        const days = Math.max(0, Number(prefs.chat_history_retention_days) || 0);
        const budget = Math.max(1, Math.min(500, Number(prefs.chat_history_max_mb) || 50)) * 1024 * 1024;
        const index = (await this.storage.get(INDEX))[INDEX] || {};
        const entries = Object.entries(index).filter(([, v]) => !v.deleted).sort((a, b) => b[1].updated - a[1].updated);
        let total = 0;
        for (const [key, root] of entries) {
            const expired = Date.now() - root.updated > days * 86400000;
            if (all || days === 0 || (key !== preserveKey && (total + root.bytes > budget || expired))) {
                await this.run(key, 'delete');
            } else total += root.bytes;
        }
        const latestIndex = (await this.storage.get(INDEX))[INDEX] || {};
        const tombstones = Object.entries(latestIndex).filter(([, v]) => v.deleted).sort((a, b) => b[1].updated - a[1].updated);
        const forget = tombstones.filter(([, v], i) => all || i >= 1000 || Date.now() - v.updated > Math.max(1, days) * 86400000).map(([key]) => key);
        if (forget.length) {
            await this.storage.remove(forget.map(key => PREFIX + key));
            for (const key of forget) { delete latestIndex[key]; this.cache.delete(key); }
            await this.storage.set({ [INDEX]: latestIndex });
        }
        if (all) {
            this.cache.clear();
            await this.deleteKey();
            await this.storage.remove(INDEX);
        }
        // Only the startup/explicit maintenance path scans encrypted blocks.
        // Ordinary checkpoints read the small index, not all stored transcripts.
        if (sweepOrphans) {
            const latest = await this.storage.get(null);
            const live = new Set(Object.entries(latest).filter(([k]) => k.startsWith(PREFIX)).flatMap(([, v]) => v.blocks || []));
            const orphaned = Object.keys(latest).filter(k => k.startsWith(BLOCK) && !live.has(k));
            if (orphaned.length) await this.storage.remove(orphaned);
        }
        return true;
    }

}

let store;
export function chatHistoryOperation(key, operation, value) {
    store ||= new ChatHistoryStore(browser.storage.local,
        async text => browser.chatPanel.encryptChatHistory(await encryptionKey(true), text),
        async ciphertext => browser.chatPanel.decryptChatHistory(await encryptionKey(false), ciphertext),
        key => browser.runtime.sendMessage({ command: 'email_chat_invalidated', key }).catch(() => {}),
        async () => {
            const id = (await browser.storage.local.get(KEY_PREF))[KEY_PREF];
            if (id) await browser.chatPanel.deleteChatHistoryKey(id);
            await browser.storage.local.remove(KEY_PREF);
            keyPromise = null;
        });
    return store.operation(key, operation, value);
}

export async function emailThreadKey(messages) {
    const roots = await browser.chatPanel.getChatThreadRoots(messages.map(m => m.id));
    const identities = [...new Set(messages.map((message, index) => JSON.stringify([
        message.folder?.accountId || 'external-message',
        String(roots[index] || message.headerMessageId || message.id).trim().replace(/^<|>$/g, ''),
    ])))].sort();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identities)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
