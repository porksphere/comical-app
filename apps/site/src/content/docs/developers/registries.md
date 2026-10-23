---
title: Publishing a registry
description: A registry is an index.json and some bundles on any static host. How to make and sign one.
---

A registry is a static `index.json` plus the bridge bundles it points at, on any static host —
GitHub Pages, Cloudflare Pages, an S3 bucket, a folder behind nginx. Comical runs no central
registry; every one is somebody's.

## Publishing

From a checkout of the [comical](https://github.com/porksphere/comical) repo with your bridges
built:

```sh
# 1. A signing keypair. Keep the private key out of the repo.
bun run cli registry keygen --out registry.key.json

# 2. Build, then write the registry to ./dist
bun run build
bun run cli registry publish \
  --base-url https://my-github-user.github.io/my-bridges \
  --out ./dist \
  --key registry.key.json     # optional — unsigned registries are valid too

# 3. Deploy ./dist/ so that index.json is at the root of --base-url
```

The index lists each bridge with its id, version, contract version, languages, capabilities, the
bundle URL and its SHA-256. A signed index also carries the public key and a signature over the
whole thing.

## Trust

When a user adds your registry, Comical pins its public key. From then on every bundle is checked
against the index's hash and the index against the key, so a tampered bundle — or a hijacked host —
doesn't install. If you rotate keys, users are asked to confirm the new key before anything
installs again; tell them where the new key came from.

Moving a registry to a new URL keeps its installs if the new index claims the old URL as
`movedFrom` under the **same** key. That's what lets a user re-add a moved registry without a
confirmation.

## Being found

Add the [`comical-registry`](https://github.com/topics/comical-registry) topic to the GitHub repo
that hosts it. That page lists every tagged registry, most-starred first. Topics are self-applied —
they're discovery, not endorsement — so say in the repo's description what the registry carries,
and whether any of it is adult content.

## Keeping it current

Re-run `registry publish` and redeploy whenever a bridge changes; the app checks each added
registry for updates and offers them under **Settings → Bridges**. Bump a bridge's version for every
published change, or users' installed copies will never see it.
