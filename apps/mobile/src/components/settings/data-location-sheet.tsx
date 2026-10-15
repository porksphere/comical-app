/**
 * The desktop's data folder: where it is, and moving it. Two steps in one sheet — the folder as it
 * stands, then, once another has been picked, whether the data goes with it. The shell does the
 * moving, by restarting: every one of these files is open while the app runs.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { OverlayHeading } from '@/components/overlay/overlay';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatBytes } from '@/data/downloads/format';
import { useTheme } from '@/hooks/use-theme';
import { chooseDataDir, defaultDataDir, moveDataDir, showDataDir, type DataDir, type DataDirTarget } from '@/lib/desktop-shell';
import { friendlyError } from '@/lib/friendly-error';

type Picked = Exclude<DataDirTarget, { problem: string }>;

function outcome(target: Picked, copy: boolean): string {
  const size = formatBytes(target.bytes);
  if (target.holdsData) {
    return copy
      ? `The library already there is replaced with a copy of yours (${size}). Yours stays where it is too.`
      : 'Comical opens the library already there. Yours stays where it is.';
  }
  return copy
    ? `Your library, downloads, bridges and settings are copied there (${size}). The originals stay where they are until you delete them.`
    : 'Comical starts out empty there. Your data stays where it is.';
}

export function DataLocationSheet({ current }: { current: DataDir }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState<'looking' | 'moving' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const look = (find: () => Promise<DataDirTarget | null>) => {
    setBusy('looking');
    setError(null);
    find().then(
      (target) => {
        setBusy(null);
        if (!target) return;
        if ('problem' in target) return setError(target.problem);
        setPicked(target);
        // Copying over a library that is already there is never what a picked folder starts at.
        setCopy(!target.holdsData);
      },
      (e: unknown) => {
        setBusy(null);
        setError(friendlyError(e, "Couldn't look at that folder."));
      },
    );
  };

  const move = (target: Picked) => {
    setBusy('moving');
    setError(null);
    // On success the app is already restarting; this sheet goes with it.
    moveDataDir(target.dir, copy).catch((e: unknown) => {
      setBusy(null);
      setError(friendlyError(e, "Couldn't move your data."));
    });
  };

  const errorLine = error && (
    <ThemedText type="small" style={{ color: theme.danger }}>
      {error}
    </ThemedText>
  );

  if (!picked) {
    return (
      <View style={styles.body}>
        <OverlayHeading>Data location</OverlayHeading>
        <ThemedText type="small" themeColor="textSecondary">
          {current.isDefault
            ? 'Your library, downloads, bridges and settings are all kept in this folder, the one Comical starts out with.'
            : 'Your library, downloads, bridges and settings are all kept in this folder.'}
        </ThemedText>
        <ThemedText testID="settings.data-location.current" type="small" selectable>
          {current.dir}
        </ThemedText>
        {errorLine}
        <View style={styles.actions}>
          <Pressable testID="settings.data-location.open" onPress={showDataDir} style={[styles.btn, styles.lead]}>
            <ThemedText type="smallBold">Open folder</ThemedText>
          </Pressable>
          {!current.isDefault && (
            <Pressable
              testID="settings.data-location.default"
              onPress={() => look(defaultDataDir)}
              disabled={busy !== null}
              style={styles.btn}>
              <ThemedText type="smallBold">Use default</ThemedText>
            </Pressable>
          )}
          <Pressable
            testID="settings.data-location.choose"
            onPress={() => look(chooseDataDir)}
            disabled={busy !== null}
            style={styles.btn}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {busy === 'looking' ? 'Checking…' : 'Choose folder…'}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  const replacing = copy && picked.holdsData;
  const short = copy && picked.free !== null && picked.bytes > picked.free;
  return (
    <View style={styles.body}>
      <OverlayHeading>Use this folder?</OverlayHeading>
      <ThemedText testID="settings.data-location.target" type="small" selectable>
        {picked.isDefault ? `${picked.dir} (the default)` : picked.dir}
      </ThemedText>
      <View style={styles.switchRow}>
        <ThemedText type="small" style={styles.switchLabel}>
          {picked.holdsData ? 'Replace its library with yours' : 'Copy your data there'}
        </ThemedText>
        <ThemedSwitch testID="settings.data-location.copy" value={copy} onValueChange={setCopy} disabled={busy !== null} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {outcome(picked, copy)}
      </ThemedText>
      {short && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {`There isn't room: this needs ${formatBytes(picked.bytes)}, and that drive has ${formatBytes(picked.free ?? 0)} free.`}
        </ThemedText>
      )}
      {errorLine}
      <View style={styles.actions}>
        <Pressable
          testID="settings.data-location.back"
          onPress={() => {
            setPicked(null);
            setError(null);
          }}
          disabled={busy !== null}
          style={styles.btn}>
          <ThemedText type="smallBold">Back</ThemedText>
        </Pressable>
        <Pressable
          testID="settings.data-location.restart"
          onPress={() => move(picked)}
          disabled={busy !== null || short}
          style={[styles.btn, short && styles.blocked]}>
          <ThemedText type="smallBold" style={{ color: replacing ? theme.danger : theme.accent }}>
            {busy === 'moving' ? 'Restarting…' : 'Restart'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  switchLabel: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
  },
  btn: {
    paddingVertical: Spacing.two,
  },
  lead: {
    marginRight: 'auto',
  },
  blocked: {
    opacity: 0.4,
  },
});
