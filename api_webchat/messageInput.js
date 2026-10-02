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

import { buildSendIcon, buildStopIcon, buildCheckIcon, buildAlertIcon } from './svgIcons.js';
import { SHARED_BASE_CSS } from './sharedStyles.js';
import { extractDocumentText, UnsupportedDocumentError } from './attachments.js';
import { getSpSettings, saveSpSettings, verifySpConnection, spToolDefinitions, spOriginPattern } from './superproductivity.js';

// Tools need the OpenAI-compatible connection (the only worker with tool calls).
const mztaToolsSupported = new URLSearchParams(window.location.search).get('llm') === 'openai_comp_api';

// Set when the chat runs in the ThunderAI side panel (see experiments/chatPanel)
const mztaInPanel = new URLSearchParams(window.location.search).get('panel') === '1';

const messageInputTemplate = document.createElement('template');

const messagesInputStyle  = document.createElement('style');
messagesInputStyle.textContent = SHARED_BASE_CSS + `
    :host {
        display: flex;
        justify-content: space-between;
        /* flex-end, not center: the textarea grows upwards, so the send/stop
           buttons must stay pinned to the bottom line rather than drifting to
           the middle of a three-line field. */
        align-items: flex-end;
        gap: 10px;
        padding: 12px 16px 16px;
        border-top: 1px solid var(--border);
        flex-wrap: wrap;
    }
    :host(.drag-over) {
        background: var(--accent-soft);
    }

    /* Document attachments (ThunderAI Side Panel fork) */
    #attachButton {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 42px;
        flex-shrink: 0;
        padding: 0;
        border: none;
        border-radius: var(--r-md);
        background: transparent;
        color: var(--ink-2);
        cursor: pointer;
    }
    #attachButton:hover:not(:disabled) {
        background: var(--hover);
        color: var(--ink);
    }
    #attachButton:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
    }
    #attachButton svg {
        width: 18px;
        height: 18px;
    }
    #spToggle {
        display: none;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 42px;
        flex-shrink: 0;
        padding: 0;
        border: none;
        border-radius: var(--r-md);
        background: transparent;
        color: var(--ink-2);
        cursor: pointer;
    }
    #spToggle.available {
        display: flex;
    }
    #spToggle:hover {
        background: var(--hover);
        color: var(--ink);
    }
    #spToggle[aria-pressed="true"] {
        background: var(--accent-soft);
        color: var(--accent);
    }
    #spToggle:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
    }
    #spToggle svg {
        width: 18px;
        height: 18px;
    }
    #spSetup {
        display: none;
        flex-basis: 100%;
        order: -1;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: .8125rem;
        color: var(--ink-2);
    }
    #spSetup.open {
        display: flex;
    }
    #spSetup p {
        flex-basis: 100%;
        margin: 0;
    }
    #spSetup p.error {
        color: var(--err-ink);
    }
    #spSetup input {
        flex: 1 1 12rem;
        min-width: 0;
        padding: 6px 10px;
        border: 1px solid var(--border-strong);
        border-radius: var(--r-sm);
        background: var(--surface);
        color: var(--ink);
        font: inherit;
    }
    #spSetup button {
        padding: 6px 12px;
        border-radius: var(--r-sm);
        font: inherit;
        cursor: pointer;
        border: 1px solid var(--border);
        background: transparent;
        color: var(--ink-2);
    }
    #spSetup button.primary {
        border-color: transparent;
        background: var(--accent);
        color: #fff;
    }
    #attachmentChips {
        display: none;
        flex-basis: 100%;
        order: -1;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: -2px;
    }
    #attachmentChips.has-items {
        display: flex;
    }
    .attachment-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 3px 4px 3px 10px;
        border: 1px solid var(--border);
        border-radius: var(--r-pill);
        background: var(--surface);
        color: var(--ink-2);
        font-size: .75rem;
    }
    .attachment-chip.error {
        border-color: var(--err-border);
        color: var(--err-ink);
    }
    .attachment-chip .chip-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .attachment-chip button {
        width: 20px;
        height: 20px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: 1;
        cursor: pointer;
    }
    .attachment-chip button:hover {
        background: var(--hover);
        color: var(--ink);
    }
    /* Heights are derived from line-height + vertical padding + borders:
       one line = 1.125rem + 2*11px + 2*1px = 42px, matching #sendButton.
       Three lines is the maximum, hence max-height = 42px + 2*1.125rem = 78px;
       beyond that the field scrolls. Recompute both if any of those change. */
    #messageInputField {
        flex-grow: 1;
        box-sizing: border-box;
        padding: 11px 14px;
        font: inherit;
        font-size: .875rem;
        line-height: 1.125rem;
        min-height: 42px;
        max-height: 78px;
        overflow-y: auto;
        resize: none;
        white-space: pre-wrap;
        border: 1px solid var(--border);
        border-radius: var(--r-lg);
        background: var(--surface);
        color: var(--ink);
        outline: none;
        transition: border-color .12s ease, box-shadow .12s ease;
    }
    #messageInputField::placeholder {
        color: var(--ink-3);
    }
    #messageInputField:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
    }
    #sendButton, #stopButton {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        flex-shrink: 0;
        cursor: pointer;
        border: none;
        border-radius: var(--r-lg);
        background: var(--accent);
        color: #fff;
        transition: background .12s ease;
    }
    #sendButton:hover:not(:disabled), #stopButton:hover:not(:disabled) {
        background: var(--accent-dark);
    }
    #sendButton:disabled, #stopButton:disabled {
        opacity: .45;
        cursor: default;
    }

    /* Floating status pill: straddles the input field's top border instead of
       taking a row of its own. Anchored to the host, which is position:relative,
       so the containing block is the host's padding box. Anchored from the
       bottom rather than the top because the textarea grows upwards: its top
       border stays at padding-bottom + one-line height above the host's bottom
       edge only while the field is one line tall, so we pin the pill to that
       baseline and let the translateY centre it on the border line whatever the
       pill's height. Keep in sync with :host padding-bottom and the field's
       min-height. */
    #statusLogger{
        position: absolute;
        bottom: calc(16px + 42px - 1px);
        transform: translateY(50%);
        right: 80px;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: .75rem;
        font-weight: 600;
        padding: 5px 11px;
        border-radius: var(--r-pill);
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--ink-2);
        box-shadow: 0 6px 16px -8px var(--shadow);
        white-space: nowrap;
    }
    /* Fixed-size centring box for the pill's leading icon. The states use
       several icon sizes (alert 13, check 15, waiting/loading 16), so the wrapper
       is sized to the largest and centres whatever it holds — that way swapping
       states never shifts the pill's height or the text beside it. */
    #statusLoggerIcon{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 16px;
        height: 16px;
    }
    /* Each icon keeps its own intrinsic width/height attributes; block display
       drops the inline-baseline descender gap, and flex:none stops the flex
       layout from stretching a small icon (the 7px dot) to the wrapper's size. */
    #statusLoggerIcon svg{
        display: block;
        flex: none;
    }
    /* Waiting keeps the neutral grey look, but states its border explicitly so
       it reads as a framed pill rather than floating text. The in-flight motion
       comes from mzta-waiting-server.svg's own SMIL animation (expanding rings),
       so no CSS animation is needed here. */
    #statusLogger.status-waiting{
        border-color: color-mix(in srgb, var(--ink-3) 55%, var(--border));
        background: var(--surface-2);
        color: var(--ink-2);
    }
    #statusLogger.status-working{
        border-color: var(--info-border);
        background: var(--info-bg);
        color: var(--info-ink);
    }
    /* The two self-animating SVGs loaded as images: mzta-waiting-server.svg
       (waiting) and mzta-loading.svg (streaming). Block display keeps them off
       the text baseline so the flex wrapper can centre them. */
    #statusLoggerIcon img{
        display: block;
        flex: none;
        width: 16px;
        height: 16px;
    }
    #statusLogger.status-done{
        border-color: color-mix(in srgb, var(--ok-ink) 40%, var(--bg));
        background: var(--ok-bg);
        color: var(--ok-ink);
    }
    #statusLogger.status-error{
        border-color: var(--err-border);
        background: var(--err-bg);
        color: var(--err-ink);
    }
    @keyframes statusFadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
    #statusLogger.status-fadeout{
        animation: statusFadeOut 0.5s ease-out forwards;
    }
    #mzta-custom_text{
        padding:10px;
        width:50%;
        min-width:300px;
        max-width:80%;
        height:auto;
        max-height:80%;
        border-radius:5px;
        overflow-y:auto;
        overflow-x:hidden;
        position:fixed;
        top:50%;
        left:50%;
        display:none;
        transform:translate(-50%,-50%);
        text-align:center;
        background:var(--surface);
        color:var(--ink);
        border:1px solid var(--border);
        box-shadow: 0 18px 44px -20px var(--shadow);
        box-sizing: border-box;
        z-index: 10;
    }
    #mzta-custom_loading{
        height:50px;display:none;
    }
    #mzta-custom_textarea{
        color:var(--ink);
        background:var(--surface-2);
        border:1px solid var(--border);
        border-radius:var(--r-sm);
        padding:5px;
        font:inherit;
        font-size:0.9375rem;
        width:100%;
        box-sizing: border-box;
        resize: vertical;
    }
    #mzta-custom_textarea:focus{
        outline:none;
        border-color:var(--accent);
        box-shadow:0 0 0 3px var(--accent-soft);
    }
    #mzta-custom_info{
        text-align:center;
        width:100%;
        padding-bottom:10px;
        font-size:0.9375rem;
    }
    #mzta-custom_info span{
        font-size:0.8em;
    }
    #mzta-custom_step{
        position: absolute;
        bottom: 5px;
        right: 10px;
        font-size: 0.75rem;
        color: var(--ink-3);
    }
    #mzta-custom_btn{
        margin-top:7px;
        padding: 8px 14px;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: var(--r-md);
        font: inherit;
        font-size: .8125rem;
        font-weight: 650;
        cursor: pointer;
        transition: background .12s ease;
    }
    #mzta-custom_btn:hover:not(:disabled){
        background: var(--accent-dark);
    }
    #mzta-custom_btn:disabled, #mzta-custom_btn.disabled{
        opacity: .45;
        cursor: default;
    }
`;
messageInputTemplate.content.appendChild(messagesInputStyle);

// A textarea, not an input: the field grows from one to three lines as the text
// wraps (see the #messageInputField rule and _autoResize below), then scrolls.
const attachButton = document.createElement('button');
attachButton.id = 'attachButton';
attachButton.type = 'button';
attachButton.title = browser.i18n.getMessage('attach_button_title');
attachButton.setAttribute('aria-label', browser.i18n.getMessage('attach_button_title'));
const attachSvg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>', 'image/svg+xml').documentElement;
attachButton.appendChild(document.importNode(attachSvg, true));
messageInputTemplate.content.appendChild(attachButton);

const attachInput = document.createElement('input');
attachInput.id = 'attachInput';
attachInput.type = 'file';
attachInput.multiple = true;
attachInput.hidden = true;
attachInput.accept = '.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.yaml,.yml,.log,.eml,.ics,.rtf,text/*';
messageInputTemplate.content.appendChild(attachInput);

const spToggle = document.createElement('button');
spToggle.id = 'spToggle';
spToggle.type = 'button';
spToggle.setAttribute('aria-pressed', 'false');
const spSvg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>', 'image/svg+xml').documentElement;
spToggle.appendChild(document.importNode(spSvg, true));
messageInputTemplate.content.appendChild(spToggle);

const spSetup = document.createElement('div');
spSetup.id = 'spSetup';
messageInputTemplate.content.appendChild(spSetup);

const attachmentChips = document.createElement('div');
attachmentChips.id = 'attachmentChips';
attachmentChips.setAttribute('role', 'list');
messageInputTemplate.content.appendChild(attachmentChips);

const inputField = document.createElement('textarea');
inputField.id = 'messageInputField';
inputField.rows = 1;
inputField.placeholder = '';
inputField.autocomplete = 'off';
messageInputTemplate.content.appendChild(inputField);

const sendButton = document.createElement('button');
sendButton.id = 'sendButton';
sendButton.appendChild(buildSendIcon());
messageInputTemplate.content.appendChild(sendButton);

const stopButton = document.createElement('button');
stopButton.id = 'stopButton';
stopButton.style.display = 'none';
stopButton.appendChild(buildStopIcon());
messageInputTemplate.content.appendChild(stopButton);

const statusLogger = document.createElement('div');
statusLogger.id = 'statusLogger';
statusLogger.style.display = 'none';
statusLogger.setAttribute('role', 'status');
statusLogger.setAttribute('aria-live', 'polite');
// The icon is rebuilt per state (waiting / streaming / check / alert) rather
// than being a single static node: the inline SVGs (check, alert) inherit
// currentColor from the pill, while the animated states load their own asset.
const statusLoggerIcon = document.createElement('span');
statusLoggerIcon.id = 'statusLoggerIcon';
statusLogger.appendChild(statusLoggerIcon);
const statusLoggerText = document.createElement('span');
statusLoggerText.id = 'statusLoggerText';
statusLogger.appendChild(statusLoggerText);
messageInputTemplate.content.appendChild(statusLogger);

//div per custom text
const customDiv = document.createElement('div');
customDiv.id = 'mzta-custom_text';
const customInfo = document.createElement('div');
customInfo.id = 'mzta-custom_info';
customInfo.textContent = browser.i18n.getMessage("chatgpt_win_custom_text");
customDiv.appendChild(customInfo);
const customTextArea = document.createElement('textarea');
customTextArea.id = 'mzta-custom_textarea';
customTextArea.rows = 5;
customDiv.appendChild(customTextArea);
const customLoading = document.createElement('img');
customLoading.src = browser.runtime.getURL("/images/loading.gif");
customLoading.id = "mzta-custom_loading";
customDiv.appendChild(customLoading);
const customBtn = document.createElement('button');
customBtn.id = 'mzta-custom_btn';
customBtn.textContent = browser.i18n.getMessage("chatgpt_win_send");
customBtn.classList.add('mzta-btn');
customDiv.appendChild(customBtn);
const customStep = document.createElement('div');
customStep.id = 'mzta-custom_step';
customDiv.appendChild(customStep);
messageInputTemplate.content.appendChild(customDiv);

class MessageInput extends HTMLElement {

    model = '';
    _doneTimeout = null;
    _customTextArray = [];
    _currentCustomTextIndex = 0;

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(messageInputTemplate.content.cloneNode(true));

        this._messageInputField = shadowRoot.querySelector('#messageInputField');
        this._sendButton = shadowRoot.querySelector('#sendButton');
        this._stopButton = shadowRoot.querySelector('#stopButton');
        this._statusLogger = shadowRoot.querySelector('#statusLogger');
        this._statusLoggerIcon = shadowRoot.querySelector('#statusLoggerIcon');
        this._statusLoggerText = shadowRoot.querySelector('#statusLoggerText');

        // Super Productivity toggle
        this._spToggle = shadowRoot.querySelector('#spToggle');
        this._spSetup = shadowRoot.querySelector('#spSetup');
        this._spToggle.addEventListener('click', () => this._toggleSuperProductivity());

        // Document attachments
        this._attachments = [];
        this._attachButton = shadowRoot.querySelector('#attachButton');
        this._attachInput = shadowRoot.querySelector('#attachInput');
        this._attachmentChips = shadowRoot.querySelector('#attachmentChips');
        this._attachButton.addEventListener('click', () => this._attachInput.click());
        this._attachInput.addEventListener('change', () => {
            this._addAttachments([...this._attachInput.files]);
            this._attachInput.value = '';
        });
        this.addEventListener('dragover', (e) => {
            if (e.dataTransfer?.types?.includes('Files')) {
                e.preventDefault();
                this.classList.add('drag-over');
            }
        });
        this.addEventListener('dragleave', () => this.classList.remove('drag-over'));
        this.addEventListener('drop', (e) => {
            this.classList.remove('drag-over');
            if (e.dataTransfer?.files?.length) {
                e.preventDefault();
                this._addAttachments([...e.dataTransfer.files]);
            }
        });

        this._messageInputField.addEventListener('keydown', this._handleKeyDown.bind(this));
        this._messageInputField.addEventListener('input', this._autoResize.bind(this));
        this._sendButton.addEventListener('click', this._handleClick.bind(this));
        this._stopButton.addEventListener('click', this._handleStopClick.bind(this));

        this._customText = shadowRoot.querySelector('#mzta-custom_text');
        this._customTextArea = shadowRoot.querySelector('#mzta-custom_textarea');
        this._customLoading = shadowRoot.querySelector('#mzta-custom_loading');
        this._customBtn = shadowRoot.querySelector('#mzta-custom_btn');
        this._customStep = shadowRoot.querySelector('#mzta-custom_step');
        this._customBtn.addEventListener("click", () => { this._customTextBtnClick({customBtn:this._customBtn,customLoading:this._customLoading,customDiv:this._customText}) });
        this._customTextArea.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                this._customTextBtnClick({customBtn:this._customBtn,customLoading:this._customLoading,customDiv:this._customText});
            }
        });
    }

    connectedCallback() {
        // Set focus to the input field when the element is added to the DOM
        this._messageInputField.focus();
    }

    async init(worker) {
        this.worker = worker;
        this._initSuperProductivity();
    }

    // ── Super Productivity (ThunderAI Side Panel fork) ──────────────────────

    async _initSuperProductivity() {
        if (!mztaToolsSupported) return;
        this._spToggle.classList.add('available');
        this._setSpState(false);
        const settings = await getSpSettings();
        // Cached so a click can ask for the permission before any await (the
        // permission prompt is only allowed directly inside a user action).
        this._spOrigin = spOriginPattern(settings.url);
        // Remembered as on: enable quietly if permission and token still work.
        if (settings.enabled && settings.token) {
            const allowed = await browser.permissions.contains({ origins: [this._spOrigin] });
            if (allowed) {
                try {
                    await verifySpConnection();
                    this._setSpState(true);
                } catch (e) {
                    // Leave it off; the user can switch it on to see the error.
                }
            }
        }
    }

    _setSpState(on) {
        this._spOn = on;
        this._spToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
        const title = browser.i18n.getMessage(on ? 'sp_toggle_on' : 'sp_toggle_off');
        this._spToggle.title = title;
        this._spToggle.setAttribute('aria-label', title);
        this.worker?.postMessage({ type: 'setTools', tools: on ? spToolDefinitions() : null });
    }

    _requestSpPermission() {
        // Must be called synchronously from the click handler, before any await.
        return browser.permissions.request({ origins: [this._spOrigin || 'http://127.0.0.1/*'] }).catch(() => false);
    }

    async _toggleSuperProductivity() {
        if (this._spOn) {
            this._setSpState(false);
            await saveSpSettings({ sp_enabled: false });
            this._closeSpSetup();
            return;
        }
        const permission = this._requestSpPermission();
        const settings = await getSpSettings();
        if (!settings.token) {
            this._openSpSetup();
            return;
        }
        await this._enableSuperProductivity(permission);
    }

    async _enableSuperProductivity(permission) {
        try {
            if (!(await permission)) {
                throw new Error(browser.i18n.getMessage('sp_error_permission'));
            }
            await verifySpConnection();
        } catch (e) {
            const message = e.code === 'UNAUTHORIZED'
                ? browser.i18n.getMessage('sp_error_token')
                : e.code === 'UNREACHABLE' ? browser.i18n.getMessage('sp_error_unreachable') : e.message;
            this._openSpSetup(message);
            return false;
        }
        this._closeSpSetup();
        await saveSpSettings({ sp_enabled: true });
        this._setSpState(true);
        return true;
    }

    _openSpSetup(errorMessage = '') {
        const box = this._spSetup;
        box.replaceChildren();
        const text = document.createElement('p');
        text.textContent = browser.i18n.getMessage('sp_setup_text');
        box.appendChild(text);
        if (errorMessage) {
            const error = document.createElement('p');
            error.className = 'error';
            error.setAttribute('role', 'alert');
            error.textContent = errorMessage;
            box.appendChild(error);
        }
        const input = document.createElement('input');
        input.type = 'password';
        input.autocomplete = 'off';
        input.placeholder = browser.i18n.getMessage('sp_token_placeholder');
        input.setAttribute('aria-label', input.placeholder);
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'primary';
        save.textContent = browser.i18n.getMessage('sp_save');
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = browser.i18n.getMessage('sp_cancel');
        const submit = async () => {
            const token = input.value.trim();
            if (!token) return;
            const permission = this._requestSpPermission();
            await saveSpSettings({ sp_api_token: token });
            await this._enableSuperProductivity(permission);
        };
        save.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); this._closeSpSetup(); }
        });
        cancel.addEventListener('click', () => this._closeSpSetup());
        box.append(input, save, cancel);
        box.classList.add('open');
        input.focus();
    }

    _closeSpSetup() {
        this._spSetup.classList.remove('open');
        this._spSetup.replaceChildren();
    }

    setMessagesArea(messagesAreaComponent) {
        this.messagesAreaComponent = messagesAreaComponent;
    }

    setModel(model){
        this.model = model;
        this._sendButton.title = browser.i18n.getMessage("chagpt_api_send_button") + ": " + this.model;
        this._stopButton.title = browser.i18n.getMessage("chagpt_api_send_button") + ": " + this.model;
    }

    handleMessageSent() {
        // console.log("[ThunderAI] handleMessageSent");
        this._messageInputField.value = '';
        this._autoResize();
    }

    enableInput(showDone = true) {
        // console.log("[ThunderAI] enableInput");
        this._messageInputField.value = '';
        this._autoResize();
        this._messageInputField.removeAttribute('disabled');
        this._sendButton.removeAttribute('disabled');
        this._sendButton.style.display = 'block';
        this._stopButton.setAttribute('disabled', 'disabled');
        this._stopButton.style.display = 'none';
        this._stopButton.title = browser.i18n.getMessage("chagpt_api_send_button") + ": " + this.model;
        if (showDone) {
            this.showDoneStatus();
        } else {
            this.hideStatusMessage();
            this.setStatusMessage('');
        }
    }

    setStatusMessage(message) {
        this._statusLoggerText.textContent = message;
    }

    showStatusMessage(state = 'working') {
        if (this._doneTimeout) {
            clearTimeout(this._doneTimeout);
            this._doneTimeout = null;
        }
        this._setStatusClass('status-' + state);
        this._statusLogger.style.display = 'inline-flex';
    }

    hideStatusMessage() {
        this._statusLogger.style.display = 'none';
        this._setStatusIcon(null);
        this._setStatusClass(null);
    }

    _setStatusClass(className) {
        this._statusLogger.classList.remove('status-waiting', 'status-working', 'status-done', 'status-error', 'status-fadeout');
        if (className) {
            this._statusLogger.classList.add(className);
        }
    }

    // Swap the pill's leading icon. Passing null clears it.
    _setStatusIcon(buildIcon) {
        this._statusLoggerIcon.textContent = '';
        if (buildIcon) {
            this._statusLoggerIcon.appendChild(buildIcon());
        }
    }

    // Streaming indicator: the shared mzta-loading.svg (three bouncing dots).
    // The SVG animates itself via SMIL, so it needs no CSS animation and centres
    // itself in whatever box it is given. Same asset as the "thinking" spinner
    // in messagesArea.js.
    _buildLoadingImage() {
        const img = document.createElement('img');
        img.src = '../images/mzta-loading.svg';
        img.alt = '';
        return img;
    }

    // Waiting indicator: mzta-waiting-server.svg (a dot emitting expanding
    // rings). Self-animating via SMIL, like the streaming spinner.
    _buildWaitingImage() {
        const img = document.createElement('img');
        img.src = '../images/mzta-waiting-server.svg';
        img.alt = '';
        return img;
    }

    // Request sent, nothing back from the server yet.
    showWaitingStatus() {
        this.setStatusMessage(browser.i18n.getMessage('WaitingServerResponse') + '...');
        // Same guard as showStreamingStatus(): rebuilding the node restarts the
        // SVG's own animation, so leave it alone if we are already waiting.
        if (!this._statusLogger.classList.contains('status-waiting')) {
            this._setStatusIcon(() => this._buildWaitingImage());
            this.showStatusMessage('waiting');
        }
    }

    // Tokens are arriving.
    showStreamingStatus() {
        this.setStatusMessage(browser.i18n.getMessage('apiwebchat_receiving_data') + '...');
        // Only rebuild the spinner when we are not already streaming: this runs
        // on every single token, and replacing the node each time would restart
        // the SVG's own animation and leave the dots frozen at frame 0.
        if (!this._statusLogger.classList.contains('status-working')) {
            this._setStatusIcon(() => this._buildLoadingImage());
            this.showStatusMessage('working');
        }
    }

    showDoneStatus() {
        if (this._doneTimeout) {
            clearTimeout(this._doneTimeout);
        }
        this.setStatusMessage(browser.i18n.getMessage('apiwebchat_done'));
        this._setStatusIcon(buildCheckIcon);
        this._setStatusClass('status-done');
        this._statusLogger.style.display = 'inline-flex';

        this._doneTimeout = setTimeout(() => {
            this._statusLogger.classList.add('status-fadeout');
            this._doneTimeout = setTimeout(() => {
                this.hideStatusMessage();
                this.setStatusMessage('');
            }, 500);
        }, 3500);
    }

    // Unlike "done", the error pill has no timeout: it stays until the next
    // request replaces it, so a failure is never silently swallowed.
    showErrorStatus(message = null) {
        if (this._doneTimeout) {
            clearTimeout(this._doneTimeout);
            this._doneTimeout = null;
        }
        this.setStatusMessage(message || browser.i18n.getMessage('apiwebchat_status_error'));
        this._setStatusIcon(buildAlertIcon);
        this._setStatusClass('status-error');
        this._statusLogger.style.display = 'inline-flex';
    }

    // Grow the field to fit its content, letting the CSS max-height cap it at
    // three lines: clear the inline height first so shrinking works too, then
    // measure. Must run after every programmatic .value change, not just on
    // input, or the field stays tall after a long message is sent.
    _autoResize() {
        this._messageInputField.style.height = 'auto';
        this._messageInputField.style.height = this._messageInputField.scrollHeight + 'px';
    }

    _handleKeyDown(event) {
        // Plain Enter is the long-standing way to send and stays as it is; the
        // preventDefault stops the textarea inserting a newline on the way out.
        // Shift+Enter falls through and adds a line break instead.
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this._handleNewChatMessage();
        }
    }

    _handleClick() {
        this._handleNewChatMessage();
    }

    _handleStopClick() {
        this.worker.postMessage({ type: 'stop' });
        this._stopButton.setAttribute('disabled', 'disabled');
        this._stopButton.title = browser.i18n.getMessage("apiwebchat_stopping") +  '...';
    }

    _handleNewChatMessage() {
        //do nothing if input is empty
        if ((!this._messageInputField.value)||(this._messageInputField.value.trim().length === 0)) {
            return;
        }
        // prevent user from interacting while we're waiting
        this._sendButton.setAttribute('disabled', 'disabled');
        this._sendButton.style.display = 'none';
        this._stopButton.removeAttribute('disabled');
        this._stopButton.style.display = 'block';
        this._messageInputField.setAttribute('disabled', 'disabled');
        let messageContent = this._messageInputField.value;
        this._messageInputField.value = '';
        this._autoResize();
        // Documents attached to this message (only fully read ones are sent).
        const documents = this._attachments.filter(a => a.status === 'ready');
        if (this.messagesAreaComponent) {
            const bubbleText = documents.length > 0
                ? messageContent + "<br><br>📄 " + documents.map(d => d.name).join(', ')
                : messageContent;
            this.messagesAreaComponent.appendUserMessage(bubbleText);
        }
        this.showWaitingStatus();
        // What the model receives: the email context (first message of an email
        // chat), then any attached documents, then the user's own words. Only
        // the user's words (plus the document names) appear in the chat.
        const question = browser.i18n.getMessage('chat_email_question_label') + "\n" + messageContent;
        const parts = [];
        if (this._pendingContext) {
            parts.push(this._pendingContext);
            this._pendingContext = null;
        }
        if (documents.length > 0) {
            parts.push(browser.i18n.getMessage('attach_docs_intro') + "\n\n" + documents.map(d =>
                `=== Document: ${d.name}${d.truncated ? ' ' + browser.i18n.getMessage('attach_truncated') : ''} ===\n${d.text}`
            ).join("\n\n"));
            this._clearAttachments();
        }
        const workerContent = parts.length > 0 ? parts.join("\n\n") + "\n\n" + question : messageContent;
        this.worker.postMessage({ type: 'chatMessage', message: workerContent });
    }

    async _addAttachments(files) {
        for (const file of files) {
            const item = { name: file.name, status: 'reading', text: '', truncated: false };
            this._attachments.push(item);
            this._renderAttachments();
            try {
                const result = await extractDocumentText(file);
                if (!result.text) {
                    throw new Error('empty');
                }
                Object.assign(item, result, { status: 'ready' });
            } catch (e) {
                item.status = 'error';
                item.error = e instanceof UnsupportedDocumentError
                    ? browser.i18n.getMessage('attach_unsupported', [file.name])
                    : browser.i18n.getMessage('attach_failed', [file.name]);
                console.error('[ThunderAI] Could not read attachment', file.name, e);
            }
            this._renderAttachments();
        }
    }

    _clearAttachments() {
        this._attachments = [];
        this._renderAttachments();
    }

    _renderAttachments() {
        const list = this._attachmentChips;
        list.replaceChildren();
        for (const item of this._attachments) {
            const chip = document.createElement('span');
            chip.className = 'attachment-chip' + (item.status === 'error' ? ' error' : '');
            chip.setAttribute('role', 'listitem');
            const label = document.createElement('span');
            label.className = 'chip-name';
            label.textContent = item.status === 'reading'
                ? `📄 ${item.name} — ${browser.i18n.getMessage('attach_reading')}`
                : item.status === 'error' ? `⚠ ${item.error}` : `📄 ${item.name}`;
            chip.title = item.status === 'error' ? item.error : item.name;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '✕';
            remove.title = browser.i18n.getMessage('attach_remove', [item.name]);
            remove.setAttribute('aria-label', remove.title);
            remove.addEventListener('click', () => {
                this._attachments = this._attachments.filter(a => a !== item);
                this._renderAttachments();
            });
            chip.append(label, remove);
            list.appendChild(chip);
        }
        list.classList.toggle('has-items', this._attachments.length > 0);
    }

    // Chat about an email: keep the emails as context for the first message.
    setPendingContext(context) {
        this._pendingContext = context;
        this._messageInputField.placeholder = browser.i18n.getMessage('chat_email_placeholder');
        this._messageInputField.focus();
    }

    _setMessageInputValue(msg) {
        this._messageInputField.value = msg;
        this._autoResize();
    }

    _showCustomTextField(custom_text_array){
        this._customTextArray = custom_text_array || [];
        if (this._customTextArray.length === 0) {
             this._customTextArray.push({ placeholder: "{%additional_text%}", info: "" });
        }
        this._currentCustomTextIndex = 0;
        this._customText.style.display = 'block';
        this._renderCustomTextStep();
    }

    _renderCustomTextStep() {
        const currentItem = this._customTextArray[this._currentCustomTextIndex];
        const infoDiv = this.shadowRoot.querySelector('#mzta-custom_info');
        
        this._customTextArea.value = "";
        infoDiv.textContent = browser.i18n.getMessage("chatgpt_win_custom_text");
        
        if (currentItem.info && currentItem.info.trim() !== "") {
            infoDiv.appendChild(document.createElement("br"));
            const infoSpan = document.createElement("span");
            infoSpan.textContent = "[" + browser.i18n.getMessage("customPrompts_form_label_ID") + ": " + currentItem.info + "]";
            infoDiv.appendChild(infoSpan);
        }

        if(this._customTextArray.length > 1) {
            this._customStep.textContent = (this._currentCustomTextIndex + 1) + "/" + this._customTextArray.length;
            this._customStep.style.display = 'block';
        } else {
            this._customStep.style.display = 'none';
        }
        
        this._customTextArea.focus();
    }

    async _customTextBtnClick(args) {
        const customText = this._customTextArea.value;
        
        if (this._customTextArray[this._currentCustomTextIndex]) {
            this._customTextArray[this._currentCustomTextIndex].custom_text = customText;
        }

        this._currentCustomTextIndex++;

        if (this._currentCustomTextIndex < this._customTextArray.length) {
            this._renderCustomTextStep();
        } else {
            args.customBtn.disabled = true;
            args.customBtn.classList.add('disabled');
            args.customLoading.style.display = 'inline-block';
            
            let tab = await browser.tabs.query({ active: true, currentWindow: true });
            browser.runtime.sendMessage({ command: "api_send_custom_text", custom_text: this._customTextArray, tabId: tab[0].id, panel: mztaInPanel });
            args.customDiv.style.display = 'none';
            
            args.customBtn.disabled = false;
            args.customBtn.classList.remove('disabled');
            args.customLoading.style.display = 'none';
        }
    }
}

customElements.define('message-input', MessageInput);