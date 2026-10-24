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

import { prefs_default, integration_options_config } from '../options/mzta-options-default.js';
import { placeholdersUtils } from '../js/mzta-placeholders.js';
import { getAPIsInitMessageString, convertNewlinesToBr } from '../js/mzta-utils.js';
import { loadPrompt } from '../js/mzta-prompts.js';
import { buildChatBubbleIcon } from './svgIcons.js';
import { runSpTool, describeSpTool, getSpTaskTitle, SP_WRITE_TOOLS, validateToolArguments } from './superproductivity.js';
import { fetchChatModels } from './models.js';
import { EmailChatHistory } from './chatHistory.js';
import { providerDestination, historyDestinationKey } from './historyIdentity.js';
import { getSecureSettings, setSecureSettings } from '../js/secure-settings.js';
import { acknowledgedHttpOrigins } from '../js/endpoint-policy.js';

// Set when the chat runs in the ThunderAI side panel (see experiments/chatPanel)
const mztaInPanel = new URLSearchParams(window.location.search).get('panel') === '1';

// Get the LLM to be used
const urlParams = new URLSearchParams(window.location.search);
const llm = urlParams.get('llm');
const call_id = urlParams.get('call_id');
const ph_def_val = urlParams.get('ph_def_val');
const prompt_id = urlParams.get('prompt_id');
const prompt_name = urlParams.get('prompt_name');

// Data received from the user
let promptData = null;

const messageInput = document.querySelector('message-input');
const messagesArea = document.querySelector('messages-area');

// --- Font zoom (Ctrl+ / Ctrl- / Ctrl+0), persisted across windows ---
const ZOOM_MIN = 0.5, ZOOM_MAX = 2.5, ZOOM_STEP = 0.1, ZOOM_DEFAULT = 1.0;
let currentZoom = ZOOM_DEFAULT;

function applyZoom(scale) {
    document.documentElement.style.fontSize = (scale * 100) + '%';
}

function setZoom(scale) {
    // clamp and round to avoid floating point drift
    scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(scale * 10) / 10));
    currentZoom = scale;
    applyZoom(scale);
    setSecureSettings({ api_webchat_font_scale: scale });
}

// Load the saved zoom level and apply it as soon as possible.
(async () => {
    const { api_webchat_font_scale } = await getSecureSettings({ api_webchat_font_scale: prefs_default.api_webchat_font_scale });
    currentZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, api_webchat_font_scale));
    applyZoom(currentZoom);
})();

document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    switch (event.key) {
        case '+':
        case '=':
            event.preventDefault();
            setZoom(currentZoom + ZOOM_STEP);
            break;
        case '-':
            event.preventDefault();
            setZoom(currentZoom - ZOOM_STEP);
            break;
        case '0':
            event.preventDefault();
            setZoom(ZOOM_DEFAULT);
            break;
    }
});

//console.log(">>>>>>>>>> controller.js DOMContentLoaded");

// console.log(">>>>>>>>>>> llm: " + llm);
// console.log(">>>>>>>>>>> call_id: " + call_id);

// The controller wires up all the components and workers together,
// managing the dependencies. A kind of "DI" class.
let worker = null;
let destination = null;
let activeToolRequest = null;
let chatPageBlocked = false;
let restoreEpoch = 0;
let boundContextIdentity = null;
const integration = llm.replace('_api', '');
let historyWarningShown = false;
const chatHistory = new EmailChatHistory(integration, error => {
    console.error('[ThunderAI] Could not save email chat');
    if (!historyWarningShown) {
        historyWarningShown = true;
        messagesArea.appendBotMessage(browser.i18n.getMessage('chat_history_save_error'), 'error');
    }
});
const clearChat = document.getElementById('clearEmailChat');
clearChat.textContent = browser.i18n.getMessage('chat_history_clear');
clearChat.title = browser.i18n.getMessage('chat_history_private');
messageInput.addEventListener('chat-message', event => {
    clearChat.disabled = true;
    chatHistory.user(event.detail);
});
clearChat.addEventListener('click', async () => {
    if (!clearChat.dataset.key || !window.confirm(browser.i18n.getMessage('chat_history_clear_confirm'))) return;
    const key = clearChat.dataset.key;
    const previousKey = chatHistory.key;
    chatHistory.invalidate();
    try {
        await browser.runtime.sendMessage({ command: 'email_chat_history', operation: 'delete', key });
        await browser.runtime.sendMessage({ command: 'shortcut_do_prompt', promptId: 'prompt_chat_email', tabId: promptData.tabId });
    } catch (error) {
        chatHistory.key = previousKey;
        messagesArea.appendBotMessage(browser.i18n.getMessage('chat_history_save_error'), 'error');
    }
});
window.addEventListener('pagehide', () => chatHistory.save());
const worker_path_map = {
    chatgpt: '../js/workers/model-worker-openai_responses.js',
    google_gemini: '../js/workers/model-worker-google_gemini.js',
    ollama: '../js/workers/model-worker-ollama.js',
    openai_comp: '../js/workers/model-worker-openai_comp.js',
    anthropic: '../js/workers/model-worker-anthropic.js',
};

const worker_path = worker_path_map[integration];

if (worker_path) {
    worker = new Worker(worker_path, { type: 'module' });
} else {
    console.error('[ThunderAI] API WebChat Unknown LLM type:', llm);
}

if (worker) {
    messagesArea.init(worker);
    messageInput.init(worker);
    messageInput.setMessagesArea(messagesArea);

    if (integration_options_config[integration]) {
        const integration_prefix = integration;
        const options_config = integration_options_config[integration];
        
        let prefsToGet = { do_debug: prefs_default.do_debug, hide_thinking: prefs_default.hide_thinking };
        for (const key in options_config) {
            prefsToGet[`${integration_prefix}_${key}`] = prefs_default[`${integration_prefix}_${key}`];
        }
        if (integration === 'openai_comp') {
            prefsToGet.openai_comp_chat_name = prefs_default.openai_comp_chat_name;
        }

        let prefs_api = await getSecureSettings(prefsToGet);

        if (prompt_id) {
            try {
                const prompt = await loadPrompt(prompt_id);
                if (prompt && prompt.api_type === llm) {
                    for (const key in options_config) {
                        const prefKey = `${integration_prefix}_${key}`;
                        if (prompt[prefKey] !== undefined) {
                            prefs_api[prefKey] = prompt[prefKey];
                        }
                    }
                }
            } catch (e) {
                console.error("[ThunderAI] Error loading prompt settings");
            }
        }

        let i18nStrings = {};
        const i18n_msg_key = integration === 'openai_comp' ? 'OpenAIComp_api_request_failed' : `${integration}_api_request_failed`;
        i18nStrings[i18n_msg_key] = browser.i18n.getMessage(i18n_msg_key);
        i18nStrings["error_connection_interrupted"] = browser.i18n.getMessage('error_connection_interrupted');

        destination = providerDestination(integration, prefs_api);
        messageInput.setProviderDestination(destination);
        messageInput.setModel(prefs_api[`${integration_prefix}_model`]);
        
        let llmName = "API";
        switch(integration) {
            case 'chatgpt': llmName = "ChatGPT"; break;
            case 'google_gemini': llmName = "Google Gemini"; break;
            case 'ollama': llmName = "Ollama Local"; break;
            case 'openai_comp': llmName = prefs_api.openai_comp_chat_name || "OpenAI Comp"; break;
            case 'anthropic': llmName = "Claude"; break;
        }
        messagesArea.setLLMName(llmName);
        messagesArea.setHideThinking(!!prefs_api.hide_thinking);

        // Shared by the header chip and the startup info message below.
        const api_strings = {
            chatgpt: "ChatGPT API",
            google_gemini: "Google Gemini API",
            ollama: "Ollama API",
            openai_comp: "OpenAI Compatible API",
            anthropic: "Claude API"
        };

        // Header bar: the logo icon plus two static chips, the API in use and
        // the model. Every live state (waiting / streaming / done / error)
        // belongs to the status pill above the input, so there is only one
        // thing to keep in sync with the request lifecycle.
        document.getElementById('appHeaderLogo').appendChild(buildChatBubbleIcon());
        const apiChip = document.getElementById('appHeaderApi');
        if (api_strings[integration]) {
            document.getElementById('appHeaderApiName').textContent = api_strings[integration];
            // `llm` is the connection type (chatgpt_api, anthropic_api, …), the
            // same key the settings pages tint their connection pill with.
            apiChip.classList.add('tint_' + llm);
            apiChip.hidden = false;
        }
        // Model chip: "prompt name | model", dropping either half when missing.
        const modelChip = document.getElementById('appHeaderModel');
        const model_label = prefs_api[`${integration_prefix}_model`] || llmName;
        const prompt_label = decodeURIComponent(prompt_name ?? '').trim();
        modelChip.textContent = prompt_label ? `${prompt_label} | ${model_label}` : model_label;
        if (mztaInPanel) {
            // Side panel: just the model's short name (no path, no .gguf).
            modelChip.textContent = String(model_label).split(/[\\/]/).pop().replace(/\.gguf$/i, '');
        }
        modelChip.title = modelChip.textContent;

        document.title += " [" + llmName + " | " + decodeURIComponent(prompt_name) + "]";

        let workerInitMessage = {
            type: 'init',
            allowed_http_origins: await acknowledgedHttpOrigins(),
            do_debug: prefs_api.do_debug,
            i18nStrings: i18nStrings,
        };

        for (const key in options_config) {
            const prefKey = `${integration_prefix}_${key}`;
            workerInitMessage[prefKey] = prefs_api[prefKey];
        }
        
        worker.postMessage(workerInitMessage);

        messageInput.configureModels(() => fetchChatModels(integration, prefs_api), model => {
            const modelKey = `${integration_prefix}_model`;
            prefs_api[modelKey] = model;
            workerInitMessage[modelKey] = model;
            // Reconfigure the same worker: its conversation history and tools stay
            // intact. OpenAI clears previous_response_id and sends the full history.
            worker.postMessage(workerInitMessage);
            messageInput.setModel(model);
            messageInput.setContextUsage(0, null);
            const label = mztaInPanel
                ? model.split(/[\\/]/).pop().replace(/\.gguf$/i, '')
                : prompt_label ? `${prompt_label} | ${model}` : model;
            modelChip.textContent = label;
            modelChip.title = label;
            if (mztaInPanel) {
                const title = document.getElementById('appHeaderName');
                title.title = `${title.textContent} | ${label}`;
            }
        });

        const additional_messages_config = {
            chatgpt: [
                { key: 'store', labelKey: 'ChatGPT_chatgpt_api_store', type: 'boolean' },
                { key: 'developer_messages', labelKey: 'ChatGPT_Developer_Messages', type: 'string' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'reasoning_summary', labelKey: 'prefs_OptionText_chatgpt_reasoning_summary', type: 'string' },
                { key: 'reasoning_effort', labelKey: 'prefs_OptionText_chatgpt_reasoning_effort', type: 'string' },
                { key: 'extra_body', labelKey: 'prefs_OptionText_chatgpt_extra_body', type: 'string' }
            ],
            google_gemini: [
                { key: 'system_instruction', labelKey: 'GoogleGemini_SystemInstruction', type: 'string' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'thinking_budget', labelKey: 'prefs_google_gemini_thinking_budget', type: 'string' }
            ],
            ollama: [
                { key: 'think', labelKey: 'prefs_ollama_think', type: 'boolean' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'num_ctx', labelKey: 'prefs_ollama_num_ctx', type: 'number_gt_zero' }
            ],
            openai_comp: [
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'extra_body', labelKey: 'prefs_OptionText_openai_comp_extra_body', type: 'string' }
            ],
            anthropic: [
                { key: 'system_prompt', labelKey: 'Anthropic_System_Prompt', type: 'string' },
                { key: 'max_tokens', labelKey: 'prefs_OptionText_anthropic_max_tokens', type: 'number_gt_zero' },
                { key: 'temperature', labelKey: 'prefs_api_temperature', type: 'string' },
                { key: 'extended_thinking_budget', labelKey: 'prefs_OptionText_anthropic_extended_thinking_budget', type: 'number_gt_zero' }
            ]
        };

        const getAdditionalMessages = (integration, prefs) => {
            const messages = [];
            const config = additional_messages_config[integration];
            if (!config) return messages;

            for (const item of config) {
                const prefKey = `${integration}_${item.key}`;
                const value = prefs[prefKey];

                if (value !== undefined && value !== null && value !== '') {
                    let displayValue;
                    let shouldAdd = false;

                    switch (item.type) {
                        case 'boolean':
                            displayValue = value ? 'Yes' : 'No';
                            shouldAdd = true;
                            break;
                        case 'string':
                            if (value.length > 0) {
                                displayValue = value;
                                shouldAdd = true;
                            }
                            break;
                        case 'number_gt_zero':
                            if (value > 0) {
                                displayValue = value;
                                shouldAdd = true;
                            }
                            break;
                    }
                    if (shouldAdd) {
                        messages.push({ label: browser.i18n.getMessage(item.labelKey), value: displayValue });
                    }
                }
            }
            return messages;
        };

        let additional_text_elements = [];
        additional_text_elements.push({label: browser.i18n.getMessage("prompt_string"), value: '[' + prompt_id + '] ' + decodeURIComponent(prompt_name)});
        additional_text_elements.push(...getAdditionalMessages(integration, prefs_api));

        if (!mztaInPanel) messagesArea.appendUserMessage(getAPIsInitMessageString({
            api_string: api_strings[integration],
            model_string: prefs_api[`${integration_prefix}_model`],
            host_string: prefs_api[`${integration_prefix}_host`],
            version_string: prefs_api[`${integration_prefix}_version`],
            additional_messages: additional_text_elements
        }), "info");
        
        //console.log(`>>>>>>>>>>>>> command: ${llm}_ready_${call_id}`,)

        browser.runtime.sendMessage({
            command: `${llm}_ready_${call_id}`,
            window_id: (await browser.windows.getCurrent()).id
        });
    }
}

//let prefs_ph = await getSecureSettings({placeholders_use_default_value: false});

// Event listeners for worker messages
worker.onmessage = async function(event) {
    if (chatPageBlocked) return;
    const { type, payload } = event.data;
    switch (type) {
        case 'messageSent':
            messageInput.handleMessageSent();
            break;
        case 'newToken':
            chatHistory.token(payload.token);
            messagesArea.handleNewToken(payload.token);
            messageInput.showStreamingStatus();
            break;
        case 'newThinkingToken':
            chatHistory.token(payload.token, true);
            messagesArea.handleNewThinkingToken(payload.token);
            messageInput.showStreamingStatus();
            break;
        case 'tokensDone':
            activeToolRequest = null;
            messagesArea.cancelToolConfirmations();
            chatHistory.done(payload.history, payload.interrupted);
            clearChat.disabled = false;
            await messagesArea.handleTokensDone(promptData);
            if (chatPageBlocked) return;
            messageInput.enableInput();
            break;
        case 'toolCalls':
            await handleToolCalls(payload.calls, payload.requestId);
            break;
        case 'usage':
            messageInput.setContextUsage(payload.used, payload.size);
            break;
        case 'error':
            activeToolRequest = null;
            messagesArea.cancelToolConfirmations();
            chatHistory.error(payload, event.data.history);
            clearChat.disabled = false;
            messagesArea.appendBotMessage(payload,'error');
            messageInput.enableInput(false);
            messageInput.showErrorStatus();
            break;
        default:
            console.error('[ThunderAI] Unknown event type from API worker:', type);
    }
};

function workerFailed(event) {
    event.preventDefault?.();
    chatPageBlocked = true;
    activeToolRequest = null;
    messagesArea.cancelToolConfirmations();
    const message = browser.i18n.getMessage('chat_worker_failed');
    chatHistory.error(message);
    messagesArea.appendBotMessage(message, 'error');
    messageInput.enableInput(false);
    messageInput.historyLoading = true;
    messageInput.showErrorStatus();
    clearChat.disabled = false;
}
worker.addEventListener('error', workerFailed);
worker.addEventListener('messageerror', workerFailed);

// Tool calls from the model (ThunderAI Side Panel fork: Super Productivity).
// Reads run straight away with a short note; anything that changes data waits
// for the user's Confirm. Results go back to the worker, which continues.
async function handleToolCalls(calls, requestId) {
    activeToolRequest = requestId;
    const results = [];
    if (!Array.isArray(calls) || calls.length > 16) {
        worker.postMessage({ type: 'stop' });
        return;
    }
    const allowed = () => activeToolRequest === requestId && messageInput.hasToolConsent(destination);
    for (const call of calls) {
        if (activeToolRequest !== requestId) return;
        if (!allowed()) {
            results.push({ tool_call_id: call.id, content: JSON.stringify({ error: 'Task access was not granted for this conversation' }) });
            continue;
        }
        let card;
        try {
            const args = call.arguments ? JSON.parse(call.arguments) : {};
            validateToolArguments(call.name, args);
            if (SP_WRITE_TOOLS.has(call.name)) {
                const title = args.task_id ? await getSpTaskTitle(args.task_id) : null;
                if (!allowed()) throw new Error('Task access revoked');
                const confirmation = await messagesArea.appendConfirmCard(describeSpTool(call.name, args, title),
                    browser.i18n.getMessage('sp_confirm'), browser.i18n.getMessage('sp_decline'));
                card = confirmation.card;
                if (!allowed()) throw new Error('Task access revoked');
                if (!confirmation.ok) {
                    messagesArea.setToolOutcome(card, browser.i18n.getMessage('sp_declined'));
                    results.push({ tool_call_id: call.id, content: JSON.stringify({ declined: true }) });
                    continue;
                }
            } else {
                messagesArea.appendToolNote('🔎 ' + describeSpTool(call.name, args));
            }
            if (!allowed()) throw new Error('Task access revoked');
            const result = await runSpTool(call.name, args);
            if (activeToolRequest !== requestId) return;
            if (!allowed()) throw new Error('Task access revoked');
            if (card) messagesArea.setToolOutcome(card, browser.i18n.getMessage('sp_done_ok'));
            results.push({ tool_call_id: call.id, content: JSON.stringify(result) });
        } catch (error) {
            if (card) messagesArea.setToolOutcome(card, browser.i18n.getMessage('sp_tool_failed', [error.message]), true);
            results.push({ tool_call_id: call.id, content: JSON.stringify({ error: 'Task action failed. Check the task connection and input.' }) });
        }
    }
    if (activeToolRequest === requestId) {
        const safeResults = allowed() ? results : calls.map(call => ({ tool_call_id: call.id,
            content: JSON.stringify({ error: 'Task access was revoked. Results were not disclosed.' }) }));
        worker.postMessage({ type: 'toolResults', results: safeResults, requestId });
    }
}

async function restoreEmailChat(message) {
    const identity = message.prompt_info?.chat_history_key || call_id;
    if (boundContextIdentity !== null) {
        if (identity === boundContextIdentity) return;
        // A page owns one conversation. Background selection normally opens a
        // new page; refuse unexpected reuse while old provider work is active.
        chatPageBlocked = true;
        ++restoreEpoch;
        activeToolRequest = null;
        messageInput.revokeToolConsent();
        messagesArea.cancelToolConfirmations();
        worker.postMessage({ type: 'stop' });
        await chatHistory.save();
        chatHistory.invalidate();
        messageInput.historyLoading = true;
        messagesArea.appendBotMessage(browser.i18n.getMessage('chat_context_changed'), 'info');
        return;
    }
    boundContextIdentity = identity;
    const epoch = ++restoreEpoch;
    messageInput.historyLoading = true;
    try {
        promptData = message;
        const info = message.prompt_info || {};
        const subject = info.chat_subject || browser.i18n.getMessage('chat_email_no_subject');
        const count = Number(info.chat_count) || 1;
        if (mztaInPanel) {
            const title = document.getElementById('appHeaderName');
            title.textContent = subject;
            const modelName = document.getElementById('appHeaderModel')?.textContent;
            title.title = modelName ? `${subject} | ${modelName}` : subject;
        }
        const escape = (text) => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const notice = count > 1
            ? browser.i18n.getMessage('chat_email_notice_many', [escape(subject), String(count)])
            : browser.i18n.getMessage('chat_email_notice_one', [escape(subject)]);
        messagesArea.clearConversation();
        messagesArea.appendUserMessage(notice, "info");
        if (info.chat_history_key) {
            const key = await historyDestinationKey(info.chat_history_key, destination);
            if (epoch !== restoreEpoch || chatPageBlocked) return;
            clearChat.dataset.key = key;
            clearChat.hidden = false;
            const historyPrefs = await browser.storage.local.get({ chat_history_retention_days: 90 });
            if (epoch !== restoreEpoch || chatPageBlocked) return;
            if (Number(historyPrefs.chat_history_retention_days) === 0) {
                chatHistory.reset();
                clearChat.hidden = true;
            } else await chatHistory.load(key);
            if (epoch !== restoreEpoch || chatPageBlocked) return;
            chatHistory.setProvenance(destination);
            for (const turn of chatHistory.turns) {
                if (turn.role === 'user') messagesArea.appendUserMessage(turn.text);
                if (turn.role === 'error') messagesArea.appendBotMessage(turn.text, 'error');
                if (turn.role === 'assistant') {
                    if (turn.thinking) messagesArea.handleNewThinkingToken(turn.thinking);
                    if (turn.text) messagesArea.handleNewToken(turn.text);
                    await messagesArea.handleTokensDone(promptData);
                    if (epoch !== restoreEpoch || chatPageBlocked) return;
                    if (turn.incomplete) messagesArea.appendUserMessage(browser.i18n.getMessage('chat_history_interrupted'), 'info');
                }
            }
            worker.postMessage({ type: 'restoreHistory', history: chatHistory.history });
        }
        // Refresh context when replies arrive, but don't resend the same email
        // and attachments every time an existing conversation is reopened.
        if (chatHistory.context !== message.prompt) {
            messageInput.setPendingContext(message.prompt);
            messageInput.addEmailAttachments(info.chat_attachments);
        }
    } catch (error) {
        if (epoch !== restoreEpoch || chatPageBlocked) return;
        // Don't silently overwrite history that could not be read.
        chatHistory.key = null;
        console.error('[ThunderAI] Could not restore email chat');
        messagesArea.appendBotMessage(browser.i18n.getMessage('chat_history_load_error'), 'error');
        messageInput.setPendingContext(message.prompt);
    } finally {
        if (epoch === restoreEpoch && !chatPageBlocked) messageInput.historyLoading = false;
    }
}

// handling commands from the backgound page
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.call_id && message.call_id !== call_id) return;
    switch (message.command) {
        case 'email_chat_invalidated':
            if (chatHistory.key !== message.key) return;
            chatHistory.invalidate();
            chatPageBlocked = true;
            ++restoreEpoch;
            activeToolRequest = null;
            worker.postMessage({ type: 'stop' });
            messagesArea.clearConversation();
            messageInput.historyLoading = true;
            messagesArea.appendBotMessage(browser.i18n.getMessage('chat_history_deleted_elsewhere'), 'info');
            return;
        case "api_context":
            return restoreEmailChat(message);
        case "api_send":
            promptData = message;
            //send the received prompt to the llm api
            if(message.do_custom_text=="1") {
                messageInput._showCustomTextField(message.prompt_info?.custom_text_array);
            }else{
                sendPrompt(message);
            }
            break;
        case 'api_send_custom_text':
            let userInput = message.custom_text;    // From version 4.0.0 this is an array
                if(userInput !== null) {
                    if(!placeholdersUtils.hasPlaceholder(promptData.prompt, 'additional_text')){
                        // no additional_text placeholder, do as usual
                        const inputText = Array.isArray(userInput) ? userInput.map(obj => obj.custom_text).join(' ') : userInput;
                        promptData.prompt += " " + inputText;
                    }else{
                        // we have the additional_text placeholder, do the magic!
                        let finalSubs = {};
                        
                        if (Array.isArray(userInput)) {
                            userInput.forEach(obj => {
                                finalSubs[obj.placeholder.replace(/^{%|%}$/g, '').trim()] = obj.custom_text;
                            });
                        } else {
                            finalSubs["additional_text"] = userInput;
                        }
                        promptData.prompt = placeholdersUtils.replacePlaceholders({
                            text: promptData.prompt,
                            replacements: finalSubs,
                            use_default_value: ph_def_val==='1'
                        })
                    }
                    sendPrompt(promptData);
                }
            break;
        case "api_error":
            messagesArea.appendBotMessage(message.error,'error');
            messageInput.enableInput(false);
            messageInput.showErrorStatus();
            break;
    }
});

function sendPrompt(message){
    messageInput._setMessageInputValue(convertNewlinesToBr(message.prompt));
    messageInput._handleNewChatMessage();
}
