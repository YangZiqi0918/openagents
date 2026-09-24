#!/usr/bin/env bash
# Package the OpenAgents Electron desktop app for Ubuntu arm64.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$ROOT/packages/launcher"
FRONTEND="$ROOT/workspace/frontend"
OUT="$ROOT/dist/edge-arm64/desktop"

for tool in node npm file sha256sum ar tar; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done
[ -x "$LAUNCHER/node_modules/.bin/electron-builder" ] || {
  echo 'Launcher dependencies missing; run npm ci in packages/launcher first.' >&2; exit 1
}
[ -x "$FRONTEND/node_modules/.bin/vite" ] || {
  echo 'Workspace dependencies missing; run npm ci in workspace/frontend first.' >&2; exit 1
}

(cd "$LAUNCHER" && npm run typecheck && npm run build)
mkdir -p "$OUT"
# Override only the Linux target; the repository default is x64.
(cd "$LAUNCHER" && ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://registry.npmmirror.com/-/binary/electron-builder-binaries/}" \
  ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://registry.npmmirror.com/-/binary/electron/}" \
  ./node_modules/.bin/electron-builder --linux deb --arm64 --publish never \
  -c.linux.target=deb -c.directories.output="$OUT")

VERSION="$(node -p "require('$LAUNCHER/package.json').version")"
deb="$OUT/OpenAgents-Launcher-$VERSION-linux-arm64.deb"
[ -f "$deb" ] || { echo "Missing expected package: $deb" >&2; exit 1; }
if command -v dpkg-deb >/dev/null; then
  arch="$(dpkg-deb -f "$deb" Architecture)"
else
  arch="$(ar p "$deb" control.tar.xz | tar -xJOf - ./control | sed -n 's/^Architecture: //p')"
fi
[ "$arch" = arm64 ] || { echo "Not an arm64 .deb: $deb" >&2; exit 1; }
file "$OUT/linux-arm64-unpacked/openagents-launcher" | grep -q 'ELF 64-bit.*ARM aarch64' || {
  echo 'Electron executable is not Linux arm64.' >&2; exit 1;
}
(cd "$OUT" && sha256sum "$(basename "$deb")" > "$(basename "$deb").sha256")
cp "$ROOT/scripts/install-linux-arm64-deb.sh" "$OUT/install-linux-arm64-deb.sh"
chmod +x "$OUT/install-linux-arm64-deb.sh"
(cd "$OUT" && sha256sum "$(basename "$deb")" install-linux-arm64-deb.sh > SHA256SUMS)
echo "Built: $deb"
echo "Delivery directory: $OUT (.deb, .sha256, installer)"
