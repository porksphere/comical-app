import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { testId } from '@/lib/test-id';
import type { TranslatedRegion } from '../types';

/**
 * One translated region, absolutely positioned over its bubble (the parent overlay computes
 * `frame` in view points). Tap flips between the translation and the original text — small
 * target, so it doesn't fight the reader's page-turn zones. Light chip over any art; the
 * reader is a dark-surface context, so this is intentionally theme-fixed like the rest of the
 * reader chrome.
 */
export function RegionBubble({
  region,
  frame,
}: {
  region: TranslatedRegion;
  frame: { x: number; y: number; w: number; h: number };
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const text = showOriginal ? region.text : region.dstText;

  // Start from a size that would roughly fill the box with this many glyphs, then let
  // adjustsFontSizeToFit shrink it the rest of the way; clamp for legibility.
  const estimate = Math.sqrt((frame.w * frame.h) / Math.max(1, text.length) / 1.8);
  const fontSize = Math.max(9, Math.min(22, estimate));

  return (
    <Pressable
      testID={testId('reader.translation.bubble', region.id)}
      style={[styles.bubble, { left: frame.x, top: frame.y, width: frame.w, height: frame.h }]}
      onPress={() => setShowOriginal((v) => !v)}
    >
      <Text
        style={[styles.text, showOriginal && styles.original, { fontSize }]}
        adjustsFontSizeToFit
        numberOfLines={Math.max(1, Math.floor(frame.h / (fontSize + 2)))}
      >
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    backgroundColor: 'rgba(250,250,250,0.92)',
    borderColor: 'rgba(0,0,0,0.25)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  text: {
    color: '#111',
    textAlign: 'center',
  },
  original: {
    color: '#444',
    fontStyle: 'italic',
  },
});
