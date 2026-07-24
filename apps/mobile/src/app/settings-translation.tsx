import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { DownloadRadial } from '@/components/downloads/download-radial';
import { FailedIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SettingsSelectRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import {
  cancelModelDownload,
  deleteModel,
  downloadModel,
  engineRegistry,
  initTranslation,
  isTranslationSupported,
  translatorModelsQuery,
  translatorNative,
  useTranslationSettings,
  type ModelStatus,
} from '@/translation';
import type { Script } from '@/translation/types';

// Settings → Translation: the live-translator's home — model downloads (the manga pipeline),
// OS language-pack status for the current target, target language, and advanced engine pins.
// The reader's on/off switch lives in the reader's own settings panel; this screen manages
// everything the toggle depends on.

const TARGET_LANG_OPTIONS: SettingsOption<string>[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'id', label: 'Indonesian' },
];

const SCRIPT_HINT_OPTIONS: SettingsOption<Script | 'auto'>[] = [
  { value: 'auto', label: 'Auto', description: 'Try Japanese first, fall back per region.' },
  { value: 'Jpan', label: 'Japanese', description: 'Manga (vertical text, furigana).' },
  { value: 'Kore', label: 'Korean', description: 'Manhwa.' },
  { value: 'Hani', label: 'Chinese', description: 'Manhua.' },
  { value: 'Latn', label: 'Latin', description: 'Already-romanized comics.' },
];

/** Source languages worth pack-checking against the target (the pipeline's likely inputs). */
const PACK_SOURCES: { lang: string; label: string }[] = [
  { lang: 'ja', label: 'Japanese' },
  { lang: 'ko', label: 'Korean' },
  { lang: 'zh', label: 'Chinese' },
];

export default function TranslationSettingsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const supported = isTranslationSupported();
  const [settings, setSettings] = useTranslationSettings();

  useEffect(() => {
    if (supported) initTranslation();
  }, [supported]);

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Translation" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        {!supported ? (
          <View style={styles.unavailable} testID="settings.translation.unavailable">
            <ThemedText type="small" themeColor="textSecondary">
              {Platform.OS === 'web'
                ? 'Live translation runs on-device and is not available on web.'
                : 'Live translation needs a native build that includes the translator module.'}
            </ThemedText>
          </View>
        ) : (
          <>
            <SettingsSection title="Models">
              <ModelRows />
            </SettingsSection>
            <SettingsSection title="Language packs">
              {PACK_SOURCES.map(({ lang, label }) => (
                <PackRow key={lang} srcLang={lang} label={label} dstLang={settings.targetLang} />
              ))}
            </SettingsSection>
            <SettingsSection title="Options">
              <SettingsSelectRow
                label="Translate to"
                description="Target language for page translations."
                value={settings.targetLang}
                options={TARGET_LANG_OPTIONS}
                onChange={(targetLang) => setSettings({ targetLang })}
              />
              <SettingsSelectRow
                label="Source script"
                description="What the comics you read are written in."
                value={settings.sourceScriptHint}
                options={SCRIPT_HINT_OPTIONS}
                onChange={(sourceScriptHint) => setSettings({ sourceScriptHint })}
              />
              <SettingsSelectRow
                label="Translate ahead"
                description="Pages processed before you reach them."
                value={String(settings.translateAhead)}
                options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(v) => setSettings({ translateAhead: Number(v) })}
              />
            </SettingsSection>
            <EngineSection />
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

/** One row per downloadable model: radial while downloading, check when installed, tap to act. */
function ModelRows() {
  const theme = useTheme();
  const { data: models = [] } = useQuery(translatorModelsQuery());
  return (
    <>
      {models.map((m: ModelStatus) => (
        <SettingsRow
          key={m.id}
          testID={`settings.translation.model.${m.id}`}
          label={m.displayName}
          description={describeModel(m)}
          onPress={() => onModelPress(m)}
          right={
            m.state === 'downloading' ? (
              <DownloadRadial fraction={m.receivedBytes / Math.max(1, m.totalBytes)} state="downloading" />
            ) : m.state === 'ready' ? (
              <Pressable
                testID={`settings.translation.model-delete.${m.id}`}
                hitSlop={8}
                onPress={() =>
                  confirmDelete(m.displayName, () => {
                    deleteModel(m.id);
                  })
                }>
                <TrashIcon color={theme.textSecondary} size={18} />
              </Pressable>
            ) : m.state === 'error' ? (
              <FailedIcon color={theme.danger} size={18} />
            ) : undefined
          }
        />
      ))}
    </>
  );
}

function describeModel(m: ModelStatus): string {
  const mb = Math.round(m.totalBytes / 1_000_000);
  switch (m.state) {
    case 'downloading':
      return `Downloading… ${Math.round(m.receivedBytes / 1_000_000)} / ${mb} MB`;
    case 'ready':
      return `Installed · ${mb} MB`;
    case 'unpublished':
      return 'Not yet available';
    case 'error':
      return m.error ?? 'Download failed — tap to retry';
    default:
      return `Tap to download · ${mb} MB`;
  }
}

function onModelPress(m: ModelStatus): void {
  if (m.state === 'downloading') {
    cancelModelDownload(m.id);
    return;
  }
  if (m.state === 'absent' || m.state === 'error') {
    downloadModel(m.id).catch((e: unknown) => {
      Alert.alert('Download failed', e instanceof Error ? e.message : String(e));
    });
  }
}

function confirmDelete(name: string, onConfirm: () => void): void {
  Alert.alert(`Delete ${name}?`, 'The model can be downloaded again any time.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

/** OS language-pack status for src → target; tap to trigger the OS download. */
function PackRow({ srcLang, label, dstLang }: { srcLang: string; label: string; dstLang: string }) {
  const [status, setStatus] = useState<string>('…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void translatorNative
      ?.translationAvailability(srcLang, dstLang)
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus('unsupported'));
    return () => {
      alive = false;
    };
  }, [srcLang, dstLang, busy]);

  const description =
    status === 'ready'
      ? 'Downloaded'
      : status === 'downloadable'
        ? busy
          ? 'Downloading…'
          : 'Tap to download'
        : status === 'unsupported'
          ? 'Not supported on this device'
          : 'Checking…';

  return (
    <SettingsRow
      testID={`settings.translation.pack.${srcLang}`}
      label={`${label} → ${dstLang.toUpperCase()}`}
      description={description}
      onPress={
        status === 'downloadable' && !busy
          ? () => {
              setBusy(true);
              translatorNative
                ?.prepareTranslation(srcLang, dstLang)
                .catch((e: unknown) => {
                  Alert.alert('Download failed', e instanceof Error ? e.message : String(e));
                })
                .finally(() => setBusy(false));
            }
          : undefined
      }
    />
  );
}

/** Advanced: pin a specific engine per stage. Options come straight from the registry, so a
 *  newly registered engine (Sugoi, an LLM) appears here with zero UI changes. */
function EngineSection() {
  const [settings, setSettings] = useTranslationSettings();
  const kinds = [
    ['detector', 'Text detection'],
    ['recognizer', 'Text recognition'],
    ['translator', 'Translation'],
  ] as const;
  return (
    <SettingsSection title="Engines">
      {kinds.map(([kind, label]) => {
        const engines = engineRegistry.all(kind);
        const options: SettingsOption<string>[] = [
          { value: '', label: 'Automatic', description: 'Best available engine per page.' },
          ...engines.map((e) => ({ value: e.capability.id, label: e.capability.displayName })),
        ];
        return (
          <SettingsSelectRow
            key={kind}
            label={label}
            value={settings.engineOverrides[kind] ?? ''}
            options={options}
            onChange={(id) =>
              setSettings({
                engineOverrides: { ...settings.engineOverrides, [kind]: id || undefined },
              })
            }
          />
        );
      })}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingTop: Spacing.three },
  unavailable: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.five },
});
