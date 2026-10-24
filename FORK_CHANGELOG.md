# ThunderAI Side Panel changes

This file describes modifications by Pedro Madruga and fork contributors to [micz/ThunderAI](https://github.com/micz/ThunderAI). The original release history remains in [CHANGELOG.md](CHANGELOG.md).

## 5.1.0 - 2026-10-24

- Establish the independent ThunderAI Side Panel identity and GitHub distribution, with separate extension storage and no automatic migration from upstream.
- Dock email conversation chats in a sidebar and follow the selected email chain.
- Attach supported documents, select models from the current provider, and show context usage when a server supplies it.
- Save and restore encrypted local email chat history, partitioned by account, thread and provider endpoint, with revision checks to prevent stale writes after deletion.
- Add local retention and storage limits, per-chain and clear-all deletion, and encrypted credential and summary-cache storage.
- Require conversation-specific task-read consent and complete previews for task changes. Block remote content in chat output and keep external links outside the privileged panel.
- Cancel stalled streaming and model discovery requests, preserve Unicode across network chunks, bound attachment extraction, and coalesce rendering and encrypted checkpoints.
- Let API servers enforce model context limits rather than applying the old prompt character limit.
- Add security and reliability hardening, repository checks, tests, an explicit package inventory, deterministic release archives and checksums.
- Retain upstream GPL attribution and add bundled third-party license notices.

This release uses Thunderbird Experiment APIs. See [Privacy](PRIVACY.md) and the compatibility notes in [README.md](README.md). The build is prepared from this repository; a release is available only when a corresponding tagged asset has actually been published.
