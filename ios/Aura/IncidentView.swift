import SwiftUI

/// The incident as it unfolds: evidence cards stream in, then a glass approve/reject bar.
struct IncidentView: View {
    @Environment(AuraModel.self) var model
    @State var rejecting = false
    @State var reason = ""
    @State var chatting = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    if model.scenario != nil {
                        VStack(spacing: 14) {
                            header(s)
                            ForEach(model.shown) { e in
                                EvidenceCard(e: e, confidence: e.kind == .hypothesis ? s.confidence : nil)
                                    .transition(.move(edge: .bottom).combined(with: .opacity))
                                    .id(e.id)
                            }
                            if model.phase == .investigating {
                                HStack(spacing: 10) {
                                    LogoMark(size: 16, lapSeconds: 0.9)
                                    Text("Aura is investigating…").font(.footnote).foregroundStyle(Theme.dim)
                                }
                                .padding(.top, 6)
                            }
                            if model.phase != .investigating {
                                ProposalCard(scenario: s, phase: model.phase).id("proposal")
                            }
                        }
                        .padding(.horizontal, 18)
                        .padding(.bottom, 120)
                    } else {
                        empty
                    }
                }
                .scrollIndicators(.hidden)
                .onChange(of: model.shown.count) {
                    if let last = model.shown.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
                .onChange(of: model.phase) {
                    withAnimation { proxy.scrollTo("proposal", anchor: .bottom) }
                }
            }
            .background(AppBackground(glow: model.phase == .healthy || model.phase == .resolved ? 1 : 1.6))
            .navigationTitle("Incident")
            .toolbar {
                if model.scenario != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Ask about this incident", systemImage: "bubble.left.and.text.bubble.right") { chatting = true }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Close", systemImage: "xmark") { model.dismiss() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) { actionBar }
            .sheet(isPresented: $chatting) {
                ChatView(incident: model.isLive ? model.scenario?.id : nil, title: "Ask about this incident")
            }
            .alert("Why reject it?", isPresented: $rejecting) {
                TextField("Reason (saved to memory)", text: $reason)
                Button("Reject", role: .destructive) { model.reject(reason: reason); reason = "" }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Agent said no", isPresented: Binding(get: { model.lastError != nil }, set: { if !$0 { model.lastError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(model.lastError ?? "") }
            .sensoryFeedback(.success, trigger: model.records.count)
            .sensoryFeedback(.warning, trigger: model.phase == .proposed)
        }
    }

    func header(_ s: Scenario) -> some View {
        HStack(spacing: 12) {
            Image(systemName: s.icon).font(.title3).frame(width: 44, height: 44)
                .glassEffect(.regular, in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.title).font(.title3.weight(.semibold))
                Text(s.summary).font(.footnote).foregroundStyle(Theme.dim)
            }
            Spacer()
        }
        .padding(.vertical, 8)
    }

    var empty: some View {
        VStack(spacing: 22) {
            ContentUnavailableView("No active incident", systemImage: "checkmark.seal",
                                   description: Text("Break the demo shop and watch Aura go from anomaly to fix."))
            if model.isLive {
                Text("Aura is watching. Incidents appear here the moment it opens one.")
                    .font(.footnote).foregroundStyle(Theme.dim).multilineTextAlignment(.center).padding(.horizontal, 40)
            } else {
            GlassEffectContainer(spacing: 10) {
                VStack(spacing: 10) {
                    ForEach(SCENARIOS) { s in
                        Button { model.inject(s) } label: {
                            Label(s.title, systemImage: s.icon).frame(maxWidth: 240)
                                .padding(.vertical, 4)
                        }
                        .buttonStyle(.glass)
                    }
                }
            }
            }
        }
        .padding(.top, 60)
    }

    @ViewBuilder var actionBar: some View {
        if model.phase == .proposed {
            GlassEffectContainer(spacing: 12) {
                HStack(spacing: 12) {
                    Button { rejecting = true } label: {
                        Label("Reject", systemImage: "xmark").frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    .buttonStyle(.glass)
                    if model.scenario?.advisory == true {
                        Button { model.investigate() } label: {
                            HStack(spacing: 8) {
                                if model.thinking { ProgressView().controlSize(.small).tint(.black) }
                                else { Image(systemName: "sparkle.magnifyingglass") }
                                Text(model.thinking ? "Investigating…" : "Investigate").fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 6)
                        }
                        .disabled(model.thinking)
                    } else {
                        Button { model.approve() } label: {
                            Label("Approve", systemImage: "checkmark").fontWeight(.semibold)
                                .frame(maxWidth: .infinity).padding(.vertical, 6)
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.white)
                    .foregroundStyle(.black)
                }
            }
            .padding(.horizontal, 18).padding(.bottom, 8)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

struct EvidenceCard: View {
    let e: Evidence
    var confidence: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon).foregroundStyle(color)
                Text(e.label.uppercased()).font(.mono(11, .medium)).tracking(1.5).foregroundStyle(color)
                Spacer()
                if let c = confidence {
                    Text("\(Int(c * 100))% confident").font(.mono(11)).foregroundStyle(Theme.dim)
                }
            }
            Text(e.text).font(e.kind == .evidence ? .subheadline : .body.weight(.medium))
                .foregroundStyle(e.kind == .evidence ? Theme.dim : .white)
                .fixedSize(horizontal: false, vertical: true)
            if let c = confidence {
                ProgressView(value: c).tint(.white)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(.white.opacity(e.kind == .evidence ? 0 : 0.08)), in: .rect(cornerRadius: 22))
    }

    var icon: String {
        switch e.kind { case .anomaly: "exclamationmark.triangle.fill"; case .evidence: "doc.text.magnifyingglass"; case .hypothesis: "lightbulb.fill" }
    }
    var color: Color {
        switch e.kind { case .anomaly: Theme.bad; case .evidence: Theme.dim; case .hypothesis: Theme.warn }
    }
}

struct ProposalCard: View {
    let scenario: Scenario
    let phase: AuraModel.Phase

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: phase == .resolved ? "checkmark.circle.fill" : "hand.raised.fill")
                    .foregroundStyle(phase == .resolved ? Theme.ok : .white)
                Text(phase == .resolved ? "RESOLVED" : phase == .fixing ? "APPLYING" : "PROPOSED FIX")
                    .font(.mono(11, .medium)).tracking(1.5)
                Spacer()
                if phase == .fixing { ProgressView().controlSize(.small) }
            }
            Text(scenario.action).font(.body.weight(.medium))
            if phase == .resolved {
                Text(scenario.resolved).font(.subheadline).foregroundStyle(Theme.ok)
            } else if phase == .proposed {
                Text(scenario.advisory ? "Advice only. Tap Investigate so Aura can find a concrete fix you can approve."
                                       : "Nothing runs until you approve.").font(.footnote).foregroundStyle(Theme.dim)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(.white.opacity(0.12)), in: .rect(cornerRadius: 24))
    }
}
