/**
 * Runs web checks (`data/web-check.ts`) on the phone, the way Aidoku does: the site's page loads
 * in a web view no one can see, with the challenged request's own User-Agent, so a check that needs
 * no person passes on its own. If it needs one, the same view comes up full screen, so nothing
 * reloads. It's done when a clearance cookie changes from its value before the check (or the person
 * says so), and the site's cookies go back to be imported. A challenge that names page storage
 * keys is done once they're all set instead, and their values go back too. Mounted once at the root.
 */
import { observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  type Challenge,
  clearanceChanged,
  clearanceOf,
  cookiesFromHeader,
  registerWebCheckRunner,
  storageComplete,
  storageReadScript,
  storageValues,
  type WebCheckOptions,
  type WebCheckResult,
  webViewUserAgent,
} from '@/data/web-check';
import { useTheme } from '@/hooks/use-theme';
import { platformUserAgent } from '../../modules/comical-runtime';
import webCookies from '../../modules/web-cookies';

const POLL_MS = 1000;
/** How long a check runs out of sight before the person is shown it. */
const HIDDEN_MS = 7000;
/** How long a quiet check runs out of sight before it gives up (it is never shown). */
const QUIET_MS = 15000;

// Cloudflare's challenge page reports its progress with `postMessage`; `interactiveBegin` means it
// is waiting on a person (the signal Mihon reads too).
const LISTENER = `addEventListener("message", function (e) {
  var d = e && e.data;
  if (d && d.source === "cloudflare-challenge" && window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ challengeEvent: d.event }));
  }
});
true;`;

/**
 * For a challenge that names page storage keys: report them as the document starts (before the
 * site's own script runs, so a value left from an earlier visit counts as "before") and every
 * second after.
 */
function storageWatcher(keys: readonly string[]): string {
  const read = storageReadScript(keys);
  return `(function () {
  function send(kind) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ [kind]: ${read} })); }
  send("storageBefore");
  setInterval(function () { send("storage"); }, ${POLL_MS});
})();
true;`;
}

type Active = { id: number; challenge: Challenge; quiet: boolean; revealed: boolean };

const active$ = observable<Active | null>(null);
const queue: { challenge: Challenge; quiet: boolean; resolve: (r: WebCheckResult) => void }[] = [];
let settle: ((r: WebCheckResult) => void) | null = null;
let nextId = 1;

function startNext(): void {
  if (active$.peek() || queue.length === 0) return;
  const job = queue.shift()!;
  settle = (r) => {
    settle = null;
    active$.set(null);
    job.resolve(r);
    startNext();
  };
  active$.set({ id: nextId++, challenge: job.challenge, quiet: job.quiet, revealed: false });
}

function runOnPhone(challenge: Challenge, { quiet = false }: WebCheckOptions): Promise<WebCheckResult> {
  return new Promise((resolve) => {
    queue.push({ challenge, quiet, resolve });
    startNext();
  });
}

export function WebCheckHost() {
  useEffect(() => (webCookies ? registerWebCheckRunner(runOnPhone) : undefined), []);
  // Field by field through `useSelector` (the compiler's name for a hook; `use$` isn't one to it),
  // so each change renders: an object read whole was cached by the compiler on its first null.
  const id = useSelector(() => active$.id.get() ?? 0);
  const challenge = useSelector(() => active$.challenge.get());
  const quiet = useSelector(() => active$.quiet.get() ?? false);
  const revealed = useSelector(() => active$.revealed.get() ?? false);
  if (!id || !challenge || !webCookies) return null;
  return <CheckView key={id} check={{ id, challenge, quiet, revealed }} />;
}

function CheckView({ check }: { check: Active }) {
  const theme = useTheme();
  const before = useRef<Map<string, string> | null>(null);
  const storageBefore = useRef<Record<string, string> | null>(null);
  const storageNow = useRef<Record<string, string>>({});
  const { url, userAgent, storage = [] } = check.challenge;
  // Left alone when the bridge already sends the web view's own User-Agent (see webViewUserAgent).
  const override = webViewUserAgent(userAgent, platformUserAgent());

  const finish = async (force: boolean): Promise<void> => {
    if (!webCookies || !settle || before.current === null) return;
    const header = await webCookies.getCookies(url);
    const values = storageNow.current;
    const through = storage.length
      ? storageBefore.current !== null && storageComplete(storage, storageBefore.current, values)
      : clearanceChanged(before.current, clearanceOf(header));
    if (!force && !through) return;
    settle?.({
      cookies: cookiesFromHeader(header, url),
      ...(userAgent ? { userAgent } : {}),
      ...(storage.length && Object.keys(values).length ? { values } : {}),
    });
  };
  // A quiet check is never put in front of the person: where it would be shown, it gives up, and
  // the check waits for them (`waitingChecks$`).
  const reveal = () => {
    if (!active$.peek()) return;
    if (check.quiet) settle?.(null);
    else active$.revealed.set(true);
  };

  useEffect(() => {
    let live = true;
    void webCookies?.getCookies(url).then((header) => {
      if (live) before.current = clearanceOf(header);
    });
    const poll = setInterval(() => void finish(false), POLL_MS);
    const show = setTimeout(reveal, check.quiet ? QUIET_MS : HIDDEN_MS);
    return () => {
      live = false;
      clearInterval(poll);
      clearTimeout(show);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one check per mount: the host keys this view by the check's id
  }, []);

  const web = (
    <WebView
      source={{ uri: url }}
      // Cloudflare's widget runs in an `about:srcdoc` frame; the default (http/https only) hands any
      // other URL to the system to open, which breaks the check.
      originWhitelist={['*']}
      {...(override ? { userAgent: override } : {})}
      injectedJavaScriptBeforeContentLoaded={storage.length ? `${LISTENER}\n${storageWatcher(storage)}` : LISTENER}
      onMessage={(e) => {
        let msg: {
          challengeEvent?: string;
          storageBefore?: string;
          storage?: string;
        };
        try {
          msg = JSON.parse(e.nativeEvent.data) as typeof msg;
        } catch {
          return; // Not our message.
        }
        if (msg.challengeEvent === 'interactiveBegin') reveal();
        // Only the first document's start is "before"; a page the check moves on to may already hold the values.
        if (msg.storageBefore !== undefined) {
          storageBefore.current ??= storageValues(msg.storageBefore);
          storageNow.current = {
            ...storageNow.current,
            ...storageValues(msg.storageBefore),
          };
        }
        if (msg.storage !== undefined) {
          storageNow.current = storageValues(msg.storage);
          void finish(false);
        }
      }}
      onNavigationStateChange={(): void => {
        void finish(false);
      }}
      setSupportMultipleWindows={false}
      thirdPartyCookiesEnabled
      style={styles.web}
    />
  );

  // Out of sight first, so a check that needs no person passes on its own.
  if (!check.revealed) {
    return (
      <View style={styles.hidden} pointerEvents="none">
        {web}
      </View>
    );
  }

  // Then a native page sheet, like the sign-in sheet: it slides up, swipes down to cancel, and the
  // check starts again in it (moving the web view into the sheet reloads it).
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => settle?.(null)}>
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={[styles.bar, { borderColor: theme.backgroundSelected }]}>
          <Pressable testID="web-check.cancel" onPress={() => settle?.(null)} hitSlop={12} style={styles.barSide}>
            <ThemedText style={{ color: theme.accent }}>Cancel</ThemedText>
          </Pressable>
          <View style={styles.titles}>
            <ThemedText type="smallBold" numberOfLines={1}>
              Quick check
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {hostOf(url)}
            </ThemedText>
          </View>
          <Pressable testID="web-check.done" onPress={() => void finish(true)} hitSlop={12} style={[styles.barSide, styles.barEnd]}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              Done
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          This site wants to make sure you’re a person before it shows anything. Complete the check below; this closes by itself once you’re
          through.
        </ThemedText>
        {web}
      </View>
    </Modal>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  // Laid out and running, but nowhere to be seen: a zero-size or unmounted web view doesn't run the page.
  hidden: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 2,
    height: 2,
    opacity: 0,
  },
  sheet: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barSide: { minWidth: 64 },
  barEnd: { alignItems: 'flex-end' },
  titles: { flex: 1, alignItems: 'center' },
  note: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    textAlign: 'center',
  },
  web: { flex: 1 },
});
