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
