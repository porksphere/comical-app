/**
 * Stable, cross-platform test identifiers for UI automation.
 *
 * React Native's built-in `testID` prop is the one selector that resolves on every target
 * platform without a custom attribute:
 *   - iOS     → `accessibilityIdentifier` (XCUITest / Appium / Detox)
 *   - Android → resource-id / view tag     (UiAutomator2 / Appium / Detox)
 *   - web     → `data-testid` on the DOM node, via react-native-web (Playwright / Cypress)
 *
 * So one `testID` string is selectable from Maestro, Detox, Appium, and Playwright alike — never
 * hand-roll a `data-testid` or platform-specific id.
 *
 * ## Convention
 *
 * Dot-namespaced, kebab-case, `area.element[.qualifier]`, stable and human-readable:
 *   - `tab.browse`, `browse.search-input`, `series.action.read`, `reader.control.next`
 *   - `settings.toggle.mock-data`, `settings.row.appearance`
 *
 * Data-driven list items suffix a **stable domain id** — never an array index or the display
 * text (labels can collide and rows rebuild whole, so neither is a durable locator):
 *   - `browse.series-card.<seriesId>`, `series.chapter.<chapterId>`
 *
 * Prefer writing the literal string inline at the call site — it stays greppable and next to the
 * element. Reach for {@link testId} only when the id is composed from runtime values, so the
 * join + slug rules live in exactly one place.
 */

/** A cross-platform test identifier (see the module doc for the naming convention). */
export type TestId = string;

/** Characters allowed in a slugged id segment. Anything else becomes a hyphen so a stray label
 *  character (a slash, a colon, whitespace) can never produce a selector that's invalid in
 *  `data-testid` / `accessibilityIdentifier` / Maestro / XPath. Dots are the segment separator
 *  and are added by the join, so they're stripped from within a segment. */
const slugSegment = (part: string | number): string =>
  String(part)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-') // collapse runs of disallowed chars (incl. dots, whitespace) to one hyphen
    .replace(/^-+|-+$/g, ''); // no leading/trailing hyphens

/**
 * Compose a {@link TestId} from parts, joined with `.`, each part slugged to `[a-z0-9-]`.
 *
 * Use for ids built from runtime values — a series id, a tag label — so every composed id follows
 * the same rules. For a fully static id, just write the string literal.
 *
 * @example
 * testId('browse.series-card', entry.id) // → "browse.series-card.abc-123"
 * testId('series.chapter', chapter.id)   // → "series.chapter.0-42"
 */
export const testId = (...parts: (string | number)[]): TestId =>
  parts
    .flatMap((p) => String(p).split('.')) // let callers pass an already-dotted prefix
    .map(slugSegment)
    .filter(Boolean)
    .join('.');
