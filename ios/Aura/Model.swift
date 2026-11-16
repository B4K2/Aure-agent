import SwiftUI

struct Metrics {
    var rps: Double, p95: Double, err: Double, rss: Double, db: Double
    var at = Date()
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
    /// investigate_further / scale: the agent won't execute these, only advise.
    var advisory: Bool = false
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

// MARK: - App model: Demo (scripted on-device) or Live (a real Aura agent over WebSocket)

@Observable @MainActor
final class AuraModel {
    enum Phase: Equatable { case healthy, investigating, proposed, fixing, resolved }
    enum Mode: String { case demo, live }
    enum Link: Equatable { case off, connecting, live(String), failed(String) }

    struct Remembered: Identifiable, Hashable {
        let id: String, title: String, detail: String, outcome: String, when: String
        var service = "", resolvedBy = "", similarity: Double? = nil
        var fields: [String: String] = [:]
    }

    struct ChatMsg: Identifiable, Equatable {
        enum Role { case me, aura, tool }
        let id = UUID()
        let role: Role
        var text: String
    }

    var mode: Mode = Mode(rawValue: UserDefaults.standard.string(forKey: "aura.mode") ?? "") ?? .demo
    var serverURL = UserDefaults.standard.string(forKey: "aura.url") ?? "http://192.168.1.10:8700"
    var token = Keychain.read("aura.token") ?? ""
    var link: Link = .off
    var lastError: String?
    var thinking = false

    var phase: Phase = .healthy
    var scenario: Scenario?
    var shown: [Evidence] = []
    var history: [Metrics] = Array(repeating: .base, count: 40)
    var records: [IncidentRecord] = []
    var remembered: [Remembered] = []
    var memoryError: String?
    /// Chat threads keyed by incident id; "" is the general thread.
    var threads: [String: [ChatMsg]] = [:]
    var waiting: Set<String> = []
    /// The Aura bubble currently receiving streamed text, per thread.
    private var streaming: [String: UUID] = [:]

    private var target = Metrics.base
    private var ticking = false
    private var run: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var liveIncident: String?

    var now: Metrics { history.last ?? .base }
    var isLive: Bool { mode == .live }

    // MARK: lifecycle

    func start() async {
        Notifier.setUp()
        if mode == .live { connect() }
        guard !ticking else { return }
        ticking = true
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(900))
            guard mode == .demo else { continue }
            let l = now
            func step(_ a: Double, _ b: Double, _ j: Double) -> Double { max(0, a + (b - a) * 0.3 + Double.random(in: -j...j)) }
            push(Metrics(rps: step(l.rps, target.rps, 2), p95: step(l.p95, target.p95, 6),
                         err: step(l.err, target.err, 0.05), rss: step(l.rss, target.rss, 2), db: step(l.db, target.db, 0.8)))
        }
    }

    func useDemo() {
        disconnect()
        mode = .demo
        UserDefaults.standard.set(mode.rawValue, forKey: "aura.mode")
        resetIncident()
        history = Array(repeating: .base, count: 40)
    }

    func useLive(url: String, token: String) {
        serverURL = url.trimmingCharacters(in: .whitespaces)
        self.token = token.trimmingCharacters(in: .whitespaces)
        UserDefaults.standard.set(serverURL, forKey: "aura.url")
        Keychain.write("aura.token", self.token)
        mode = .live
        UserDefaults.standard.set(mode.rawValue, forKey: "aura.mode")
        resetIncident()
        records = []
        connect()
    }

    private func push(_ m: Metrics) { history = Array(history.dropFirst()) + [m] }

    private func resetIncident() {
        run?.cancel()
        phase = .healthy; scenario = nil; shown = []; liveIncident = nil; target = .base
    }

    // MARK: demo

    func inject(_ s: Scenario) {
        guard mode == .demo else { return }
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
        if mode == .live {
            send(["type": "decide", "incident_id": s.id, "decision": "approved", "note": ""])
            return
        }
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
        if mode == .live {
            // the agent requires a reason on reject
            let note = reason.isEmpty ? "rejected from the iOS app" : reason
            withAnimation { phase = .fixing }
            send(["type": "decide", "incident_id": s.id, "decision": "rejected", "note": note])
            return
        }
        target = .base
        withAnimation(.spring) {
            phase = .resolved
            records.insert(IncidentRecord(number: 200 + records.count, scenario: s, approved: false,
                                          note: reason.isEmpty ? "Rejected" : "Rejected: \(reason)", date: .now), at: 0)
        }
    }

    func ask(_ text: String, incident: String?) {
        let key = incident ?? ""
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        threads[key, default: []].append(ChatMsg(role: .me, text: t))
        guard mode == .live, case .live = link else {
            threads[key, default: []].append(ChatMsg(role: .aura, text: "I'm in demo mode. Connect to your agent (tap Demo on Overview) and I'll answer with real data."))
            return
        }
        waiting.insert(key)
        var msg: [String: Any] = ["type": "chat", "text": t]
        if let incident { msg["incident_id"] = incident }
        send(msg)
    }

    /// "New chat": drop this thread here and on the agent so the next question starts fresh.
    func newChat(incident: String?) {
        let key = incident ?? ""
        threads[key] = []
        waiting.remove(key)
        streaming[key] = nil
        var msg: [String: Any] = ["type": "reset"]
        if let incident { msg["incident_id"] = incident }
        send(msg)
    }

    /// Same prompt the CLI's /investigate sends: Aura digs in with its tools and proposes an executable fix.
    func investigate() {
        guard mode == .live, let s = scenario else { return }
        thinking = true
        send(["type": "chat", "incident_id": s.id, "text":
              "Investigate this incident with your tools (current signals, read-only DB queries such as " +
              "pg_stat_activity grouped by application_name, logs, recent diffs). Find the concrete cause, then call " +
              "propose_execution with an executable fix and tell me why."])
    }

    func dismiss() { withAnimation(.spring) { resetIncident() } }

    // MARK: live

    func connect() {
        disconnect()
        guard var comps = URLComponents(string: serverURL), comps.host != nil else {
            link = .failed("That address doesn't look right. Use http://<ip>:8700"); return
        }
        comps.scheme = comps.scheme == "https" ? "wss" : "ws"
        comps.path = "/ws"
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = comps.url else { return }
        link = .connecting
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task
        task.resume()
        Task { await receiveLoop(task) }
    }

    func disconnect() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        if case .live = link { link = .off }
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask) async {
        while socket === task {
            do {
                let msg = try await task.receive()
                var data: Data?
                switch msg {
                case .string(let s): data = s.data(using: .utf8)
                case .data(let d): data = d
                @unknown default: break
                }
                if let d = data, let ev = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { handle(ev) }
            } catch {
                guard socket === task else { return }
                socket = nil
                link = .failed(task.closeCode.rawValue == 4401 ? "Bad token" : "Can't reach the agent at \(serverURL)")
                // retry in a few seconds while still in live mode
                try? await Task.sleep(for: .seconds(5))
                if mode == .live, socket == nil { connect() }
                return
            }
        }
    }

    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
        socket?.send(.string(s)) { _ in }
    }

    private func handle(_ ev: [String: Any]) {
        switch ev["type"] as? String {
        case "hello":
            link = .live(ev["watching"] as? String ?? "agent")
            if let beats = ev["history"] as? [[String: Any]], !beats.isEmpty {
                let ms = beats.suffix(40).map(metrics)
                history = Array(repeating: ms.first!, count: max(0, 40 - ms.count)) + ms
            }
            if let open = (ev["incidents"] as? [[String: Any]])?.first(where: {
                !["resolved", "rejected", "unresolved"].contains($0["status"] as? String ?? "") }),
               let iid = open["incident_id"] as? String {
                send(["type": "get", "incident_id": iid])
            }
            Task { await loadMemory() }
        case "heartbeat":
            push(metrics(ev))
        case "incident_opened":
            guard let iid = ev["incident_id"] as? String else { return }
            liveIncident = iid
            Notifier.post("Incident opened", "Aura is investigating \(iid)", id: iid + "-open")
            withAnimation(.spring) {
                scenario = liveScenario(iid, summary: "Collecting signals…")
                shown = []
                phase = .investigating
            }
        case "anomaly":
            guard let a = ev["anomaly"] as? [String: Any], ev["incident_id"] as? String == liveIncident else { return }
            let label = (a["metric_name"] as? String) ?? (a["signal_type"] as? String) ?? "anomaly"
            withAnimation(.spring) { shown.append(Evidence(kind: .anomaly, label: label, text: a["raw_excerpt"] as? String ?? "")) }
        case "stage":
            guard ev["incident_id"] as? String == liveIncident, let stage = ev["stage"] as? String else { return }
            let detail = ev["detail"] as? String ?? ""
            withAnimation(.spring) {
                shown.append(Evidence(kind: .evidence, label: stage.replacingOccurrences(of: "_", with: " "),
                                      text: detail.isEmpty ? "…" : detail))
            }
        case "awaiting_approval", "action_changed", "closed", "incident":
            if let inc = ev["incident"] as? [String: Any] { apply(inc) }
            if ev["type"] as? String == "closed" { Task { await loadMemory() } }
        case "thinking":
            let key = ev["incident_id"] as? String ?? ""
            if !key.isEmpty, key == scenario?.id, !waiting.contains(key) { thinking = true }
        case "tool":
            guard let name = ev["name"] as? String else { return }
            let key = ev["incident_id"] as? String ?? ""
            let pretty = name.replacingOccurrences(of: "_", with: " ")
            if waiting.contains(key) {
                streaming[key] = nil  // text before a tool call stays as its own bubble
                threads[key, default: []].append(ChatMsg(role: .tool, text: pretty))
            }
            if thinking, key == scenario?.id {
                withAnimation(.spring) { shown.append(Evidence(kind: .evidence, label: "tool", text: pretty)) }
            }
        case "delta":
            let key = ev["incident_id"] as? String ?? ""
            guard waiting.contains(key), let t = ev["text"] as? String else { return }
            var msgs = threads[key, default: []]
            if let sid = streaming[key], let i = msgs.firstIndex(where: { $0.id == sid }) {
                msgs[i].text += t
            } else {
                let m = ChatMsg(role: .aura, text: t)
                streaming[key] = m.id
                msgs.append(m)
            }
            threads[key] = msgs
        case "answer":
            let key = ev["incident_id"] as? String ?? ""
            let text = ev["text"] as? String ?? ""
            if waiting.contains(key) {
                waiting.remove(key)
                var msgs = threads[key, default: []]
                if let sid = streaming.removeValue(forKey: key), let i = msgs.firstIndex(where: { $0.id == sid }) {
                    msgs[i].text = text
                } else {
                    msgs.append(ChatMsg(role: .aura, text: text))
                }
                threads[key] = msgs
            } else if thinking, key == scenario?.id {
                thinking = false
                withAnimation(.spring) { shown.append(Evidence(kind: .hypothesis, label: "Aura", text: text)) }
            }
        case "error":
            thinking = false
            waiting.removeAll()
            streaming.removeAll()
            lastError = ev["message"] as? String
            Notifier.post("Aura error", lastError ?? "Something went wrong", id: "err-\(Date().timeIntervalSince1970)")
            if phase == .fixing { phase = .proposed }
        default: break
        }
    }

    /// A full incident from the agent → the same Scenario/Evidence shapes the views use.
    private func apply(_ inc: [String: Any]) {
        guard let iid = inc["incident_id"] as? String else { return }
        liveIncident = iid
        let status = inc["status"] as? String ?? ""
        let rca = inc["rca"] as? [String: Any] ?? [:]
        let action = rca["proposed_action"] as? [String: Any] ?? [:]
        let actionText = [action["type"] as? String, action["target"] as? String].compactMap { $0 }
            .joined(separator: " → ").replacingOccurrences(of: "_", with: " ")
        let exec = inc["execution_result"] as? [String: Any]
        func nonEmpty(_ v: Any?) -> String? {
            guard let t = (v as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
            return t
        }
        let outcome = nonEmpty(exec?["summary"]) ?? nonEmpty(exec?["detail"])
        let note = nonEmpty(inc["human_note"])
        let resolvedText: String = switch status {
        case "resolved": outcome ?? (actionText.isEmpty ? "Fixed and verified" : "Applied: \(actionText)")
        case "rejected": note.map { "You rejected the fix: \($0)" } ?? "You rejected the proposed fix"
        case "unresolved": outcome ?? "Fix applied, but signals haven't recovered yet"
        default: outcome ?? status.replacingOccurrences(of: "_", with: " ").capitalized
        }

        var ev: [Evidence] = []
        for a in inc["anomalies_detected"] as? [[String: Any]] ?? [] {
            ev.append(Evidence(kind: .anomaly, label: (a["metric_name"] as? String) ?? "anomaly", text: a["raw_excerpt"] as? String ?? ""))
        }
        for e in rca["evidence"] as? [[String: Any]] ?? [] {
            ev.append(Evidence(kind: .evidence, label: (e["source"] as? String ?? "evidence").replacingOccurrences(of: "_", with: " "),
                               text: e["detail"] as? String ?? ""))
        }
        if let h = rca["hypothesis"] as? String { ev.append(Evidence(kind: .hypothesis, label: "Hypothesis", text: h)) }

        let s = Scenario(id: iid, title: iid, icon: "waveform.path.ecg",
                         summary: (rca["root_cause_type"] as? String)?.replacingOccurrences(of: "_", with: " ") ?? status,
                         target: .base, evidence: ev, confidence: (rca["calibrated_confidence"] as? NSNumber)?.doubleValue ?? 0,
                         action: actionText.isEmpty ? "Investigating" : actionText, resolved: resolvedText,
                         advisory: ["investigate_further", "scale"].contains(action["type"] as? String ?? ""))
        notify(iid: iid, status: status, action: actionText, result: resolvedText)
        withAnimation(.spring) {
            scenario = s
            if !ev.isEmpty { shown = ev + shown.filter { $0.label == "Aura" || $0.label == "tool" } }
            switch status {
            case "awaiting_approval": phase = .proposed
            case "executing", "closing": phase = .fixing
            case "resolved", "rejected", "unresolved":
                phase = .resolved
                if !records.contains(where: { $0.scenario.id == iid }) {
                    records.insert(IncidentRecord(number: records.count + 1, scenario: s, approved: status == "resolved",
                                                  note: resolvedText, date: .now), at: 0)
                }
            default: phase = .investigating
            }
        }
    }

    /// One banner per incident state change (the id dedupes repeats of the same state).
    private func notify(iid: String, status: String, action: String, result: String) {
        switch status {
        case "awaiting_approval": Notifier.post("Fix ready for approval", action.isEmpty ? iid : action, id: "\(iid)-\(status)")
        case "resolved": Notifier.post("Resolved", result, id: "\(iid)-\(status)")
        case "rejected", "unresolved": Notifier.post("Incident \(status)", result, id: "\(iid)-\(status)")
        default: break
        }
    }

    private func liveScenario(_ iid: String, summary: String) -> Scenario {
        Scenario(id: iid, title: iid, icon: "waveform.path.ecg", summary: summary, target: .base,
                 evidence: [], confidence: 0, action: "", resolved: "")
    }

    private func metrics(_ b: [String: Any]) -> Metrics {
        func n(_ k: String) -> Double { (b[k] as? NSNumber)?.doubleValue ?? 0 }
        let db = (b["db"] as? [String: Any])?["sessions"] as? NSNumber
        return Metrics(rps: n("rps"), p95: n("p95") * 1000, err: n("err") * 100, rss: n("rss_mb"), db: db?.doubleValue ?? 0)
    }

    func loadMemory() async {
        guard let rows = await getJSON("/memory/incidents") as? [[String: Any]] else { return }
        remembered = rows.prefix(200).map(remembered(from:))
    }

    /// Free-text search over remembered incidents and runbooks (agent's /memory/search).
    func searchMemory(_ q: String) async -> [Remembered] {
        let t = q.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, let res = await getJSON("/memory/search", query: [URLQueryItem(name: "q", value: t)]) as? [String: Any]
        else { return [] }
        let inc = (res["incidents"] as? [[String: Any]] ?? []).map(remembered(from:))
        let books = (res["runbooks"] as? [[String: Any]] ?? []).map { r -> Remembered in
            var m = remembered(from: r)
            m = Remembered(id: "rb-" + m.id, title: (r["title"] as? String) ?? (r["source"] as? String) ?? "Runbook",
                           detail: (r["text"] as? String) ?? m.detail, outcome: "runbook", when: "",
                           similarity: m.similarity, fields: m.fields)
            return m
        }
        return inc + books
    }

    private func remembered(from r: [String: Any]) -> Remembered {
        func str(_ v: Any) -> String {
            if let s = v as? String { return s }
            if let n = v as? NSNumber { return n.stringValue }
            if let d = try? JSONSerialization.data(withJSONObject: v, options: [.prettyPrinted]) { return String(decoding: d, as: UTF8.self) }
            return "\(v)"
        }
        let pretty = { (s: String?) in s?.replacingOccurrences(of: "_", with: " ") }
        return Remembered(
            id: r["incident_id"] as? String ?? r["id"] as? String ?? UUID().uuidString,
            title: pretty(r["root_cause_type"] as? String)?.capitalized ?? (r["incident_id"] as? String ?? "Incident"),
            detail: (r["text"] as? String) ?? (r["hypothesis"] as? String) ?? "",
            outcome: r["outcome"] as? String ?? "",
            when: String((r["timestamp"] as? String ?? "").prefix(16)).replacingOccurrences(of: "T", with: " "),
            service: r["service"] as? String ?? "",
            resolvedBy: pretty(r["resolved_by"] as? String) ?? "",
            similarity: (r["similarity"] as? NSNumber)?.doubleValue,
            fields: r.mapValues(str))
    }

    private func getJSON(_ path: String, query: [URLQueryItem] = []) async -> Any? {
        guard mode == .live, var comps = URLComponents(string: serverURL) else { return nil }
        comps.path = path
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { return nil }
        var req = URLRequest(url: url)
        req.setValue(token, forHTTPHeaderField: "x-aura-token")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let body = try? JSONSerialization.jsonObject(with: data)
            guard code == 200 else {
                memoryError = (body as? [String: Any])?["detail"] as? String ?? "HTTP \(code)"
                return nil
            }
            memoryError = nil
            return body
        } catch {
            memoryError = "Can't reach the agent"
            return nil
        }
    }
}

// MARK: - Token storage

enum Keychain {
    static func write(_ key: String, _ value: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
        var add = q
        add[kSecValueData as String] = Data(value.utf8)
        SecItemAdd(add as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
}
