import SwiftUI

/// The landing page, top to bottom, in the same order as web/src/App.tsx.
struct ContentView: View {
    @State var progress: CGFloat = 0
    @State var contentHeight: CGFloat = 1
    @State var viewport: CGFloat = 1
    @Environment(\.openURL) var openURL

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        HeroSection { withAnimation(.easeInOut(duration: 0.8)) { proxy.scrollTo("demo", anchor: .top) } }
                            .id("top")
                        MarqueeSection()
                        HowItWorksSection().id("how")
                        DemoSection().id("demo")
                        StatsSection()
                        FeaturesSection().id("features")
                        StatementSection()
                        CTASection()
                        FooterSection()
                    }
                    .background(GeometryReader { g in
                        Color.clear.preference(key: ScrollKey.self,
                                               value: [-g.frame(in: .named("scroll")).minY, g.size.height])
                    })
                }
                .coordinateSpace(name: "scroll")
                .background(GeometryReader { g in Color.clear.onAppear { viewport = g.size.height } })
                .onPreferenceChange(ScrollKey.self) { v in
                    guard v.count == 2 else { return }
                    progress = min(max(v[0] / max(v[1] - viewport, 1), 0), 1)
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    NavBar(
                        onSection: { id in withAnimation(.easeInOut(duration: 0.8)) { proxy.scrollTo(id, anchor: .top) } },
                        onDashboard: { openURL(Theme.dashboard) }
                    )
                }
            }

            // thin scroll progress line, like the web ScrollProgress bar
            GeometryReader { g in
                Rectangle().fill(.white).frame(width: g.size.width * progress, height: 1)
                    .animation(.interpolatingSpring(stiffness: 120, damping: 30), value: progress)
            }
            .frame(height: 1)

            Grain()
        }
    }
}

private struct ScrollKey: PreferenceKey {
    static var defaultValue: [CGFloat] = []
    static func reduce(value: inout [CGFloat], nextValue: () -> [CGFloat]) { value = nextValue() }
}

struct NavBar: View {
    var onSection: (String) -> Void
    var onDashboard: () -> Void

    var body: some View {
        HStack {
            Button { onSection("top") } label: { LogoView() }
            Spacer()
            Menu {
                Button("How it works") { onSection("how") }
                Button("Features") { onSection("features") }
                Button("Demo") { onSection("demo") }
            } label: {
                Image(systemName: "line.3.horizontal").font(.system(size: 16)).foregroundStyle(Theme.neutral400)
                    .frame(width: 36, height: 36)
            }
            Button(action: onDashboard) {
                Text("Dashboard").font(.system(size: 14, weight: .medium)).foregroundStyle(.black)
                    .padding(.horizontal, 14).padding(.vertical, 7).background(.white, in: Capsule())
            }
            .buttonStyle(PressScale())
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(.ultraThinMaterial.opacity(0.9))
        .background(Color.black.opacity(0.6))
        .overlay(alignment: .bottom) { Color.white.opacity(0.05).frame(height: 1) }
        .environment(\.colorScheme, .dark)
    }
}

#Preview { ContentView().preferredColorScheme(.dark) }
