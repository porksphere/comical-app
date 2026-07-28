/**
 * ESLint rule: interactive elements must carry a `testID`.
 *
 * UI automation (Appium / Detox / Maestro / Playwright) selects on `testID`, which react-native
 * maps to `accessibilityIdentifier` (iOS), resource-id (Android), and `data-testid` (web, via
 * react-native-web). An interactive element with no `testID` is unreachable from a stable
 * selector, so this rule makes one mandatory.
 *
 * Targets the interactive RN primitives — `Pressable`, the `Touchable*` family, `TextInput`,
 * `Switch`, and expo-router's `Link`. Our own wrapper components (ActionButton, SettingsRow, …)
 * are NOT matched here: they render one of these primitives internally (which this rule catches)
 * and additionally require a `testID` prop via TypeScript, so their call sites are enforced by
 * `tsc`, not by this rule.
 *
 * Matching tracks the local import binding, so an aliased import (`import { Pressable as P }`) or
 * a member access (`RN.Pressable`) is still caught — not just the bare name.
 *
 * A dynamic id (`testID={expr}`) satisfies the rule. A `{...spread}` does NOT exempt the element:
 * the components that spread props here (the tab triggers, the series card, the selector rows)
 * are exactly the ones that would otherwise ship with no id, so requiring an explicit `testID`
 * attribute is the whole point. A genuinely id-less element uses an inline
 * `// eslint-disable-next-line comical/require-test-id -- reason`.
 */

'use strict';

/** Bare component names that require a testID, keyed by the module they come from. Local import
 *  bindings (including aliases) are resolved to these at lint time. */
const INTERACTIVE = {
  'react-native': ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'TextInput', 'Switch'],
  'react-native-gesture-handler': ['TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback'],
  'expo-router': ['Link'],
  // The guarded `<Link>` wrapper (see src/lib/nav.tsx) — call sites import it from there, not from
  // expo-router, so it needs its own entry or the rule would stop seeing every link in the app.
  '@/lib/nav': ['Link'],
};

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require a testID on interactive elements so UI automation can select them across iOS/Android/web.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Extra bare component names to treat as interactive (e.g. project wrappers), matched by
          // their local import binding just like the built-ins.
          additionalComponents: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missing: 'Interactive <{{name}}> must have a testID (see src/lib/test-id.ts for the naming convention).',
    },
  },

  create(context) {
    const extra = new Set((context.options[0] && context.options[0].additionalComponents) || []);

    // Local binding name -> true, for every interactive component actually imported in this file.
    const localNames = new Set();
    // Local namespace binding (e.g. `import * as RN from 'react-native'`) -> set of interactive
    // member names exported by that module, so `RN.Pressable` is matched.
    const namespaces = new Map();

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const names = INTERACTIVE[source];
        if (!names) return;
        const nameSet = new Set(names);
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier' && nameSet.has(spec.imported.name)) {
            // Named import (with or without alias) — track the LOCAL binding.
            localNames.add(spec.local.name);
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            namespaces.set(spec.local.name, nameSet);
          }
        }
      },

      JSXOpeningElement(node) {
        const el = node.name;
        let matched = false;
        if (el.type === 'JSXIdentifier') {
          matched = localNames.has(el.name) || extra.has(el.name);
        } else if (el.type === 'JSXMemberExpression' && el.object.type === 'JSXIdentifier' && el.property.type === 'JSXIdentifier') {
          const members = namespaces.get(el.object.name);
          matched = !!members && members.has(el.property.name);
        }
        if (!matched) return;

        const hasTestId = node.attributes.some(
          (attr) => attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier' && attr.name.name === 'testID',
        );
        if (hasTestId) return;

        context.report({
          node,
          messageId: 'missing',
          data: { name: el.type === 'JSXMemberExpression' ? `${el.object.name}.${el.property.name}` : el.name },
        });
      },
    };
  },
};
