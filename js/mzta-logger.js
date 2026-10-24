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
 */

// Debug output must describe operations, not reproduce mailbox or model data.
// Redact by semantic labels, independent of whether a password input is visible.
export function redactLogMessage(value) {
    const text = String(value ?? '');
    if (/(?:api[_ -]?key|authorization|bearer|password|access[_ -]?token|sp_api_token)/i.test(text)) {
        return '[credential-bearing log omitted]';
    }
    if (/(?:tokensDone|raw_text|raw_html|raw_selection|raw_selection_html|raw_only_typed_html|mail_plain_text_part|curr_prompt|fullPrompt|full response|full reasoning|body_text|msg_text|conversationHistory|conversation_history|selection_text|selection_html|messageContent|promptText)\s*[:=]/i.test(text)) {
        return '[message content omitted]';
    }
    return text;
}

export class taLogger {

    do_debug = false;
    prefix = "";

    constructor(prefix, do_debug) {
        this.do_debug = do_debug;
        this.prefix = "[ThunderAI Logger | " + prefix + "] ";
    }

    changeDebug(do_debug) {
        this.do_debug = do_debug;
    }

    log(msg, do_debug = -1) {
        if(do_debug !== -1) this.do_debug = do_debug;
        if(this.do_debug === true) console.log(this.prefix + redactLogMessage(msg));
    }

    error(msg) {
        console.error(this.prefix + redactLogMessage(msg));
    }

    warn(msg) {
        console.warn(this.prefix + redactLogMessage(msg));
    }
};