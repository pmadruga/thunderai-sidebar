#!/usr/bin/env bash
# Packages ThunderAI (Side Panel) into dist/thunderai-side-panel-<version>.xpi
set -euo pipefail
cd "$(dirname "$0")"
version=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
out="dist/thunderai-side-panel-${version}.xpi"
mkdir -p dist
rm -f "$out"
zip -q -r -X "$out" manifest.json mzta-background.html mzta-background.js LICENSE \
  _locales api_webchat experiments images js options pages popup
echo "Built $out"
