import SwiftUI

enum Theme {
    static let repo = URL(string: "https://github.com/B4K2/Aure-agent")!
    static let docs = URL(string: "https://github.com/B4K2/Aure-agent#readme")!

    static let dim = Color.white.opacity(0.6)
    static let faint = Color.white.opacity(0.4)
    static let ok = Color(red: 0.42, green: 0.86, blue: 0.58)
    static let bad = Color(red: 1.0, green: 0.42, blue: 0.42)
    static let warn = Color(red: 1.0, green: 0.74, blue: 0.35)
}

extension Font {
    static func serifItalic(_ size: CGFloat) -> Font { .system(size: size, weight: .regular, design: .serif).italic() }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .monospaced) }
}

/// Static dark mesh behind every screen. Liquid Glass needs something to refract;
/// on flat black it just reads as grey. Static on purpose: zero per-frame cost.
struct AppBackground: View {
    var tint: Color = .indigo

    var body: some View {
        MeshGradient(
            width: 3, height: 3,
            points: [[0, 0], [0.5, 0], [1, 0],
                     [0, 0.5], [0.6, 0.4], [1, 0.5],
                     [0, 1], [0.5, 1], [1, 1]],
            colors: [.black, tint.opacity(0.55), .black,
                     Color(red: 0.05, green: 0.1, blue: 0.25), .black, Color(red: 0.2, green: 0.05, blue: 0.3),
                     .black, Color(red: 0.0, green: 0.2, blue: 0.25), .black]
        )
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
