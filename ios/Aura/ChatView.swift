import SwiftUI

/// Talk to Aura. `incident` = nil is the general thread; otherwise the agent gets that incident as context.
struct ChatView: View {
    @Environment(AuraModel.self) var model
    @Environment(\.dismiss) var dismiss
    var incident: String?
    var title = "Ask Aura"
    var starter: String? = nil
    var inSheet = true
    @State var draft = ""
    @FocusState var focused: Bool

    var key: String { incident ?? "" }
    var messages: [AuraModel.ChatMsg] { model.threads[key] ?? [] }
    var waiting: Bool { model.waiting.contains(key) }

    let suggestions = ["What's happening right now?", "What changed recently?",
                       "Any past incidents like this?", "Is the database healthy?"]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if messages.isEmpty { intro }
                        ForEach(messages) { m in bubble(m).id(m.id) }
                        if waiting {
                            HStack(spacing: 10) {
                                LogoMark(size: 16, lapSeconds: 0.9)
                                Text("Aura is thinking…").font(.footnote).foregroundStyle(Theme.dim)
                                Spacer()
                            }
                            .id("waiting")
                        }
                    }
                    .padding(18)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: messages.count) { scrollToBottom(proxy) }
                .onChange(of: waiting) { scrollToBottom(proxy) }
            }
            .background(AppBackground())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if inSheet {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done", systemImage: "checkmark") { dismiss() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) { composer }
            .onAppear {
                if let starter, messages.isEmpty { model.ask(starter, incident: incident) }
            }
        }
    }

    func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation {
            if waiting { proxy.scrollTo("waiting", anchor: .bottom) }
            else if let last = messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
        }
    }

    var intro: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Ask it").font(.system(size: 32, weight: .light))
                Text("anything.").font(.serifItalic(34))
            }
            Text(incident == nil ? "Aura answers with its tools: live signals, logs, deploys, read-only DB queries and memory."
                                 : "Aura has \(incident!) in focus.")
                .font(.subheadline).foregroundStyle(Theme.dim)
            GlassEffectContainer(spacing: 8) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(suggestions, id: \.self) { s in
                        Button(s) { model.ask(s, incident: incident) }
                            .buttonStyle(.glass)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 10)
    }

    @ViewBuilder func bubble(_ m: AuraModel.ChatMsg) -> some View {
        switch m.role {
        case .me:
            HStack {
                Spacer(minLength: 50)
                Text(m.text).foregroundStyle(.black)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.white, in: .rect(cornerRadius: 20))
            }
        case .tool:
            Label(m.text, systemImage: "wrench.and.screwdriver").font(.mono(11)).foregroundStyle(Theme.faint)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .aura:
            HStack {
                Text((try? AttributedString(markdown: m.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(m.text))
                    .textSelection(.enabled)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .glassEffect(.regular, in: .rect(cornerRadius: 20))
                Spacer(minLength: 30)
            }
        }
    }

    var composer: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                TextField("Ask Aura…", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
                Button {
                    model.ask(draft, incident: incident); draft = ""
                } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.semibold)).frame(width: 30, height: 30)
                }
                .buttonStyle(.glassProminent).tint(.white).foregroundStyle(.black)
                .buttonBorderShape(.circle)
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || waiting)
            }
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
    }
}
