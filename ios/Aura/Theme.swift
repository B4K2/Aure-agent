import SwiftUI

/// Mirrors the web page's look: black canvas, white type, neutral greys,
/// a light sans for headlines and an italic serif for the accent words.
enum Theme {
    static let repo = URL(string: "https://github.com/B4K2/Aure-agent")!
    static let dashboard = URL(string: "https://github.com/B4K2/Aure-agent#readme")!

    static let neutral300 = Color(white: 0.83)
    static let neutral400 = Color(white: 0.64)
    static let neutral500 = Color(white: 0.45)
    static let neutral600 = Color(white: 0.32)
    static let neutral700 = Color(white: 0.25)
    static let hairline = Color.white.opacity(0.1)
    static let card = Color(white: 0.04)
}

extension Font {
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .light) }
    static func serifItalic(_ size: CGFloat) -> Font { .system(size: size, weight: .regular, design: .serif).italic() }
    static func mono(_ size: CGFloat) -> Font { .system(size: size, design: .monospaced) }
}

/// Fades and lifts content in the first time it appears, like the web `Reveal`.
struct Reveal: ViewModifier {
    var delay: Double = 0
    @State var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 20)
            .onAppear {
                withAnimation(.easeOut(duration: 0.8).delay(delay)) { shown = true }
            }
    }
}

extension View {
    func reveal(_ delay: Double = 0) -> some View { modifier(Reveal(delay: delay)) }
}

/// "Plain words" + "serif italic words", the two-tone headline used across the page.
struct TwoToneTitle: View {
    let plain: String
    let serif: String
    var size: CGFloat = 40
    var alignment: TextAlignment = .leading

    var body: some View {
        (Text(plain + " ").font(.display(size)) + Text(serif).font(.serifItalic(size)))
            .tracking(-size * 0.03)
            .multilineTextAlignment(alignment)
            .foregroundStyle(.white)
    }
}

/// Faint film grain over everything, like the `.grain` overlay on the web.
struct Grain: View {
    var body: some View {
        Canvas { ctx, size in
            var rng = SeededRandom(seed: 7)
            let count = Int(size.width * size.height / 90)
            for _ in 0..<count {
                let x = rng.next() * size.width, y = rng.next() * size.height
                ctx.fill(Path(CGRect(x: x, y: y, width: 1, height: 1)),
                         with: .color(.white.opacity(rng.next() * 0.5)))
            }
        }
        .opacity(0.08)
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}

struct SeededRandom {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 33) / Double(UInt64(1) << 31)
    }
}
