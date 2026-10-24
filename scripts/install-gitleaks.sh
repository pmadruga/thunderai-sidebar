#!/usr/bin/env bash
# Pinned official release; hash verified before extracting the executable.
set -euo pipefail
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'This installer supports Linux x86_64. Supply your own verified Gitleaks 8.30.1 binary on other platforms.' >&2
  exit 1
fi
scan_dir="${1:?Pass a temporary destination directory}"
mkdir -p "$scan_dir"
archive="$scan_dir/gitleaks.tar.gz"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  --output "$archive"
printf '%s  %s\n' '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$scan_dir" gitleaks
chmod 0755 "$scan_dir/gitleaks"
