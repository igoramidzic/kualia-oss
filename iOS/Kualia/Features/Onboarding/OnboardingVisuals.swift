import SwiftUI

struct OnboardingIcon: View {
    let icon: KualiaIcon
    var size: CGFloat = 24

    var body: some View {
        KualiaIconImage(icon: icon, size: size)
    }
}

struct OnboardingChoice: View {
    let title: String
    let icon: KualiaIcon
    var detail: String? = nil
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                OnboardingIcon(icon: icon, size: 26).frame(width: 30)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline)
                    if let detail {
                        Text(detail).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                ZStack {
                    Circle().strokeBorder(KualiaPalette.border, lineWidth: 1.5)
                    if selected { OnboardingIcon(icon: .checkCircle, size: 22) }
                }
                .frame(width: 22, height: 22)
                .foregroundStyle(KualiaPalette.budgetPositive)
            }
            .padding(18).frame(minHeight: 72)
            .background(
                selected ? KualiaPalette.budgetPositive.opacity(0.08) : KualiaPalette.surface,
                in: RoundedRectangle(cornerRadius: 20)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 20)
                    .strokeBorder(
                        selected ? KualiaPalette.budgetPositive.opacity(0.5) : .clear, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
