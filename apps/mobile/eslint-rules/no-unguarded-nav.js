/**
 * ESLint rule: navigate through `@/lib/nav`, never straight from `expo-router`.
 *
 * `@/lib/nav` re-exports `useRouter`, `router` and `Link` with the double-tap guard attached
 * (see src/lib/nav-guard.ts): a tap whose screen is slow to appear invites a second tap, and an
 * unguarded push then stacks a second copy of the same route. That's not a per-screen bug, so
 * the fix isn't per-screen either — it lives in the one wrapper every call site goes through,
 * and this rule is what keeps "every call site" true. A file that imports `useRouter` directly
 * silently opts its whole screen out of the guard, which is exactly the kind of regression
 * nobody notices until the stack is four series deep.
 *
 * Everything else expo-router exports (`useLocalSearchParams`, `useFocusEffect`, `Stack`,
 * `usePathname`, …) is untouched — only the three navigation entry points are redirected.
 *
 * The wrapper module itself is the one legitimate importer, so it's exempt.
 */

'use strict';

/** Bindings that must come from the wrapper instead. */
const GUARDED = ['useRouter', 'router', 'Link'];

/** The wrapper module, by path suffix — the only file allowed to import them from expo-router. */
const WRAPPER = 'src/lib/nav.tsx';

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: "Import navigation entry points from '@/lib/nav' (double-tap guarded), not from 'expo-router'.",
    },
    schema: [],
    messages: {
      unguarded:
        "Import `{{name}}` from '@/lib/nav', not 'expo-router' — the wrapper drops the duplicate navigation a double tap would otherwise stack (see src/lib/nav-guard.ts).",
    },
  },

  create(context) {
    const filename = (context.filename || context.getFilename() || '').replace(/\\/g, '/');
    if (filename.endsWith(WRAPPER)) return {};

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'expo-router') return;
        for (const spec of node.specifiers) {
          if (spec.type !== 'ImportSpecifier') continue;
          const imported = spec.imported.name;
          if (!GUARDED.includes(imported)) continue;
          context.report({ node: spec, messageId: 'unguarded', data: { name: imported } });
        }
      },
    };
  },
};
