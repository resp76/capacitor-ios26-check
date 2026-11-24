# Fix guide

Run `npx capacitor-ios26-check .` from the Capacitor project root. The audit is read-only. Apply fixes in your project and rerun the audit after each sync.

## UIScene life cycle

Apps built with the iOS 26 SDK or later can fail to launch with “UIScene life cycle is required” when the scene setup is missing.

**On Capacitor 8.5 or later, use the official migration.** Update the CLI first, then migrate; `cap migrate` runs the migrator of the CLI installed when it starts, so an older CLI skips the UIScene step without saying so:

```sh
npm i -D @capacitor/cli@latest
npx cap migrate
```

A successful run prints `Writing SceneDelegate.swift`. See the [8.5 update guide](https://capacitorjs.com/docs/updating/8-5). If your app sets a `CAPBridgeViewController` subclass in `Main.storyboard`, also read [App-target plugin registration](#app-target-plugin-registration) below.

**Manual route, only for projects that stay on Capacitor 8.4 or earlier.** After this route, a later `cap migrate` reports a “partial state” and skips its UIScene step; follow the 8.5 guide's manual steps at that point. Add the following inside the top-level `<dict>` in `ios/App/App/Info.plist`:

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

Keep existing AppDelegate URL and Universal Link forwarding for application-level callbacks. Build and launch on a device or simulator, then test cold and warm deep links. This text audit cannot validate the `UISceneDelegateClassName` value, Xcode target membership or runtime behavior: a misspelled class name or a `SceneDelegate.swift` outside the App target gives a black screen, not a crash.

## App-target plugin registration

Plugins compiled into the App target are not in node_modules, so `cap sync` never lists them in `ios/App/App/capacitor.config.json` → `packageClassList`, and removes any entry you add by hand. Register them in code instead, as the [Capacitor custom code guide](https://capacitorjs.com/docs/ios/custom-code) documents: subclass `CAPBridgeViewController` and register each plugin in `capacitorDidLoad()`.

```swift
import UIKit
import Capacitor

class MyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LocalPlugin())
    }
}
```

The subclass only runs if it is the root view controller:

- **Storyboard (Capacitor 8.4 and earlier, or the manual UIScene route above):** set the bridge view controller's custom class in `Main.storyboard` to `MyViewController`, module `App`.
- **After `cap migrate` to 8.5 or later:** the generated `SceneDelegate.swift` creates a plain `CAPBridgeViewController()` and ignores the storyboard class, so the plugin's JS object becomes undefined. `cap migrate` does not warn about this. Change that line to create your subclass:

```swift
window?.rootViewController = MyViewController()
```

This survives `cap sync`. Then check from JS, on a device or simulator, that each app-local plugin answers.

## Stale native web bundle

Build the web app into the configured `webDir` (default `www`), then run `npx cap sync ios`. The checker compares source and native `index.html` contents. Matching entry points do not prove all assets match: for release verification, also compare all relative file paths and bytes, allowing only generated `cordova.js` and `cordova_plugins.js` extras in the native bundle.

## Gitignored native bundle with tracked files

A gitignore rule does not remove existing files from Git's index, but it can hide newly generated assets. After sync, if you intentionally version the native bundle, run:

```sh
git add -f ios/App/App/public
git diff --cached --stat
```

Review staged changes before committing. Alternatively, explicitly change your repository policy to regenerate native assets during builds rather than tracking them.
