/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Super Productivity tools (ThunderAI Side Panel fork).
// Talks to the Super Productivity desktop app's Local REST API
// (https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/3.01-API.md)
// and exposes it to the model as OpenAI-style function tools. Reads run
// directly; anything that changes data is marked `write` and must be
// confirmed by the user before it runs. There is deliberately no delete tool.

import { getLocalSecret, setLocalSecret } from '../js/secure-settings.js';
import { secureFetch, confirmEndpointAccess } from '../js/endpoint-policy.js';

export const SP_DEFAULT_URL = 'http://127.0.0.1:3876';

// Settings live in storage.local: the token is a credential and must not sync.
export async function getSpSettings() {
    const s = await browser.storage.local.get({ sp_api_url: SP_DEFAULT_URL, sp_enabled: false });
    s.sp_api_token = await getLocalSecret('sp_api_token');
    return { url: s.sp_api_url.replace(/\/+$/, ''), token: s.sp_api_token, enabled: s.sp_enabled };
}

/** Host permission pattern for the API (any port on that host). */
export function spOriginPattern(url) {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}/*`;
    } catch (e) {
        return 'http://127.0.0.1/*';
    }
}

export async function saveSpSettings(changes) {
    const ordinary = { ...changes };
    if (Object.hasOwn(ordinary, 'sp_api_token')) {
        await setLocalSecret('sp_api_token', String(ordinary.sp_api_token || ''));
        delete ordinary.sp_api_token;
    }
    if (ordinary.sp_api_url && !(await confirmEndpointAccess(ordinary.sp_api_url))) {
        throw new SpError('HTTP origin was not acknowledged', 'INSECURE_ENDPOINT');
    }
    await browser.storage.local.set(ordinary);
}

export class SpError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

async function spFetch(path, { method = 'GET', body } = {}) {
    const { url, token } = await getSpSettings();
    if (!token) {
        throw new SpError('No Super Productivity access token set', 'NO_TOKEN');
    }
    let response;
    try {
        response = await secureFetch(url + path, {
            method,
            headers: {
                'Authorization': 'Bearer ' + token,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (e) {
        throw new SpError('Super Productivity is not reachable (is the app running with the API enabled?)', 'UNREACHABLE');
    }
    let json = null;
    try {
        json = await response.json();
    } catch (e) {
        // fall through to the status check
    }
    if (!response.ok || !json?.ok) {
        throw new SpError(json?.error?.message || `HTTP ${response.status}`, json?.error?.code || 'HTTP_' + response.status);
    }
    return json.data;
}

/** Checks the URL and token; resolves on success, throws SpError otherwise. */
export async function verifySpConnection() {
    await spFetch('/status');
}

// Keep task lists small: the fields that matter for a conversation.
function slimTask(t) {
    return {
        id: t.id,
        title: t.title,
        isDone: !!t.isDone,
        projectId: t.projectId || null,
        tagIds: t.tagIds || [],
        dueDay: t.dueDay || null,
        dueWithTime: t.dueWithTime ? new Date(t.dueWithTime).toISOString() : null,
        timeEstimateMinutes: t.timeEstimate ? Math.round(t.timeEstimate / 60000) : 0,
        timeSpentMinutes: t.timeSpent ? Math.round(t.timeSpent / 60000) : 0,
        ...(t.parentId ? { parentId: t.parentId } : {}),
        ...(t.notes ? { notes: String(t.notes).slice(0, 300) } : {}),
    };
}

const MAX_TASKS = 60;

function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** OpenAI function-tool definitions, with today's date for due dates. */
export function spToolDefinitions() {
    const today = todayIso();
    const fn = (name, description, properties = {}, required = []) => ({
        type: 'function',
        function: { name, description, parameters: { type: 'object', properties, required } },
    });
    return [
        fn('sp_list_tasks', 'List or search the user\'s Super Productivity tasks. Returns active (not done) tasks unless include_done is true.', {
            query: { type: 'string', description: 'Case-insensitive text to match in task titles' },
            project_id: { type: 'string', description: 'Only tasks of this project (ids come from sp_list_projects)' },
            today_only: { type: 'boolean', description: 'Only tasks planned for today' },
            include_done: { type: 'boolean', description: 'Also return completed tasks' },
        }),
        fn('sp_list_projects', 'List Super Productivity projects (id and title).', {
            query: { type: 'string', description: 'Filter by title' },
        }),
        fn('sp_list_tags', 'List Super Productivity tags (id and title).', {
            query: { type: 'string', description: 'Filter by title' },
        }),
        fn('sp_get_current_task', 'Get the task the user is currently tracking time on, if any.'),
        fn('sp_create_task', `Create a new task. Today is ${today}. The app shows the user a confirm button, so call this directly instead of asking first.`, {
            title: { type: 'string', description: 'Task title' },
            notes: { type: 'string', description: 'Optional notes (Markdown)' },
            project_id: { type: 'string', description: 'Optional project id from sp_list_projects' },
            tag_ids: { type: 'array', items: { type: 'string' }, description: 'Optional tag ids from sp_list_tags' },
            due_day: { type: 'string', description: 'Optional due date, YYYY-MM-DD' },
            time_estimate_minutes: { type: 'number', description: 'Optional time estimate in minutes' },
        }, ['title']),
        fn('sp_update_task', `Change an existing task (only the given fields). Today is ${today}. The app shows the user a confirm button, so call this directly instead of asking first.`, {
            task_id: { type: 'string', description: 'Task id from sp_list_tasks' },
            title: { type: 'string' },
            notes: { type: 'string' },
            is_done: { type: 'boolean', description: 'Mark done (true) or not done (false)' },
            due_day: { type: 'string', description: 'Due date, YYYY-MM-DD' },
            time_estimate_minutes: { type: 'number' },
            project_id: { type: 'string', description: 'Move to this project' },
        }, ['task_id']),
        fn('sp_start_task', 'Start tracking time on a task (makes it the current task). The app shows the user a confirm button, so call this directly instead of asking first.', {
            task_id: { type: 'string', description: 'Task id from sp_list_tasks' },
        }, ['task_id']),
        fn('sp_stop_tracking', 'Stop tracking time on the current task. The app shows the user a confirm button, so call this directly instead of asking first.'),
    ];
}

export const SP_WRITE_TOOLS = new Set(['sp_create_task', 'sp_update_task', 'sp_start_task', 'sp_stop_tracking']);

function taskBody(args) {
    const body = {};
    if (args.title !== undefined) body.title = String(args.title);
    if (args.notes !== undefined) body.notes = String(args.notes);
    if (args.is_done !== undefined) body.isDone = !!args.is_done;
    if (args.project_id) body.projectId = String(args.project_id);
    if (Array.isArray(args.tag_ids)) body.tagIds = args.tag_ids.map(String);
    if (args.due_day) body.dueDay = String(args.due_day);
    if (args.time_estimate_minutes !== undefined && Number(args.time_estimate_minutes) >= 0) {
        body.timeEstimate = Math.round(Number(args.time_estimate_minutes) * 60000);
    }
    return body;
}

/** Runs one tool call; returns a JSON-serialisable result. */
export async function runSpTool(name, args = {}) {
    validateToolArguments(name, args);
    switch (name) {
        case 'sp_list_tasks': {
            const params = new URLSearchParams();
            if (args.query) params.set('query', String(args.query));
            if (args.project_id) params.set('projectId', String(args.project_id));
            if (args.today_only) params.set('tagId', 'TODAY');
            if (args.include_done) params.set('includeDone', 'true');
            const tasks = await spFetch('/tasks' + (params.size ? '?' + params : ''));
            const list = (Array.isArray(tasks) ? tasks : []).map(slimTask);
            return { count: list.length, tasks: list.slice(0, MAX_TASKS), truncated: list.length > MAX_TASKS };
        }
        case 'sp_list_projects': {
            const q = args.query ? '?query=' + encodeURIComponent(args.query) : '';
            return (await spFetch('/projects' + q) || []).map(p => ({ id: p.id, title: p.title }));
        }
        case 'sp_list_tags': {
            const q = args.query ? '?query=' + encodeURIComponent(args.query) : '';
            return (await spFetch('/tags' + q) || []).map(t => ({ id: t.id, title: t.title }));
        }
        case 'sp_get_current_task': {
            const current = await spFetch('/task-control/current');
            return current ? slimTask(current.task ?? current) : { current: null };
        }
        case 'sp_create_task':
            if (!args.title) throw new SpError('title is required', 'INVALID_INPUT');
            return slimTask(await spFetch('/tasks', { method: 'POST', body: taskBody(args) }));
        case 'sp_update_task':
            if (!args.task_id) throw new SpError('task_id is required', 'INVALID_INPUT');
            return slimTask(await spFetch('/tasks/' + encodeURIComponent(args.task_id), { method: 'PATCH', body: taskBody(args) }));
        case 'sp_start_task':
            if (!args.task_id) throw new SpError('task_id is required', 'INVALID_INPUT');
            await spFetch('/tasks/' + encodeURIComponent(args.task_id) + '/start', { method: 'POST' });
            return { started: args.task_id };
        case 'sp_stop_tracking':
            await spFetch('/task-control/stop', { method: 'POST' });
            return { stopped: true };
        default:
            throw new SpError('Unknown tool ' + name, 'UNKNOWN_TOOL');
    }
}

/** Title of a task, for confirmation cards (falls back to the id). */
export async function getSpTaskTitle(taskId) {
    try {
        const task = await spFetch('/tasks/' + encodeURIComponent(taskId));
        return task?.title || String(taskId);
    } catch (e) {
        return String(taskId);
    }
}

/** One-line, human description of a tool call, for the chat. */
export function describeSpTool(name, args = {}, taskTitle = null) {
    const target = `“${taskTitle ?? args.task_id}”`;
    const fields = [];
    if (Object.hasOwn(args, 'title')) fields.push(`Title: ${String(args.title)}`);
    if (Object.hasOwn(args, 'due_day')) fields.push(browser.i18n.getMessage('sp_due', [String(args.due_day)]));
    if (Object.hasOwn(args, 'time_estimate_minutes')) fields.push(browser.i18n.getMessage('sp_estimate', [String(args.time_estimate_minutes)]));
    if (args.is_done === true) fields.push(browser.i18n.getMessage('sp_mark_done'));
    if (args.is_done === false) fields.push(browser.i18n.getMessage('sp_mark_not_done'));
    if (Object.hasOwn(args, 'notes')) fields.push('Notes: ' + String(args.notes));
    if (Object.hasOwn(args, 'project_id')) fields.push('Project: ' + String(args.project_id));
    if (Object.hasOwn(args, 'tag_ids')) fields.push('Tags: ' + JSON.stringify(args.tag_ids));
    const detail = fields.join(', ');
    switch (name) {
        case 'sp_list_tasks': return browser.i18n.getMessage('sp_desc_list_tasks', [args.query ? `“${args.query}”` : '']);
        case 'sp_list_projects': return browser.i18n.getMessage('sp_desc_list_projects');
        case 'sp_list_tags': return browser.i18n.getMessage('sp_desc_list_tags');
        case 'sp_get_current_task': return browser.i18n.getMessage('sp_desc_current');
        case 'sp_create_task': return browser.i18n.getMessage('sp_desc_create', [detail]);
        case 'sp_update_task': return browser.i18n.getMessage('sp_desc_update', [target, detail]);
        case 'sp_start_task': return browser.i18n.getMessage('sp_desc_start', [target]);
        case 'sp_stop_tracking': return browser.i18n.getMessage('sp_desc_stop');
        default: return name;
    }
}

// Call once when tools are enabled for a chat, including after restoring a
// remembered preference. Consent is in-memory and bound to this destination.
export function requestToolReadConsent(provider, endpoint) {
    const destination = endpoint || provider || 'the selected AI provider';
    const message = browser.i18n.getMessage('sp_read_disclosure', [destination]) ||
        `Allow this chat to read your Super Productivity tasks, notes, projects and tags, and send the results to ${destination}? Email content may influence which data the model requests. Changes still require confirmation.`;
    return window.confirm(message);
}

export function validateToolArguments(name, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new SpError('Tool arguments must be an object', 'INVALID_INPUT');
    const allowed = {
        sp_list_tasks: ['query', 'project_id', 'today_only', 'include_done'],
        sp_list_projects: ['query'], sp_list_tags: ['query'], sp_get_current_task: [],
        sp_create_task: ['title', 'notes', 'project_id', 'tag_ids', 'due_day', 'time_estimate_minutes'],
        sp_update_task: ['task_id', 'title', 'notes', 'is_done', 'due_day', 'time_estimate_minutes', 'project_id'],
        sp_start_task: ['task_id'], sp_stop_tracking: [],
    }[name];
    if (!allowed) throw new SpError('Unknown tool', 'UNKNOWN_TOOL');
    for (const [field, value] of Object.entries(args)) {
        if (!allowed.includes(field)) throw new SpError('Unexpected tool field: ' + field, 'INVALID_INPUT');
        if (['is_done', 'today_only', 'include_done'].includes(field)) {
            if (typeof value !== 'boolean') throw new SpError('Expected a boolean: ' + field, 'INVALID_INPUT');
        } else if (field === 'time_estimate_minutes') {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new SpError('Invalid time estimate', 'INVALID_INPUT');
        } else if (field === 'tag_ids') {
            if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new SpError('Invalid tag list', 'INVALID_INPUT');
        } else if (typeof value !== 'string') throw new SpError('Expected text: ' + field, 'INVALID_INPUT');
    }
    if (['sp_update_task', 'sp_start_task'].includes(name) && !args.task_id) throw new SpError('task_id is required', 'INVALID_INPUT');
    if (name === 'sp_create_task' && !args.title?.trim()) throw new SpError('title is required', 'INVALID_INPUT');
    return args;
}
