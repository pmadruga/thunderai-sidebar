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
