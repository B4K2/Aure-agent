import SwiftUI

/// A pretend Aura CLI: replays one incident when it appears, then takes commands.
/// Fully scripted on-device (no agent behind it); scenarios mirror the web demo.
struct TermLine: Identifiable {
    enum Tone { case dim, bright, prompt, ok, bad }
    let id = UUID()
    let text: String
    var tone: Tone = .dim
    var pause: UInt64 = 0
}

struct Scenario {
    let summary: String
    let detect: [TermLine]
    let action: String
    let resolved: String
}

let SCENARIOS: [(String, Scenario)] = [
    ("bad-deploy-checkout-500", Scenario(
        summary: "renamed column, every checkout 500s",
        detect: [
            TermLine(text: "● anomaly  5xx 0.2% → 31% · POST /api/orders 500", tone: .bright, pause: 500),
            TermLine(text: "  logs        column \"shipping_address\" does not exist"),
            TermLine(text: "  change      deploy f63edba 2m before onset"),
            TermLine(text: "  memory      1 similar · INC-0087 (0.81)", pause: 600),
            TermLine(text: "◆ hypothesis  f63edba writes a missing column → checkout fails", tone: .bright),
            TermLine(text: "  confidence  0.90"),
        ],
        action: "rollback → deployment/void-app previous revision",
        resolved: "✓ rolled back · 5xx 31% → 0.1% · written to memory")),
    ("memory-leak", Scenario(
        summary: "response buffer never trims, RSS climbs",
        detect: [
            TermLine(text: "● anomaly  RSS 180 → 920 MB in ~4 min, not flattening", tone: .bright, pause: 500),
            TermLine(text: "  metrics     event-loop lag p99 12ms → 180ms"),
            TermLine(text: "  change      deploy 9c1e7a0 6m before onset"),
            TermLine(text: "  memory      restart alone recurred (INC-0112)", pause: 600),
            TermLine(text: "◆ hypothesis  capture buffer never trimmed → heap growth", tone: .bright),
            TermLine(text: "  confidence  0.84"),
        ],
        action: "rollback → deployment/void-app previous revision",
        resolved: "✓ rolled back · RSS steady at 185 MB")),
    ("db-lock", Scenario(
        summary: "a \"migration\" holds ACCESS EXCLUSIVE on orders",
        detect: [
            TermLine(text: "● anomaly  9 sessions waiting on locks, longest 41s", tone: .bright, pause: 500),
            TermLine(text: "  postgres    blocked by pid 4182 schema-migrate"),
            TermLine(text: "  change      no deploy within 15 min", pause: 600),
            TermLine(text: "◆ hypothesis  schema-migrate holds the orders lock", tone: .bright),
            TermLine(text: "  confidence  0.88"),
        ],
        action: "terminate_db_sessions → application_name = schema-migrate",
        resolved: "✓ 1 session terminated · p95 back to 130 ms")),
    ("db-outage", Scenario(
        summary: "Postgres goes away",
        detect: [
            TermLine(text: "● anomaly  /api/health unreachable · void-db not running", tone: .bright, pause: 500),
            TermLine(text: "  logs        ECONNREFUSED 10.96.4.12:5432", pause: 600),
            TermLine(text: "◆ hypothesis  the database is down and took the app with it", tone: .bright),
            TermLine(text: "  confidence  0.95"),
        ],
        action: "start_db → scale statefulset/void-db to 1, restart app",
        resolved: "✓ void-db ready · health ok for 3 checks")),
    ("traffic-spike", Scenario(
        summary: "flash sale, 300 extra shoppers",
        detect: [
            TermLine(text: "● anomaly  p95 120ms → 900ms while rps 42 → 380", tone: .bright, pause: 500),
            TermLine(text: "  change      no deploy within 15 min", pause: 600),
            TermLine(text: "◆ hypothesis  real load, not a regression", tone: .bright),
            TermLine(text: "  confidence  0.79"),
        ],
        action: "scale (advisory) → add replicas",
        resolved: "✓ noted · traffic tapering · written to memory")),
]

@MainActor
final class TerminalModel: ObservableObject {
    @Published var lines: [TermLine] = []
    @Published var busy = false
    private var pending: Scenario?
    private var handled: [String] = []
    private var started = false

    func startIfNeeded() {
        guard !started else { return }
        started = true
        Task {
            await typeOut("$ node inject.js bad-deploy-checkout-500", tone: .prompt)
            await run("bad-deploy-checkout-500")
            await say(TermLine(text: "/approve", tone: .prompt, pause: 900))
            await approve()
            await say(TermLine(text: "type /help to take the keyboard", tone: .dim, pause: 400))
        }
    }

    func submit(_ raw: String) {
        let cmd = raw.trimmingCharacters(in: .whitespaces)
        guard !cmd.isEmpty, !busy else { return }
        lines.append(TermLine(text: "› " + cmd, tone: .prompt))
        let parts = cmd.split(separator: " ", maxSplits: 1).map(String.init)
        Task {
            switch parts[0] {
            case "/help":
                for (c, d) in [("/scenarios", "what you can break"), ("/inject <name>", "break the shop"),
                               ("/approve", "run the proposed fix"), ("/reject <why>", "decline; stored in memory"),
                               ("/incidents", "handled this session"), ("/clear", "clear the screen")] {
                    lines.append(TermLine(text: "  " + c.padding(toLength: 16, withPad: " ", startingAt: 0) + d))
                }
            case "/scenarios":
                for (n, s) in SCENARIOS { lines.append(TermLine(text: "  \(n)  — \(s.summary)")) }
            case "/inject":
                let name = parts.count > 1 ? parts[1] : ""
                if SCENARIOS.contains(where: { $0.0 == name }) { await run(name) }
                else { lines.append(TermLine(text: "unknown scenario. try /scenarios", tone: .bad)) }
            case "/approve":
                if pending != nil { await approve() }
                else { lines.append(TermLine(text: "nothing to approve", tone: .dim)) }
            case "/reject":
                if pending != nil {
                    pending = nil
                    lines.append(TermLine(text: "✕ rejected · reason stored in memory", tone: .bad))
                } else { lines.append(TermLine(text: "nothing to reject", tone: .dim)) }
            case "/incidents":
                if handled.isEmpty { lines.append(TermLine(text: "none yet")) }
                for (i, h) in handled.enumerated() { lines.append(TermLine(text: "  INC-\(String(format: "%04d", 200 + i))  \(h)")) }
            case "/clear":
                lines.removeAll()
            default:
                lines.append(TermLine(text: "unknown command. try /help", tone: .bad))
            }
        }
    }

    private func run(_ name: String) async {
        guard let s = SCENARIOS.first(where: { $0.0 == name })?.1 else { return }
        busy = true
        await say(TermLine(text: "injected \(name) · watching…", tone: .dim, pause: 700))
        for l in s.detect { await say(l) }
        await say(TermLine(text: "▲ proposed     \(s.action)", tone: .bright, pause: 400))
        await say(TermLine(text: "  waiting for /approve or /reject", tone: .dim))
        pending = s
        handled.append(name)
        busy = false
    }

    private func approve() async {
        guard let s = pending else { return }
        busy = true
        await say(TermLine(text: "running…", tone: .dim, pause: 900))
        await say(TermLine(text: s.resolved, tone: .ok, pause: 300))
        pending = nil
        busy = false
    }

    private func say(_ l: TermLine) async {
        try? await Task.sleep(nanoseconds: (l.pause + 220) * 1_000_000)
        lines.append(l)
    }

    private func typeOut(_ text: String, tone: TermLine.Tone) async {
        lines.append(TermLine(text: "", tone: tone))
        for i in text.indices {
            try? await Task.sleep(nanoseconds: 35_000_000)
            lines[lines.count - 1] = TermLine(text: String(text[...i]), tone: tone)
        }
    }
}

struct TerminalView: View {
    @StateObject var model = TerminalModel()
    @State var input = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                ForEach(0..<3) { _ in Circle().fill(Color.white.opacity(0.15)).frame(width: 10, height: 10) }
                Spacer()
                Text("aura — incident").font(.mono(11)).foregroundStyle(Theme.neutral500)
                Spacer()
                Color.clear.frame(width: 42, height: 1)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            Divider().overlay(Theme.hairline)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(model.lines) { l in
                            Text(l.text).font(.mono(11.5)).foregroundStyle(color(l.tone))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(l.id)
                        }
                    }
                    .padding(14)
                }
                .frame(height: 320)
                .onChange(of: model.lines.count) {
                    if let last = model.lines.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }

            Divider().overlay(Theme.hairline)
            HStack {
                Text("›").font(.mono(13)).foregroundStyle(Theme.neutral500)
                TextField("", text: $input, prompt: Text("/help").foregroundColor(Theme.neutral600))
                    .font(.mono(13))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .onSubmit { model.submit(input); input = "" }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.12)))
        .onAppear { model.startIfNeeded() }
    }

    private func color(_ t: TermLine.Tone) -> Color {
        switch t {
        case .dim: Theme.neutral500
        case .bright: .white
        case .prompt: Theme.neutral300
        case .ok: Color(red: 0.45, green: 0.85, blue: 0.55)
        case .bad: Color(red: 0.95, green: 0.4, blue: 0.4)
        }
    }
}
