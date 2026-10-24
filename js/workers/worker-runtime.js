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

// Shared worker message lifecycle. Provider entry points only select a client.
import { ChatSession } from './chat-session.js';
import { configureEndpointPolicy } from '../endpoint-policy.js';
import { providerConfig } from '../api/provider-config.js';

export function createWorkerHandler({ provider, Client, describeError, emit = message => postMessage(message) }) {
    let conversationHistory = [];
    let client = null;
    let session = null;
    let tools = null;
    let strings = {};
    let contextSize = null;

    return async function(event) {
        const data = event.data;
        if (data.type === 'restoreHistory') {
            session?.stop();
            conversationHistory = Array.isArray(data.history) ? data.history : [];
            if (session) { session.history = conversationHistory; session.resetResponseId(); }
            return;
        }
        if (data.type === 'stop') { session?.stop(); return; }
        try {
            if (data.type === 'init') {
                configureEndpointPolicy(data.allowed_http_origins || []);
                client = new Client({ stream: true, ...providerConfig(provider, data) });
                strings = data.i18nStrings || {};
                if (session) { session.client = client; session.strings = strings; session.resetResponseId(); }
                if (typeof client.fetchContextSize === 'function') {
                    const activeClient = client;
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 5000);
                    activeClient.fetchContextSize({ signal: controller.signal }).then(size => {
                        if (client !== activeClient) return;
                        contextSize = size;
                        if (session) session.contextSize = size;
                        emit({ type: 'usage', payload: { used: 0, size } });
                    }).catch(() => {}).finally(() => clearTimeout(timer));
                }
            } else if (data.type === 'setTools') {
                tools = Array.isArray(data.tools) && data.tools.length ? data.tools : null;
                if (session) session.tools = tools;
            } else if (data.type === 'chatMessage' || data.type === 'toolResults') {
                if (!client) throw new Error('AI provider is not configured');
                if (!session) session = new ChatSession({
                    provider, client, history: conversationHistory, strings,
                    emit,
                    describeError,
                });
                session.tools = tools;
                session.contextSize = contextSize;
                if (data.type === 'chatMessage') await session.send(data.message);
                else await session.toolResults(data.results, data.requestId);
            }
        } catch (error) {
            emit({ type: 'error', payload: 'AI request failed: ' + (error?.message || 'Unknown error'), history: conversationHistory });
        }
    };
}
