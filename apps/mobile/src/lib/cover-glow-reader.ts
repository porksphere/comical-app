import { Image } from 'expo-image';

import { type CoverGlow, glowFromTones, oneOfAFew, tonesFromBlurhash } from '@/lib/cover-glow';

/**
 * A cover's glow tints, read off a copy of it a few pixels big: decoded through the same cache the
 * card's own cover came from (no second download), hashed, and released. Handing
 * `generateBlurhashAsync` the URL instead would download the picture again and hash it whole. `null`
 * whenever anything fails, which leaves the glow neutral.
 */
export async function readCoverGlow(uri: string): Promise<CoverGlow | null> {
  return oneOfAFew(async () => {
    try {
      const ref = await Image.loadAsync({ uri }, { maxWidth: 12, maxHeight: 18 });
      try {
        const hash = await Image.generateBlurhashAsync(ref, [1, 2]);
        const tones = hash ? tonesFromBlurhash(hash) : null;
        return tones && glowFromTones(tones.top, tones.bottom);
      } finally {
        ref.release();
      }
    } catch {
      return null;
    }
  });
}
