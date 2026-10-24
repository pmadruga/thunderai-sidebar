# Privacy and data handling

This policy describes the independent ThunderAI Side Panel fork, not the upstream ThunderAI service or any AI provider. The extension uses no maintainer-operated processing service. It connects to providers and integrations selected in its settings.

## What leaves your computer

When you invoke an AI action, the configured provider receives the prompt and the email content required by that action. In an email chat, this can include the selected conversation, your messages, previous chat turns, extracted document text, and model tool results. Attachment filenames may appear in context. Automatic email features can process messages when their configured trigger runs, without a separate prompt each time.

A local API endpoint processes these requests on the machine or network you configure. A cloud API or ChatGPT Web receives the data under that provider's own terms. The extension cannot control provider retention, training policies, account logging or server backups. Selecting a model or discovering available models also contacts the configured API endpoint.

Optional task integrations require read-access consent for the current conversation and provider destination. Enabling access allows task content to be sent to that provider. Modifying actions additionally require confirmation with an argument preview. Revoking access prevents later results from being sent, but cannot recall requests already sent.

## Saved chats

Email chat transcripts are saved in Thunderbird extension-local storage as ciphertext. A random local identifier selects a key in Thunderbird's native key store. The identifier is not the encryption secret. Chat history and this identifier are not written to extension sync storage. Saved history is separated by account, email thread and normalized provider endpoint. Changing the endpoint starts or restores that endpoint's separate chat rather than transferring another provider's history. Changing models at the same endpoint retains the chat. Thread identifiers are hashed to name records; hashing is not a substitute for encrypting the transcript itself.

History is decrypted in memory when a chain is reopened. Saving must fail without a plaintext fallback if encryption is unavailable. A decryption failure preserves the old record rather than silently replacing it. **Clear saved chat** removes the saved record for the current chain and does not remove the emails themselves. Saved chats default to a 90-day retention period and a 50 MiB encrypted-storage budget. The chat settings let you adjust these limits. Setting retention to 0 disables saving and deletes saved chats. Clear all saved chats removes all stored conversations. Expired and older conversations can be removed to enforce retention and storage limits. Unsaved text or the final part of a response can be lost after a crash.

Encryption at rest is not a separate password barrier inside Thunderbird. Someone using your unlocked session, or software with access to that session and key store, may read the chats. Key-store protection depends on the operating system and Thunderbird backend. Do not assume that copying a profile to another machine preserves key access. There is no chat-key export or recovery feature; loss of the key can make saved chats unreadable.

History encryption does not imply that all extension settings, summaries, translations, task data, provider-side history, operating-system swap, crash reports or backups are encrypted by this feature. External backup or profile-sync tools may copy local files independently of the extension. Use device encryption and appropriate account security for broader protection.

## Settings and diagnostics

Provider API keys and task-service credentials are encrypted in extension-local storage using the native key store. Legacy synced credentials are removed only after encryption succeeds; this does not erase old backups or copies already retained by a sync service. Prompt-specific credentials use encrypted secret references. Settings exports omit credentials and their references. Provider configuration, custom prompt text and feature preferences remain settings data and may be synced.

Cached summaries, translations and spam explanations are also encrypted locally. Their Message-ID record keys remain visible metadata. These caches use a separate key from chat history, so clearing chats preserves credentials and cached features. Encryption fails closed if the key store is unavailable.

Logging redacts known sensitive fields and response content, but diagnostics from Thunderbird, providers or other software remain outside that guarantee. Do not publish profiles or unreviewed configuration exports. Keep debug logging off for normal use, redact diagnostics before sharing, and use synthetic messages in public issue reports.

## Permissions and control

The sidebar and native key-store integration use a Thunderbird Experiment API. Thunderbird grants such add-ons full, unrestricted access to Thunderbird and the computer. Individual optional permissions do not form an effective security sandbox for Experiment code. This privilege is why source review, trusted releases and device security matter.

Disable automatic features you do not want, choose the intended provider before sending, remove attachments you do not want processed, and clear saved chats when no longer needed. Disabling or uninstalling the add-on does not recall requests already sent to a provider or delete that provider's copies. The distinct fork ID has separate storage from original ThunderAI and no automatic cross-extension migration.
