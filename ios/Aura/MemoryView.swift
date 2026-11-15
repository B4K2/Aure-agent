import SwiftUI

struct MemoryView: View {
    @Environment(AuraModel.self) var model

    var body: some View {
        NavigationStack {
            ScrollView {
                if model.records.isEmpty {
                    ContentUnavailableView("Nothing remembered yet", systemImage: "brain",
                                           description: Text("Resolved and rejected incidents land here. The second time a failure shows up, Aura recognises it."))
                        .padding(.top, 80)
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(model.records) { r in
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: r.approved ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .font(.title3).foregroundStyle(r.approved ? Theme.ok : Theme.bad)
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text("INC-\(String(format: "%04d", r.number))").font(.mono(12, .medium))
                                        Spacer()
                                        Text(r.date, style: .time).font(.caption).foregroundStyle(Theme.faint)
                                    }
                                    Text(r.scenario.title).font(.headline)
                                    Text(r.note).font(.footnote).foregroundStyle(Theme.dim)
                                }
                            }
                            .padding(16)
                            .glassEffect(.regular, in: .rect(cornerRadius: 22))
                        }
                    }
                    .padding(.horizontal, 18)
                }
            }
            .background(AppBackground(tint: .teal))
            .navigationTitle("Memory")
        }
    }
}
