import SwiftUI
import WidgetKit

@main
struct KualiaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        CategoryBalancesWidget()
        UpcomingBillsWidget()
        BalancesWidget()
        TransactionLauncherWidget()
        TransactionLauncherControl()
    }
}
