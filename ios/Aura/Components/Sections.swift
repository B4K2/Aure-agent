import SwiftUI

// MARK: - Content (same copy as web/src/App.tsx)

let SCENARIO_TAGS = ["bad deploys", "memory leaks", "CPU hot paths", "DB pool leaks", "slow queries",
                     "connection exhaustion", "table locks", "DB outages", "traffic spikes"]

let FEATURES: [(String, String)] = [
    ("Evidence, not guesses", "Every hypothesis cites the metrics, log lines, traces and deploy diffs it came from, so you can check the reasoning in seconds."),
    ("Memory that compounds", "Resolved and rejected incidents go into Qdrant and Neo4j. The second time a failure shows up, Aura recognises it."),
    ("Human in the loop", "Rollbacks, restarts and session kills are proposals. Nothing destructive runs until you type /approve."),
    ("Ask it anything", "Chat with the incident from the terminal. Why this deploy? What else changed? What happened last time?"),
]

let STAGES: [(String, String, String)] = [
    ("01", "Detect", "Watches latency, error rate, saturation and DB health. Flags anomalies, not noise."),
    ("02", "Correlate", "Lines the onset up against deploys, config changes and traffic shifts."),
    ("03", "Recall", "Searches vector and graph memory for incidents that looked like this one."),
    ("04", "Diagnose", "Forms a root-cause hypothesis with evidence and a confidence score."),
    ("05", "Propose", "Suggests rollback, restart, kill sessions or scale. Waits for your approval."),
    ("06", "Learn", "Writes the outcome, and your reason if you reject it, back into memory."),
]

// MARK: - Pieces

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.mono(11)).tracking(2.5).foregroundStyle(Theme.neutral500)
    }
}

struct SectionHead: View {
    let eyebrow: String, title: String, serif: String
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Eyebrow(text: eyebrow).reveal()
            TwoToneTitle(plain: title, serif: serif, size: 40).reveal(0.15)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 48)
    }
}

struct PillButton: View {
    let title: String
    var filled = true
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 15, weight: .medium))
                .padding(.horizontal, 26).padding(.vertical, 13)
                .foregroundStyle(filled ? .black : .white)
                .background(filled ? Color.white : Color.clear, in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(filled ? 0 : 0.2)))
        }
        .buttonStyle(PressScale())
    }
}

struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - Sections

struct HeroSection: View {
    var onDemo: () -> Void
    @Environment(\.openURL) var openURL
    @State var shown = false

    var body: some View {
        ZStack {
            ThreadsView()
            RadialGradient(colors: [.clear, .black], center: .center, startRadius: 80, endRadius: 420)
            VStack(spacing: 0) {
                Text("Incidents,").font(.display(64)).tracking(-2.8)
                Text("understood.").font(.serifItalic(66)).tracking(-1.2)
                    .opacity(shown ? 1 : 0).offset(y: shown ? 0 : 24)
                    .animation(.easeOut(duration: 1).delay(0.25), value: shown)
                Text("Aura watches your app, ties anomalies to the deploy that caused them, remembers every past incident, and proposes a fix. You approve it.")
                    .font(.system(size: 17)).foregroundStyle(Theme.neutral300)
                    .multilineTextAlignment(.center).lineSpacing(5)
                    .padding(.top, 32).padding(.horizontal, 8)
                    .opacity(shown ? 1 : 0).animation(.easeOut(duration: 1).delay(0.6), value: shown)
                VStack(spacing: 12) {
                    PillButton(title: "Run it locally") { openURL(Theme.repo) }
                    PillButton(title: "Watch a demo ↓", filled: false, action: onDemo)
                }
                .padding(.top, 36)
                .opacity(shown ? 1 : 0).animation(.easeOut(duration: 1).delay(0.8), value: shown)
            }
            .padding(.horizontal, 24)
            .opacity(shown ? 1 : 0.0001)
            .animation(.easeOut(duration: 0.9), value: shown)
        }
        .frame(minHeight: 720)
        .onAppear { shown = true }
    }
}

struct MarqueeSection: View {
    @State var rowWidth: CGFloat = 1500

    var row: some View {
        HStack(spacing: 28) {
            ForEach(SCENARIO_TAGS, id: \.self) { s in
                Text(s).font(.mono(13)).foregroundStyle(Theme.neutral500).fixedSize()
                Text("✕").font(.mono(13)).foregroundStyle(Theme.neutral700)
            }
        }
        .fixedSize()
    }

    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let shift = (t * 40).truncatingRemainder(dividingBy: Double(rowWidth + 28))
            HStack(spacing: 28) {
                row.background(GeometryReader { g in
                    Color.clear.onAppear { rowWidth = g.size.width }
                })
                row
            }
            .offset(x: -CGFloat(shift))
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 22)
        .clipped()
        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.15),
                                     .init(color: .black, location: 0.85), .init(color: .clear, location: 1)],
                             startPoint: .leading, endPoint: .trailing))
        .padding(.vertical, 22)
        .overlay(alignment: .top) { Theme.hairline.frame(height: 1) }
        .overlay(alignment: .bottom) { Theme.hairline.frame(height: 1) }
    }
}

struct HowItWorksSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(eyebrow: "How it works", title: "From first alert to", serif: "root cause.")
            ZStack(alignment: .topLeading) {
                // vertical track with a pulse travelling down it
                Theme.hairline.frame(width: 1).padding(.leading, 7).padding(.vertical, 8)
                GeometryReader { geo in
                    TimelineView(.animation) { tl in
                        let p = (tl.date.timeIntervalSinceReferenceDate / 7).truncatingRemainder(dividingBy: 1)
                        Circle().fill(.white).frame(width: 9, height: 9)
                            .shadow(color: .white.opacity(0.7), radius: 10)
                            .offset(x: 3, y: p * (geo.size.height - 9))
                    }
                }
                VStack(alignment: .leading, spacing: 36) {
                    ForEach(Array(STAGES.enumerated()), id: \.offset) { i, s in
                        HStack(alignment: .top, spacing: 20) {
                            Circle().stroke(Color.white.opacity(0.4)).background(Circle().fill(.black))
                                .frame(width: 15, height: 15)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(s.0).font(.mono(11)).foregroundStyle(Theme.neutral500)
                                Text(s.1).font(.system(size: 20, weight: .medium))
                                Text(s.2).font(.system(size: 14)).foregroundStyle(Theme.neutral400).lineSpacing(4)
                            }
                        }
                        .reveal(Double(i) * 0.08)
                    }
                }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 96)
    }
}

struct DemoSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Eyebrow(text: "Demo").reveal().padding(.bottom, 20)
            TwoToneTitle(plain: "A bad push,", serif: "caught in minutes.", size: 38).reveal(0.1)
            (Text("Watch Aura go from anomaly to approved rollback, with the reasoning shown at every step. Then take the keyboard: break the shop yourself with ")
             + Text("/inject").font(.mono(14)).foregroundColor(.white)
             + Text(", and approve or reject the fix."))
                .font(.system(size: 16)).foregroundStyle(Theme.neutral400).lineSpacing(5)
                .padding(.top, 24).padding(.bottom, 36).reveal(0.25)
            TerminalView()
                .reveal(0.3)
        }
        .padding(.horizontal, 16).padding(.vertical, 96)
    }
}

struct CountUp: View {
    let to: Int
    @State var value = 0
    var body: some View {
        Text("\(value)")
            .contentTransition(.numericText())
            .onAppear {
                guard to > 0 else { return }
                Task {
                    for v in 0...to {
                        try? await Task.sleep(nanoseconds: 90_000_000)
                        withAnimation(.snappy) { value = v }
                    }
                }
            }
    }
}

struct StatsSection: View {
    let stats = [(9, "failure scenarios in the demo harness"),
                 (6, "remediation actions Aura can propose"),
                 (0, "destructive actions without approval")]
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(stats.enumerated()), id: \.offset) { i, s in
                VStack(alignment: .leading, spacing: 12) {
                    CountUp(to: s.0).font(.system(size: 72, weight: .light)).tracking(-3)
                    Text(s.1).font(.system(size: 14)).foregroundStyle(Theme.neutral500)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 40).padding(.horizontal, 24)
                .overlay(alignment: .top) { if i > 0 { Theme.hairline.frame(height: 1) } }
            }
        }
        .overlay(alignment: .top) { Theme.hairline.frame(height: 1) }
        .overlay(alignment: .bottom) { Theme.hairline.frame(height: 1) }
    }
}

struct SpotlightCard<Content: View>: View {
    @ViewBuilder var content: Content
    @State var touch: CGPoint? = nil
    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(28)
            .background {
                ZStack {
                    Theme.card
                    if let p = touch {
                        RadialGradient(colors: [.white.opacity(0.12), .clear], center: .init(x: 0, y: 0),
                                       startRadius: 0, endRadius: 260)
                            .offset(x: p.x, y: p.y)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.white.opacity(0.1)))
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { v in withAnimation(.easeOut(duration: 0.15)) { touch = v.location } }
                .onEnded { _ in withAnimation(.easeOut(duration: 0.6)) { touch = nil } })
    }
}

struct FeaturesSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(eyebrow: "Features", title: "Built for the 3am", serif: "page.")
            VStack(spacing: 14) {
                ForEach(Array(FEATURES.enumerated()), id: \.offset) { i, f in
                    SpotlightCard {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("0\(i + 1)").font(.mono(11)).foregroundStyle(Theme.neutral600)
                            Text(f.0).font(.system(size: 24, weight: .medium)).tracking(-0.5).padding(.top, 48)
                            Text(f.1).font(.system(size: 15)).foregroundStyle(Theme.neutral400).lineSpacing(5).padding(.top, 14)
                        }
                    }
                    .reveal(Double(i) * 0.08)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 96)
    }
}

/// Words light up one by one as the paragraph scrolls up through the screen.
struct StatementSection: View {
    let words = "It doesn't replace your on-call engineer. It makes sure they never start from zero.".split(separator: " ").map(String.init)
    var body: some View {
        GeometryReader { geo in
            let screen = UIScreen.main.bounds.height
            let minY = geo.frame(in: .global).minY
            // 0 when the top hits 85% of the screen, 1 when it reaches 35%
            let progress = min(max((screen * 0.85 - minY) / (screen * 0.5), 0), 1)
            let lit = Int(progress * Double(words.count) + 0.5)
            words.enumerated().reduce(Text("")) { acc, w in
                acc + Text(w.element + " ").foregroundColor(.white.opacity(w.offset < lit ? 1 : 0.15))
            }
            .font(.system(size: 32, weight: .light)).tracking(-0.9)
            .multilineTextAlignment(.center)
            .frame(width: geo.size.width)
            .animation(.easeOut(duration: 0.2), value: lit)
        }
        .frame(height: 220)
        .padding(.horizontal, 24).padding(.vertical, 110)
    }
}

struct CTASection: View {
    @Environment(\.openURL) var openURL
    var body: some View {
        ZStack {
            ThreadsView(amplitude: 0.8).opacity(0.6)
            RadialGradient(colors: [.clear, .black], center: .center, startRadius: 40, endRadius: 360)
            VStack(spacing: 44) {
                TwoToneTitle(plain: "Sleep through", serif: "the next one.", size: 48, alignment: .center).reveal()
                HStack(spacing: 10) {
                    Text("$").foregroundStyle(Theme.neutral500)
                    Text("git clone github.com/B4K2/Aure-agent").lineLimit(1).minimumScaleFactor(0.6)
                    Button("Clone") { openURL(Theme.repo) }
                        .font(.system(size: 14, weight: .medium)).foregroundStyle(.black)
                        .padding(.horizontal, 16).padding(.vertical, 8).background(.white, in: Capsule())
                }
                .font(.mono(12))
                .padding(.leading, 18).padding(.trailing, 6).padding(.vertical, 6)
                .background(Theme.card, in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(0.15)))
                .reveal(0.3)
            }
            .padding(.horizontal, 16)
        }
        .frame(minHeight: 520)
    }
}

struct FooterSection: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("© \(String(Calendar.current.component(.year, from: .now))) Aura")
            HStack(spacing: 24) {
                Link("GitHub", destination: Theme.repo)
                Link("Docs", destination: Theme.dashboard)
            }
        }
        .font(.system(size: 14)).foregroundStyle(Theme.neutral500).tint(Theme.neutral500)
        .frame(maxWidth: .infinity).padding(.vertical, 36)
        .overlay(alignment: .top) { Theme.hairline.frame(height: 1) }
    }
}
