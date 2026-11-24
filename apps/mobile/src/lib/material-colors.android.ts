import { getMaterialColors, isDynamicColorAvailable } from '@expo/ui/jetpack-compose';
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { AppState } from 'react-native';

import { MATERIAL_SEED, type MaterialRoles } from '@/constants/material';

export const WALLPAPER_COLORS_AVAILABLE = isDynamicColorAvailable;

// The wallpaper can change while the app is away, and nothing says so: the palette is read again
// each time the app comes back.
const returned$ = observable(0);
AppState.addEventListener('change', (state) => {
  if (state === 'active') returned$.set((n) => n + 1);
});

const held = new Map<string, { returned: number; roles: MaterialRoles }>();

const same = (a: MaterialRoles, b: MaterialRoles) =>
  (Object.keys(a) as (keyof MaterialRoles)[]).every((role) => a[role] === b[role]);

// A palette that reads the same is handed back as the SAME object: it is the theme's identity, and
// a new one renders every themed view in the app.
function read(scheme: 'light' | 'dark', wallpaper: boolean, returned: number): MaterialRoles {
  const key = `${scheme}:${wallpaper}`;
  const last = held.get(key);
  if (last?.returned === returned) return last.roles;
  const fresh: MaterialRoles = getMaterialColors(wallpaper ? { scheme } : { scheme, seedColor: MATERIAL_SEED });
  const roles = last && same(last.roles, fresh) ? last.roles : fresh;
  held.set(key, { returned, roles });
  return roles;
}

export function useMaterialRoles(scheme: 'light' | 'dark', wallpaper: boolean): MaterialRoles | null {
  const returned = use$(returned$);
  return read(scheme, wallpaper && isDynamicColorAvailable, returned);
}
