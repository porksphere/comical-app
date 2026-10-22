import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { WebLoginSetting } from '@/data/api';
import { useTheme } from '@/hooks/use-theme';

import webCookies from '../../../modules/web-cookies';

const POLL_MS = 1000;

/** Whether this build can sign in inside the app: the web view and the cookie reader shipped together. */
export const canSignInNatively = webCookies !== null;

/**
 * A site's own sign-in page in a web view, watched until every cookie the bridge named is set.
 * Finishes with them as a `Cookie` string, or null when cancelled. The site's cookies are cleared
 * before the page opens, so it starts signed out and signing in as someone else works.
 */
export function WebLoginSheet({ login, onDone }: { login: WebLoginSetting | null; onDone: (cookies: string | null) => void }) {
  return (
    <Modal visible={login !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onDone(null)}>
      {login && <SheetBody login={login} onDone={onDone} />}
    </Modal>
  );
}

function SheetBody({ login, onDone }: { login: WebLoginSetting; onDone: (cookies: string | null) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [cleared, setCleared] = useState(false);
  const finished = useRef(false);
  const urls = [login.url, ...(login.cookieUrls ?? [])];

  const check = async () => {
    if (!webCookies || finished.current) return;
    const jar = new Map<string, string>();
    for (const url of urls) {
      for (const pair of (await webCookies.getCookies(url)).split(';')) {
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        if (eq > 0 && !jar.has(name)) jar.set(name, pair.slice(eq + 1).trim());
      }
    }
    if (finished.current || !login.cookies.every((name) => jar.get(name))) return;
    finished.current = true;
    onDone([...jar].map(([name, value]) => `${name}=${value}`).join('; '));
  };

  useEffect(() => {
    let live = true;
    void webCookies
      ?.clearCookies(urls)
      .catch(() => {})
      .then(() => {
        if (live) setCleared(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cleared) return;
    const t = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(t);
  });

  return (
    <View style={[styles.sheet, { backgroundColor: theme.background }]}>
      <View style={[styles.bar, { paddingTop: Math.max(insets.top, Spacing.two), borderColor: theme.backgroundSelected }]}>
        <ThemedText type="smallBold" style={styles.title}>
          {login.label}
        </ThemedText>
        <Pressable testID="settings.web-login.cancel" onPress={() => onDone(null)} hitSlop={8} style={styles.cancel}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Cancel
          </ThemedText>
        </Pressable>
      </View>
      {cleared ? (
        <WebView
          source={{ uri: login.url }}
          onNavigationStateChange={() => void check()}
          setSupportMultipleWindows={false}
          thirdPartyCookiesEnabled
          style={styles.web}
        />
      ) : (
        <ActivityIndicator style={styles.web} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { textAlign: 'center' },
  cancel: { position: 'absolute', right: Spacing.four, bottom: Spacing.two },
  web: { flex: 1 },
});
