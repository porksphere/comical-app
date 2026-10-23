---
title: Writing a bridge
description: What a bridge is made of, and where the SDK and its docs live.
---

A bridge is a TypeScript module that implements the `Bridge` interface from `@comical/sdk`: it
declares what it can do, and translates one backend — a server you run, a service, a site — into
the neutral model of series, chapters and pages. The runtime, the SDK and the full authoring guide
live in the [comical](https://github.com/porksphere/comical) repository; this page is the shape of
it.

## The shape

```ts
import { BridgeBase, defineBridge, defineSettings, type BridgeInfo, type InferSettings } from '@comical/sdk';

const SETTINGS = defineSettings([
  { type: 'string', key: 'baseUrl', label: 'Backend URL', required: true },
  { type: 'string', key: 'apiKey', label: 'API key', secret: true },
]);

class MyBridge extends BridgeBase<InferSettings<typeof SETTINGS>> {
  readonly info: BridgeInfo = {
    id: 'my-bridge',
    name: 'My Bridge',
    version: '0.1.0',
    contractVersion: '2.1.0',
    languages: ['en'],
    nsfw: false,
    capabilities: ['lists', 'settings'],
  };

  getSettings() {
    return [...SETTINGS];
  }

  async getLists() {
    return [{ id: 'new', name: 'New', layout: 'grid', featured: true }];
  }

  async getListItems(listId: string, page: number) {
    const $ = await this.fetchHtml(`${this.requireSetting('baseUrl')}/${listId}?page=${page}`);
    // ... map the page into { items, page, hasNextPage }
  }

  // getSeriesDetails, getChapters, getChapterPages; getSearchResults for the "search" capability
}

export default defineBridge((host) => new MyBridge(host));
```

## The rules

- **Never** use `fetch`, `XMLHttpRequest` or any platform API directly — only `this.request()`,
  `this.fetchHtml()` and `this.fetchJson()`. The sandbox has nothing else, and that's how the app
  rate-limits, logs and isolates every bridge the same way.
- **Never** hard-code a backend URL. Read it from a setting; the user supplies it.
- Image URLs must be absolute.
- Declare every capability you implement in `info.capabilities`, and only those.

## Testing

The core repo's CLI runs a bridge without the app:

```sh
bun run cli test --bridge my-bridge --set baseUrl=https://your-backend.example.com
bun run cli conformance --bridge my-bridge   # the strict gate the registry publisher runs
```

The conformance report lists which contract methods work and which are missing, which is also
what decides the capabilities a registry advertises for it.

## Publishing

A bridge reaches users through a registry — yours, or one that accepts contributions. See
[Publishing a registry](../registries/). Bridge source repositories on GitHub use the
[`comical-bridge`](https://github.com/topics/comical-bridge) topic.
