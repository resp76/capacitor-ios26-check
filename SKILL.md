---
name: capacitor-ios26-check
description: Audit a Capacitor 8 iOS project for iOS 26 scene lifecycle, app-target plugin registration, stale native web bundles, and gitignored bundle traps.
---

# Capacitor iOS 26 check

1. Locate the Capacitor project root, containing `ios/App/App`.
2. Run `npx capacitor-ios26-check <projectDir> --json` and inspect every result. Exit 1 means at least one failure; warnings still need review.
3. Read [docs/FIX-GUIDE.md](docs/FIX-GUIDE.md) and apply its matching fix to each failure or warning within the user's requested scope. Preserve existing app behavior and use the project's plugin class names.
4. For UIScene, add the manifest and scene delegate, ensure target membership, and preserve cold and warm URL/Universal Link forwarding. For plugins, restore registration after every sync. Build web assets before syncing and review force-staged assets if the bundle is intentionally tracked.
5. Rerun the checker and relevant project tests. Report remaining warnings and runtime validation still needed. Never commit, push, or publish unless explicitly requested.
