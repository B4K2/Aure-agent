import SwiftUI

@main
struct AuraApp: App {
    @State var model = AuraModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .task { await model.start() }
        }
    }
}
