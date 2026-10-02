/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * 
 * 
 *  This file contains a modified version of the code from the project at https://github.com/boxabirds/chatgpt-frontend-nobuild
 *  The original code has been released under the Apache License, Version 2.0.
 */

import { OpenAIComp } from '../api/openai_comp.js';
import { taLogger } from '../mzta-logger.js';

let openai_comp = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
// Function tools offered to the model (ThunderAI Side Panel fork). Null = none.
let tools = null;
// Tool calls being assembled from the stream, by index.
let toolCallsAccumulator = [];
let assistantResponseAccumulator = '';
let thinkingAccumulator = '';
// Context meter (ThunderAI Side Panel fork): window size from the server, and
// the tokens the latest request used (prompt + answer), from its usage chunk.
let contextSize = null;
let lastUsage = null;

// Reasoning field names used by the various OpenAI-compatible servers, in priority
// order: reasoning_content (DeepSeek, vLLM, SGLang), reasoning (OpenRouter, which
// may send a string or an object with a .text property), thinking (some
// llama.cpp / LM Studio builds). Detection is based purely on the field being
// present in the stream, so a model that reasons without the connection's thinking
// option being enabled is still handled.
const REASONING_DELTA_FIELDS = ['reasoning_content', 'reasoning', 'thinking'];

function extractReasoningToken(delta) {
    for (const field of REASONING_DELTA_FIELDS) {
        const value = delta[field];
        if (typeof value === 'string' && value !== '') {
            return value;
        }
        if (value && typeof value === 'object' && typeof value.text === 'string' && value.text !== '') {
            return value.text;
        }
    }
    return null;
}

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        let config = { stream: true };
        for (const key in event.data) {
            if (key.startsWith('openai_comp_')) {
                let newKey = key.replace('openai_comp_', '');
                if (newKey === 'api_key') newKey = 'apiKey';
                config[newKey] = event.data[key];
            }
        }
        openai_comp = new OpenAIComp(config);
        do_debug = event.data.do_debug;
        i18nStrings = event.data.i18nStrings;
        taLog = new taLogger('model-worker-openai_comp', do_debug);
        contextSize = await openai_comp.fetchContextSize();
        postMessage({ type: 'usage', payload: { used: 0, size: contextSize } });
    } else if (event.data.type === 'setTools') {
        tools = Array.isArray(event.data.tools) && event.data.tools.length > 0 ? event.data.tools : null;
    } else if (event.data.type === 'toolResults') {
        // Results of the tool calls the page ran: add them and let the model continue.
        for (const result of event.data.results || []) {
            conversationHistory.push({ role: 'tool', tool_call_id: result.tool_call_id, content: result.content });
        }
        await streamTurn();
    } else if (event.data.type === 'chatMessage') {
        conversationHistory.push({ role: 'user', content: event.data.message });
        postMessage({ type: 'messageSent' });
        await streamTurn();
    } else if (event.data.type === 'stop') {
        stopStreaming = true;
    }
};

// One model turn: stream the answer; if the model asks for tools, hand the
// calls to the page (which answers with 'toolResults') instead of finishing.
async function streamTurn() {
    toolCallsAccumulator = [];
    lastUsage = null;
    const response = await openai_comp.fetchResponse(conversationHistory, 0, tools); //4096);

        if (!response.ok) {
            let error_message = '';
            let errorDetail = '';
            let error_text = '';
            if(response.is_exception === true){
                error_message = response.error;
                // Network-level failure: no status/statusText exist on the returned object,
                // and error_message already carries the provider name.
                error_text = error_message;
            }else{
                try{
                    const errorJSON = await response.json();
                    errorDetail = JSON.stringify(errorJSON);
                    error_message = errorJSON.error.message;
                }catch(e){
                    error_message = response.statusText;
                }
                taLog.log("error_message: " + JSON.stringify(error_message));
                error_text = i18nStrings["OpenAIComp_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + (errorDetail ? " " + errorDetail : "");
            }
            postMessage({ type: 'error', payload: error_text });
            throw new Error("[ThunderAI] OpenAI Comp API request failed: " + error_text);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
    
        while (true) {
            if (stopStreaming) {
                stopStreaming = false;
                reader.cancel();
                taLog.log("AI full reasoning [STOPPED]: " + thinkingAccumulator);
                taLog.log("AI full response [STOPPED]: " + assistantResponseAccumulator);
                conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                assistantResponseAccumulator = '';
                postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                thinkingAccumulator = '';
                break;
            }
            const { done, value } = await reader.read();
            if (done) {
                if (lastUsage) {
                    postMessage({ type: 'usage', payload: { used: lastUsage, size: contextSize } });
                }
                taLog.log("AI full reasoning: " + thinkingAccumulator);
                taLog.log("AI full response: " + assistantResponseAccumulator);
                const calls = toolCallsAccumulator.filter(Boolean).map((c, i) => ({ ...c, id: c.id || ('call_' + Date.now() + '_' + i) }));
                if (calls.length > 0) {
                    // The model wants tools: record its request and hand the calls to
                    // the page. The turn continues when 'toolResults' arrives.
                    conversationHistory.push({
                        role: 'assistant',
                        content: assistantResponseAccumulator || null,
                        tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
                    });
                    assistantResponseAccumulator = '';
                    postMessage({ type: 'toolCalls', payload: { calls: calls.map(c => ({ id: c.id, name: c.name, arguments: c.arguments })) } });
                    break;
                }
                conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                assistantResponseAccumulator = '';
                postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                thinkingAccumulator = '';
                break;
            }
            // lots of low-level OpenAI response parsing stuff
            const chunk = decoder.decode(value);
            buffer += chunk;
            // No per-chunk dump of `buffer` here: taLog.log() only gates the console
            // call, so its argument is built whether or not debug is on - and that
            // argument is the whole unconsumed buffer, rebuilt on every SSE chunk.
            // The per-line log below covers the same content, guarded properly.
            const lines = buffer.split("\n");
            buffer = lines.pop();
            let parsedLines = [];
            try{
                parsedLines = lines
                    .map((line) => line.replace(/^data: /, "").trim()) // Remove the "data: " prefix
                    .map((line) => line.replace(/^: OPENROUTER PROCESSING/, "").trim()) // Remove the ": OPENROUTER PROCESSING " prefix
                    .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                    // .map((line) => JSON.parse(line)); // Parse the JSON string
                    .map((line) => {
                         try {
                            // Guarded at the call site: taLog.log() gates only the console
                            // call, so an unguarded JSON.stringify() would run per SSE line
                            // even with debug off.
                            if (taLog.do_debug) taLog.log("line: " + JSON.stringify(line));
                            return JSON.parse(line);
                        } catch (e) {
                            taLog.warn("JSON parse warning, skipped line: " + line + " - " + e.message);
                            return null;
                        }
                    })
                    .filter((parsed) => parsed !== null);
            }catch(e){
                taLog.error("Error parsing lines: " + e);
            }
    
            for (const parsedLine of parsedLines) {
                const { choices } = parsedLine;
                if (parsedLine.usage) {
                    const u = parsedLine.usage;
                    lastUsage = u.total_tokens ?? ((u.prompt_tokens || 0) + (u.completion_tokens || 0));
                }
                if (!choices || choices.length === 0) {
                    // Debug-gated, unlike most warn() calls: a frame without choices is
                    // routine here (keep-alives and usage-only frames are what plenty of
                    // OpenAI-compatible servers send), so this fires per chunk on a normal
                    // response - and taLog.warn() is never gated by the logger itself.
                    if (taLog.do_debug) taLog.warn("No choices found in parsed line: " + JSON.stringify(parsedLine));
                    continue;
                }
                const { delta } = choices[0];
                if (!delta || typeof delta !== 'object') {
                    continue;
                }
                // Update the UI with the new thinking content
                const thinkingToken = extractReasoningToken(delta);
                if (thinkingToken) {
                    thinkingAccumulator += thinkingToken;
                    postMessage({ type: 'newThinkingToken', payload: { token: thinkingToken } });
                }
                const { content } = delta;
                // Update the UI with the new content
                if (content) {
                    assistantResponseAccumulator += content;
                    postMessage({ type: 'newToken', payload: { token: content } });
                }
                // Tool calls arrive in pieces: the id and name first, then the
                // JSON arguments as string fragments, keyed by index.
                if (Array.isArray(delta.tool_calls)) {
                    for (const part of delta.tool_calls) {
                        const i = part.index ?? 0;
                        const call = toolCallsAccumulator[i] ??= { id: '', name: '', arguments: '' };
                        if (part.id) call.id = part.id;
                        if (part.function?.name) call.name += part.function.name;
                        if (part.function?.arguments) call.arguments += part.function.arguments;
                    }
                }
            }
        }
}
