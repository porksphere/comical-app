# comical-app-web — the Expo static web export, served by nginx.
# Published as ghcr.io/porksphere/comical-app-web.
#
# The web app has no on-device runtime: it talks to a hosted @comical/host-server. Because Expo
# inlines EXPO_PUBLIC_* at export time, the backend URL is NOT baked here — the runtime entrypoint
# injects window.__COMICAL_SERVER__ from the COMICAL_SERVER env var (see docker-entrypoint.sh and
# apps/mobile/src/data/api.ts). One image, re-pointable at `docker run`.

# ── Stage 1: build the static web bundle (needs Node for Metro + Bun for install/scripts) ─────────
# Pin to the native build platform: the web export is architecture-neutral static files, so Metro
# runs ONCE on the runner's native arch (no slow emulated arm64 bundling) and both target images
# reuse its output — only the nginx runtime stage below varies per arch.
FROM --platform=$BUILDPLATFORM node:20-bookworm AS builder

# Bun (the repo's package manager); the official npm package fetches the platform binary.
RUN npm install -g bun

WORKDIR /build

# Install deps first (cached until manifests change). The external/comical submodule is type-only
# (tsconfig paths, erased by Metro) and not a workspace member, so a web export doesn't need it.
COPY package.json bun.lock ./
COPY apps/mobile/package.json apps/mobile/
# apps/mobile's postinstall (verify-react-versions.js) runs during install, so its scripts/ must exist.
COPY apps/mobile/scripts/ apps/mobile/scripts/
COPY packages/ packages/
RUN bun install --frozen-lockfile

# App source + the comical submodule (metro.config.js resolves @comical/* to external/comical/packages,
# and src/data/embedded imports @comical/host-rn, so the web export needs it on disk).
COPY apps/ apps/
COPY external/ external/
# The submodule's own leaf deps (zod, hono, cheerio) — metro.config nodeModulesPaths points Metro at
# external/comical/node_modules for the @comical/* packages' imports. (Non-frozen: this repo's lock
# can drift from its package.json; let the build reconcile rather than fail.)
RUN cd external/comical && bun install

# Serve at the domain root: SDK 56 reads the web base path only from app.json experiments.baseUrl
# (EXPO_BASE_URL is ignored), and the repo pins it to /comical-app for GitHub Pages. Patch it to ""
# so the Docker build references root-relative assets. (Node is already present in this stage.)
RUN node -e "const f='apps/mobile/app.json';const j=require('./'+f);j.expo.experiments.baseUrl='';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"

# Real build — NOT demo mode (that flag is only for the backend-less GitHub Pages preview).
WORKDIR /build/apps/mobile
RUN bunx expo export --platform web
# → /build/apps/mobile/dist

# ── Stage 2: serve the static export ──────────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /build/apps/mobile/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-inject-comical-server.sh
RUN chmod +x /docker-entrypoint.d/40-inject-comical-server.sh

EXPOSE 80
# nginx:alpine's own entrypoint runs every executable in /docker-entrypoint.d/ before starting nginx,
# so our injection script runs at container start, then the base image launches nginx.
