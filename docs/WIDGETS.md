# Home-screen widgets

What the widgets are, what a platform's implementation must do, and what it may not decide for
itself. Both platforms have them: iOS in `apps/mobile/targets/widgets`, Android in
`apps/mobile/modules/home-widgets/android`.

## What is shared and what can't be

Everything up to the drawing is one implementation, in the app's JS, and is already
platform-neutral:

| Layer | Where | Shared |
| --- | --- | --- |
| Which rows, their text, their links, the NSFW rule | `src/data/home-widgets/feed.ts` | Yes |
| Fetching, cover rendering, when to write | `src/data/home-widgets/publish.ts` | Yes |
| The feed on disk | `snapshot.json` + `covers/` (below) | Yes, as a file format |
| Storing the feed and asking for a redraw | `modules/home-widgets` | One JS API, one native implementation per platform |
| Drawing the widget | WidgetKit + SwiftUI (iOS), Jetpack Glance (Android) | No |

The drawing can't be shared. A widget is not a React Native view on either platform: iOS draws an
archived SwiftUI view in the system's process, and Android draws `RemoteViews` in the launcher's.
Expo's `expo-widgets` doesn't change that. Its layouts are written in JS, but from two different
component sets (`@expo/ui/swift-ui` and `@expo/ui/jetpack-compose`), so a widget is still laid out
once per platform. It is also ruled out here on other grounds: on iOS it reads the App Group from a
fixed Info.plist key, which a sideload signer's renamed group breaks (AGENTS.md → "Home-screen
widgets"), and its config plugin adds its iOS extension whenever the app has a bundle identifier,
so it can't be taken for Android alone.

So the widgets are specified here instead, and each platform draws to the specification.

## The rule both platforms keep

**A widget decides nothing.** It draws the rows it is handed, in the order it is handed them, with
the text it is handed, and a tap opens the link it is handed. It does not filter, sort, word or
build a link. Those are decided once, in `feed.ts`, from the helpers the History and Activity tabs'
own rows use, which is what keeps a widget's row and the tab's from disagreeing.

What a widget does own: its layout per size, the wording of a row's age (it changes as time
passes, with no publish), its empty state, and the fixed strings in the table under "The widgets".

A widget makes no network request and reads nothing but the feed.

## The feed

A folder named `Widgets`, in storage the widget can read (iOS: the App Group container; Android:
the app's files directory, which a widget's receiver shares with the app).

```
Widgets/
  snapshot.json
  covers/<name>.jpg
```

`snapshot.json`:

```json
{
  "history": [
    {
      "id": "bridge:series",
      "title": "Series title",
      "detail": "Chapter 7  ·  5 / 20",
      "at": 1731300000000,
      "progress": 0.25,
      "cover": "0a1b2c3d4e5f60718293a4b5.jpg",
      "url": "comical://series?id=…"
    }
  ],
  "activity": []
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique within its list. For identity only, never shown. |
| `title` | The series' title. |
| `detail` | The row's second line, complete. May be empty. |
| `at` | When the row last moved, in milliseconds since 1970: last read (history), newest detection (activity). The widget words the age. |
| `progress` | Optional. Pages seen of the chapter being read, 0 to 1. History rows only, and only when the page count is known. |
| `cover` | Optional. A file name in `covers/`. Present only once that file has been stored, so a named cover can be assumed to exist. |
| `url` | What a tap opens. Opaque to the widget. |

Each list is newest first and holds at most 5 rows (`WIDGET_ROWS`), the most any layout shows. A
missing or unreadable file means nothing has been published yet and is drawn as the empty state.
A field added later must be optional, so a widget from an older build still reads the file.

Covers are JPEGs at a book's shape, 2:3, at most 400 × 600 pixels, already cropped. A widget's
process has little memory on both platforms: draw them at the size shown, never larger.

## The module

`modules/home-widgets` is the feed's only writer. A platform implements four functions:

| Function | Contract |
| --- | --- |
| `isAvailable()` | Whether the folder can be opened. False makes every publish a no-op. |
| `covers()` | The file names in `covers/`. |
| `storeCover(name, uri)` | Copy the image at `uri` to `covers/<name>`. |
| `publish(snapshot, covers)` | Delete every stored cover not named in `covers`. Write `snapshot` if it differs from the file there, and only then ask the system to redraw the widgets. Resolves to whether it wrote. |

The comparison in `publish` matters on iOS, where a redraw asked for from the background comes out
of a daily budget. Both platforms keep it so the two behave alike.

The feed is published when the app is left and at the end of a background chapter check. Nothing
else writes it, and a platform adds no trigger of its own.

## The widgets

| | Continue Reading | New Chapters |
| --- | --- | --- |
| List | `history` | `activity` |
| Rows | The History tab's newest, minus rows swiped out of it | The Activity tab's rows with a chapter still unread |
| A tap on a row | Carries on reading where the series was left | Reads the row's newest unread chapter |
| Gallery description | Pick up the series you read last. | New chapters of the series in your library. |
| Empty message | Series you read show up here. | No new chapters. |
| A tap when empty | `comical://history` | `comical://activity` |

Both come in the same three layouts. iOS has a fixed size for each. Android widgets are resized
freely, so there the layout follows the room given: Feature under 250dp wide, Strip from there
while under 250dp tall, List beyond that.

- **Feature** (the smallest size): the first row alone. Its cover fills the widget under a dark
  gradient rising from the bottom edge, with the title (two lines at most) and `detail` (one line)
  in white at the bottom, and the progress bar under them when the row has one. The whole widget is
  the tap target.
- **Strip** (the wide size): the first four rows as covers side by side, each with its title and
  `detail` on one line apiece beneath. A feed of fewer than four keeps the covers the size four
  would have, from the leading edge. Each cover and its text is a tap target.
- **List** (the large size): the widget's name as a heading, then up to five rows of a small
  cover, the title over `detail`, and the row's age at the trailing edge. Each row is a tap target.

In every layout:

- A row without a `cover` draws a neutral tile with the title's first letter.
- A row with `progress` draws a thin bar along the bottom edge of its cover (in Feature, under
  the text).
- The empty state is the widget's name over its empty message, centred.
- Outside Feature, colours are the system's own for a widget in light and dark.

NSFW is handled before the feed is written: rows of an NSFW bridge are left out unless the stored
setting shows them. A session override never applies, since it ends as the app is left and the
widget is what is on screen after that. A widget does not need to know any of this.

## iOS

Built. A WidgetKit extension in Swift; the three layouts are the `systemSmall`, `systemMedium` and
`systemLarge` families. The App Group, how it is found under a sideload signer, and the packaging
step that makes one possible are in AGENTS.md → "Home-screen widgets".

## Android

Jetpack Glance, in Kotlin, in the `android/` directory of `modules/home-widgets`. The module's
manifest declares the two receivers and is merged into the app's, so there is no config plugin.

- **The feed** is `Widgets/` under the app's files directory. A widget's receiver runs in the
  app's own process, so there is no shared container to find and `isAvailable()` is always true.
- **Sizes:** `SizeMode.Exact`, the widget's real size. Nothing in a widget can hold a cover to its
  shape, so each layout works its covers' sizes out from the room there is. A new widget is four
  cells by two, the Strip.
- **Redrawing:** `publish` ends in `updateAll` on each widget. Glance does not reload a widget it
  is already running, so the feed is also re-read on a counter that `publish` moves
  (`WidgetStore.version`).
- **Ages:** Glance has no text that counts on its own, so the age is worded when the widget is
  drawn, and `updatePeriodMillis` (thirty minutes, the least Android allows) redraws it.
- **Covers:** decoded down to about the size drawn, and the same bitmap is used wherever a cover
  appears. `RemoteViews` carries bitmaps to the launcher by value and rejects an update whose
  bitmaps are too large in total.
- **Colours** are the system's dynamic ones (`GlanceTheme`), and the launcher rounds the widget
  itself on Android 12 and later. Earlier versions draw it and its covers square.
- **Taps** start an `ACTION_VIEW` intent on the row's `url`, which the app's own `comical` scheme
  receives.

One class per widget (`HistoryWidget`, `ActivityWidget`), never one class given a feed: Glance
finds a widget's instances by its class, and two receivers sharing one would each be updated with
the other's feed.
