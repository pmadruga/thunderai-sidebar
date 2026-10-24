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

import { OpenAI } from '../api/openai_responses.js';
import { ChatSession } from './chat-session.js';
import { configureEndpointPolicy } from '../endpoint-policy.js';

let conversationHistory = [];
let previous_response_id = null;
let client = null;
let session = null;
let tools = null;
let strings = {};
let contextSize = null;

self.onmessage = async function(event) {
    const data = event.data;
    if (data.type === 'restoreHistory') {
        session?.stop();
        conversationHistory = Array.isArray(data.history) ? data.history : [];
        previous_response_id = null;
        if (session) { session.history = conversationHistory; session.resetResponseId(); }
        return;
    }
    if (data.type === 'stop') { session?.stop(); return; }
    try {
        if (data.type === 'init') {
            configureEndpointPolicy(data.allowed_http_origins || []);
            const config = { stream: true };
            for (const key in data) {
                if (!key.startsWith('chatgpt_') || key.startsWith('chatgpt_web_')) continue;
                let name = key.slice('chatgpt_'.length);
                if (name === 'api_key') name = 'apiKey';
                config[name] = data[key];
            }
            client = new OpenAI(config);
            strings = data.i18nStrings || {};
            previous_response_id = null;
            if (session) { session.client = client; session.strings = strings; session.resetResponseId(); }
        } else if (data.type === 'setTools') {
            tools = Array.isArray(data.tools) && data.tools.length ? data.tools : null;
            if (session) session.tools = tools;
        } else if (data.type === 'chatMessage' || data.type === 'toolResults') {
            if (!client) throw new Error('AI provider is not configured');
            if (!session) session = new ChatSession({
                provider: 'chatgpt', client, history: conversationHistory, strings,
                emit: message => postMessage(message),
                onResponseId: id => { previous_response_id = id; },
            });
            session.tools = tools;
            session.contextSize = contextSize;
            if (data.type === 'chatMessage') await session.send(data.message);
            else await session.toolResults(data.results, data.requestId);
        }
    } catch (error) {
        postMessage({ type: 'error', payload: 'AI request failed: ' + (error?.message || 'Unknown error'), history: conversationHistory });
    }
};
