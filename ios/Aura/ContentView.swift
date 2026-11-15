import SwiftUI

enum AppTab: Hashable { case home, incident, ask, memory, about }

struct RootView: View {
    @Environment(AuraModel.self) var model
    @State var tab: AppTab = .home

    var body: some View {
        TabView(selection: $tab) {
            Tab("Overview", systemImage: "circle.circle", value: AppTab.home) {
                HomeView(openIncident: { tab = .incident })
            }
            Tab("Incident", systemImage: "waveform.path.ecg", value: AppTab.incident) {
                IncidentView()
            }
            .badge(model.phase == .proposed ? 1 : 0)
            Tab("Ask", systemImage: "bubble.left.and.text.bubble.right", value: AppTab.ask) {
                ChatView(incident: nil, inSheet: false)
            }
            Tab("Memory", systemImage: "brain", value: AppTab.memory) {
                MemoryView()
            }
            Tab("About", systemImage: "sparkles", value: AppTab.about) {
                AboutView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(.white)
    }
}

#Preview { RootView().environment(AuraModel()) }
