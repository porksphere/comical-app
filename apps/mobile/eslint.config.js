// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

const requireTestId = require("./eslint-rules/require-test-id");

module.exports = defineConfig([
  expoConfig,
  {
    // Mandatory testIDs on interactive elements, so UI automation (Appium/Detox/Maestro/Playwright)
    // can select them across iOS/Android/web. See eslint-rules/require-test-id.js and src/lib/test-id.ts.
    // Registered AFTER expoConfig so the rule can reference this plugin; no languageOptions here so
    // the TS parser + JSX config from eslint-config-expo/flat still apply.
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      comical: { rules: { "require-test-id": requireTestId } },
    },
    rules: {
      "comical/require-test-id": "error",
    },
  },
  {
    ignores: ["dist/*", "eslint-rules/**"],
  }
]);
