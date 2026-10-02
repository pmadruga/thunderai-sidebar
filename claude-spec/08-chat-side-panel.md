# Chat side panel (ThunderAI Side Panel fork)

API-based chats (OpenAI API, Gemini, Ollama, OpenAI-compatible, Anthropic) open
in a panel docked on the right of the main window instead of a popup window.

## Pieces

- `experiments/chatPanel/` — experiment API (`chatPanel.open(windowId, url)`,
  `chatPanel.close()`). Inserts a splitter + `<vbox id="thunderai-chat-panel">`
  at the end of `#tabmail-container` (Thunderbird's extension point for side
  panes, also used by the Today pane). The `<browser>` is configured like
  Thunderbird's extension popups (`ExtensionPopups.sys.mjs`) and registered via
  `extension-browser-inserted`, so the page has the normal WebExtension API.
  Width is remembered in XULStore. `open()` resolves `false` for windows
  without `#tabmail-container` (compose, standalone message windows) or if the
  browser isn't ready within 5 s, and the caller falls back to a popup.
- `mzta-background.js` — `openChatView()` replaces `windows.create()` for the
  API connections when `chat_in_side_panel` is on (default). ChatGPT Web keeps
  its window (it needs a real tab for script injection).
- Messaging: the panel page is not a tab, so `sender.tab` is undefined and the
  background reaches it with `sendToChat()` → `runtime.sendMessage` broadcast.
- Page side: `api_webchat` detects `panel=1` in its URL (`mztaInPanel`) and adds
  `panel: true` to `chatgpt_close` and `api_send_custom_text`.

## Invariant: never close the main window

Inside the panel, `windows.getCurrent()` is the main mail window. The
`chatgpt_close` handler closes the panel when `message.panel` is set, and as a
second guard never calls `windows.remove()` on a `normal` window.

## Setting

`chat_in_side_panel` (default `true`), in Advanced options.

## Chat about this email

"Chat about this email" opens the chat with the selected email(s) as context
and sends **nothing** until the user types.

- Entry points: first item of the popup menu (injected in `preparePopupMenu()`
  for mail/message tabs, so it needs no stored prompt data) and first item of
  the message-list context menu (`loadContextMenus()`, which now always creates
  the ThunderAI parent). The context menu passes `info.selectedMessages`, so a
  collapsed conversation or a multi-selection is used as a whole; the popup
  uses `messageDisplay.getDisplayedMessages()`.
- `openEmailChat()` (background) sorts messages oldest first, keeps the most
  recent 30, reads each body with `messages.listInlineTextParts()` (HTML via
  `messengerUtilities.convertToPlainText()`), and calls `openChatGPT()` with
  `prompt_info.chat_mode = true`. The usual max prompt length check applies.
- For API connections the background then sends `api_context` instead of
  `api_send`. The page shows a notice, sets the input placeholder and calls
  `messageInput.setPendingContext()`; the context is prepended to the user's
  first message only (the bubble shows just the question). Follow-ups keep it
  because the workers keep the conversation history.

## Panel look

`api_webchat/panel-theme.js` (panel mode only) reads the active Thunderbird
theme through `chatPanel.getTheme(windowId)` — resolved `--layout-*` /
`--selected-item-*` colours and the UI font, probed in about:3pane — and maps
them onto the page's design tokens (`--bg`, `--ink`, `--accent`, `--font`, …).
The panel hides the provider pill and the connection debug note, shows the
email subject (chat mode) and the model's short name in the header, replaces
the per-answer Close button with a header ✕, and uses a thin themed scrollbar.

## Header button and actions menu

- The message header button is "Chat with AI" (`message_display_action`
  without a popup): `onClicked` and the `_thunderai__do_action` shortcut call
  `openEmailChat()` directly. The compose window keeps its popup menu.
- The panel header has an "Actions…" `<select>` (`panel-theme.js`,
  `addActionsMenu()`), filled from `popup_menu_ready`: every reading prompt not
  hidden everywhere (`show_in !== 'none'`), including context-menu ones such as
  Summarize/Translate, in popup order. Choosing one sends `shortcut_do_prompt`
  for the mail tab, which reloads the panel with that prompt.
- No "AI Summary" button is drawn on emails: the manual summary mode
  (`summarize_auto === 1`) returns early. Automatic summaries are unchanged.

## Document attachments

`api_webchat/attachments.js` turns a user-chosen file into plain text:
text-like files directly, PDF with the bundled pdf.js
(`js/lib/pdfjs/`, Apache-2.0, see VENDORS.md; `isEvalSupported: false`
because extension pages forbid eval; cleanup via `loadingTask.destroy()` in
pdf.js 6), and .docx by reading `word/document.xml` from the zip with
`DecompressionStream('deflate-raw')`. Each document is capped at
`MAX_DOCUMENT_CHARS`. The message input has a paperclip button, a hidden file
input and drag-and-drop; files show as removable chips. On send, the model
gets: email context (first message of an email chat) → attached documents →
the question; the user's bubble shows the question plus the file names.
Attachments are per message and are not kept when the panel switches email.

## Following the selection

A single selected email expands to its whole conversation via
`chatPanel.getThreadMessages()` (the folder's thread, through the msg DB and
`messageManager.convert()`). `messageDisplay.onMessagesDisplayed` (debounced
450 ms) re-opens the email chat for the new selection while the panel is open
and `chat_follow_selection` is on (default), unless the selection belongs to
the conversation already loaded (`_emailChatKey`).

## Using an answer as the reply

Email chats run with `action: "1"`, so every answer gets "Use this answer"
(reply / reply all), which opens a reply with the answer as its body. The
reply target is the email the user picked, or for a whole conversation the
newest email not sent by one of the user's identities
(`latestMessageNotFromMe()`), passed as `prompt_info.chat_reply_to_id` and
used by `openChatGPT()` when no single message is displayed. The context
tells the model who the user is (`chat_email_identity`, default identity of
the emails' account) and marks the user's own emails "(me)", so drafts are
written from the user. In the side panel the chat stays open after replying.

## Super Productivity tools

A checklist toggle next to the paperclip (shown only for the OpenAI-compatible
connection, which is the one with tool calling) lets the model use the Super
Productivity desktop app's Local REST API (`api_webchat/superproductivity.js`,
default `http://127.0.0.1:3876`, Bearer token from Settings → Misc). Turning
it on requests the `http://127.0.0.1/*` host permission (synchronously, inside
the click handler), asks for the token inline if none is saved, and checks it
with `GET /status`. URL, token and on/off live in `storage.local` (never
synced); the toggle turns itself back on when the panel opens if all three are
still valid.

While on, the page sends OpenAI function tools to the worker (`setTools`).
The worker streams `delta.tool_calls`, and at the end of a turn with calls it
posts `toolCalls` instead of `tokensDone`. The controller runs them and posts
`toolResults`, and the worker continues the turn. Reads (list/search tasks,
projects, tags, current task) run directly and leave a "🔎" note. Writes
(create, update, start, stop tracking) show a confirmation card first; Cancel
returns `{cancelled: true}` to the model. There is no delete tool.

## Context meter

Under the chat input, a small "used / total" token count (e.g. `12.4k / 131k`,
full numbers and percentage in the tooltip). The OpenAI-compatible worker asks
for `stream_options.include_usage` and posts a `usage` message after each
answer with `total_tokens` of the latest request, i.e. how much of the window
the conversation fills now. The total comes once per chat from llama.cpp's
`/props` (`default_generation_settings.n_ctx`); servers without it show just
the used count. Other connections don't report usage, so the meter stays
hidden.
