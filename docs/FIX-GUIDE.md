# Fix guide

Run `npx capacitor-ios26-check .` from the Capacitor project root. The audit is read-only. Apply fixes in your project and rerun the audit after each sync.

## UIScene life cycle

Apps built with the iOS 26 SDK can crash at launch with “UIScene life cycle is required” when the scene setup is missing. Add the following inside the top-level `<dict>` in `ios/App/App/Info.plist`:

```xml
<key>UIApplicationSceneManifest</key>
<dict>
    <key>UIApplicationSupportsMultipleScenes</key>
    <false/>
    <key>UISceneConfigurations</key>
    <dict>
        <key>UIWindowSceneSessionRoleApplication</key>
        <array>
            <dict>
                <key>UISceneConfigurationName</key>
                <string>Default Configuration</string>
                <key>UISceneDelegateClassName</key>
                <string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>
            </dict>
        </array>
    </dict>
</dict>
```

Add this class to an existing app-target Swift file, or create `SceneDelegate.swift` and include it in the App target. It loads the Capacitor bridge from `Main.storyboard` and forwards both cold-start and subsequent deep links through Capacitor:

```swift
import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        window.rootViewController = storyboard.instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()

        if let context = connectionOptions.urlContexts.first {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, open: context.url, options: [:])
        }
        for activity in connectionOptions.userActivities {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, continue: activity) { _ in }
        }
    }

    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        guard let context = contexts.first else { return }
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, open: context.url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity) { _ in }
    }
}
```

Keep existing AppDelegate URL and Universal Link forwarding for application-level callbacks. Build and launch on a device or simulator, then test cold and warm deep links; this text audit cannot validate Xcode target membership or runtime behavior.

## App-target plugin registration

`cap sync` rebuilds `ios/App/App/capacitor.config.json` → `packageClassList` from node_modules. Plugins compiled directly into the App target disappear from that list and their JS object becomes undefined. Restore them after **every** sync.

Create `tools/register-ios-app-plugins.mjs` in your project (replace `LocalPlugin` with your Swift plugin class names):

```js
import { readFileSync, writeFileSync } from 'node:fs';

const classes = ['LocalPlugin'];
const file = new URL('../ios/App/App/capacitor.config.json', import.meta.url);
const config = JSON.parse(readFileSync(file, 'utf8'));
const registered = config.packageClassList ?? [];
const missing = classes.filter(name => !registered.includes(name));
if (missing.length) {
  config.packageClassList = [...registered, ...missing];
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
```

Wire the script after sync in your project's package.json:

```json
{
  "scripts": {
    "ios:sync": "npx cap sync ios && node tools/register-ios-app-plugins.mjs",
    "cap:sync": "npx cap sync && node tools/register-ios-app-plugins.mjs"
  }
}
```

## Stale native web bundle

Build the web app into the configured `webDir` (default `www`), then run the sync wrapper above. The checker compares source and native `index.html` contents. Matching entry points do not prove all assets match: for release verification, also compare all relative file paths and bytes, allowing only generated `cordova.js` and `cordova_plugins.js` extras in the native bundle.

## Gitignored native bundle with tracked files

A gitignore rule does not remove existing files from Git's index, but it can hide newly generated assets. After sync, if you intentionally version the native bundle, run:

```sh
git add -f ios/App/App/public
git diff --cached --stat
```

Review staged changes before committing. Alternatively, explicitly change your repository policy to regenerate native assets during builds rather than tracking them.
