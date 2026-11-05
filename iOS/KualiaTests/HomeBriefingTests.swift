import Foundation
import Testing

@testable import Kualia

struct HomeBriefingTests {
    @Test func decodesTheServerContractAndCurrency() throws {
        let data = try Self.snapshot()
        #expect(data.workspace.id == "personal")
        #expect(data.amount("12345") == Decimal(string: "123.45"))
        #expect(data.amount("-9007199254740993") == Decimal(string: "-90071992547409.93"))
        #expect(data.money("12345").contains("123"))
        #expect(data.notices.isEmpty)
    }
    @Test func incompleteBriefingsKeepAnUndismissibleNotice() throws {
        let data = try Self.snapshot(partial: true)
        #expect(data.notices.count == 1)
        #expect(data.notices.first?.isDismissible == false)
    }
    @Test func approvalsBecomeADismissibleNotice() throws {
        let data = try Self.snapshot(reviews: 4)
        #expect(data.notices.count == 1)
        #expect(data.notices.first?.isDismissible == true)
    }
    @Test func formatsCurrenciesWithoutTwoMinorDigits() throws {
        #expect(try Self.snapshot(currency: "JPY", minorUnit: 0).amount("12345") == 12345)
        #expect(
            try Self.snapshot(currency: "KWD", minorUnit: 3).amount("12345")
                == Decimal(string: "12.345"))
    }
    @Test func cappedCountsAreExplicit() {
        let count = HomeBriefing.Attention(count: 500, hasMore: true, items: [])
        #expect(count.countLabel == "500+")
    }
    @Test func homeOnlySurfacesPaymentsForTodayAndTomorrow() throws {
        let upcoming = """
            [
              {"id":"today","name":"Rent","accountName":"Checking","date":"2026-09-05","day":0,"amount":"-120000","isTransfer":false},
              {"id":"tomorrow","name":"Spotify","accountName":"Checking","date":"2026-09-06","day":1,"amount":"-1299","isTransfer":false},
              {"id":"later","name":"Insurance","accountName":"Checking","date":"2026-09-07","day":2,"amount":"-3000","isTransfer":false}
            ]
            """
        let data = try Self.snapshot(upcoming: upcoming, upcomingCount: 3)
        #expect(data.notices.map(\.id) == ["upcoming:today", "upcoming:tomorrow"])
        #expect(data.notices.map(\.eyebrow) == ["TODAY", "TOMORROW"])
        #expect(data.notices.allSatisfy { $0.isDismissible && $0.destination == .planned })
    }
    @Test func changingReviewContentsWithTheSameCountReopensTheNotice() throws {
        let first = try Self.snapshot(
            reviews: 1,
            reviewItems: """
                [{"id":"first","name":"Shop","accountName":"Bank","date":"2026-09-05","amount":"-100"}]
                """)
        let next = try Self.snapshot(
            reviews: 1,
            reviewItems: """
                [{"id":"second","name":"Shop","accountName":"Bank","date":"2026-09-05","amount":"-100"}]
                """)
        #expect(first.notices.first?.id == next.notices.first?.id)
        #expect(first.notices.first?.revision != next.notices.first?.revision)
    }
    @Test func decodingConnectionsRecognizesBothLinkRepresentations() throws {
        let json = """
            [{"id":"one","provider":"plaid","displayName":"Bank","status":"needs_attention","canManageConnection":true,"accounts":[{"isLinked":true}]},
             {"id":"two","provider":"appleWallet","displayName":"Wallet","status":"disconnected","canManageConnection":false,"accounts":[{"isLinked":false,"linkedToBankAccount":{"_id":"account"}}]},
             {"id":"three","provider":"plaid","displayName":"Unused","status":"disconnected","canManageConnection":true,"accounts":[{"isLinked":false}]}]
            """
        let connections = try JSONDecoder().decode([HomeBankConnection].self, from: Data(json.utf8))
        #expect(connections.map(\.hasLinkedAccounts) == [true, true, false])
    }
    static func snapshot(
        workspace: String = "personal", partial: Bool = false, reviews: Int = 0,
        currency: String = "USD", minorUnit: Int = 2, upcoming: String = "[]",
        upcomingCount: Int = 0,
        reviewItems: String = "[]"
    ) throws -> HomeBriefing {
        let json = """
            {"workspace":{"id":"\(workspace)","name":"Personal","currencyCode":"\(currency)","minorUnit":\(minorUnit),"timezoneIdentifier":"America/New_York"},"today":"2026-09-05","throughDate":"2026-09-12","isPartial":\(partial),"reviews":{"count":\(reviews),"hasMore":false,"items":\(reviewItems)},"uncategorized":{"count":0,"hasMore":false,"items":[]},"accounts":[],"upcoming":\(upcoming),"upcomingCount":\(upcomingCount),"overdue":[],"overdueCount":0,"incoming":"0","outgoing":"0","spending":null}
            """
        return try JSONDecoder().decode(HomeBriefing.self, from: Data(json.utf8))
    }
}
