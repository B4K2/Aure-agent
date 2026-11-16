import UserNotifications

/// Local banners for agent events (incident opened, fix ready, resolved, errors).
/// They fire while the app holds the live socket: in the foreground, or for a short while after backgrounding.
/// Delivery with the app fully closed would need APNs push from the agent.
@MainActor
enum Notifier {
    private static let delegate = Delegate()
    private static var sent: Set<String> = []

    static func setUp() {
        let c = UNUserNotificationCenter.current()
        c.delegate = delegate
        c.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    static func post(_ title: String, _ body: String, id: String) {
        guard sent.insert(id).inserted else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    /// Show banners even while the app is open.
    final class Delegate: NSObject, UNUserNotificationCenterDelegate {
        func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
            -> UNNotificationPresentationOptions { [.banner, .sound, .list] }
    }
}
