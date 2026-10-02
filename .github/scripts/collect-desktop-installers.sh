#!/usr/bin/env bash
# Renames the installers electron-builder produced (one flattened download of every
# `comical-desktop-*` artifact) to the fixed names every desktop download link uses:
#
#   comical-desktop-setup.exe  comical-desktop-x86_64.AppImage  comical-desktop-amd64.deb
#
# electron-builder puts the version in the filename, which would move a rolling channel's URL on
# every build and give each vX.Y.Z Release differently-shaped links from its IPA and APK.
#
# Usage: collect-desktop-installers.sh <dir>
set -euo pipefail

DIR="${1:?usage: collect-desktop-installers.sh <dir>}"

# Globs, not `find | head` — under `pipefail` a SIGPIPE from the closed pipe fails the step.
# electron-builder emits exactly one of each (it cleans up the temporary __uninstaller.exe, and the
# .blockmap doesn't match *.exe).
shopt -s nullglob
exes=("$DIR"/*.exe)
apps=("$DIR"/*.AppImage)
debs=("$DIR"/*.deb)
[ ${#exes[@]} -eq 1 ] || { echo "::error::expected exactly 1 .exe, found ${#exes[@]}"; exit 1; }
[ ${#apps[@]} -eq 1 ] || { echo "::error::expected exactly 1 .AppImage, found ${#apps[@]}"; exit 1; }
[ ${#debs[@]} -eq 1 ] || { echo "::error::expected exactly 1 .deb, found ${#debs[@]}"; exit 1; }

move() { [ "$1" = "$2" ] || mv "$1" "$2"; }
move "${exes[0]}" "$DIR/comical-desktop-setup.exe"
move "${apps[0]}" "$DIR/comical-desktop-x86_64.AppImage"
move "${debs[0]}" "$DIR/comical-desktop-amd64.deb"
