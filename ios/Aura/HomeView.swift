import SwiftUI
import Charts

struct HomeView: View {
    @Environment(AuraModel.self) var model
    var openIncident: () -> Void
    @State var showConnect = false

    var dotColor: Color {
        switch model.link {
        case .live: .white
        case .connecting: .white.opacity(0.5)
        default: .white.opacity(model.isLive ? 0.2 : 0.5)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    hero
                    StatusCard(openIncident: openIncident)
                    metrics
                    if !model.isLive { breakSomething }
                    pipeline
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .background(AppBackground())
            .sheet(isPresented: $showConnect) { ConnectView() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showConnect = true } label: {
                        HStack(spacing: 6) {
                            Circle().fill(dotColor).frame(width: 7, height: 7)
                            Text(model.isLive ? "Live" : "Demo").font(.subheadline.weight(.medium))
                        }
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    HStack(spacing: 8) {
                        LogoMark(size: 20)
                        Text("Aura").font(.headline)
                    }
                    .padding(.horizontal, 6)
                }
            }
        }
    }

    var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Incidents,").font(.system(size: 44, weight: .light)).tracking(-1.5)
            Text("understood.").font(.serifItalic(46)).padding(.top, -14)
            Text("Aura ties anomalies to the deploy that caused them, remembers past incidents and proposes a fix. You approve it.")
                .font(.subheadline).foregroundStyle(Theme.dim).lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }

    var metrics: some View {
        VStack(spacing: 12) {
            Eyebrow(text: model.isLive ? "Live · your service" : "Demo shop")
            let h = model.history
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                MetricTile(name: "Traffic", value: "\(Int(model.now.rps)) rps", values: h.map(\.rps), alert: model.now.rps > 200)
                MetricTile(name: "p95 latency", value: "\(Int(model.now.p95)) ms", values: h.map(\.p95), alert: model.now.p95 > 300)
                MetricTile(name: "Errors", value: String(format: "%.1f%%", model.now.err), values: h.map(\.err), alert: model.now.err > 2)
                MetricTile(name: "Memory", value: "\(Int(model.now.rss)) MB", values: h.map(\.rss), alert: model.now.rss > 500)
            }
        }
    }

    var breakSomething: some View {
        VStack(spacing: 12) {
            Eyebrow(text: "Break something")
            ScrollView(.horizontal) {
                GlassEffectContainer(spacing: 10) {
                    HStack(spacing: 10) {
                        ForEach(SCENARIOS) { s in
                            Button {
                                model.inject(s)
                                openIncident()
                            } label: {
                                Label(s.title, systemImage: s.icon).font(.subheadline.weight(.medium))
                                    .padding(.horizontal, 6).padding(.vertical, 4)
                            }
                            .buttonStyle(.glass)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
    }

    var pipeline: some View {
        VStack(spacing: 12) {
            Eyebrow(text: "How Aura thinks")
            ScrollView(.horizontal) {
                HStack(spacing: 12) {
                    ForEach(STAGES, id: \.n) { s in
                        VStack(alignment: .leading, spacing: 8) {
                            Image(systemName: s.icon).font(.title3)
                            Text(s.name).font(.headline)
                            Text(s.body).font(.footnote).foregroundStyle(Theme.dim).lineSpacing(2)
                            Spacer(minLength: 0)
                            Text(s.n).font(.mono(11)).foregroundStyle(Theme.faint)
                        }
                        .padding(16)
                        .frame(width: 200, height: 190, alignment: .topLeading)
                        .glassEffect(.regular, in: .rect(cornerRadius: 24))
                    }
                }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .scrollTargetBehavior(.viewAligned)
        }
    }
}

struct Stage { let n: String, name: String, icon: String, body: String }
let STAGES: [Stage] = [
    .init(n: "01", name: "Detect", icon: "dot.radiowaves.left.and.right", body: "Watches latency, errors, saturation and DB health. Flags anomalies, not noise."),
    .init(n: "02", name: "Correlate", icon: "arrow.triangle.branch", body: "Lines the onset up against deploys, config changes and traffic shifts."),
    .init(n: "03", name: "Recall", icon: "brain", body: "Searches vector and graph memory for incidents that looked like this one."),
    .init(n: "04", name: "Diagnose", icon: "stethoscope", body: "Forms a root-cause hypothesis with evidence and a confidence score."),
    .init(n: "05", name: "Propose", icon: "hand.raised", body: "Suggests a rollback, restart or scale, and waits for your approval."),
    .init(n: "06", name: "Learn", icon: "book.closed", body: "Writes the outcome, and why you rejected it, back into memory."),
]

struct StatusCard: View {
    @Environment(AuraModel.self) var model
    var openIncident: () -> Void

    var watching: String {
        if case .live(let w) = model.link { return "Watching \(w)" }
        return "Not connected"
    }

    var body: some View {
        let (title, sub, color, icon): (String, String, Color, String) = switch model.phase {
        case .healthy: ("All systems normal", model.isLive ? watching : "Demo mode · scripted on this phone", Theme.ok, "checkmark.seal.fill")
        case .investigating: ("Investigating", model.scenario?.summary ?? "", Theme.warn, "magnifyingglass")
        case .proposed: ("Fix ready for approval", model.scenario?.action ?? "", Theme.warn, "hand.raised.fill")
        case .fixing: ("Applying fix", model.scenario?.action ?? "", Theme.warn, "gearshape.2.fill")
        case .resolved: ("Resolved", model.records.first?.note ?? "", Theme.ok, "checkmark.circle.fill")
        }
        Button(action: openIncident) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.title2).foregroundStyle(color)
                    .symbolEffect(.pulse, isActive: model.phase == .investigating)
                    .frame(width: 36)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline)
                    Text(sub).font(.footnote).foregroundStyle(Theme.dim).lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.faint)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(.white.opacity(model.phase == .healthy ? 0.04 : 0.14)).interactive(), in: .rect(cornerRadius: 26))
    }
}

struct MetricTile: View {
    let name: String, value: String, values: [Double]
    var alert = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(name).font(.caption).foregroundStyle(Theme.dim)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
                .foregroundStyle(alert ? Theme.bad : .white)
                .contentTransition(.numericText())
            Sparkline(values: values, color: alert ? Theme.bad : .white)
                .frame(height: 34)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .animation(.easeOut(duration: 0.4), value: value)
    }
}

struct Sparkline: View {
    let values: [Double], color: Color
    var body: some View {
        Chart(Array(values.enumerated()), id: \.offset) { i, v in
            AreaMark(x: .value("t", i), y: .value("v", v))
                .foregroundStyle(LinearGradient(colors: [color.opacity(0.3), .clear], startPoint: .top, endPoint: .bottom))
                .interpolationMethod(.catmullRom)
            LineMark(x: .value("t", i), y: .value("v", v))
                .foregroundStyle(color.opacity(0.9))
                .lineStyle(StrokeStyle(lineWidth: 1.5))
                .interpolationMethod(.catmullRom)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
    }
}
