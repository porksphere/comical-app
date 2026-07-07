#!/bin/sh
# Injected into the nginx:alpine image as /docker-entrypoint.d/40-inject-comical-server.sh — the base
# image runs every script here at container start, before launching nginx. So this only injects the
# backend URL and returns; nginx is started by the base entrypoint afterwards.
#
# Expo static export emits one prerendered .html per route. We write window.__COMICAL_SERVER__ into
# each <head> (before the app bundle) so apps/mobile/src/data/api.ts reads it at runtime. Idempotent:
# any previously injected snippet is stripped first, so container restarts don't stack scripts.
set -e

ROOT=/usr/share/nginx/html

# Strip any prior injection (keeps <head> intact — matches only our own <script> tag).
find "$ROOT" -name '*.html' -exec \
  sed -i 's#<script>window.__COMICAL_SERVER__=[^<]*</script>##g' {} +

if [ -z "$COMICAL_SERVER" ]; then
  echo "comical-app-web: COMICAL_SERVER not set — using the app's baked default / in-app Settings."
  exit 0
fi

# Escape sed replacement metacharacters in the URL value (&, |, \).
esc=$(printf '%s' "$COMICAL_SERVER" | sed -e 's/[&|\\]/\\&/g')
snippet="<script>window.__COMICAL_SERVER__=\"${esc}\";</script>"

find "$ROOT" -name '*.html' -exec sed -i "s|<head>|<head>${snippet}|" {} +

count=$(find "$ROOT" -name '*.html' | wc -l)
echo "comical-app-web: injected backend URL '$COMICAL_SERVER' into ${count} page(s)."
