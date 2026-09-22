#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

python3 -m json.tool manifest.json >/dev/null
node --check src/background.js
node --check src/content/instagram.js
node --check src/content/youtube.js
node --check src/options/options.js
node --check src/popup/popup.js

python3 - <<'PY'
import json
from pathlib import Path

manifest = json.loads(Path("manifest.json").read_text())
paths = [
    manifest["background"]["service_worker"],
    manifest["action"]["default_popup"],
    manifest["options_page"],
]
for script in manifest["content_scripts"]:
    paths.extend(script.get("js", []))
    paths.extend(script.get("css", []))

missing = [path for path in paths if not Path(path).is_file()]
if missing:
    raise SystemExit(f"Manifest references missing files: {', '.join(missing)}")

print(f"Validated Jev Focus v{manifest['version']}")
PY
