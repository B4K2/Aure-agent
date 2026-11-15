# Aura for iPhone

Native SwiftUI version of the Aura landing page (`web/`), same layout, copy and black/white look:
hero with animated threads, scenario marquee, the 6-stage pipeline, the interactive demo terminal
(`/help`, `/inject <scenario>`, `/approve`, `/reject`, …), stats, feature cards, scroll-lit
statement, CTA and footer.

## Run it

1. `git pull && git checkout ios`
2. Open `ios/Aura.xcodeproj` in **Xcode 26+** (Xcode 26+ for Liquid Glass).
3. Pick an iPhone simulator (iOS 26) and press **⌘R**.

To run on a real iPhone: select the **Aura** target → *Signing & Capabilities* → pick your team
(a free Apple ID works), and change the bundle id `com.aura.app` if Xcode says it is taken.

No CocoaPods / SPM dependencies. Sources live in `ios/Aura/` (Xcode picks up new files automatically).
