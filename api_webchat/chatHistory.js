// Changed-turn patches only. There is at most one save in flight; subsequent
// checkpoints coalesce, so a slow key store cannot queue whole transcripts.
export class EmailChatHistory {
    constructor(integration, onError) {
        this.integration = integration;
        this.onError = onError;
        this.reset();
    }
    reset() {
        this.epoch = (this.epoch || 0) + 1;
        clearTimeout(this.timer);
        this.key = null;
        this.turns = [];
        this.history = [];
        this.context = null;
        this.provenance = null;
        this.active = null;
        this.timer = null;
        this.dirtyTurns = new Set();
        this.dirtyHistory = new Set();
        this.metaDirty = false;
        this.inflight = null;
    }
    async load(key) {
        this.reset();
        const epoch = this.epoch;
        const loaded = await browser.runtime.sendMessage({ command: 'email_chat_history', operation: 'load', key });
        if (epoch !== this.epoch) return [];
        const saved = loaded.value;
        this.key = key;
        this.revision = loaded.revision;
        this.generation = loaded.generation;
        this.turns = saved.turns;
        this.context = saved.context;
        this.provenance = saved.provenance;
        this.history = saved.integration === this.integration ? saved.history : this.fromTurns();
        // If a provider format changed, replace its native history on first save.
        if (saved.integration !== this.integration) this.history.forEach((_, i) => this.dirtyHistory.add(i));
        return this.turns;
    }
    modelMessage(role, content) {
        return this.integration === 'google_gemini'
            ? { role: role === 'assistant' ? 'model' : role, parts: [{ text: content }] }
            : { role, content };
    }
    fromTurns() {
        return this.turns.filter(t => t.role === 'user' || (t.role === 'assistant' && t.text))
            .map(t => this.modelMessage(t.role, t.role === 'user' ? t.content : t.text));
    }
    setProvenance(provenance) {
        if (JSON.stringify(this.provenance) !== JSON.stringify(provenance)) {
            this.provenance = provenance;
            this.metaDirty = true;
        }
    }
    user({ text, content, context }) {
        if (!this.key) return;
        this.active = null;
        this.dirtyTurns.add(this.turns.length);
        this.turns.push({ role: 'user', text, content });
        this.dirtyHistory.add(this.history.length);
        this.history.push(this.modelMessage('user', content));
        if (context) this.context = context;
        this.metaDirty = true;
        this.save();
    }
    token(text, thinking = false) {
        if (!this.key) return;
        if (!this.active) {
            this.active = { role: 'assistant', text: '', thinking: '', incomplete: true };
            this.turns.push(this.active);
        }
        this.active[thinking ? 'thinking' : 'text'] += text;
        this.dirtyTurns.add(this.turns.length - 1);
        if (!this.timer) this.timer = setTimeout(() => this.save(), 1500);
    }
    done(history, interrupted = false) {
        if (!this.key) return;
        if (this.active) {
            this.active.incomplete = !!interrupted;
            this.dirtyTurns.add(this.turns.length - 1);
        }
        history = Array.isArray(history) ? history : this.fromTurns();
        history.forEach((item, i) => {
            if (JSON.stringify(item) !== JSON.stringify(this.history[i])) this.dirtyHistory.add(i);
        });
        this.history = history;
        this.active = null;
        this.metaDirty = true;
        this.save();
    }
    error(text, nativeHistory) {
        if (!this.key) return;
        if (Array.isArray(nativeHistory)) {
            nativeHistory.forEach((item, i) => { if (JSON.stringify(item) !== JSON.stringify(this.history[i])) this.dirtyHistory.add(i); });
            this.history = nativeHistory;
            this.metaDirty = true;
        }
        if (!nativeHistory && this.active?.text) {
            this.dirtyHistory.add(this.history.length);
            this.history.push(this.modelMessage('assistant', this.active.text));
        }
        this.active = null;
        this.dirtyTurns.add(this.turns.length);
        this.turns.push({ role: 'error', text });
        this.save();
    }
    invalidate() {
        this.epoch = (this.epoch || 0) + 1;
        this.key = null;
        clearTimeout(this.timer);
        this.dirtyTurns.clear();
        this.dirtyHistory.clear();
        this.metaDirty = false;
    }
    async save() {
        clearTimeout(this.timer);
        this.timer = null;
        if (!this.key) return;
        if (this.inflight) { await this.inflight.catch(() => {}); return this.save(); }
        if (!this.metaDirty && !this.dirtyTurns.size && !this.dirtyHistory.size) return;
        const key = this.key;
        const epoch = this.epoch;
        const patch = {
            turns: [...this.dirtyTurns].map(index => ({ index, value: structuredClone(this.turns[index]) })),
            history: [...this.dirtyHistory].map(index => ({ index, value: structuredClone(this.history[index]) })),
            turnsLength: this.turns.length,
            historyLength: this.history.length,
        };
        if (this.active?.text) {
            patch.history.push({ index: this.history.length, value: this.modelMessage('assistant', this.active.text) });
            patch.historyLength++;
        }
        if (this.metaDirty) Object.assign(patch, { context: this.context, provenance: this.provenance, integration: this.integration });
        this.dirtyTurns.clear();
        this.dirtyHistory.clear();
        this.metaDirty = false;
        const task = browser.runtime.sendMessage({ command: 'email_chat_history', operation: 'save', key,
            value: { generation: this.generation, revision: this.revision, patch } });
        this.inflight = task;
        try {
            const result = await task;
            if (this.key === key && this.epoch === epoch) { this.revision = result.revision; this.generation = result.generation; }
        } catch (error) {
            // Stop saving, rather than retrying stale data or replacing a
            // record whose key cannot be read. Unsaved text stays visible.
            if (this.epoch === epoch) { this.invalidate(); this.onError(error); }
        } finally {
            if (this.inflight === task) this.inflight = null;
            if (this.epoch === epoch && this.key === key && (this.metaDirty || this.dirtyTurns.size || this.dirtyHistory.size)) await this.save();
        }
    }
}
