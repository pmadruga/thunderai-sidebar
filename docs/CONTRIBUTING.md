# Contributing to ThunderAI Side Panel

This is an independent GPL-3.0-or-later fork of [micz/ThunderAI](https://github.com/micz/ThunderAI). Preserve original source notices and history. Fork-specific issues and pull requests belong in [pmadruga/thunderai-sidebar](https://github.com/pmadruga/thunderai-sidebar).

## Local setup and checks

Use Git, Node.js 22 and Python 3.11 or later. Runtime code remains plain JavaScript modules; no transpilation or bundler is required. Run:

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check_repository.py
./scripts/build.sh
```

Use synthetic email and a disposable Thunderbird profile for integration tests. Keep the real profile closed to automation. The live smoke-test checklist is:

1. Open two unrelated chains, including matching subjects, and verify separate chats.
2. Save a chat, close the panel, reopen it, restart Thunderbird, and continue it against a mock API. Verify the actual request history.
3. Add a reply to a chain and verify context refresh without losing the saved discussion.
4. Exercise stop, network failure, malformed streams, oversized attachments and switching selections while work is in progress.
5. Verify history deletion, unavailable keys, encrypted records, provider-endpoint separation and retention limits.
6. Test both the declared minimum Thunderbird version and the version intended for release on each supported operating system. Record which combinations actually passed.

A mock API test is not a claim that every cloud provider works. A check of an API endpoint is not a check of the sidebar UI.

## Publication safety

Do not commit email fixtures derived from real mail, provider keys, configuration exports, profile directories, screenshots containing personal data, or local backups. `backup/` and `dist/` are ignored. An ignored file can still be included by a careless packaging command, so the build uses a reviewed inventory instead of recursive directory zipping.

Run a dedicated redacted scan before publication. On Linux x86_64:

```sh
scan_dir=$(mktemp -d)
bash scripts/install-gitleaks.sh "$scan_dir"
python3 scripts/scan-secrets.py --binary "$scan_dir/gitleaks"
rm -rf "$scan_dir"
```

The installer pins Gitleaks 8.30.1 and checks the official release archive's SHA-256 before extracting it. The scanner checks all reachable Git history plus tracked and nonignored untracked files. It never prints matched secret values. Do not upload the scanner's raw internal output or relax findings globally to make CI pass. Resolve findings, rotate exposed credentials when appropriate, and use narrowly scoped, documented exceptions only for verified synthetic fixtures.

## Source and dependencies

- Edit only `_locales/en/messages.json` by hand. Other translations retain upstream ownership unless a deliberate fork translation process is established.
- `config/locales.txt` is the locale shipping allowlist. Update it only for approved translations.
- Add every new runtime or required notice file to `config/release-files.txt`. Do not add profiles, tests or developer tooling to the runtime archive.
- Update affected specifications and the fork changelog when behavior changes.
- Review vendor updates manually against the upstream release. Update `config/vendor-lock.json`, version, source URL, SHA-256 and license together. Preserve any bundled subcomponent notices.
- Keep package-level `LICENSE`, `docs/THIRD_PARTY_NOTICES.md` and every referenced license in the XPI.

## Releases

1. Complete source review, the automated checks, the redacted history scan and the relevant Thunderbird smoke tests.
2. Update `manifest.json`, the dated `docs/FORK_CHANGELOG.md` entry and public documentation. The extension ID belongs to this fork and must remain stable after publication.
3. Commit all intended files. The source commit must contain everything in the package inventory.
4. Tag that commit `sidebar-v<manifest version>`. Do not tag a dirty or partially committed workspace.
5. Run `./scripts/build.sh --release`. It requires a clean working tree and the matching version tag at HEAD. A tagged CI run performs the same checks and uploads a short-lived workflow artifact; it does not automatically publish a GitHub release.
6. Compare the XPI checksum from two builds of that source. The archive uses sorted entries, fixed timestamps and permissions, and stored entries without compressor-dependent output.
7. Publish the reviewed XPI and `.sha256` alongside the matching source tag. Include tested Thunderbird/OS combinations, migration limits, privileged-access disclosure, known limitations and rollback instructions.

GitHub releases are the fork's distribution channel. There is no automatic update manifest yet. Do not link users to upstream downloads as if they contain the fork features. Keep the original project as the `upstream` remote and the fork as `origin`; use normal branch pushes rather than mirroring unrelated local references.

## Reporting and review

Use [SECURITY.md](SECURITY.md) for vulnerabilities. Public reports must be redacted. Prefer focused changes with a concrete regression test, avoid unrelated copy changes, and retain the upstream commit history and authorship. Publishing this fork does not imply endorsement by the original author or any dependency author.

## Optional live Thunderbird tests

With `marionette_driver` installed in a development Python environment, build the XPI and run `tests/thunderbird/security-smoke.py`, `tests/thunderbird/history-smoke.py` and `tests/thunderbird/sidebar-smoke.py` with `--xpi /absolute/path/to/package.xpi`. Add `--flatpak` for the Fedora Flatpak installation or `--binary /path/to/thunderbird` for a native installation. Run these sequentially: the security and history harnesses share a local canary port. Each creates and removes its own disposable profile. Never point them at your personal profile.

The history harness exercises native encryption, large synthetic context, endpoint separation and deletion. The sidebar harness creates synthetic mail and a local streaming provider, sends through the actual input control, reloads and restores the transcript, continues with restored provider history, and clears the saved chat. These tests do not establish compatibility with real provider services or all supported Thunderbird versions.
