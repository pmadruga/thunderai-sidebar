#!/usr/bin/env bash
# Development by default; --release requires a clean tagged source commit.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 scripts/build_release.py "$@"
