import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SensorType, useAnimatedReaction, useAnimatedSensor, useSharedValue, type SharedValue } from 'react-native-reanimated';

/** How far the device has just been tipped from the way it is being held, -1 to 1 each way:
 *  `x` to its right, `y` toward its top. */
export type Tilt = { x: number; y: number };

export const LEVEL: Tilt = { x: 0, y: 0 };
/** A tip of about a quarter of a right angle is the whole of the range. */
const REACH = 4;
/** Per reading: how fast the held angle is taken as the new level, and how fast the tilt follows. */
const SETTLE = 0.03;
const FOLLOW = 0.25;

/**
 * The device's tilt, written to `tilt`, for things that should stir when it moves. It is measured
 * from how the device is being HELD, which is followed slowly, so a phone propped at any angle
 * reads level and a tip away from that eases back to nothing in a second or two: a movement, never
 * a lean that stays. Read on the UI thread, off gravity's direction rather than the gyroscope's
 * rate, which drifts.
 *
 * A component and not a hook, because the sensor runs for as long as its hook is mounted and has
 * no switch: mount this only while there is something on screen to stir.
 */
function SensorTilt({ tilt }: { tilt: SharedValue<Tilt> }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  const held = useSharedValue<Tilt | null>(null);
  useAnimatedReaction(
    () => gravity.sensor.get(),
    (g) => {
      const pull = Math.hypot(g.x, g.y, g.z) || 1;
      const x = g.x / pull;
      const y = g.y / pull;
      const was = held.get() ?? { x, y };
      const level = { x: was.x + (x - was.x) * SETTLE, y: was.y + (y - was.y) * SETTLE };
      held.set(level);
      const now = tilt.get();
      const toX = Math.max(-1, Math.min(1, (x - level.x) * REACH));
      const toY = Math.max(-1, Math.min(1, (y - level.y) * REACH));
      tilt.set({ x: now.x + (toX - now.x) * FOLLOW, y: now.y + (toY - now.y) * FOLLOW });
    },
  );
  useEffect(() => () => tilt.set(LEVEL), [tilt]);
  return null;
}

/** A browser has no such sensor to speak of, and Reanimated warns for each one it can't find. */
export const DeviceTilt: (props: { tilt: SharedValue<Tilt> }) => null = Platform.OS === 'web' ? () => null : SensorTilt;
