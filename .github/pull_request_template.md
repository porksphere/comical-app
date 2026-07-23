## Summary

<!-- What changed and why. -->

## Checklist

- [ ] New interactive elements have a `testID` (enforced by CI — `comical/require-test-id` — but
      double check before pushing; see `apps/mobile/src/lib/test-id.ts` for the naming convention).
- [ ] New user-facing screens/flows are covered by a Maestro flow under `apps/mobile/e2e/` — **or**
      an existing flow needed updating because this PR changed a screen it already covers (a
      selector that moved, an assertion that's now stale). CI's `check:flow-coverage` only flags
      *missing* coverage for brand-new tab/screen/Settings-category anchors — it can't detect a flow
      that's gone stale because of a change like this, so this box is the only backstop for that
      case. See `apps/mobile/e2e/README.md`.
