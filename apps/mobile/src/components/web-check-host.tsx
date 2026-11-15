/**
 * Runs web checks (`data/web-check.ts`) on the phone, the way Aidoku does: the site's page loads
 * in a web view no one can see, with the challenged request's own User-Agent, so a check that needs
 * no person passes on its own. If it needs one, the same view comes up full screen, so nothing
 * reloads. It's done when a clearance cookie changes from its value before the check (or the person
 * says so), and the site's cookies go back to be imported. A challenge that names page storage
 * keys is done once they're all set instead, and their values go back too. Mounted once at the root.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  type WebCheckResult,
} from '@/data/web-check';
import { useTheme } from '@/hooks/use-theme';
import webCookies from '../../modules/web-cookies';

const POLL_MS = 1000;
/** How long a check runs out of sight before the person is shown it. */
const HIDDEN_MS = 7000;

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

type Active = { id: number; challenge: Challenge; revealed: boolean };

const active$ = observable<Active | null>(null);
const queue: { challenge: Challenge; resolve: (r: WebCheckResult) => void }[] = [];
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
  active$.set({ id: nextId++, challenge: job.challenge, revealed: false });
}

function runOnPhone(challenge: Challenge): Promise<WebCheckResult> {
  return new Promise((resolve) => {
    queue.push({ challenge, resolve });
    startNext();
  });
}

export function WebCheckHost() {
  useEffect(() => (webCookies ? registerWebCheckRunner(runOnPhone) : undefined), []);
  const check = use$(active$);
  if (!check || !webCookies) return null;
  return <CheckView key={check.id} check={check} />;
}

function CheckView({ check }: { check: Active }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const before = useRef<Map<string, string> | null>(null);
  const storageBefore = useRef<Record<string, string> | null>(null);
  const storageNow = useRef<Record<string, string>>({});
  const { url, userAgent, storage = [] } = check.challenge;

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
  const reveal = () => {
    if (active$.peek()) active$.revealed.set(true);
  };

  useEffect(() => {
    let live = true;
    void webCookies?.getCookies(url).then((header) => {
      if (live) before.current = clearanceOf(header);
    });
    const poll = setInterval(() => void finish(false), POLL_MS);
    const show = setTimeout(reveal, HIDDEN_MS);
    return () => {
      live = false;
      clearInterval(poll);
      clearTimeout(show);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one check per mount: the host keys this view by the check's id
  }, []);

  return (
    <View
      style={check.revealed ? [styles.sheet, { backgroundColor: theme.background }] : styles.hidden}
      pointerEvents={check.revealed ? 'auto' : 'none'}>
      {check.revealed && (
        <View style={[styles.bar, { paddingTop: Math.max(insets.top, Spacing.two), borderColor: theme.backgroundSelected }]}>
          <Pressable testID="web-check.cancel" onPress={() => settle?.(null)} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              Cancel
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            {hostOf(url)}
          </ThemedText>
          <Pressable testID="web-check.done" onPress={() => void finish(true)} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              Done
            </ThemedText>
          </Pressable>
        </View>
      )}
      <WebView
        source={{ uri: url }}
        {...(userAgent ? { userAgent } : {})}
        injectedJavaScriptBeforeContentLoaded={storage.length ? `${LISTENER}\n${storageWatcher(storage)}` : LISTENER}
        onMessage={(e) => {
          let msg: { challengeEvent?: string; storageBefore?: string; storage?: string };
          try {
            msg = JSON.parse(e.nativeEvent.data) as typeof msg;
          } catch {
            return; // Not our message.
          }
          if (msg.challengeEvent === 'interactiveBegin') reveal();
          // Only the first document's start is "before"; a page the check moves on to may already hold the values.
          if (msg.storageBefore !== undefined) {
            storageBefore.current ??= storageValues(msg.storageBefore);
            storageNow.current = { ...storageNow.current, ...storageValues(msg.storageBefore) };
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
    </View>
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
  hidden: { position: 'absolute', left: 0, top: 0, width: 2, height: 2, opacity: 0 },
  sheet: { ...StyleSheet.absoluteFill, zIndex: 1000 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, textAlign: 'center' },
  web: { flex: 1 },
});
