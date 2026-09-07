#!/usr/bin/env bash
# Install the official k6 binary without changing the application or database.
set -euo pipefail
VERSION="2.2.0"
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) PLATFORM=linux-amd64 ;;
  Linux/aarch64|Linux/arm64) PLATFORM=linux-arm64 ;;
  Darwin/x86_64) PLATFORM=macos-amd64 ;;
  Darwin/arm64) PLATFORM=macos-arm64 ;;
  *) echo 'Unsupported platform: use the official Grafana k6 installer.' >&2; exit 2 ;;
esac
DEST="${K6_INSTALL_DIR:-${HOME}/.local/bin}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export VERSION PLATFORM TMP
python3 - <<'PY'
import hashlib, json, os, pathlib, urllib.request
version, platform = os.environ['VERSION'], os.environ['PLATFORM']
base = 'https://api.github.com/repos/grafana/k6/releases/tags/v' + version
request = urllib.request.Request(base, headers={'User-Agent': 'acprod-capacity-installer'})
with urllib.request.urlopen(request, timeout=30) as response:
    release = json.load(response)
name = f'k6-v{version}-{platform}.tar.gz'
assets = release.get('assets', [])
asset = next((a for a in assets if a['name'] == name), None)
if not asset:
    raise SystemExit('Official k6 archive not found; refusing an unverified substitute.')
url = asset['browser_download_url']
if not url.startswith('https://github.com/grafana/k6/releases/download/v' + version + '/'):
    raise SystemExit('Unexpected release URL.')
archive = pathlib.Path(os.environ['TMP']) / name
with urllib.request.urlopen(url, timeout=60) as response:
    archive.write_bytes(response.read())
expected = asset.get('digest') or ''
if expected.startswith('sha256:'):
    expected = expected.split(':', 1)[1]
else:
    checks = next((a for a in assets if a['name'].endswith('checksums.txt')), None)
    if not checks:
        raise SystemExit('Release has no SHA256 digest/checksums; installation refused.')
    with urllib.request.urlopen(checks['browser_download_url'], timeout=30) as response:
        lines = response.read().decode().splitlines()
    expected = next((s.split()[0] for s in lines if s.split()[-1].lstrip('*') == name), '')
actual = hashlib.sha256(archive.read_bytes()).hexdigest()
if len(expected) != 64 or expected != actual:
    raise SystemExit('k6 SHA256 verification failed.')
print(f'Official k6 {version}: SHA256 verified {actual}')
(pathlib.Path(os.environ['TMP']) / 'archive-path').write_text(str(archive))
PY
ARCHIVE="$(cat "$TMP/archive-path")"
# Only extract the one binary; do not extract arbitrary archive paths.
tar -xzf "$ARCHIVE" -C "$TMP" "k6-v${VERSION}-${PLATFORM}/k6"
mkdir -p "$DEST"
install -m 0755 "$TMP/k6-v${VERSION}-${PLATFORM}/k6" "$DEST/k6"
"$DEST/k6" version
if [ -n "${GITHUB_PATH:-}" ]; then printf '%s\n' "$DEST" >> "$GITHUB_PATH"; fi
printf 'k6 installed at %s/k6\n' "$DEST"
