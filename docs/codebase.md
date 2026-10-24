# Codebase guide

ThunderAI Side Panel uses native JavaScript modules. There is no runtime bundler or package manager. Keep Thunderbird entry-point paths stable so upstream changes remain straightforward to review.

## Where changes belong

| Area | Location | Responsibility |
| --- | --- | --- |
| Extension startup and email actions | `mzta-background.js` | Route messages, read selected emails, open chat pages |
| Chat interface | `api_webchat/` | Input, attachments, rendering, model selection and tool confirmations |
| Provider HTTP clients | `js/api/` | Provider request formats and model discovery |
| Provider configuration | `js/api/provider-config.js` | Translate stored preferences into client configuration |
| Worker entry points | `js/workers/model-worker-*.js` | Select the provider client and error formatter |
| Worker lifecycle | `js/workers/worker-runtime.js` | Initialize, restore, stop and route worker messages |
| Streaming conversation | `js/workers/chat-session.js` | Conversation state, cancellation, tool rounds and provider events |
| Stream decoding | `js/workers/stream-transport.js` | Incremental UTF-8, SSE and NDJSON parsing |
| Saved conversations | `api_webchat/chatHistory.js`, `js/mzta-chathistory.js` | UI checkpoints and background-owned encrypted storage |
| Privacy boundaries | `js/secure-settings.js`, `js/endpoint-policy.js` | Encrypted credentials/caches and network destination policy |
| Thunderbird internals | `experiments/chatPanel/` | Docked panel, thread identity and native key store |
| Settings and feature pages | `options/`, `pages/`, `popup/` | Preferences, feature-specific controls and action menus |
| Tests and packaging | `tests/`, `scripts/` | Regression tests, isolated Thunderbird tests and deterministic XPI builds |

## Provider flow

The chat controller selects a small provider worker entry point. That entry point supplies its API client to `createWorkerHandler()`. The shared handler owns the worker lifecycle and delegates active conversations to `ChatSession`; the session uses the provider client for HTTP requests and the stream decoder for incoming events.

Model discovery and worker initialization both use `providerConfig()`. Provider-specific request formats stay in the API clients. Protocol-specific response interpretation stays in `ChatSession`. Avoid adding another copy of initialization or cancellation logic to an entry point.

## Storage ownership

Chat pages send changed-turn patches to the background instead of writing saved history directly. The background serializes writes, verifies revisions and encrypts records. Account/thread identity and provider destination determine which history a page may restore. Credentials and feature caches use a separate encrypted store.

## Tests and documentation

Run the checks in [CONTRIBUTING.md](../CONTRIBUTING.md). `tests/worker-runtime.test.mjs` exercises all five entry points through the shared lifecycle; `tests/stream-transport.test.mjs` covers provider streaming behavior. Live tests under `tests/thunderbird/` use disposable profiles and local mock servers.

Detailed subsystem specifications remain in [claude-spec/](../claude-spec/). Add new runtime files to `release-files.txt`; documentation, screenshots and test fixtures stay outside the XPI.

## Reproduce README screenshots

Build a development XPI, install `marionette_driver` in a development Python environment, then run:

```sh
python tests/thunderbird/sidebar-smoke.py --flatpak \
  --xpi dist/thunderai-side-panel-5.1.0.xpi \
  --screenshots docs/screenshots
```

For a native installation, replace `--flatpak` with `--binary /path/to/thunderbird`. Screenshot mode uses a short fictional email and fixed responses from a local mock provider. Normal mode retains the large-email regression. Both modes exercise real sidebar rendering, encrypted restoration, continuation and deletion. No personal account or profile is used.
