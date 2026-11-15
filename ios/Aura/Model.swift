import SwiftUI

struct Metrics {
    var rps: Double, p95: Double, err: Double, rss: Double, db: Double
    static let base = Metrics(rps: 42, p95: 120, err: 0.2, rss: 180, db: 14)
}

struct Evidence: Identifiable {
    enum Kind { case anomaly, evidence, hypothesis }
    let id = UUID()
    let kind: Kind
    let label: String
    let text: String
}

struct Scenario: Identifiable {
    let id: String
    let title: String
    let icon: String
    let summary: String
    let target: Metrics
    let evidence: [Evidence]
    let confidence: Double
    let action: String
    let resolved: String
}

struct IncidentRecord: Identifiable {
    let id = UUID()
    let number: Int
    let scenario: Scenario
    let approved: Bool
    let note: String
    let date: Date
}

let SCENARIOS: [Scenario] = [
    Scenario(id: "bad-deploy-checkout-500", title: "Bad deploy", icon: "shippingbox",
             summary: "Renamed column, every checkout 500s",
             target: Metrics(rps: 42, p95: 340, err: 31, rss: 190, db: 16),
             evidence: [
                .init(kind: .anomaly, label: "Anomaly", text: "5xx 0.2% → 31% on POST /api/orders"),
                .init(kind: .evidence, label: "Logs", text: "column \"shipping_address\" of relation \"orders\" does not exist"),
                .init(kind: .evidence, label: "Change", text: "Deploy f63edba \"store address as shipping_address\", 2 min before onset"),
                .init(kind: .evidence, label: "Memory", text: "1 similar incident · INC-0087 (0.81)"),
                .init(kind: .hypothesis, label: "Hypothesis", text: "f63edba writes a column that doesn't exist, so every checkout fails"),
             ], confidence: 0.90,
             action: "Roll back deployment/void-app to the previous revision",
             resolved: "Rolled back · 5xx 31% → 0.1%"),
    Scenario(id: "memory-leak", title: "Memory leak", icon: "memorychip",
             summary: "Response buffer never trims, RSS climbs ~3 MB/s",
             target: Metrics(rps: 40, p95: 410, err: 0.6, rss: 920, db: 15),
             evidence: [
                .init(kind: .anomaly, label: "Anomaly", text: "RSS 180 → 920 MB in ~4 min, not flattening"),
                .init(kind: .evidence, label: "Metrics", text: "Event-loop lag p99 12 ms → 180 ms, GC pauses rising"),
                .init(kind: .evidence, label: "Change", text: "Deploy 9c1e7a0 \"capture response bodies\", 6 min before onset"),
                .init(kind: .evidence, label: "Memory", text: "Restart alone recurred last time (INC-0112, rejected)"),
                .init(kind: .hypothesis, label: "Hypothesis", text: "The capture buffer in 9c1e7a0 is never trimmed: unbounded heap growth"),
             ], confidence: 0.84,
             action: "Roll back deployment/void-app (a restart only buys time)",
             resolved: "Rolled back · RSS steady at 185 MB"),
    Scenario(id: "db-lock", title: "Table lock", icon: "lock",
             summary: "A \"migration\" holds ACCESS EXCLUSIVE on orders",
             target: Metrics(rps: 30, p95: 4800, err: 6, rss: 200, db: 61),
             evidence: [
                .init(kind: .anomaly, label: "Anomaly", text: "9 sessions waiting on locks, longest 41 s"),
                .init(kind: .evidence, label: "Postgres", text: "Blocked by pid 4182 schema-migrate (idle in transaction)"),
                .init(kind: .evidence, label: "Change", text: "No deploy within 15 min of onset"),
                .init(kind: .hypothesis, label: "Hypothesis", text: "schema-migrate holds the orders lock; checkout queues behind it"),
             ], confidence: 0.88,
             action: "Terminate DB sessions where application_name = schema-migrate",
             resolved: "1 session terminated · p95 back to 130 ms"),
    Scenario(id: "db-outage", title: "DB outage", icon: "cylinder.split.1x2",
             summary: "Postgres goes away",
             target: Metrics(rps: 6, p95: 900, err: 100, rss: 170, db: 0),
             evidence: [
                .init(kind: .anomaly, label: "Anomaly", text: "/api/health unreachable · void-db not running"),
                .init(kind: .evidence, label: "Logs", text: "ECONNREFUSED 10.96.4.12:5432"),
                .init(kind: .hypothesis, label: "Hypothesis", text: "The database is down and took the app with it"),
             ], confidence: 0.95,
             action: "Scale statefulset/void-db to 1, then restart the app",
             resolved: "void-db ready · health ok for 3 checks"),
    Scenario(id: "traffic-spike", title: "Traffic spike", icon: "chart.line.uptrend.xyaxis",
             summary: "Flash sale, 300 extra shoppers",
             target: Metrics(rps: 380, p95: 900, err: 1.4, rss: 260, db: 48),
             evidence: [
                .init(kind: .anomaly, label: "Anomaly", text: "p95 120 → 900 ms while rps 42 → 380"),
                .init(kind: .evidence, label: "Change", text: "No deploy within 15 min of onset"),
                .init(kind: .hypothesis, label: "Hypothesis", text: "Real load, not a regression: capacity is the limit"),
             ], confidence: 0.79,
             action: "Add replicas (advisory, nothing destructive)",
             resolved: "Noted · traffic tapering"),
]

/// Scripted on-device Aura: live metrics, one incident at a time, approve/reject.
@Observable @MainActor
final class AuraModel {
    enum Phase: Equatable { case healthy, investigating, proposed, fixing, resolved }

    var phase: Phase = .healthy
    var scenario: Scenario?
    var shown: [Evidence] = []
    var history: [Metrics] = Array(repeating: .base, count: 40)
    var records: [IncidentRecord] = []

    private var target = Metrics.base
    private var ticking = false
    private var run: Task<Void, Never>?

    var now: Metrics { history.last ?? .base }

    func startTicking() async {
        guard !ticking else { return }
        ticking = true
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(900))
            let l = now
            func step(_ a: Double, _ b: Double, _ j: Double) -> Double { max(0, a + (b - a) * 0.3 + Double.random(in: -j...j)) }
            let next = Metrics(rps: step(l.rps, target.rps, 2), p95: step(l.p95, target.p95, 6),
                               err: step(l.err, target.err, 0.05), rss: step(l.rss, target.rss, 2),
                               db: step(l.db, target.db, 0.8))
            history = Array(history.dropFirst()) + [next]
        }
    }

    func inject(_ s: Scenario) {
        run?.cancel()
        scenario = s
        shown = []
        phase = .investigating
        target = s.target
        run = Task {
            for e in s.evidence {
                try? await Task.sleep(for: .milliseconds(1100))
                if Task.isCancelled { return }
                withAnimation(.spring(duration: 0.5)) { shown.append(e) }
            }
            try? await Task.sleep(for: .milliseconds(700))
            withAnimation(.spring) { phase = .proposed }
        }
    }

    func approve() {
        guard let s = scenario, phase == .proposed else { return }
        withAnimation { phase = .fixing }
        run = Task {
            try? await Task.sleep(for: .seconds(1.6))
            target = .base
            withAnimation(.spring) {
                phase = .resolved
                records.insert(IncidentRecord(number: 200 + records.count, scenario: s, approved: true,
                                              note: s.resolved, date: .now), at: 0)
            }
        }
    }

    func reject(reason: String) {
        guard let s = scenario, phase == .proposed else { return }
        target = .base
        withAnimation(.spring) {
            phase = .resolved
            records.insert(IncidentRecord(number: 200 + records.count, scenario: s, approved: false,
                                          note: reason.isEmpty ? "Rejected" : "Rejected: \(reason)", date: .now), at: 0)
        }
    }

    func dismiss() {
        run?.cancel()
        withAnimation(.spring) { phase = .healthy; scenario = nil; shown = [] }
    }
}
