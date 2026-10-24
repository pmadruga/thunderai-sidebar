# ThunderAI Side Panel - Contributor Guide

## Project Overview
ThunderAI is a **Thunderbird WebExtension (Manifest V2)** that integrates multiple AI providers (ChatGPT Web, OpenAI API, Google Gemini, Claude/Anthropic, Ollama, and OpenAI-compatible APIs) directly into the Thunderbird email client.

- **Extension ID:** `thunderai-sidebar@pedromadruga.com`
- **Min Thunderbird:** 140.0+
- **Language:** Plain ES6+ JavaScript modules — no build tools, no transpilation, no npm
- **License:** GPLv3

## Key Rules

1. **Localization:** Modify ONLY `_locales/en/messages.json`. All other locale files are managed via Weblate — never touch them.
2. **`config/locales.txt` is the release packaging allowlist, not a locale inventory.** It lists only the translations complete enough to ship, and is therefore a *deliberately partial* subset of `_locales/` — locales below the release bar are omitted on purpose. It is maintained by hand: add a locale when its translation is approved for release. Do not "fix" it to match `_locales/`.
3. **Packaging:** There is no runtime bundler, compiler, or package manager. JavaScript modules load directly. `scripts/build.sh` uses the explicit `config/release-files.txt` inventory and `config/locales.txt`; `--release` requires clean committed source and a matching version tag.
4. **Module imports:** Use relative paths with `.js` extension (e.g., `import { foo } from '../js/mzta-utils.js'`).
5. **Placeholder format:** Placeholders in prompt text use the `{%placeholder_id%}` syntax (e.g., `{%mail_text_body_or_selected%}`).
6. **Validation:** Run `node --test tests/*.test.mjs` and `python3 scripts/check_repository.py`. Integration tests use a disposable Thunderbird profile and mock APIs. Never use personal mail as a fixture.
7. **Settings defaults:** All new preferences must be added to `options/mzta-options-default.js` in `prefs_default`.
8. **Keep spec files up to date:** When making code changes that affect a subsystem described in docs/specs/, update the relevant spec file to reflect the new behavior. Read the spec before modifying, update it after.

See [docs/codebase.md](codebase.md) for the maintained module responsibility map and screenshot reproduction.

## Directory Map

```
/
├── mzta-background.js      # Background script (main entry point)
├── mzta-background.html    # Loads the background script
├── manifest.json           # Extension manifest
├── js/                     # Core modules
│   ├── api/                # AI API integration modules
│   ├── workers/            # Provider entry points plus shared lifecycle and streaming
│   ├── lib/                # Third-party libraries (diff.js)
│   └── mzta-*.js           # Core utilities, menus, prompts, placeholders
├── options/                # Settings UI
│   ├── mzta-options.html/.js/.css
│   ├── mzta-options-default.js   # ALL default preference values
│   └── mzta-release-notes.html
├── pages/                  # Feature-specific settings pages
│   ├── addtags/
│   ├── customprompts/
│   ├── customdataplaceholders/
│   ├── get-calendar-event/
│   ├── get-task/
│   ├── menu_order/         # Drag-and-drop reorder + visibility for popup/context menus
│   ├── spamfilter/
│   ├── summarize/
│   ├── translate/
│   ├── onboarding/
│   ├── setup-wizard/       # First-run guided connection setup
│   └── _lib/               # Shared libraries used by pages
├── popup/                  # Popup menu (shown on toolbar click)
│   └── mzta-popup.html/.js/.css
├── _locales/               # Localization
│   ├── en/messages.json    # ← ONLY THIS FILE is edited directly
│   └── [all other languages managed by Weblate — see `_locales/` for the current set]
├── images/                 # Icons and graphical assets
└── api_webchat/            # Web chat API interface
```

## Spec Files

For detailed documentation see [`docs/specs/`](specs):

- [01-architecture.md](specs/01-architecture.md) — Module structure and data flow
- [02-prompts.md](specs/02-prompts.md) — Prompt system (types, actions, properties)
- [03-placeholders.md](specs/03-placeholders.md) — Placeholder system
- [04-api-integrations.md](specs/04-api-integrations.md) — AI provider integrations
- [05-options.md](specs/05-options.md) — Settings and preferences system
- [06-localization.md](specs/06-localization.md) — i18n rules and workflow
- [07-diff-picker.md](specs/07-diff-picker.md) — Interactive change picker for proofreading (hunk model, compose invariant)
- [99-thunderbird-team-spec.md](specs/99-thunderbird-team-spec.md) — Thunderbird WebExtensions development guidelines (API usage, experiments, review requirements)
