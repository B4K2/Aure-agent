import SwiftUI

/// Native take on the web hero's WebGL "Threads": a bundle of thin wavy lines drifting slowly.
struct ThreadsView: View {
    var amplitude: Double = 1
    var lines = 28

    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                let midY = size.height * 0.5
                for i in 0..<lines {
                    let f = Double(i) / Double(lines - 1)
                    var path = Path()
                    let steps = 80
                    for s in 0...steps {
                        let x = Double(s) / Double(steps)
                        let envelope = sin(x * .pi)
                        let y = midY
                            + (f - 0.5) * size.height * 0.18 * envelope
                            + sin(x * 6 + t * 0.6 + f * 3) * 38 * amplitude * envelope
                            + sin(x * 13 - t * 0.9 + f * 5) * 10 * amplitude * envelope
                        let pt = CGPoint(x: x * size.width, y: y)
                        if s == 0 { path.move(to: pt) } else { path.addLine(to: pt) }
                    }
                    ctx.stroke(path, with: .color(.white.opacity(0.08 + 0.35 * (1 - abs(f - 0.5) * 2))), lineWidth: 0.8)
                }
            }
        }
        .allowsHitTesting(false)
    }
}
