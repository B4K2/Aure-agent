import SwiftUI

/// Pick Demo (scripted on the phone) or Live (your real Aura agent).
struct ConnectView: View {
    @Environment(AuraModel.self) var model
    @Environment(\.dismiss) var dismiss
    @State var url = ""
    @State var token = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Connect to").font(.system(size: 32, weight: .light))
                        Text("your agent.").font(.serifItalic(34))
                    }

                    status

                    VStack(spacing: 12) {
                        field("Agent address", text: $url, prompt: "http://192.168.1.10:8700", secure: false)
                        field("API token", text: $token, prompt: "from agent/.aura_state/api_token", secure: true)
                    }

                    GlassEffectContainer(spacing: 12) {
                        VStack(spacing: 12) {
                            Button {
                                model.useLive(url: url, token: token)
                            } label: {
                                Text(model.isLive ? "Reconnect" : "Go live").fontWeight(.semibold)
                                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                            }
                            .buttonStyle(.glassProminent).tint(.white).foregroundStyle(.black)
                            .disabled(url.isEmpty || token.isEmpty)

                            Button {
                                model.useDemo(); dismiss()
                            } label: {
                                Text("Use demo mode").frame(maxWidth: .infinity).padding(.vertical, 6)
                            }
                            .buttonStyle(.glass)
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Eyebrow(text: "On the machine running Aura")
                        Text("""
                        1. Listen on the network, not just localhost:
                           AURA_API_HOST=0.0.0.0 uv run python -m aura.main
                        2. Use that machine's LAN IP above (same Wi-Fi as the phone), port 8700.
                        3. Token: run /web in the aura CLI, or cat agent/.aura_state/api_token.
                        """)
                        .font(.mono(11.5)).foregroundStyle(Theme.dim).lineSpacing(3)
                    }
                    .padding(16)
                    .glassEffect(.regular, in: .rect(cornerRadius: 20))
                }
                .padding(20)
            }
            .background(AppBackground())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
            .onAppear { url = model.serverURL; token = model.token }
            .onChange(of: model.link) { if case .live = model.link { dismiss() } }
        }
        .presentationDetents([.large])
    }

    @ViewBuilder var status: some View {
        let (icon, text): (String, String) = switch model.link {
        case .off: ("circle.dashed", model.isLive ? "Disconnected" : "Demo mode: data is scripted on this phone")
        case .connecting: ("antenna.radiowaves.left.and.right", "Connecting…")
        case .live(let w): ("checkmark.circle.fill", "Live · watching \(w)")
        case .failed(let why): ("exclamationmark.circle", why)
        }
        Label(text, systemImage: icon).font(.subheadline).foregroundStyle(Theme.dim)
    }

    func field(_ title: String, text: Binding<String>, prompt: String, secure: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(Theme.faint)
            Group {
                if secure { SecureField(prompt, text: text) } else { TextField(prompt, text: text).keyboardType(.URL) }
            }
            .font(.mono(14))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 16).padding(.vertical, 13)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
    }
}
