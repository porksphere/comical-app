import { describe, expect, test } from 'bun:test';

import { Motion, paletteFromMaterial, type MaterialRoles } from './material';
import type { Palette } from './theme';

// Material 3's baseline palettes, as `@expo/ui` reports a palette: `#RRGGBBAA`.
const LIGHT: MaterialRoles = {
  primary: '#6750A4FF',
  onPrimary: '#FFFFFFFF',
  secondaryContainer: '#E8DEF8FF',
  onSecondaryContainer: '#1D192BFF',
  surface: '#FEF7FFFF',
  onSurface: '#1D1B20FF',
  onSurfaceVariant: '#49454FFF',
  surfaceContainerLow: '#F7F2FAFF',
  surfaceContainer: '#F3EDF7FF',
  surfaceContainerHigh: '#ECE6F0FF',
  surfaceContainerHighest: '#E6E0E9FF',
  outline: '#79747EFF',
  outlineVariant: '#CAC4D0FF',
  error: '#B3261EFF',
  onError: '#FFFFFFFF',
};
const DARK: MaterialRoles = {
  primary: '#D0BCFFFF',
  onPrimary: '#381E72FF',
  secondaryContainer: '#4A4458FF',
  onSecondaryContainer: '#E8DEF8FF',
  surface: '#141218FF',
  onSurface: '#E6E0E9FF',
  onSurfaceVariant: '#CAC4D0FF',
  surfaceContainerLow: '#1D1B20FF',
  surfaceContainer: '#211F26FF',
  surfaceContainerHigh: '#2B2930FF',
  surfaceContainerHighest: '#36343BFF',
  outline: '#938F99FF',
  outlineVariant: '#49454FFF',
  error: '#F2B8B5FF',
  onError: '#601410FF',
};

// Stands in for `Colors[scheme]`, which this file can't import (it brings react-native): every
// token a marker, so one the mapping leaves alone shows as one.
const TOKENS = [
  'text', 'background', 'backgroundPanel', 'backgroundElement', 'backgroundSelected', 'tileWash',
  'overlaySurface', 'overlayHover', 'overlaySelected', 'overlayHairline', 'textSecondary', 'inkUnread',
  'accent', 'accentHover', 'accentOn', 'badgeInfo', 'badgeWarn', 'badgeSuccess', 'badgeNew', 'badgeNewOn',
  'hairline', 'barHairline', 'tabIconActive', 'tabIconInactive', 'chipBg', 'chipFill', 'chipText',
  'coverPaper', 'coverPaperEdge', 'danger', 'dangerOn',
] as const;
const BASE = Object.fromEntries(TOKENS.map((t) => [t, `base:${t}`])) as unknown as Palette;

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('paletteFromMaterial', () => {
  test('every colour comes out as #RRGGBB, so an alpha can be appended', () => {
    for (const roles of [LIGHT, DARK]) {
      const palette = paletteFromMaterial(roles, BASE, false);
      for (const [token, value] of Object.entries(palette)) {
        if (value.startsWith('base:')) continue;
        expect(`${token} ${value}`).toMatch(/^\w+ #[0-9A-Fa-f]{6}$/);
      }
    }
  });

  test('only the status colours, the wash and the paper keep the app’s own', () => {
    const kept = Object.entries(paletteFromMaterial(DARK, BASE, false))
      .filter(([, value]) => value.startsWith('base:'))
      .map(([token]) => token);
    expect(kept.sort()).toEqual(
      ['badgeInfo', 'badgeNew', 'badgeNewOn', 'badgeSuccess', 'badgeWarn', 'coverPaper', 'coverPaperEdge', 'tileWash'].sort(),
    );
  });

  test('text reads on every surface it is drawn on, in both schemes', () => {
    for (const roles of [LIGHT, DARK]) {
      const p = paletteFromMaterial(roles, BASE, false);
      for (const surface of [p.background, p.backgroundPanel, p.backgroundElement, p.backgroundSelected, p.overlaySurface]) {
        expect(contrast(p.text, surface)).toBeGreaterThanOrEqual(7);
        expect(contrast(p.textSecondary, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(p.accentOn, p.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.dangerOn, p.danger)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.chipText, p.chipFill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.text, p.chipBg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accent, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.danger, p.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('pure black takes the page and nothing drawn on it', () => {
    const plain = paletteFromMaterial(DARK, BASE, false);
    const black = paletteFromMaterial(DARK, BASE, true);
    expect(black.background).toBe('#000000');
    expect({ ...black, background: plain.background }).toEqual(plain);
  });
});

describe('Motion', () => {
  test('a spring keeps Compose’s damping ratio', () => {
    const { stiffness, damping, mass } = Motion.spatial.default;
    expect(damping / (2 * Math.sqrt(stiffness * mass))).toBeCloseTo(0.8, 6);
    expect(Motion.effects.fast.damping / (2 * Math.sqrt(Motion.effects.fast.stiffness))).toBeCloseTo(1, 6);
  });
});
