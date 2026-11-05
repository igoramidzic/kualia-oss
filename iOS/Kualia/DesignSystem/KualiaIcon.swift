import SwiftUI

nonisolated enum KualiaIcon: String, CaseIterable {
    case car = "NucleoCar"
    case bus = "NucleoBus"
    case bicycle = "NucleoBicycle"
    case key = "NucleoKey"
    case house = "NucleoHouse"
    case users = "NucleoUsers"
    case discord = "NucleoDiscord"
    case child = "NucleoChild"
    case paw = "NucleoPaw"
    case plane = "NucleoPlane"
    case shield = "NucleoShield"
    case leaf = "NucleoLeaf"
    case dots = "NucleoDots"
    case info = "NucleoInfo"
    case arrowRight = "NucleoArrowRight"
    case arrowDownRight = "NucleoArrowDownRight"
    case bell = "NucleoSettingsBell"
    case book = "NucleoSettingsBook"
    case idea = "NucleoSettingsIdea"
    case support = "NucleoSettingsSupport"
    case sparkles = "NucleoSettingsSparkles"
    case updates = "NucleoUpdates"
    case maintenance = "NucleoMaintenance"
    case download = "NucleoDownload"
    case arrowUpRight = "NucleoSettingsArrowUpRight"
    case chevronRight = "NucleoSettingsChevronRight"
    case chevronDown = "NucleoSettingsChevronDown"
    case chevronLeft = "NucleoSettingsChevronLeft"
    case logout = "NucleoSettingsLogout"
    case moon = "NucleoSettingsMoon"
    case sun = "NucleoSettingsSun"
    case systemAppearance = "NucleoSettingsSystemAppearance"
    case appearance = "NucleoSettingsAppearance"
    case copy = "NucleoSettingsCopy"
    case archive = "NucleoSettingsArchive"
    case trash = "NucleoSettingsTrash"
    case camera = "NucleoSettingsCamera"
    case heart = "NucleoSettingsHeart"
    case lock = "NucleoSettingsLock"
    case close = "NucleoSettingsClose"
    case check = "NucleoSettingsCheck"
    case checkCircle = "NucleoSettingsCheckCircle"
    case email = "NucleoSettingsEmail"
    case phone = "NucleoSettingsPhone"
    case user = "NucleoSettingsUser"
    case creditCard = "NucleoSettingsCreditCard"
    case family = "NucleoFamily"
    case subscription = "NucleoSubscription"
    case accounts = "NucleoAccounts"
    case allClear = "NucleoAllClear"
    case assistant = "NucleoAssistant"
    case backspace = "NucleoBackspace"
    case bank = "NucleoBank"
    case bolt = "NucleoBolt"
    case budget = "NucleoBudget"
    case target = "NucleoTarget"
    case category = "NucleoCategory"
    case categoryGroupArrow = "NucleoCategoryGroupArrow"
    case closeCircle = "NucleoCloseCircle"
    case equals = "NucleoEquals"
    case home = "NucleoHome"
    case minus = "NucleoMinus"
    case newChat = "NucleoNewChat"
    case newEntry = "NucleoNewEntry"
    case calendarFilled = "NucleoCalendarFilled"
    case calendarRepeating = "NucleoCalendarRepeating"
    case plus = "NucleoPlus"
    case plusMinus = "NucleoPlusMinus"
    case preferences = "NucleoPreferences"
    case reports = "NucleoReports"
    case recurrence = "NucleoRepeat"
    case search = "NucleoSearch"
    case badgeCheck = "NucleoBadgeCheck"
    case transactions = "NucleoTransactions"
    case undo = "NucleoUndo"
    case workspace = "NucleoWorkspace"
    case oneCircle = "NucleoOneCircle"
    case arrowDownLeft = "NucleoArrowDownLeft"
    case transfer = "NucleoTransfer"
    case transferCircle = "NucleoTransferCircle"
    case arrowRightCircle = "NucleoArrowRightCircle"
    case refresh = "NucleoRefresh"
    case split = "NucleoSplit"
    case arrowTurnRight = "NucleoArrowTurnRight"
    case arrowUp = "NucleoArrowUp"
    case sort = "NucleoSort"
    case pencil = "NucleoPencil"
    case grip = "NucleoGrip"
    case externalLink = "NucleoExternalLink"
    case arrowUpLeft = "NucleoArrowUpLeft"
    case money = "NucleoMoney"
    case calendarCheck = "NucleoCalendarCheck"
    case calendarClock = "NucleoCalendarClock"
    case calendarPlus = "NucleoCalendarPlus"
    case chartLine = "NucleoChartLine"
    case checklist = "NucleoChecklist"
    case chevronUp = "NucleoChevronUp"
    case circle = "NucleoCircle"
    case circleOutline = "NucleoCircleOutline"
    case clock = "NucleoClock"
    case cloudOff = "NucleoCloudOff"
    case crown = "NucleoCrown"
    case file = "NucleoFile"
    case note = "NucleoNote"
    case fileSearch = "NucleoFileSearch"
    case envelopeBadge = "NucleoEnvelopeBadge"
    case envelopeOpen = "NucleoEnvelopeOpen"
    case warning = "NucleoWarning"
    case skip = "NucleoSkip"
    case pause = "NucleoPause"
    case handDraw = "NucleoHandDraw"
    case handTap = "NucleoHandTap"
    case handWave = "NucleoHandWave"
    case filter = "NucleoFilter"
    case link = "NucleoLink"
    case unlink = "NucleoUnlink"
    case linkPlus = "NucleoLinkPlus"
    case list = "NucleoList"
    case minusCircle = "NucleoMinusCircle"
    case send = "NucleoSend"
    case userCheck = "NucleoUserCheck"
    case photo = "NucleoPhoto"
    case plusCircle = "NucleoPlusCircle"
    case connection = "NucleoConnection"
    case question = "NucleoQuestion"
    case sidebar = "NucleoSidebar"
    case widgets = "NucleoWidgets"
    case grid = "NucleoGrid"
    case layers = "NucleoLayers"
    case stop = "NucleoStop"
    case shop = "NucleoShop"
    case inbox = "NucleoInbox"
    case wifiOff = "NucleoWifiOff"

    var mirrorsInRightToLeftLayout: Bool {
        switch self {
        case .chevronLeft, .chevronRight, .arrowRight, .arrowRightCircle, .arrowTurnRight,
            .categoryGroupArrow, .logout, .undo, .backspace, .send:
            true
        default:
            false
        }
    }
}

struct KualiaIconImage: View {
    let icon: KualiaIcon
    let size: CGFloat
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        Image(icon.rawValue)
            .resizable()
            .renderingMode(.template)
            .flipsForRightToLeftLayoutDirection(icon.mirrorsInRightToLeftLayout)
            .scaledToFit()
            .frame(width: size * scale, height: size * scale)
            .accessibilityHidden(true)
    }
}

extension Label where Title == Text, Icon == KualiaIconImage {
    init(_ title: LocalizedStringKey, icon: KualiaIcon) {
        self.init {
            Text(title)
        } icon: {
            KualiaIconImage(icon: icon, size: 18)
        }
    }

    init<S: StringProtocol>(_ title: S, icon: KualiaIcon) {
        self.init {
            Text(title)
        } icon: {
            KualiaIconImage(icon: icon, size: 18)
        }
    }
}

extension Button where Label == SwiftUI.Label<Text, KualiaIconImage> {
    init<S: StringProtocol>(_ title: S, icon: KualiaIcon, action: @escaping () -> Void) {
        self.init(action: action) { SwiftUI.Label(title, icon: icon) }
    }

    init(_ title: LocalizedStringKey, icon: KualiaIcon, action: @escaping () -> Void) {
        self.init(action: action) { SwiftUI.Label(title, icon: icon) }
    }
}

extension ContentUnavailableView
where Label == SwiftUI.Label<Text, KualiaIconImage>, Description == Text?, Actions == EmptyView {
    init<S: StringProtocol>(_ title: S, icon: KualiaIcon, description: Text? = nil) {
        self.init {
            SwiftUI.Label {
                Text(title)
            } icon: {
                KualiaIconImage(icon: icon, size: 44)
            }
        } description: {
            description
        }
    }

    init(_ title: LocalizedStringKey, icon: KualiaIcon, description: Text? = nil) {
        self.init {
            SwiftUI.Label {
                Text(title)
            } icon: {
                KualiaIconImage(icon: icon, size: 44)
            }
        } description: {
            description
        }
    }
}
