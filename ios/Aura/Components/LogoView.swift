import SwiftUI

/// Aura mark: a ring (orbit), a breathing core and a planet travelling around it.
struct LogoMark: View {
    var size: CGFloat = 30
    var lapSeconds: Double = 6

    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let angle = (t / lapSeconds).truncatingRemainder(dividingBy: 1) * 2 * .pi + .pi / 4
            let breathe = 0.85 + 0.15 * cos(t * 2 * .pi / 2.4)
            Canvas { ctx, s in
                let k = s.width / 32
                let c = CGPoint(x: 16 * k, y: 16 * k)
                ctx.stroke(Path(ellipseIn: CGRect(x: 5 * k, y: 5 * k, width: 22 * k, height: 22 * k)),
                           with: .color(.white), lineWidth: 1.75 * k)
                let r = 4 * k * breathe
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)), with: .color(.white))
                let p = CGPoint(x: c.x + 11 * k * sin(angle), y: c.y - 11 * k * cos(angle))
                let pr = 2.75 * k
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - pr, y: p.y - pr, width: 2 * pr, height: 2 * pr)), with: .color(.white))
            }
            .frame(width: size, height: size)
        }
    }
}

struct LogoView: View {
    var body: some View {
        HStack(spacing: 10) {
            LogoMark(size: 26)
            Text("Aura").font(.system(size: 20, weight: .medium)).tracking(-0.4)
        }
        .foregroundStyle(.white)
    }
}
