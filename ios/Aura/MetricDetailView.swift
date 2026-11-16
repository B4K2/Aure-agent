import SwiftUI
import Charts

/// Full-size chart for one metric. Drag across it to read exact points.
/// The readout sits in a fixed bar above the plot, so a finger on the chart never covers it.
struct MetricDetailView: View {
    @Environment(AuraModel.self) var model
    @Environment(\.dismiss) var dismiss
    let metric: MetricKind
    @State var selected: Int?

    struct Point: Identifiable { let i: Int, v: Double, at: Date; var id: Int { i } }

    var points: [Point] {
        model.history.enumerated().map { Point(i: $0.offset, v: metric.value($0.element), at: $0.element.at) }
    }

    var areaColor: Color { metric.color(points.last?.v ?? 0) }

    var body: some View {
        let pts = points
        let vals = pts.map(\.v)
        let sel = selected.flatMap { s in pts.first { $0.i == s } }
        let shown = sel ?? pts.last
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                // readout: always above the chart, out of the thumb's way
                VStack(alignment: .leading, spacing: 4) {
                    Text(sel == nil ? "Now" : shown.map { $0.at.formatted(date: .omitted, time: .standard) } ?? "")
                        .font(.mono(12)).foregroundStyle(Theme.dim)
                    Text(shown.map { metric.format($0.v) } ?? "–")
                        .font(.system(size: 40, weight: .semibold)).monospacedDigit()
                        .foregroundStyle(shown.map { metric.alert($0.v) } == true ? Theme.bad : .white)
                        .contentTransition(.numericText())
                }
                .animation(.snappy(duration: 0.15), value: selected)

                Chart {
                    ForEach(pts) { p in
                        AreaMark(x: .value("t", p.i), y: .value(metric.name, p.v))
                            .foregroundStyle(LinearGradient(colors: [areaColor.opacity(0.25), .clear], startPoint: .top, endPoint: .bottom))
                            .interpolationMethod(.monotone)
                        LineMark(x: .value("t", p.i), y: .value(metric.name, p.v))
                            .foregroundStyle(.white)
                            .lineStyle(StrokeStyle(lineWidth: 2))
                            .interpolationMethod(.monotone)
                    }
                    if let t = metric.threshold {
                        RuleMark(y: .value("limit", t))
                            .foregroundStyle(Theme.bad.opacity(0.6))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    }
                    if let s = sel {
                        RuleMark(x: .value("t", s.i)).foregroundStyle(.white.opacity(0.35))
                        PointMark(x: .value("t", s.i), y: .value(metric.name, s.v))
                            .foregroundStyle(metric.alert(s.v) ? Theme.bad : .white)
                            .symbolSize(90)
                    }
                }
                .chartXSelection(value: $selected)
                .chartXAxis(.hidden)
                .chartYScale(domain: .automatic(includesZero: false))
                .chartYAxis {
                    AxisMarks(position: .leading) { _ in
                        AxisGridLine().foregroundStyle(.white.opacity(0.08))
                        AxisValueLabel().foregroundStyle(Theme.faint)
                    }
                }
                .frame(height: 280)
                .sensoryFeedback(.selection, trigger: selected)

                HStack {
                    stat("Min", vals.min()); stat("Avg", vals.isEmpty ? nil : vals.reduce(0, +) / Double(vals.count)); stat("Max", vals.max())
                }
                Text("Drag across the chart to inspect a point. Last \(pts.count) samples.")
                    .font(.footnote).foregroundStyle(Theme.faint)
                Spacer()
            }
            .padding(20)
            .background(AppBackground())
            .navigationTitle(metric.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done", systemImage: "checkmark") { dismiss() } }
            }
        }
    }

    func stat(_ label: String, _ v: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(Theme.dim)
            Text(v.map(metric.format) ?? "–").font(.headline).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum MetricKind: String, Identifiable {
    case rps, p95, err, rss
    var id: String { rawValue }
    var name: String { switch self { case .rps: "Traffic"; case .p95: "p95 latency"; case .err: "Errors"; case .rss: "Memory" } }
    func value(_ m: Metrics) -> Double { switch self { case .rps: m.rps; case .p95: m.p95; case .err: m.err; case .rss: m.rss } }
    func format(_ v: Double) -> String {
        switch self { case .rps: "\(Int(v)) rps"; case .p95: "\(Int(v)) ms"; case .err: String(format: "%.1f%%", v); case .rss: "\(Int(v)) MB" }
    }
    var threshold: Double? { switch self { case .rps: 200; case .p95: 300; case .err: 2; case .rss: 500 } }
    func alert(_ v: Double) -> Bool { threshold.map { v > $0 } ?? false }
    func color(_ v: Double) -> Color { alert(v) ? Theme.bad : .white }
}
