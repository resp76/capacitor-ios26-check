# capacitor-ios26-check

Zero-dependency Node.js CLI for auditing Capacitor 8 iOS projects for known iOS 26 SDK and sync traps. Requires Node.js 18 or later and Git for the gitignore check.

```sh
npx capacitor-ios26-check [projectDir]
npx capacitor-ios26-check . --json
```

The directory defaults to the current working directory. The audit only reads the project; it never runs project code or modifies files.

Each check prints PASS, FAIL, or WARN. JSON output is an array of `{ check, status, message }` objects. Exit status is 1 for any FAIL or audit error, otherwise 0; warnings alone do not fail CI.

- **UIScene:** requires a scene manifest in `ios/App/App/Info.plist` and an app-target Swift class conforming to `UIWindowSceneDelegate`.
- **Plugins:** checks direct CAPPlugin subclasses in `ios/App/App/*.swift` against the native `capacitor.config.json` packageClassList.
- **Bundle parity:** compares native public/index.html with webDir/index.html when both exist; defaults to `www`.
- **Gitignore:** warns when the native public directory is ignored but contains tracked files. Missing Git or a non-Git project produces a warning.

Static webDir strings in root `capacitor.config.ts`, `.js`, `.mjs`, `.cjs`, or `.json` are supported, in that order. Computed JavaScript values are not executed; the native config webDir or `www` is used as a fallback. Missing entry points are reported as a non-applicable PASS. These lightweight text checks do not validate Xcode membership, runtime behavior, or full asset parity.

**Fixing a UIScene failure:** Capacitor 8.5 and later adopt UIScene officially. `npx cap migrate` adds the scene manifest and `SceneDelegate.swift` for you; see the [8.5 update guide](https://capacitorjs.com/docs/updating/8-5). Use this checker to confirm the result, or to audit a project you cannot upgrade yet.

See [the fix guide](docs/FIX-GUIDE.md) for scene setup, sync wrappers, and Git staging. [SKILL.md](SKILL.md) provides a Claude workflow.

```sh
npm test
node bin/cli.mjs /path/to/project
```

MIT licensed.
