#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

./scripts/validate.sh
version="$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')"
mkdir -p dist
archive="dist/jev-focus-v${version}.zip"
latest_archive="dist/jev-focus.zip"
rm -f "$archive"
zip -qr "$archive" manifest.json src -x '*.DS_Store'
unzip -tq "$archive"
cp "$archive" "$latest_archive"
printf 'Created %s\n' "$archive"
printf 'Created %s\n' "$latest_archive"
