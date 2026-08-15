// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

const requireTestId = require("./eslint-rules/require-test-id");
const noUnguardedNav = require("./eslint-rules/no-unguarded-nav");

module.exports = defineConfig([
  expoConfig,
  {
    // A suppression that outlives its reason is worse than the warning it silenced — it reads as
    // "we thought about this" when nobody has since the code moved on. ESLint only warns about a
    // directive that no longer suppresses anything; make it fail instead, so the reasons attached to
    // every `-- …` (see AGENTS.md → "Suppressing a React Compiler rule") stay true or get deleted.
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    // Mandatory testIDs on interactive elements, so UI automation (Appium/Detox/Maestro/Playwright)
    // can select them across iOS/Android/web. See eslint-rules/require-test-id.js and src/lib/test-id.ts.
    // Registered AFTER expoConfig so the rule can reference this plugin; no languageOptions here so
    // the TS parser + JSX config from eslint-config-expo/flat still apply.
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      comical: { rules: { "require-test-id": requireTestId, "no-unguarded-nav": noUnguardedNav } },
    },
    rules: {
      "comical/require-test-id": "error",
      // Navigation goes through the double-tap-guarded wrapper in src/lib/nav.tsx, so one slow
      // screen can't be opened twice by an impatient second tap. See eslint-rules/no-unguarded-nav.js.
      "comical/no-unguarded-nav": "error",
    },
  },
  {
    ignores: ["dist/*", "eslint-rules/**"],
  }
]);
