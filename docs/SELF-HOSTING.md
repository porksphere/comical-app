# Self-hosting the web app

The web build runs as two containers:

- **`comical-app-web`** is the app itself, a static bundle served by nginx.
- **`comical-host`** is the backend (`@comical/host-server`), which runs the bridges.

Both are needed. Only the web build uses them; the iOS and Android apps run bridges on-device.

## Docker compose

```yaml
services:
  comical-host:
    image: ghcr.io/porksphere/comical-host:latest
    container_name: comical-host
    environment:
      - COMICAL_ORIGIN=*
      # - COMICAL_TOKEN=change-me   # optional bearer auth
    volumes:
      - ./comical-host:/data
    ports:
      - 3100:3100
    restart: unless-stopped

  comical-app-web:
    image: ghcr.io/porksphere/comical-app-web:latest
    container_name: comical-app-web
    environment:
      - COMICAL_SERVER=http://localhost:3100
    ports:
      - 3300:80
    depends_on:
      - comical-host
    restart: unless-stopped
```

`docker compose up -d`, then open <http://localhost:3300>.

The backend bundles no bridges. Once the stack is up, add a registry in the app's **Settings**
and install the bridges you want from it.

## Configuration

| Variable | Service | What it does |
|----------|---------|--------------|
| `COMICAL_SERVER` | app | Backend URL, injected into every page at container start. |
| `COMICAL_ORIGIN` | backend | Origin allowed to call the backend (CORS). `*` allows any. |
| `COMICAL_TOKEN` | backend | Optional bearer token required on every request. |

`COMICAL_SERVER` is the URL the **browser** resolves, not the compose service name: the browser
runs on the user's machine, outside the compose network, so `http://comical-host:3100` will not
work. Because it is injected at container start rather than baked in, one image can point at any
backend without a rebuild. Users can also override it per-device in the app's **Settings**.

Leave `COMICAL_TOKEN` unset for a normal deployment. The app has no field for a bearer token, so
setting one locks the app out of its own backend; it exists for calling the backend directly.

The backend's `/data` volume holds your library, settings, and installed bridges. Keep it.

## Beyond a local trial

Front both services with a reverse proxy and TLS, then:

- set `COMICAL_SERVER` to the backend's public URL (`https://comical-api.example.com`),
- set `COMICAL_ORIGIN` to the app's public origin (`https://comical.example.com`) instead of `*`,
- drop the `ports:` mappings if the proxy shares a network with the containers.

## Image tags

`latest` and `sha-<commit>` follow the default branch. `X.Y.Z` and `X.Y` are cut from `v*` git
tags. Pin a version if you would rather upgrade deliberately.

To build either image, or run the backend from source, see [DEVELOPMENT.md](DEVELOPMENT.md).
