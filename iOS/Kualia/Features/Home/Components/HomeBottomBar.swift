import SwiftUI
import UIKit

/// Retain page identity independently of the visible navigation controls.
struct HomeNativePages<Content: View>: UIViewControllerRepresentable {
    let selectedPage: HomePage
    let mountedPages: Set<HomePage>
    let barInsets: HomePageBarInsets
    @ViewBuilder var content: (HomePage) -> Content

    func makeCoordinator() -> HomeNativePagesCoordinator { HomeNativePagesCoordinator() }

    func makeUIViewController(context: Context) -> UITabBarController {
        let controller = UITabBarController()
        controller.mode = .tabBar
        controller.view.backgroundColor = .clear
        controller.setTabBarHidden(true, animated: false)
        controller.tabs =
            HomePage.navigationPages.map { page in
                let host = UIHostingController(
                    rootView: HomeNativeTabPage<Content>(
                        content: nil, environment: context.environment, barInsets: barInsets))
                // The shell sizes the host and supplies bar insets. Inheriting
                // the window's side inset here would subtract it a second time.
                host.safeAreaRegions = []
                host.view.backgroundColor = .clear
                context.coordinator.hosts[page] = host
                let tab = UITab(
                    title: page.title, image: UIImage(named: page.icon.rawValue),
                    identifier: page.rawValue
                ) { _ in host }
                tab.preferredPlacement = .fixed
                tab.accessibilityIdentifier = "home.tab.\(page.rawValue)"
                return tab
            }
        updateUIViewController(controller, context: context)
        return controller
    }

    func updateUIViewController(_ controller: UITabBarController, context: Context) {
        let coordinator = context.coordinator
        for page in HomePage.navigationPages {
            let host = coordinator.hosts[page] as? UIHostingController<HomeNativeTabPage<Content>>
            host?.rootView = HomeNativeTabPage(
                content: mountedPages.contains(page) ? content(page) : nil,
                environment: context.environment, barInsets: barInsets)
            controller.tabs.first(where: { $0.identifier == page.rawValue })?.title = page.title
        }
        if controller.selectedTab?.identifier != selectedPage.rawValue {
            controller.selectedTab = controller.tabs.first {
                $0.identifier == selectedPage.rawValue
            }
        }
        controller.setTabBarHidden(true, animated: false)
    }

}

// A non-generic owner avoids Swift 6.3.3's Release optimizer crash in the
// synthesized destructor of a generic coordinator. The hosted views stay typed.
@MainActor
final class HomeNativePagesCoordinator {
    var hosts: [HomePage: UIViewController] = [:]
}

enum HomeBottomBarMetrics {
    // Match the visible system tab platter, excluding its bottom clearance.
    static var actionSize: CGFloat { if #available(iOS 26.0, *) { 62 } else { 49 } }
}

/// The system tab bar contains destinations only. Adjacent buttons open the
/// More card and transaction editor without participating in tab selection.
struct HomeBottomBar: UIViewRepresentable {
    var isVertical = false
    let selectedPage: HomePage
    let canAddTransaction: Bool
    let onSelectPage: (HomePage) -> Void
    let onAddTransaction: () -> Void
    var onMoreTap: () -> Void = {}
    var onMoreDragChanged: (CGPoint) -> Void = { _ in }
    var onMoreDragEnded: (CGPoint, CGSize) -> Void = { _, _ in }
    var onMoreDragCancelled: () -> Void = {}
    var badges = HomeNavigationBadges()

    func makeUIView(context: Context) -> HomeTabBarView { HomeTabBarView(isVertical: isVertical) }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: HomeTabBarView, context: Context)
        -> CGSize?
    {
        let width = proposal.width ?? 390
        if isVertical {
            return CGSize(width: width, height: uiView.dockHeight)
        }
        let nativeSize = uiView.tabBar.sizeThatFits(CGSize(width: width, height: 0))
        return CGSize(width: width, height: max(HomeBottomBarMetrics.actionSize, nativeSize.height))
    }

    func updateUIView(_ view: HomeTabBarView, context: Context) {
        view.selectedPage = selectedPage
        view.updateBadges(badges)
        view.onSelectPage = onSelectPage
        view.onMoreTap = onMoreTap
        view.onMoreDragChanged = onMoreDragChanged
        view.onMoreDragEnded = onMoreDragEnded
        view.onMoreDragCancelled = onMoreDragCancelled
        view.moreButton.accessibilityLabel = L10n.string("More")
        view.moreButton.accessibilityHint = L10n.string(
            "Tap to open, or press and slide up to select")
        view.onAddTransaction = onAddTransaction
        view.addButton.isEnabled = canAddTransaction
        view.addButton.accessibilityLabel = L10n.string("Add transaction")
        view.addButton.accessibilityHint = L10n.string("Create a transaction or transfer")
        view.semanticContentAttribute =
            context.environment.layoutDirection == .rightToLeft
            ? .forceRightToLeft : .forceLeftToRight
        for (index, page) in HomePage.tabPages.enumerated() {
            view.tabBar.items?[index].title = page.title
        }
        view.updateDockButtons()
    }
}

/// This bar sits inside the shell's safe-area toolbar, beside a separate button.
/// Inherited window insets would be subtracted from its content height a second
/// time, compressing the native icon/label layout near the home indicator.
final class HomeNavigationTabBar: UITabBar {
    override var safeAreaInsets: UIEdgeInsets { .zero }
}

@MainActor
final class HomeTabBarView: UIView, UITabBarDelegate {
    let isVertical: Bool
    let tabBar = HomeNavigationTabBar()
    let addButton = UIButton(type: .system)
    let moreButton = UIButton(type: .system)
    private(set) var menuBadgeValue: String?
    private(set) var menuBadgeImageFrame: CGRect?
    var onMoreTap: () -> Void = {}
    var onMoreDragChanged: (CGPoint) -> Void = { _ in }
    var onMoreDragEnded: (CGPoint, CGSize) -> Void = { _, _ in }
    var onMoreDragCancelled: () -> Void = {}
    var onSelectPage: (HomePage) -> Void = { _ in }
    var onAddTransaction: () -> Void = {}
    private var morePressOrigin = CGPoint.zero
    private(set) var dockTabButtons: [UIButton] = []
    var dockHeight: CGFloat { CGFloat(HomePage.tabPages.count + 2) * 48 + 8 }

    var selectedPage: HomePage = .budget {
        didSet { updateSelection() }
    }

    init(isVertical: Bool = false) {
        self.isVertical = isVertical
        super.init(frame: .zero)
        tintColor = .label
        tabBar.tintColor = .label
        tabBar.unselectedItemTintColor = .secondaryLabel
        tabBar.items = HomePage.tabPages.enumerated().map { index, page in
            let item = UITabBarItem(
                title: page.title, image: Self.navigationImage(page.icon), tag: index)
            item.accessibilityIdentifier = "home.tab.\(page.rawValue)"
            return item
        }
        tabBar.delegate = self
        tabBar.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        updateSelection()

        var configuration: UIButton.Configuration
        if #available(iOS 26.0, *) {
            configuration = .glass()
        } else {
            configuration = .tinted()
        }
        configuration.image = Self.navigationImage(.plus)
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .capsule
        addButton.configuration = configuration
        addButton.accessibilityLabel = L10n.string("Add transaction")
        addButton.accessibilityHint = L10n.string("Create a transaction or transfer")
        addButton.accessibilityIdentifier = "home.addTransaction"
        addButton.addAction(
            UIAction { [weak self] _ in
                guard let self, self.addButton.isEnabled else { return }
                self.onAddTransaction()
            }, for: .touchUpInside)

        var moreConfiguration = configuration
        moreConfiguration.image = Self.navigationImage(.chevronUp)
        moreConfiguration.contentInsets = .zero
        moreButton.configuration = moreConfiguration
        moreButton.accessibilityIdentifier = "home.more"
        moreButton.accessibilityLabel = L10n.string("More")
        moreButton.accessibilityHint = L10n.string("Tap to open, or press and slide up to select")
        moreButton.addAction(
            UIAction { [weak self] _ in self?.onMoreTap() }, for: .primaryActionTriggered)
        let press = UILongPressGestureRecognizer(
            target: self, action: #selector(trackMorePress(_:)))
        press.minimumPressDuration = 0
        moreButton.addGestureRecognizer(press)
        registerForTraitChanges([UITraitUserInterfaceStyle.self, UITraitAccessibilityContrast.self])
        {
            (view: HomeTabBarView, _: UITraitCollection) in
            view.updateMenuImage()
        }
        if isVertical {
            configureDock()
            return
        }
        let stack = UIStackView(arrangedSubviews: [tabBar, moreButton, addButton])
        stack.axis = .horizontal
        stack.alignment = .top
        if #available(iOS 26.0, *) {
            // UIKit reserves a 21-point transparent margin beyond its glass.
            // Share 9 points of that margin to leave a 12-point visible gap.
            stack.spacing = -9
        } else {
            stack.spacing = 12
        }
        stack.setCustomSpacing(12, after: moreButton)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        // The native bar includes bottom clearance below its visible glass platter.
        let buttonSize = HomeBottomBarMetrics.actionSize
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -18),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            tabBar.heightAnchor.constraint(equalTo: heightAnchor),
            moreButton.widthAnchor.constraint(equalToConstant: buttonSize),
            moreButton.heightAnchor.constraint(equalToConstant: buttonSize),
            addButton.widthAnchor.constraint(equalToConstant: buttonSize),
            addButton.heightAnchor.constraint(equalToConstant: buttonSize),
        ])
    }

    private func configureDock() {
        dockTabButtons = HomePage.tabPages.map { page in
            let button = UIButton(type: .system)
            button.accessibilityIdentifier = "home.tab.\(page.rawValue)"
            button.addAction(
                UIAction { [weak self] _ in self?.onSelectPage(page) }, for: .primaryActionTriggered
            )
            return button
        }
        let buttons = dockTabButtons + [moreButton, addButton]
        let stack = UIStackView(arrangedSubviews: buttons)
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        let glass = UIVisualEffectView()
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect(style: .regular)
            effect.tintColor = UIColor(KualiaPalette.glassTint).withAlphaComponent(0.38)
            effect.isInteractive = true
            glass.effect = effect
        } else {
            glass.effect = UIBlurEffect(style: .systemMaterial)
        }
        glass.layer.cornerRadius = 28
        glass.clipsToBounds = true
        glass.translatesAutoresizingMaskIntoConstraints = false
        addSubview(glass)
        glass.contentView.addSubview(stack)
        for (button, icon) in [(moreButton, KualiaIcon.chevronUp), (addButton, .plus)] {
            var configuration = UIButton.Configuration.plain()
            configuration.image = Self.navigationImage(icon, size: 19)
            configuration.baseForegroundColor = .label
            configuration.contentInsets = .zero
            button.configuration = configuration
        }
        NSLayoutConstraint.activate(
            buttons.map { $0.heightAnchor.constraint(equalToConstant: 44) } + [
                glass.widthAnchor.constraint(equalToConstant: 56),
                glass.centerXAnchor.constraint(equalTo: centerXAnchor),
                glass.topAnchor.constraint(equalTo: topAnchor),
                glass.bottomAnchor.constraint(equalTo: bottomAnchor),
                stack.leadingAnchor.constraint(
                    equalTo: glass.contentView.leadingAnchor, constant: 6),
                stack.trailingAnchor.constraint(
                    equalTo: glass.contentView.trailingAnchor, constant: -6),
                stack.topAnchor.constraint(equalTo: glass.contentView.topAnchor, constant: 6),
                stack.bottomAnchor.constraint(
                    equalTo: glass.contentView.bottomAnchor, constant: -6),
            ])
        updateDockButtons()
    }

    func updateDockButtons() {
        guard isVertical, dockTabButtons.count == HomePage.tabPages.count else { return }
        for (index, page) in HomePage.tabPages.enumerated() {
            let button = dockTabButtons[index]
            let item = tabBar.items?[index]
            let selected = selectedPage == page
            var configuration = UIButton.Configuration.plain()
            configuration.baseForegroundColor = .label
            configuration.image = Self.navigationImage(page.icon, size: 19)
            configuration.contentInsets = .zero
            configuration.background.backgroundColor = selected ? .tertiarySystemFill : .clear
            configuration.background.cornerRadius = 22
            button.configuration = configuration
            button.accessibilityLabel = page.title
            button.accessibilityValue = item?.accessibilityValue
            button.accessibilityTraits = selected ? [.button, .selected] : .button
            if let badge = item?.badgeValue {
                let label = (button.viewWithTag(101) as? UILabel) ?? UILabel()
                label.tag = 101
                label.text = badge.isEmpty ? " " : badge
                label.font = .systemFont(ofSize: 11, weight: .semibold)
                label.textColor = .white
                label.textAlignment = .center
                label.backgroundColor = .systemRed
                label.layer.cornerRadius = 8
                label.clipsToBounds = true
                label.isAccessibilityElement = false
                label.isUserInteractionEnabled = false
                if label.superview == nil {
                    label.translatesAutoresizingMaskIntoConstraints = false
                    button.addSubview(label)
                    NSLayoutConstraint.activate([
                        label.trailingAnchor.constraint(
                            equalTo: button.trailingAnchor, constant: -6),
                        label.topAnchor.constraint(equalTo: button.topAnchor, constant: 2),
                        label.widthAnchor.constraint(greaterThanOrEqualToConstant: 16),
                        label.heightAnchor.constraint(equalToConstant: 16),
                    ])
                }
            } else {
                button.viewWithTag(101)?.removeFromSuperview()
            }
        }
    }

    func updateBadges(_ badges: HomeNavigationBadges) {
        for (index, page) in HomePage.tabPages.enumerated() {
            let item = tabBar.items?[index]
            item?.badgeColor = .systemRed
            let badgeValue: String? =
                switch page {
                case .budget: badges.budgetBadgeValue
                case .transactions: badges.transactionBadgeValue
                default: badges.pageStatuses[page] == nil ? nil : ""
                }
            item?.badgeValue = badgeValue
            let descriptions = [
                badgeValue,
                badges.pageStatuses[page]?.message,
            ].compactMap { $0 }.filter { !$0.isEmpty }
            item?.accessibilityValue =
                descriptions.isEmpty ? nil : descriptions.joined(separator: ". ")
        }
        if menuBadgeValue != badges.menuBadgeValue {
            menuBadgeValue = badges.menuBadgeValue
            updateMenuImage()
        }
        let menuDescriptions = [badges.menuBadgeValue, badges.menuStatus?.message].compactMap { $0 }
        moreButton.accessibilityValue =
            menuDescriptions.isEmpty ? nil : menuDescriptions.joined(separator: ". ")
        updateDockButtons()
    }

    private func updateMenuImage() {
        guard let value = menuBadgeValue else {
            menuBadgeImageFrame = nil
            moreButton.configuration?.image = Self.navigationImage(
                .chevronUp, size: isVertical ? 19 : 25)
            return
        }
        // Render both into the button's own image so UIKit's glass press/drag
        // transforms move the caret and its badge together. Symmetric transparent
        // margins keep the caret centered and the badge on the native badge row.
        let font = UIFont.systemFont(ofSize: 13)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: UIColor.white,
        ]
        let textSize = (value as NSString).size(withAttributes: attributes)
        let badgeWidth = max(18, ceil(textSize.width) + 6)
        // Keep the badge inside the rounded glass content mask, including pills
        // with multiple digits, without moving the centered caret.
        let size = isVertical ? CGSize(width: 40, height: 40) : CGSize(width: 48, height: 50)
        let badgeFrame = CGRect(
            x: size.width - badgeWidth, y: 0,
            width: badgeWidth, height: 18)
        menuBadgeImageFrame = badgeFrame
        let ink = UIColor.label.resolvedColor(with: traitCollection)
        let red = UIColor.systemRed.resolvedColor(with: traitCollection)
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            let iconSide: CGFloat = isVertical ? 19 : 25
            Self.navigationImage(.chevronUp, size: iconSide)?.withTintColor(
                ink, renderingMode: .alwaysOriginal
            )
            .draw(
                in: CGRect(
                    x: size.width / 2 - iconSide / 2, y: size.height / 2 - iconSide / 2,
                    width: iconSide, height: iconSide))
            red.setFill()
            UIBezierPath(roundedRect: badgeFrame, cornerRadius: 9).fill()
            (value as NSString).draw(
                at: CGPoint(
                    x: badgeFrame.midX - textSize.width / 2,
                    y: badgeFrame.midY - textSize.height / 2), withAttributes: attributes)
        }
        moreButton.configuration?.image = image.withRenderingMode(.alwaysOriginal)
    }

    @objc private func trackMorePress(_ gesture: UILongPressGestureRecognizer) {
        let location = gesture.location(in: window)
        switch gesture.state {
        case .began:
            morePressOrigin = location
            onMoreDragChanged(location)
        case .changed:
            onMoreDragChanged(location)
        case .ended:
            onMoreDragEnded(
                location,
                CGSize(
                    width: location.x - morePressOrigin.x, height: location.y - morePressOrigin.y))
        case .cancelled, .failed:
            onMoreDragCancelled()
        default: break
        }
    }

    private static func navigationImage(_ icon: KualiaIcon, size side: CGFloat = 25) -> UIImage? {
        guard let image = UIImage(named: icon.rawValue) else { return nil }
        let size = CGSize(width: side, height: side)
        return UIGraphicsImageRenderer(size: size).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }.withRenderingMode(.alwaysTemplate)
    }

    required init?(coder: NSCoder) { nil }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard HomePage.tabPages.indices.contains(item.tag) else { return }
        // The session commits selection after its page readiness checks.
        updateSelection()
        onSelectPage(HomePage.tabPages[item.tag])
    }

    private func updateSelection() {
        defer { updateDockButtons() }
        guard let index = HomePage.tabPages.firstIndex(of: selectedPage) else {
            tabBar.selectedItem = nil
            return
        }
        tabBar.selectedItem = tabBar.items?[index]
    }
}

struct HomeNativeTabPage<Content: View>: View {
    let content: Content?
    let environment: EnvironmentValues
    let barInsets: HomePageBarInsets

    var body: some View {
        // The native scroll edge needs a navigation context in this hosting
        // controller; the shell's NavigationStack lives across a UIKit boundary.
        NavigationStack {
            pageContent
                .modifier(
                    HomeDockSurface(
                        layout: environment.homeControlDock, actions: environment.homeDockActions,
                        barInsets: barInsets, navigation: environment.homeDockNavigation,
                        peekBottomInset: environment.peekContentBottomInset)
                )
                .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var pageContent: some View {
        content
            .kualiaSafeAreaBar(edge: .top, spacing: 0) {
                Color.clear.frame(height: barInsets.top)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: barInsets.bottom)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            // Both visible bars belong to the SwiftUI shell; restore their insets once.
            .ignoresSafeArea(.container, edges: .vertical)
            // Copy app dependencies and appearance, not SwiftUI's internal scroll
            // and presentation state. Reusing the whole environment makes nested
            // scroll views lose their margins when the host updates on iOS 27.
            .environment(\.locale, environment.locale)
            .environment(\.calendar, environment.calendar)
            .environment(\.timeZone, environment.timeZone)
            .environment(\.dynamicTypeSize, environment.dynamicTypeSize)
            .environment(\.layoutDirection, environment.layoutDirection)
            .environment(\.colorScheme, environment.colorScheme)
            .environment(\.budgetAssignmentFocusRegistry, environment.budgetAssignmentFocusRegistry)
            .environment(\.isBudgetAssignmentRevealReady, environment.isBudgetAssignmentRevealReady)
            .environment(\.checkInSettings, environment.checkInSettings)
            .environment(\.transactionScheduleStore, environment.transactionScheduleStore)
            .environment(\.categoryPickerBudget, environment.categoryPickerBudget)
            .environment(\.isDemoWorkspace, environment.isDemoWorkspace)
            .environment(\.homeControlDock, environment.homeControlDock)
            .modifier(HomeScrollSurface(showsBottomToolbar: barInsets.bottom > 0))
    }
}
