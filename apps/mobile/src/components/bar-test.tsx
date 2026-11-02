import { Stack } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/build/react-navigation/elements/Header/HeaderHeightContext.js';
import { use, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  Screen,
  ScreenStack,
  ScreenStackHeaderConfig,
  ScreenStackItem,
  type HeaderMinimizationBehavior,
  type HeaderSafeAreaAdjustment,
  type ScreenStackHeaderConfigProps,
} from 'react-native-screens';

import { ContentScrollAnchor } from '../../modules/content-scroll-view';

import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SettingsGutter, SettingsTopGap } from '@/constants/theme';
import { useNativeHeaderHeight } from '@/hooks/use-native-header';
import { useTheme } from '@/hooks/use-theme';
import { router } from '@/lib/nav';

// THROWAWAY: finds what keeps the iOS 27 bar from sliding away on our screens. Delete this file,
// its three routes (app/bar-test, app/bar-test-upstream, app/(tabs)/settings/in-tab/bar-test) and
// the rows that open them (settings-developer, the Settings tab) once the answer is in.

const DEFAULT = 'default';
type Minimize = HeaderMinimizationBehavior | typeof DEFAULT;
type SafeArea = HeaderSafeAreaAdjustment | typeof DEFAULT;
type Inset = 'automatic' | 'never';
type Wrap = 'none' | 'view' | 'sibling' | 'two' | 'three';
type Named = 'off' | 'on';

const MINIMIZE: Minimize[] = [DEFAULT, 'automatic', 'onScrollDown', 'never'];
const SAFE_AREA: SafeArea[] = [DEFAULT, 'automatic', 'enabled', 'disabled'];
const INSETS: Inset[] = ['automatic', 'never'];
const WRAPS: Wrap[] = ['none', 'view', 'sibling', 'two', 'three'];
const NAMED: Named[] = ['off', 'on'];
const HOSTS = ['Screen', 'ScreenStackItem'] as const;

function next<T>(values: readonly T[], value: T): T {
  return values[(values.indexOf(value) + 1) % values.length];
}

function headerConfig(minimize: Minimize, safeArea: SafeArea) {
  return {
    ...(minimize !== DEFAULT && { minimizationBehavior: minimize }),
    ...(safeArea !== DEFAULT && { safeAreaAdjustment: safeArea }),
  };
}

function Choice<T extends string>({
  id,
  label,
  values,
  value,
  onChange,
}: {
  id: string;
  label: string;
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <SettingsRow
      testID={`bar-test.${id}`}
      label={label}
      right={<ThemedText>{value}</ThemedText>}
      onPress={() => onChange(next(values, value))}
    />
  );
}

function Rows() {
  return Array.from({ length: 100 }, (_, index) => (
    <ThemedText key={index} style={styles.row}>
      Row {index}
    </ThemedText>
  ));
}

function Readout({ text }: { text: string }) {
  return (
    <View pointerEvents="none" style={styles.readout}>
      <ThemedText type="small" style={styles.readoutText}>
        {text}
      </ThemedText>
    </View>
  );
}

/** A pushed screen of one of our own stacks (the root stack, or a tab's), with our bar options. */
export function BarTest({ where }: { where: string }) {
  const theme = useTheme();
  const [minimize, setMinimize] = useState<Minimize>('onScrollDown');
  const [safeArea, setSafeArea] = useState<SafeArea>('disabled');
  const [inset, setInset] = useState<Inset>('never');
  const [wrap, setWrap] = useState<Wrap>('view');
  const [named, setNamed] = useState<Named>('off');
  const reported = use(HeaderHeightContext) ?? 0;
  const barHeight = useNativeHeaderHeight();

  if (Platform.OS !== 'ios') return <ThemedText style={styles.row}>iOS only</ThemedText>;

  const scroll = (
    <ScrollView
      key={`${minimize}-${safeArea}-${inset}-${wrap}-${named}`}
      style={wrap === 'none' && { backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior={inset}
      contentContainerStyle={{ paddingTop: (inset === 'never' ? barHeight : 0) + SettingsTopGap }}>
      <SettingsSection title={where} footer="Scroll down. The bar should slide away. Every change remounts the list.">
        <Choice id="minimize" label="minimizationBehavior" values={MINIMIZE} value={minimize} onChange={setMinimize} />
        <Choice id="safe-area" label="safeAreaAdjustment" values={SAFE_AREA} value={safeArea} onChange={setSafeArea} />
        <Choice id="inset" label="contentInsetAdjustment" values={INSETS} value={inset} onChange={setInset} />
        <Choice id="wrap" label="Ahead of the list" values={WRAPS} value={wrap} onChange={setWrap} />
        <Choice id="named" label="Named to UIKit" values={NAMED} value={named} onChange={setNamed} />
      </SettingsSection>
      <Rows />
    </ScrollView>
  );
  const list =
    named === 'on' && ContentScrollAnchor ? (
      <ContentScrollAnchor style={styles.fill}>{scroll}</ContentScrollAnchor>
    ) : (
      scroll
    );
  const readout = <Readout text={`reported bar ${Math.round(reported)}`} />;

  return (
    <>
      <Stack.Screen
        options={{ title: 'Bar test', unstable_nativeProps: { headerConfig: headerConfig(minimize, safeArea) } }}
      />
      {wrap === 'none' ? (
        <>
          {list}
          {readout}
        </>
      ) : (
        <ThemedView style={styles.fill}>
          {wrap === 'sibling' && <View collapsable={false} pointerEvents="none" style={styles.sibling} />}
          {wrap === 'two' || wrap === 'three' ? (
            <View collapsable={false} style={styles.fill}>
              {wrap === 'three' ? (
                <View collapsable={false} style={styles.fill}>
                  {list}
                </View>
              ) : (
                list
              )}
            </View>
          ) : (
            list
          )}
          {readout}
        </ThemedView>
      )}
    </>
  );
}

/**
 * react-native-screens' own test of the feature, copied: a stack of its own holding one screen
 * whose first child is the list. Hosted by a screen of the root stack that hides its bar.
 */
export function BarTestUpstream() {
  const theme = useTheme();
  const [host, setHost] = useState<(typeof HOSTS)[number]>('Screen');
  const [minimize, setMinimize] = useState<Minimize>(DEFAULT);
  const [inset, setInset] = useState<Inset>('automatic');
  const [height, setHeight] = useState(0);

  if (Platform.OS !== 'ios') return <ThemedText style={styles.row}>iOS only</ThemedText>;

  const config: ScreenStackHeaderConfigProps = {
    title: 'Upstream copy',
    translucent: true,
    backgroundColor: 'transparent',
    ...headerConfig(minimize, DEFAULT),
  };
  const content: ReactNode = (
    <>
      <ScrollView
        key={`${minimize}-${inset}`}
        style={{ backgroundColor: theme.background }}
        contentInsetAdjustmentBehavior={inset}
        contentContainerStyle={inset === 'never' && { paddingTop: height }}>
        <SettingsSection footer="Scroll down. The bar should slide away.">
          <SettingsRow testID="bar-test.close" label="Close" onPress={() => router.back()} />
          <Choice id="host" label="Host" values={HOSTS} value={host} onChange={setHost} />
          <Choice id="minimize" label="minimizationBehavior" values={MINIMIZE} value={minimize} onChange={setMinimize} />
          <Choice id="inset" label="contentInsetAdjustment" values={INSETS} value={inset} onChange={setInset} />
        </SettingsSection>
        <Rows />
      </ScrollView>
      <Readout text={`reported bar ${Math.round(height)}`} />
    </>
  );

  return (
    <ScreenStack key={host} style={styles.fill}>
      {host === 'Screen' ? (
        <Screen
          activityState={2}
          isNativeStack
          style={StyleSheet.absoluteFill}
          onHeaderHeightChange={(e) => setHeight(e.nativeEvent.headerHeight)}>
          {content}
          <ScreenStackHeaderConfig {...config} />
        </Screen>
      ) : (
        <ScreenStackItem
          screenId="bar-test"
          activityState={2}
          headerConfig={config}
          style={StyleSheet.absoluteFill}
          onHeaderHeightChange={(e) => setHeight(e.nativeEvent.headerHeight)}>
          {content}
        </ScreenStackItem>
      )}
    </ScreenStack>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    padding: 16,
    paddingHorizontal: SettingsGutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  sibling: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#0001',
  },
  readout: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 120,
    alignItems: 'center',
  },
  readoutText: {
    backgroundColor: '#000a',
    color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
