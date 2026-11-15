import SwiftUI

struct MemoryView: View {
    @Environment(AuraModel.self) var model
    @State var query = ""
    @State var results: [AuraModel.Remembered]? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                if model.isLive {
                    live
                } else {
                    demo
                }
            }
            .background(AppBackground())
            .navigationTitle("Memory")
            .navigationDestination(for: AuraModel.Remembered.self) { MemoryDetailView(item: $0) }
            .refreshable { await model.loadMemory() }
            .searchable(text: $query, prompt: "Search past incidents and runbooks")
            .onSubmit(of: .search) { Task { results = await model.searchMemory(query) } }
            .onChange(of: query) { if query.isEmpty { results = nil } }
            .task { if model.isLive { await model.loadMemory() } }
        }
    }

    @ViewBuilder var live: some View {
        let items = results ?? model.remembered
        if let err = model.memoryError, items.isEmpty {
            ContentUnavailableView("Memory unavailable", systemImage: "externaldrive.badge.xmark",
                                   description: Text(err + "\n\nStart Qdrant and Neo4j: cd agent && docker compose up -d"))
                .padding(.top, 60)
        } else if items.isEmpty {
            ContentUnavailableView(results == nil ? "Nothing remembered yet" : "No matches", systemImage: "brain",
                                   description: Text("Resolved and rejected incidents land here."))
                .padding(.top, 60)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(items) { r in
                    NavigationLink(value: r) { MemoryRow(r: r) }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 18).padding(.bottom, 30)
        }
    }

    @ViewBuilder var demo: some View {
        if model.records.isEmpty {
            ContentUnavailableView("Nothing remembered yet", systemImage: "brain",
                                   description: Text("Resolved and rejected incidents land here. The second time a failure shows up, Aura recognises it."))
                .padding(.top, 80)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(model.records) { r in
                    let m = AuraModel.Remembered(id: r.id.uuidString, title: r.scenario.title,
                                                 detail: r.scenario.evidence.map(\.text).joined(separator: "\n"),
                                                 outcome: r.approved ? "confirmed" : "rejected",
                                                 when: r.date.formatted(date: .omitted, time: .shortened),
                                                 resolvedBy: r.approved ? r.scenario.action : "",
                                                 fields: ["note": r.note])
                    NavigationLink(value: m) { MemoryRow(r: m) }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 18)
        }
    }
}

struct MemoryRow: View {
    let r: AuraModel.Remembered
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(r.outcome.uppercased()).font(.mono(11, .medium)).tracking(1.5)
                    .foregroundStyle(r.outcome == "confirmed" ? .white : Theme.faint)
                if let s = r.similarity { Text("· \(Int(s * 100))% match").font(.mono(11)).foregroundStyle(Theme.faint) }
                Spacer()
                Text(r.when).font(.caption).foregroundStyle(Theme.faint)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.faint)
            }
            Text(r.title).font(.headline)
            Text(r.detail).font(.footnote).foregroundStyle(Theme.dim).lineLimit(3)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
    }
}

struct MemoryDetailView: View {
    let item: AuraModel.Remembered
    @State var asking = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.outcome.uppercased()).font(.mono(11, .medium)).tracking(1.5).foregroundStyle(Theme.dim)
                    Text(item.title).font(.system(size: 30, weight: .light))
                    Text(item.id).font(.mono(12)).foregroundStyle(Theme.faint).textSelection(.enabled)
                }
                .padding(.bottom, 6)

                if !item.service.isEmpty || !item.resolvedBy.isEmpty || !item.when.isEmpty {
                    VStack(spacing: 10) {
                        row("Service", item.service)
                        row("Resolved by", item.resolvedBy)
                        row("When", item.when)
                    }
                    .padding(16)
                    .glassEffect(.regular, in: .rect(cornerRadius: 20))
                }

                if !item.detail.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Eyebrow(text: "What Aura remembers")
                        Text(item.detail).font(.body).textSelection(.enabled)
                    }
                    .padding(16)
                    .glassEffect(.regular, in: .rect(cornerRadius: 20))
                }

                let shown: Set<String> = ["text", "root_cause_type", "outcome", "timestamp", "service", "resolved_by", "incident_id"]
                let extra = item.fields.filter { !shown.contains($0.key) }.sorted { $0.key < $1.key }
                if !extra.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Eyebrow(text: "All fields")
                        ForEach(extra, id: \.key) { k, v in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(k.replacingOccurrences(of: "_", with: " ")).font(.caption).foregroundStyle(Theme.faint)
                                Text(v).font(.mono(12.5)).textSelection(.enabled)
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassEffect(.regular, in: .rect(cornerRadius: 20))
                }

                Button { asking = true } label: {
                    Label("Ask Aura about this", systemImage: "bubble.left.and.text.bubble.right")
                        .fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.glassProminent).tint(.white).foregroundStyle(.black)
                .padding(.top, 6)
            }
            .padding(18)
        }
        .background(AppBackground())
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $asking) {
            ChatView(incident: nil, title: "Ask Aura",
                     starter: "Tell me about past incident \(item.id) (\(item.title)). What happened, what fixed it, and what should I watch for?")
        }
    }

    @ViewBuilder func row(_ k: String, _ v: String) -> some View {
        if !v.isEmpty {
            HStack(alignment: .top) {
                Text(k).font(.subheadline).foregroundStyle(Theme.faint)
                Spacer()
                Text(v).font(.subheadline).multilineTextAlignment(.trailing)
            }
        }
    }
}
