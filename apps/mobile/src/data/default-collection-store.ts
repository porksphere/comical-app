import { persisted$ } from '@/lib/observable';

/**
 * Which collection this device treats as the default, by id.
 *
 * By ID and not by name because it is an ORDINARY collection: the user can rename it, and matching
 * on the name meant a rename silently spawned a second default on the next add. Split out from
 * `default-collection.ts` so the rule itself stays free of react-native — persisted stores reach it,
 * and a rule that decides where a user's series lands is worth being able to test without mocking
 * the platform.
 *
 * Wrapped in an object because a persisted *primitive* observable reads back as `{}` before
 * anything is stored, whereas an object initial round-trips cleanly (see `data/api.ts`).
 */
const defaultCollection$ = persisted$<{ id: string | null }>('comical:defaultCollection', { id: null });

export function getDefaultCollectionId(): string | null {
  return defaultCollection$.peek().id;
}

export function setDefaultCollectionId(id: string): void {
  defaultCollection$.set({ id });
}
