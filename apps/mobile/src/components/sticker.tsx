import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Pattern, Polygon, Rect } from 'react-native-svg';

// A sticker is ink on paper whatever the theme; only the tone it casts follows the page.
export const STICKER = { paper: '#ffffff', ink: '#1c1c1e' } as const;
const TONE = { light: '#1c1c1e', dark: '#8a8a8f' } as const;

export const stickerTone = (dark: boolean) => (dark ? TONE.dark : TONE.light);

/** The burst's outline: twelve even points, every other one a little longer. Even, because the
 *  first cut's uneven ones read as a mistake at this size rather than as a hand's. Twelve, because
 *  it is turned afresh for each book: sixteen were too fine for the turn to show, and a star made
 *  wider than it is tall, so that it would, only looked slanted. */
const BURST_POINTS = 12;
const BURST = Array.from({ length: BURST_POINTS * 2 }, (_, k) => {
  const angle = (k / (BURST_POINTS * 2)) * Math.PI * 2 - Math.PI / 2;
  const reach = k % 2 ? 30 : k % 4 ? 40 : 46;
  return `${(Math.cos(angle) * reach).toFixed(1)},${(Math.sin(angle) * reach).toFixed(1)}`;
}).join(' ');
/** The turn after which the burst is the same shape again, in degrees: a long point and a short. */
export const BURST_TURN = 720 / BURST_POINTS;
/** The burst's box, square. */
export const BURST_SIZE = 96;

/** The tone a sticker casts: dots, never a blur. */
export function ToneShadow({ id, colour }: { id: string; colour: string }) {
  return (
    <Svg style={styles.toneShadow} width="100%" height="100%">
      <Defs>
        <Pattern id={id} patternUnits="userSpaceOnUse" width={4} height={4}>
          <Circle cx={2} cy={2} r={1.1} fill={colour} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** The star that says how many chapters are new, its lettering level whichever way its points fall. */
export function BurstStar({ count, turn, tone }: { count: number; /** In degrees. */ turn: number; tone: string }) {
  return (
    <>
      <Svg width={BURST_SIZE} height={BURST_SIZE} viewBox="-50 -50 100 100">
        {/* A hard shadow, as the tabs cast: tone dotted into a margin this thin was only fragments. */}
        <Polygon points={BURST} fill={tone} transform={`translate(3 4) rotate(${turn})`} />
        <Polygon points={BURST} fill={STICKER.paper} stroke={STICKER.ink} strokeWidth={2.4} strokeLinejoin="miter" transform={`rotate(${turn})`} />
      </Svg>
      <View style={styles.burstLabel}>
        <Text style={styles.burstCount}>{count}</Text>
        <Text style={styles.burstNew}>NEW!</Text>
      </View>
    </>
  );
}

/** A sticker's paper: what a tap does, in a word, over where it goes. */
export function StickerBox({ label, where, pressed }: { label: string; where: string; pressed?: boolean }) {
  return (
    <View style={[styles.box, pressed && styles.boxPressed]}>
      <Text style={styles.label}>{label}</Text>
      {where ? (
        <Text style={styles.where} numberOfLines={1}>
          {where}
        </Text>
      ) : null}
    </View>
  );
}

/** A sticker that is a button of its own, standing on its tone and pressed down into it. */
export function StickerButton({
  label,
  where,
  tone,
  toneId,
  onPress,
  disabled,
  accessibilityLabel,
  testID,
}: {
  label: string;
  where: string;
  tone: string;
  /** The tone pattern's id, unique among the stickers on screen. */
  toneId: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [label, where].filter(Boolean).join(', ')}
      accessibilityState={{ disabled: !!disabled }}>
      {({ pressed }) => (
        <>
          <ToneShadow id={toneId} colour={tone} />
          <StickerBox label={label} where={where} pressed={pressed} />
        </>
      )}
    </Pressable>
  );
}

const TONE_OFFSET = 6;

const styles = StyleSheet.create({
  toneShadow: { position: 'absolute', left: TONE_OFFSET, top: TONE_OFFSET },
  burstLabel: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  burstCount: { color: STICKER.ink, fontSize: 24, lineHeight: 24, fontWeight: '900', marginTop: -1 },
  burstNew: { color: STICKER.ink, fontSize: 9.5, lineHeight: 10, fontWeight: '900', letterSpacing: 0.5 },
  box: {
    paddingHorizontal: 10,
    paddingTop: 5,
    paddingBottom: 6,
    backgroundColor: STICKER.paper,
    borderColor: STICKER.ink,
    borderWidth: 2.5,
  },
  boxPressed: { transform: [{ translateX: TONE_OFFSET - 1 }, { translateY: TONE_OFFSET - 1 }] },
  label: { color: STICKER.ink, fontSize: 13, lineHeight: 15, fontWeight: '900', letterSpacing: 0.6 },
  where: { color: STICKER.ink, fontSize: 11.5, lineHeight: 14 },
});
