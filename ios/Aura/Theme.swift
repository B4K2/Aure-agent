import SwiftUI

enum Theme {
    static let repo = URL(string: "https://github.com/B4K2/Aure-agent")!
    static let docs = URL(string: "https://github.com/B4K2/Aure-agent#readme")!

    static let dim = Color.white.opacity(0.6)
    static let faint = Color.white.opacity(0.4)
    // Mostly black and white; hue only where it carries state.
    static let ok = Color(red: 0.35, green: 0.85, blue: 0.55)
    static let bad = Color(red: 1.0, green: 0.36, blue: 0.36)
    static let warn = Color(red: 1.0, green: 0.72, blue: 0.3)
}

extension Font {
    static func serifItalic(_ size: CGFloat) -> Font { .system(size: size, weight: .regular, design: .serif).italic() }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .monospaced) }
}

/// Black canvas with soft white light leaks. Liquid Glass needs something to refract;
/// on flat black it reads as dull grey. Static on purpose: zero per-frame cost.
/// `glow` brightens the light a little (used while an incident is open).
struct AppBackground: View {
    var glow: Double = 1

    var body: some View {
        ZStack {
            Color.black
            RadialGradient(colors: [.white.opacity(0.16 * glow), .clear], center: .init(x: 0.85, y: 0.05),
                           startRadius: 0, endRadius: 420)
            RadialGradient(colors: [.white.opacity(0.09 * glow), .clear], center: .init(x: 0.05, y: 0.55),
                           startRadius: 0, endRadius: 360)
            RadialGradient(colors: [.white.opacity(0.07 * glow), .clear], center: .init(x: 0.9, y: 0.95),
                           startRadius: 0, endRadius: 380)
        }
        .ignoresSafeArea()
    }
}

/// Section label, monospaced and tracked out like the web eyebrows.
struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.mono(11, .medium)).tracking(2).foregroundStyle(Theme.faint)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
