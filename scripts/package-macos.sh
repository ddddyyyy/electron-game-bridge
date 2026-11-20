#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."

arch="${1:?Usage: bash scripts/package-macos.sh arm64|x64}"
case "$arch" in
  arm64|x64) ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac
version="$(node -p 'require("./package.json").version')"
electron_version=45.4.1
archive="electron-v${electron_version}-darwin-${arch}.zip"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

gh release download "v$electron_version" --repo electron/electron --dir "$work" \
  --pattern SHASUMS256.txt --pattern "$archive"
(cd "$work" && awk -v file="$archive" '$2 == file || $2 == "*" file' SHASUMS256.txt | shasum -a 256 -c -)

bundle="$work/Electron Game Bridge.app"
ditto -x -k "$work/$archive" "$work/extracted"
mv "$work/extracted/Electron.app" "$bundle"
resources="$bundle/Contents/Resources"
mkdir "$resources/app"
cp -R package.json main.js library-main.js library-preload.js adapters core ui "$resources/app/"
cp "$work/extracted/LICENSE" "$work/extracted/LICENSES.chromium.html" "$resources/"
rm -f "$resources/default_app.asar"

plist="$bundle/Contents/Info.plist"
bundle_id=io.github.ddddyyyy.electron-game-bridge
plutil -replace CFBundleIdentifier -string "$bundle_id" "$plist"
plutil -replace CFBundleName -string 'Electron Game Bridge' "$plist"
plutil -replace CFBundleDisplayName -string 'Electron Game Bridge' "$plist"
plutil -replace CFBundleVersion -string "$version" "$plist"
plutil -replace CFBundleShortVersionString -string "$version" "$plist"
mv "$bundle/Contents/MacOS/Electron" "$bundle/Contents/MacOS/Electron Game Bridge"
plutil -replace CFBundleExecutable -string 'Electron Game Bridge' "$plist"
for plist in "$bundle"/Contents/Frameworks/*.app/Contents/Info.plist; do
  helper_id="$(plutil -extract CFBundleIdentifier raw "$plist")"
  plutil -replace CFBundleIdentifier -string "$bundle_id.${helper_id#com.github.Electron.}" "$plist"
done

# shortcut: ad hoc signing until the project has a Developer ID and notarization credentials.
codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
test "$(lipo -archs "$bundle/Contents/MacOS/Electron Game Bridge")" = "$([ "$arch" = arm64 ] && echo arm64 || echo x86_64)"

mkdir -p dist
ditto -c -k --keepParent "$bundle" "dist/Electron-Game-Bridge-${version}-macos-${arch}.zip"
