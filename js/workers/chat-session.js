import { redactApiError } from '../api/api-utils.js';
import { StreamDecoder, abortable } from './stream-transport.js';

const DEFAULT_IDLE_TIMEOUT = 120000;
const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'thinking'];

export class ChatSession {
    constructor({ provider, client, history, emit, strings = {}, describeError, onResponseId = () => {}, idleTimeout = DEFAULT_IDLE_TIMEOUT }) {
        Object.assign(this, { provider, client, history, emit, strings, describeError, onResponseId, idleTimeout });
        this.sequence = 0;
        this.current = null;
        this.tools = null;
        this.previousResponseId = null;
    }

    modelMessage(role, text) {
        return this.provider === 'google_gemini'
            ? { role: role === 'assistant' ? 'model' : role, parts: [{ text }] }
            : { role, content: text };
    }

    resetResponseId() { this.previousResponseId = null; this.onResponseId(null); }

    async send(text) {
        if (this.current) return;
        this.history.push(this.modelMessage('user', text));
        const request = { id: ++this.sequence, controller: new AbortController(), reader: null,
            text: '', thinking: '', waitingCalls: null, finished: false, timer: null, toolRounds: 0 };
        this.current = request;
        this.emit({ type: 'messageSent' });
        await this.run(request);
    }

    touch(request) {
        clearTimeout(request.timer);
        request.timer = setTimeout(() => {
            request.controller.abort(new Error('The server stopped responding'));
        }, this.idleTimeout);
    }

    async fetch(request) {
        const signal = request.controller.signal;
        if (this.provider === 'openai_comp') return this.client.fetchResponse(this.history, 0, this.tools, { signal });
        if (this.provider === 'chatgpt') {
            const input = this.previousResponseId ? this.history.slice(-1) : this.history;
            return this.client.fetchResponse(input, 0, this.previousResponseId, { signal });
        }
        return this.client.fetchResponse(this.history, { signal });
    }

    async run(request) {
        const calls = [];
        let reader;
        try {
            if (++request.toolRounds > 8) throw new Error('Tool call limit reached for this message');
            this.touch(request);
            const response = await abortable(this.fetch(request), request.controller.signal);
            if (!response?.ok) {
                let detail = response?.error || response?.statusText || 'Request failed';
                if (!response?.is_exception) {
                    try {
                        const body = await abortable(response.json(), request.controller.signal);
                        detail = body.error?.message || (typeof body.error === 'string' ? body.error : detail);
                    } catch (error) { if (request.controller.signal.aborted) throw error; }
                }
                if (this.describeError && response?.status === 400) detail = this.describeError(detail, this.client.model, this.strings);
                const error = new Error(String(detail));
                error.apiException = !!response?.is_exception;
                throw error;
            }
            if (!response.body) throw new Error('The server returned no response stream');
            reader = response.body.getReader();
            request.reader = reader;
            const decoder = new StreamDecoder(this.provider === 'ollama' ? 'ndjson' : 'sse');
            let complete = false;
            while (!complete) {
                this.touch(request);
                const { done, value } = await abortable(reader.read(), request.controller.signal);
                for (const event of decoder.feed(value, done)) {
                    if (request.finished) return;
                    if (this.consume(event, request, calls)) { complete = true; break; }
                }
                if (done) complete = true;
            }
            if (request.finished) return;
            if (calls.filter(Boolean).length) {
                request.waitingCalls = calls.filter(Boolean).map((call, index) => ({ ...call, id: call.id || `call_${request.id}_${index}` }));
                this.history.push({ role: 'assistant', content: request.text || null,
                    tool_calls: request.waitingCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) });
                request.text = '';
                this.emit({ type: 'toolCalls', payload: { requestId: request.id, calls: request.waitingCalls } });
            } else this.finish(request);
        } catch (error) {
            if (!request.finished) this.fail(request, error);
        } finally {
            clearTimeout(request.timer);
            request.reader = null;
            if (reader) {
                // Cancel first so servers stop generating on early terminal events.
                Promise.resolve(reader.cancel()).catch(() => {}).finally(() => {
                    try { reader.releaseLock(); } catch (_) {}
                });
            }
        }
    }

    token(request, text, thinking = false) {
        if (typeof text !== 'string' || !text) return;
        request[thinking ? 'thinking' : 'text'] += text;
        this.emit({ type: thinking ? 'newThinkingToken' : 'newToken', payload: { token: text } });
    }

    consume(event, request, calls) {
        if (event.type === '__done') return true;
        if (event.error || event.type === 'error' || event.type === 'response.failed') {
            throw new Error(event.error?.message || event.response?.error?.message || (typeof event.error === 'string' ? event.error : 'The server reported a streaming error'));
        }
        if (this.provider === 'openai_comp') {
            if (event.usage) this.emit({ type: 'usage', payload: { used: event.usage.total_tokens ?? ((event.usage.prompt_tokens || 0) + (event.usage.completion_tokens || 0)), size: this.contextSize || null } });
            const delta = event.choices?.[0]?.delta;
            if (!delta) return false;
            for (const field of REASONING_FIELDS) {
                const value = delta[field];
                const text = typeof value === 'string' ? value : value?.text;
                if (text) { this.token(request, text, true); break; }
            }
            this.token(request, delta.content);
            for (const part of delta.tool_calls || []) {
                const index = part.index ?? 0;
                if (!Number.isInteger(index) || index < 0 || index > 127) throw new Error('Invalid tool call index');
                const call = calls[index] ??= { id: '', name: '', arguments: '' };
                if (part.id) call.id = part.id;
                if (part.function?.name) call.name += part.function.name;
                if (part.function?.arguments) call.arguments += part.function.arguments;
            }
        } else if (this.provider === 'ollama') {
            this.token(request, event.message?.thinking, true);
            this.token(request, event.message?.content);
            return event.done === true;
        } else if (this.provider === 'google_gemini') {
            for (const part of event.candidates?.[0]?.content?.parts || []) this.token(request, part.text, part.thought === true);
        } else if (this.provider === 'anthropic') {
            if (event.type === 'content_block_delta') {
                this.token(request, event.delta?.thinking, true);
                this.token(request, event.delta?.text);
            }
            return event.type === 'message_stop';
        } else if (this.provider === 'chatgpt') {
            if (event.type === 'response.created' && event.response?.id) { this.previousResponseId = event.response.id; this.onResponseId(this.previousResponseId); }
            if (event.type === 'response.output_text.delta') this.token(request, event.delta);
            if (['response.reasoning_summary_text.delta', 'response.reasoning_text.delta'].includes(event.type)) this.token(request, event.delta, true);
            if (event.type === 'response.output_item.done' && event.item?.type === 'reasoning' && !request.thinking) {
                this.token(request, (event.item.summary || []).map(part => part.text || '').join(''), true);
            }
            if (event.type === 'response.incomplete') throw new Error('The server returned an incomplete response');
            return event.type === 'response.completed';
        }
        return false;
    }

    finish(request, interrupted = false) {
        if (request.finished) return;
        request.finished = true;
        clearTimeout(request.timer);
        if (request.text) this.history.push(this.modelMessage('assistant', request.text));
        this.current = null;
        this.emit({ type: 'tokensDone', payload: { thinking: request.thinking, history: this.history, interrupted } });
    }

    fail(request, error) {
        request.finished = true;
        clearTimeout(request.timer);
        if (request.text) this.history.push(this.modelMessage('assistant', request.text));
        this.resetResponseId();
        this.current = null;
        const label = this.strings[`${this.provider === 'openai_comp' ? 'OpenAIComp' : this.provider}_api_request_failed`] || 'AI request failed';
        this.emit({ type: 'error', payload: (error.apiException ? '' : label + ': ') + redactApiError(error, this.client.apiKey), history: this.history });
    }

    stop() {
        const request = this.current;
        if (!request) return;
        request.controller.abort(new Error('Request cancelled'));
        if (request.waitingCalls) {
            for (const call of request.waitingCalls) this.history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ cancelled: true }) });
            request.waitingCalls = null;
        }
        this.resetResponseId();
        this.finish(request, true);
    }

    async toolResults(results, requestId) {
        const request = this.current;
        if (!request || request.finished || request.id !== requestId || !request.waitingCalls) return;
        for (const call of request.waitingCalls) {
            const result = results?.find(result => result.tool_call_id === call.id);
            this.history.push({ role: 'tool', tool_call_id: call.id, content: result?.content || JSON.stringify({ error: 'Missing tool result' }) });
        }
        request.waitingCalls = null;
        await this.run(request);
    }
}
