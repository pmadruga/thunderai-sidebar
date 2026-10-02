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

// Side panel look (ThunderAI Side Panel fork): when the chat runs in the side
// panel, adopt the active Thunderbird theme's colours and font, and give the
// header a close button. In a normal popup window this module does nothing.

const inPanel = new URLSearchParams(window.location.search).get('panel') === '1';

async function applyTheme(root) {
    const win = await browser.windows.getCurrent();
    const theme = await browser.chatPanel.getTheme(win.id);
    if (!theme) {
        return;
    }
    const mix = (amount, color, base = theme.background) =>
        `color-mix(in srgb, ${color} ${amount}%, ${base})`;
    const tokens = {
        '--bg': theme.background,
        '--surface': mix(6, theme.text),
        '--surface-2': theme.background,
        '--hover': mix(9, theme.text),
        '--ink': theme.text,
        '--ink-2': theme.text2,
        '--ink-3': theme.text3,
        '--border': theme.border,
        '--border-strong': mix(28, theme.text),
        '--code-bg': mix(10, theme.text),
        '--accent': theme.accent,
        '--accent-soft': mix(18, theme.accent),
        '--accent-soft-ink': theme.text,
        '--info-bg': 'transparent',
        '--info-border': theme.border,
        '--info-ink': theme.text2,
        '--font': theme.font,
    };
    for (const [name, value] of Object.entries(tokens)) {
        root.style.setProperty(name, value);
    }
}

// Prompts dropdown: the ThunderAI prompts that used to live in the header
// button's popup menu, run on the email shown in the main window.
async function addActionsMenu() {
    const header = document.getElementById('appHeader');
    if (!header || document.getElementById('appHeaderActions')) {
        return;
    }
    let menu;
    try {
        menu = await browser.runtime.sendMessage({ command: 'popup_menu_ready' });
    } catch (e) {
        console.error('[ThunderAI] Could not load the prompts list:', e);
        return;
    }
    if (!menu || !Array.isArray(menu.lastShortcutPromptsData)) {
        return;
    }
    // Reading prompts, in the popup menu's order. The panel replaces both the
    // popup and the right-click menu, so context-menu prompts (Summarize,
    // Translate, …) are included; only prompts hidden everywhere are left out.
    const allowedTypes = menu.lastShortcutFiltering === 2 ? ['0', '2'] : ['0', '1'];
    const prompts = menu.lastShortcutPromptsData
        .filter(p => p && p.id !== 'prompt_chat_email')
        .filter(p => (p.show_in || 'popup') !== 'none')
        .filter(p => allowedTypes.includes(String(p.type)))
        .sort((a, b) => (a.position_display || 9999) - (b.position_display || 9999));
    if (prompts.length === 0) {
        return;
    }

    const select = document.createElement('select');
    select.id = 'appHeaderActions';
    select.title = browser.i18n.getMessage('chat_panel_actions_label');
    select.setAttribute('aria-label', browser.i18n.getMessage('chat_panel_actions_label'));
    const placeholder = new Option(browser.i18n.getMessage('chat_panel_actions'), '');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.add(placeholder);
    for (const prompt of prompts) {
        select.add(new Option(prompt.label, prompt.id));
    }
    select.addEventListener('change', () => {
        const promptId = select.value;
        select.selectedIndex = 0;
        if (promptId) {
            browser.runtime.sendMessage({ command: 'shortcut_do_prompt', tabId: menu.lastShortcutTabId, promptId });
        }
    });
    header.insertBefore(select, document.getElementById('appHeaderClose'));

    // Make room for the subject: the model name moves to the title's tooltip.
    const model = document.getElementById('appHeaderModel');
    const title = document.getElementById('appHeaderName');
    if (model && title) {
        model.hidden = true;
        if (model.textContent) {
            title.title = `${title.textContent} — ${model.textContent}`;
        }
    }
}

function addCloseButton() {
    const header = document.getElementById('appHeader');
    if (!header || document.getElementById('appHeaderClose')) {
        return;
    }
    const close = document.createElement('button');
    close.id = 'appHeaderClose';
    close.type = 'button';
    close.textContent = '✕';
    close.title = browser.i18n.getMessage('chat_panel_close');
    close.setAttribute('aria-label', browser.i18n.getMessage('chat_panel_close'));
    close.addEventListener('click', async () => {
        const win = await browser.windows.getCurrent();
        browser.runtime.sendMessage({ command: 'chatgpt_close', window_id: win.id, panel: true }).catch(() => {});
    });
    header.appendChild(close);
}

if (inPanel) {
    const root = document.documentElement;
    root.classList.add('in-panel');
    try {
        await applyTheme(root);
    } catch (e) {
        console.error('[ThunderAI] Could not read the Thunderbird theme:', e);
    } finally {
        root.classList.add('theme-ready');
    }
    const setUpHeader = () => {
        addCloseButton();
        addActionsMenu();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setUpHeader, { once: true });
    } else {
        setUpHeader();
    }
}
