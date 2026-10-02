#!/usr/bin/env bash
# Checks one flattened download of every `comical-desktop-*` artifact holds exactly what a desktop
# release publishes: the installers under the fixed names every download link uses, and the update
# feeds electron-updater reads.
#
#   comical-desktop-setup.exe  comical-desktop-x86_64.AppImage  comical-desktop-amd64.deb
#   latest.yml  latest-linux.yml
#
# electron-builder.yml names them, not this script: a feed records the file name it was written
# for, so renaming an installer afterwards would point the updater at a file that isn't there.
#
# Usage: collect-desktop-installers.sh <dir>
set -euo pipefail

DIR="${1:?usage: collect-desktop-installers.sh <dir>}"

for f in comical-desktop-setup.exe comical-desktop-x86_64.AppImage comical-desktop-amd64.deb \
  latest.yml latest-linux.yml; do
  [ -f "$DIR/$f" ] || { echo "::error::$f missing from the desktop artifacts"; ls -la "$DIR"; exit 1; }
done
# The feed has to name the file it sits beside, or the updater 404s.
grep -q 'url: comical-desktop-setup.exe' "$DIR/latest.yml" \
  || { echo "::error::latest.yml doesn't point at comical-desktop-setup.exe"; cat "$DIR/latest.yml"; exit 1; }
grep -q 'url: comical-desktop-x86_64.AppImage' "$DIR/latest-linux.yml" \
  || { echo "::error::latest-linux.yml doesn't point at comical-desktop-x86_64.AppImage"; cat "$DIR/latest-linux.yml"; exit 1; }
