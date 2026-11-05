import Foundation

/// Extension-safe HTTP client. Financial data stays behind the existing read-only token.
nonisolated enum WidgetDataService {
    enum WidgetDataError: Error {
        case noToken, noConvexUrl, sessionChanged
        case httpError(Int)
    }

    private struct RequestBody: Encodable {
        var localDate: String? = nil
        var categoryIds: [String]? = nil
        var accountIds: [String]? = nil
        var expensesOnly: Bool? = nil
    }

    static func fetchBudgetPulse() async throws -> BudgetPulseResponse {
        try await post(path: "/widget/budget-pulse", body: RequestBody())
    }

    static func fetchCategoryAvailable(categoryIds: [String], localDate: String? = nil) async throws
        -> CategoryAvailableResponse
    {
        try await post(
            path: "/widget/category-available",
            body: RequestBody(localDate: localDate ?? localDateString(), categoryIds: categoryIds))
    }

    static func fetchUpcomingTransactions(localDate: String? = nil, expensesOnly: Bool? = nil)
        async throws -> UpcomingTransactionsResponse
    {
        try await post(
            path: "/widget/upcoming-transactions",
            body: RequestBody(localDate: localDate ?? localDateString(), expensesOnly: expensesOnly)
        )
    }

    static func fetchAccountBalances(accountIds: [String]) async throws -> AccountBalancesResponse {
        try await post(path: "/widget/account-balances", body: RequestBody(accountIds: accountIds))
    }

    private static func localDateString() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone =
            WidgetSharedStorage.timezoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .current
        return formatter.string(from: Date())
    }

    private static func post<T: Decodable>(path: String, body: RequestBody) async throws -> T {
        guard let token = WidgetSharedStorage.widgetToken else { throw WidgetDataError.noToken }
        let workspaceID = WidgetSharedStorage.workspaceId
        guard let deployment = WidgetSharedStorage.convexUrl,
            let url = URL(
                string: deployment.replacingOccurrences(of: ".convex.cloud", with: ".convex.site")
                    + path),
            url.scheme == "https"
        else { throw WidgetDataError.noConvexUrl }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard WidgetSharedStorage.workspaceId == workspaceID,
            WidgetSharedStorage.widgetToken == token
        else { throw WidgetDataError.sessionChanged }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw WidgetDataError.httpError((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
