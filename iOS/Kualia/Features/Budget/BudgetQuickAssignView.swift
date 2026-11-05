import SwiftUI

/// Quick assign occupies the budget canvas itself; the shell keeps its live RTA peek.
struct BudgetQuickAssignView: View {
    let store: BudgetStore
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if let session = store.quickAssign {
            ZStack(alignment: .top) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        heading(session)
                        if let message = session.errorMessage ?? store.errorMessage {
                            HStack(alignment: .top, spacing: 12) {
                                Text(message).frame(maxWidth: .infinity, alignment: .leading)
                                if store.errorMessage != nil {
                                    Button(L10n.string("Retry"), action: store.retry).buttonStyle(
                                        .kualiaHaptic)
                                }
                            }
                            .font(.subheadline)
                            .padding(16)
                            .background(
                                KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 16)
                            )
                            .accessibilityIdentifier("budget-quick-assign-error")
                        }
                        if session.isChoosingOption {
                            options
                        } else {
                            preview(session)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 24)
                }
                // The method chooser and preview have independent scroll lifetimes.
                .id(session.isChoosingOption)
                .modifier(HomeGlowScrollObserver())
                .transition(.opacity)
            }
            .fontDesign(.rounded)
            .foregroundStyle(KualiaPalette.ink)
            .animation(
                reduceMotion ? nil : .smooth(duration: 0.24), value: session.isChoosingOption
            )
            .accessibilityIdentifier("budget-quick-assign")
        }
    }

    private func heading(_ session: BudgetQuickAssignSession) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !session.isChoosingOption {
                Button(action: store.showQuickAssignOptions) {
                    Label(L10n.string("Back to methods"), icon: .chevronLeft)
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(session.phase != .reviewing)
                .opacity(session.phase == .reviewing ? 1 : 0.4)
                .accessibilityIdentifier("budget-quick-method")
            }
            Text(
                session.isChoosingOption
                    ? L10n.string("Give your money a plan.") : session.option.title
            )
            .font(.title2.weight(.bold))
            .accessibilityAddTraits(.isHeader)
            Text(
                session.isChoosingOption
                    ? L10n.string(
                        "Choose a starting point. You'll see every change before applying it.")
                    : session.option.detail
            )
            .font(.subheadline)
            .foregroundStyle(KualiaPalette.mutedInk)
        }
    }

    private var options: some View {
        VStack(spacing: 0) {
            ForEach(BudgetQuickAssignOption.allCases) { option in
                Button {
                    store.chooseQuickAssignOption(option)
                } label: {
                    HStack(alignment: .center, spacing: 16) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(option.title).font(.body.weight(.semibold))
                            Text(option.detail)
                                .font(.caption)
                                .foregroundStyle(KualiaPalette.mutedInk)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        KualiaIconImage(icon: .arrowUpRight, size: 15)
                            .font(.subheadline.weight(.semibold))
                            .accessibilityHidden(true)
                    }
                    .padding(.vertical, 18)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityIdentifier("budget-quick-option-\(option.rawValue)")
                if option != BudgetQuickAssignOption.allCases.last {
                    Divider().overlay(KualiaPalette.border.opacity(0.4))
                }
            }
        }
    }

    @ViewBuilder
    private func preview(_ session: BudgetQuickAssignSession) -> some View {
        Group {
            if session.option == .underfunded { underfundedPriority }
            Toggle(
                isOn: Binding(
                    get: { !(store.quickAssign?.allowsNegativeRTA ?? false) },
                    set: { store.setQuickAssignAllowsNegativeRTA(!$0) }
                )
            ) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L10n.string("Use only available money")).font(
                        .subheadline.weight(.semibold))
                    Text(L10n.string("Stop funding when Ready to Assign reaches zero."))
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            .tint(KualiaPalette.budgetPositive)
            .accessibilityIdentifier("budget-quick-limit-rta")
        }
        .disabled(session.phase != .reviewing)

        if let message = session.plan.errorMessage {
            Text(message).font(.subheadline).foregroundStyle(KualiaPalette.budgetNegative)
        } else if session.plan.previewChanges.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.string("Nothing to change here")).font(.headline)
                Text(
                    session.plan.unfilledAmount > 0
                        ? L10n.string(
                            "There isn't enough Ready to Assign for this method. Try returning extra funding first, or turn off the available money limit."
                        )
                        : L10n.string(
                            "These categories already match this method, or there isn't any completed history yet. Try another method."
                        )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            .padding(.vertical, 16)
        } else {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(
                        session.phase == .finished
                            ? L10n.string("CHANGES APPLIED") : L10n.string("WHERE IT'S GOING")
                    )
                    .tracking(1.2)
                    Spacer()
                    Text(L10n.string("\(session.plan.changes.count) categories"))
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(KualiaPalette.mutedInk)

                let changes =
                    session.phase == .finished
                    ? session.plan.changes : session.plan.previewChanges
                // Slots keep their position; only the content at each position crossfades.
                ForEach(Array(changes.enumerated()), id: \.offset) { _, change in
                    let isIncluded = !session.excludedCategoryIDs.contains(change.id)
                    Button {
                        store.toggleQuickAssignCategory(change.id)
                    } label: {
                        ZStack {
                            changeRow(change, isFinished: session.phase == .finished)
                                .contentTransition(.opacity)
                                .opacity(isIncluded ? 1 : 0.4)
                                .id(change.id)
                                .transition(.opacity)
                        }
                        .contentShape(Rectangle())
                        .animation(
                            reduceMotion ? nil : .easeInOut(duration: 0.24), value: change
                        )
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(session.phase != .reviewing)
                    .accessibilityValue(
                        isIncluded ? L10n.string("Included") : L10n.string("Skipped")
                    )
                    .accessibilityHint(
                        isIncluded
                            ? L10n.string("Tap to skip this category")
                            : L10n.string("Tap to include this category")
                    )
                    .accessibilityIdentifier("budget-quick-toggle-\(change.id)")
                }
            }
        }
        if session.plan.unfilledAmount > 0 {
            Text(
                L10n.string(
                    "\(money(session.plan.unfilledAmount)) still needed to complete this method.")
            )
            .font(.caption.weight(.medium))
            .foregroundStyle(KualiaPalette.mutedInk)
        }
    }

    private var underfundedPriority: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.string("Fill first"))
                .font(.subheadline.weight(.semibold))
            let layout =
                dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
            layout {
                ForEach(BudgetUnderfundedOrder.allCases) { order in
                    let isSelected = store.underfundedOrder == order
                    Button {
                        store.setUnderfundedOrder(order)
                    } label: {
                        HStack(spacing: 8) {
                            Text(order.title)
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, alignment: .leading)
                            KualiaIconImage(icon: isSelected ? .checkCircle : .circle, size: 18)
                                .accessibilityHidden(true)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, minHeight: 54)
                        .foregroundStyle(isSelected ? KualiaPalette.canvas : KualiaPalette.ink)
                        .background(
                            isSelected ? KualiaPalette.ink : KualiaPalette.surface,
                            in: RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                    .accessibilityIdentifier("budget-quick-order-\(order.rawValue)")
                }
            }
            // Both descriptions occupy the same space, including at larger text sizes.
            ZStack(alignment: .topLeading) {
                ForEach(BudgetUnderfundedOrder.allCases) { order in
                    Text(order.detail)
                        .font(.caption)
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .opacity(store.underfundedOrder == order ? 1 : 0)
                        .accessibilityHidden(store.underfundedOrder != order)
                }
            }
        }
        .accessibilityIdentifier("budget-quick-underfunded-order")
    }

    private func changeRow(_ change: BudgetQuickAssignChange, isFinished: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(change.name)
                        .font(.body.weight(.semibold))
                    HStack(spacing: 4) {
                        KualiaIconImage(icon: .categoryGroupArrow, size: 12)
                            .accessibilityHidden(true)
                        Text(change.groupName)
                    }
                    .font(.caption)
                    .foregroundStyle(KualiaPalette.mutedInk)
                }
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(money(Decimal(change.previousAssigned)))
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .accessibilityLabel(
                            L10n.string(
                                "Currently assigned \(money(Decimal(change.previousAssigned)))"))
                    Text(
                        "\(change.delta > 0 ? "+" : change.delta < 0 ? "−" : "")\(money(abs(change.delta)))"
                    )
                    .font(.body.weight(.bold).monospacedDigit())
                    .foregroundStyle(
                        change.delta > 0 ? KualiaPalette.budgetPositive : KualiaPalette.ink
                    )
                }
                .fixedSize(horizontal: true, vertical: false)
                if isFinished {
                    KualiaIconImage(icon: .check, size: 18).foregroundStyle(
                        KualiaPalette.budgetPositive)
                }
            }
            Divider().padding(.top, 4)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("budget-quick-change-\(change.id)")
    }

    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: store.workspace?.currencyCode ?? "USD",
            minorUnit: store.workspace?.minorUnit ?? 2, showsPositiveSign: false,
            usesAbsoluteValue: false, locale: locale)
    }
}

/// Preview and snapshot entry point for the shared, continuously mounted RTA peek.
struct BudgetQuickAssignPeek: View {
    let session: BudgetQuickAssignSession
    let readyToAssign: Decimal
    let currencyCode: String
    let minorUnit: Int
    let showsCompletion: Bool

    var body: some View {
        BudgetReadyToAssignPeek(
            readyToAssign: readyToAssign, currencyCode: currencyCode, minorUnit: minorUnit,
            quickAssign: session, showsQuickAssignCompletion: showsCompletion
        )
        .accessibilityIdentifier("budget-quick-peek")
    }
}
