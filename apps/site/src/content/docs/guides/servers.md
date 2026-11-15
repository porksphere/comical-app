---
title: Your own servers
description: Reading from your own Komga, Kavita, Suwayomi or LANraragi server, or any OPDS catalog.
---

If you already keep a library on a server of your own, Comical can read straight from it. The
bridges for that live in one official registry,
[comical-opds-bridges](https://github.com/porksphere/comical-opds-bridges).

[Add the registry](../../demo/add-registry?url=https%3A%2F%2Fraw.githubusercontent.com%2Fporksphere%2Fcomical-opds-bridges%2Fmain%2Findex.json),
or paste its address under **Settings → Bridges → Add registry**:

```
https://raw.githubusercontent.com/porksphere/comical-opds-bridges/main/index.json
```

Then install the bridge for your server and open its settings. Every one asks for the server's
address, as you'd open it in a browser (`http://192.168.1.5:25600`), and has a **Test connection**
button that tells you whether it got in.

| Server | Signs in with | Reading syncs back |
|---|---|---|
| Komga | an API key, or your email and password | ✓ |
| Kavita | an API key, or the OPDS URL from Kavita | ✓ |
| Suwayomi | nothing, or a username and password | ✓ |
| LANraragi | nothing, or the API key | ✓ |
| Any OPDS catalog | a username and password, if it asks | — |

Where reading syncs, finishing something in Comical marks it read on the server, and what you read
elsewhere shows up as read the next time your library refreshes.

## Komga

Use **Komga** rather than OPDS: it shows covers, details and progress that Komga's OPDS feed leaves
out. It needs Komga 1.19 or later.

- **API key:** in Komga, **Account settings → API keys**. Or sign in with your email and password.
- The account needs Komga's **Page streaming** role to open books.
- Lists: Keep reading and On deck (once there's something in them), Recently added, Recently
  updated, then each library and collection.

## Kavita

- **API key:** in Kavita, **User settings → Auth keys**. Or paste Kavita's **OPDS URL** as the
  server address: the key comes with it.
- Chapters keep Kavita's order: volumes, loose chapters, then specials. PDFs open page by page;
  text EPUBs can't be read here.

## Suwayomi

- Leave the username and password empty if Suwayomi has no sign-in. With **Basic auth** or **UI
  login** turned on, enter its username and password. **Simple login** only works in a browser:
  switch Suwayomi to one of the other two to sign in from Comical.
- Lists: Recently updated and your library (one list per category) once they have something in
  them, then each installed source, Local source first. A source's list searches that source.
- Search looks through your library and up to eight sources at once.

## LANraragi

LANraragi is marked as an adult source, since that's what most libraries on it hold, so it shows
only where adult sources are allowed.

- Each archive is one book, with no chapters.
- An open server reads without a key. Add the **API key** (LANraragi: **Settings → Security**) if
  it runs in No-Fun Mode, and to sync reading progress.
- Search takes LANraragi's own syntax, such as `artist:someone`.

## Any OPDS catalog

The **OPDS** bridge reads any OPDS 1.x catalog that streams pages (OPDS-PSE): Komga, Kavita, Codex,
Stump, Ubooquity and more. Use the catalog's own address, as the server's settings show it.

- A book the server only offers as a whole-file download is listed, but can't be opened.
- OPDS has no way to send reading progress back, so nothing syncs.

## Reaching your server

Comical connects over plain `http://` as well as `https://`, so a server on your home network or
over [Tailscale](https://tailscale.com) works as it is. A bridge's settings warn you when your
password or key would cross the internet unencrypted: plain `http://` to a server outside your
home network and Tailscale. Use an `https://` address for those.

A server with a certificate your phone doesn't trust needs its certificate authority installed on
the device: see [My server uses its own certificate](../../troubleshooting/#my-server-uses-its-own-certificate).
