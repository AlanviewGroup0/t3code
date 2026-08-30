import ExpoModulesCore
import UIKit

/**
 * Back to Editor overlay for harness builds.
 *
 * The overlay lives in its own UIWindow, owned by native code, so it survives
 * the React Native bundle swap that happens when the dev client loads a
 * previewed project. T3 Code's JS shows it (with the deep link back to the
 * editor bundle) right before opening a preview, and hides it when the editor
 * bundle mounts again.
 */
public final class T3HarnessOverlayModule: Module {
  private static var overlayWindow: UIWindow?

  public func definition() -> ModuleDefinition {
    Name("T3HarnessOverlay")

    AsyncFunction("show") { (returnUrl: String, label: String) in
      DispatchQueue.main.async {
        Self.showOverlay(returnUrl: returnUrl, label: label)
      }
    }

    AsyncFunction("hide") {
      DispatchQueue.main.async {
        Self.hideOverlay()
      }
    }
  }

  private static func showOverlay(returnUrl: String, label: String) {
    guard let url = URL(string: returnUrl) else {
      return
    }
    hideOverlay()
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
    else {
      return
    }

    let window = PassthroughWindow(windowScene: scene)
    window.windowLevel = .alert + 1
    window.backgroundColor = .clear
    let controller = UIViewController()
    controller.view.backgroundColor = .clear
    window.rootViewController = controller

    var configuration = UIButton.Configuration.filled()
    configuration.title = label
    configuration.cornerStyle = .capsule
    configuration.baseBackgroundColor = UIColor.black.withAlphaComponent(0.78)
    configuration.baseForegroundColor = .white
    configuration.contentInsets = NSDirectionalEdgeInsets(
      top: 9, leading: 16, bottom: 9, trailing: 16)
    // The overlay stays up after the tap: the editor bundle hides it once it
    // has mounted, so a failed open leaves the way back available.
    let button = UIButton(
      configuration: configuration,
      primaryAction: UIAction { _ in
        UIApplication.shared.open(url)
      })
    button.translatesAutoresizingMaskIntoConstraints = false
    controller.view.addSubview(button)
    NSLayoutConstraint.activate([
      button.centerXAnchor.constraint(
        equalTo: controller.view.safeAreaLayoutGuide.centerXAnchor),
      button.bottomAnchor.constraint(
        equalTo: controller.view.safeAreaLayoutGuide.bottomAnchor, constant: -10),
    ])

    window.isHidden = false
    overlayWindow = window
  }

  private static func hideOverlay() {
    overlayWindow?.isHidden = true
    overlayWindow = nil
  }
}

/// Routes touches on the button to the overlay and everything else to the app
/// underneath, so the previewed app stays fully interactive.
private final class PassthroughWindow: UIWindow {
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let view = super.hitTest(point, with: event)
    if view === self || view === rootViewController?.view {
      return nil
    }
    return view
  }
}
