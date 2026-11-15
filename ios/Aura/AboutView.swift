import SwiftUI

struct AboutView: View {
    let features: [(String, String, String)] = [
        ("checkmark.shield", "Evidence, not guesses", "Every hypothesis cites the metrics, logs, traces and deploy diffs it came from."),
        ("brain", "Memory that compounds", "Incidents go into Qdrant and Neo4j. The second time a failure shows up, Aura recognises it."),
        ("hand.raised", "Human in the loop", "Rollbacks, restarts and session kills are proposals. Nothing destructive runs without approval."),
        ("bubble.left.and.text.bubble.right", "Ask it anything", "Why this deploy? What else changed? What happened last time?"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Built for the 3am").font(.system(size: 34, weight: .light))
                        Text("page.").font(.serifItalic(36))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 10)

                    ForEach(features, id: \.1) { f in
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: f.0).font(.title3).frame(width: 30)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(f.1).font(.headline)
                                Text(f.2).font(.subheadline).foregroundStyle(Theme.dim)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(16)
                        .glassEffect(.regular, in: .rect(cornerRadius: 22))
                    }

                    Text("It doesn't replace your on-call engineer. It makes sure they never start from zero.")
                        .font(.title3.weight(.light)).multilineTextAlignment(.center)
                        .padding(.vertical, 30)

                    GlassEffectContainer(spacing: 12) {
                        HStack(spacing: 12) {
                            Link(destination: Theme.repo) {
                                Label("GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                            }
                            .buttonStyle(.glassProminent)
                            .tint(.white)
                            .foregroundStyle(.black)
                            Link(destination: Theme.docs) {
                                Label("Docs", systemImage: "book").frame(maxWidth: .infinity).padding(.vertical, 6)
                            }
                            .buttonStyle(.glass)
                        }
                    }
                    Text("© \(String(Calendar.current.component(.year, from: .now))) Aura").font(.caption)
                        .foregroundStyle(Theme.faint).padding(.top, 20)
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
            }
            .background(AppBackground())
            .navigationTitle("About")
        }
    }
}
