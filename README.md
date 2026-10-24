# ThunderAI Side Panel

An independent fork of [ThunderAI by Mic](https://github.com/micz/ThunderAI), maintained by [Pedro Madruga](https://github.com/pmadruga). This fork keeps upstream history and attribution and is distributed under GPL-3.0-or-later. It is not an official ThunderAI release.

The fork adds an email conversation sidebar, document attachments, provider model selection, context usage, and encrypted local chat history. Existing upstream email actions remain available. See [fork changes](FORK_CHANGELOG.md), [upstream credits](UPSTREAM.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Install

When a packaged release is available, download the `.xpi` from this fork's [GitHub releases](https://github.com/pmadruga/thunderai-sidebar/releases). Until then, build a development XPI from the source using the commands below. In Thunderbird, open **Add-ons and Themes**, use the gear menu, select **Install Add-on From File**, and choose the XPI. Verify the matching `.sha256` file if you download the package separately from its source tag.

This fork uses a privileged Thunderbird Experiment API for the sidebar and key store. Thunderbird therefore requests full access to Thunderbird and your computer. Read [Privacy](PRIVACY.md) before enabling AI processing.

The manifest declares Thunderbird 140 or later. The sidebar and encrypted history have been exercised on Thunderbird 156 on Fedora. Other platforms and the minimum supported version need their own smoke tests; do not treat the manifest minimum as a tested compatibility matrix.

## Moving from original ThunderAI

The fork has its own add-on ID, `thunderai-sidebar@pedromadruga.com`. It does not replace `thunderai@micz.it` and has separate settings and storage. Disable the original while using this fork to avoid duplicate email actions and shortcuts.

There is no automatic cross-extension migration. Reconfigure your provider in this fork. If you export and import custom prompts, inspect them before sharing: exports can contain personal instructions or provider configuration. Original local history is not imported. Never copy profile databases or publish a settings backup to migrate.

GitHub release XPIs do not currently provide automatic updates. Install a newer fork release manually. Upstream add-on updates are not the fork's update channel. ThunderAI Sparks is a separate upstream companion; compatibility with the fork's distinct ID must be checked before relying on its calendar/task integration.

## Chat and privacy

Open an email chain and use **Chat with AI**. The sidebar follows the selected conversation while open. The selected email context and attached documents are sent to the configured provider when you ask a question. A local provider keeps that request local; a cloud provider receives it under its own policies.

Email chat history is saved on this device as encrypted records and restored when you return to the chain at the same provider endpoint. Changing endpoints keeps the histories separate. **Clear saved chat** deletes that chain's saved record without deleting emails. This is encryption at rest, not a second login inside an unlocked Thunderbird session. Missing keys or decryption errors must not cause a plaintext fallback. The defaults are 90 days and 50 MiB; setting retention to 0 disables saving and deletes saved chats. Details and limitations are in [PRIVACY.md](PRIVACY.md).

## Development

Use plain JavaScript modules without a runtime bundler. Required development tools are Git, Node.js 22, Python 3.11 or later, and Thunderbird for integration testing.

```sh
node --test tests/*.test.mjs
python3 scripts/check_repository.py
./build-side-panel.sh
```

The default build is a development package. It uses the explicit file inventory in `release-files.txt`, filters locales through `LANG.md`, rejects symlinks, and produces a SHA-256 sidecar. It does not silently include other files from your workspace.

For a distributable release, commit the complete source, tag it `sidebar-v5.1.0` (matching the manifest), then run:

```sh
./build-side-panel.sh --release
```

Release mode rejects a dirty or untracked working tree and requires the matching tag at HEAD. Packages have sorted entries, fixed timestamps and file modes, and no compression, so identical source bytes produce identical archives without depending on a compressor version. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks, vendored updates, and the release procedure.

## Support and attribution

Report fork issues in [this repository](https://github.com/pmadruga/thunderai-sidebar/issues). Do not send fork-specific reports to the upstream maintainer. Remove email content, addresses, authentication tokens and private server details from reports. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

The original ThunderAI project is Copyright (C) 2024-2026 Mic and contributors. Fork changes are Copyright (C) 2026 Pedro Madruga and contributors. Original source headers, [GPL license](LICENSE), upstream contributor credits and vendored license notices are retained. Changes in this fork began in October 2026; see the dated [fork changelog](FORK_CHANGELOG.md). Upstream changes remain documented in [CHANGELOG.md](CHANGELOG.md).
