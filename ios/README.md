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

## Demo vs Live

The app starts in **Demo** mode (everything scripted on the phone). Tap **Demo** at the top right
of Overview to connect to a real agent:

1. On the machine running Aura: `cd agent && AURA_API_HOST=0.0.0.0 uv run python -m aura.main`
   (by default it only listens on 127.0.0.1, which the phone can't reach).
2. In the app enter `http://<that machine's LAN IP>:8700` and the token
   (`/web` in the aura CLI, or `agent/.aura_state/api_token`). The token is stored in the Keychain.
3. Phone and machine must be on the same Wi-Fi (or use a tunnel such as Tailscale and its address).

Live mode uses the agent's existing API: `/ws` for heartbeats, incident events and approve/reject,
and `GET /memory/incidents` for the Memory tab.
