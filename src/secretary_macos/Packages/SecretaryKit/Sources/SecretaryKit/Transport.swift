import Foundation

public struct Route: Hashable, Sendable {
  public let path: String
  public let query: [String: String]
  public init(_ path: String, query: [String: String] = [:]) throws {
    let allowed = CharacterSet(
      charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_:.~")
    guard !path.isEmpty,
      path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({
        !$0.isEmpty && $0 != "." && $0 != ".." && $0.unicodeScalars.allSatisfy(allowed.contains)
      })
    else { throw ClientError.invalidRoute }
    self.path = path
    self.query = query
  }
  var key: String {
    var parts = URLComponents()
    parts.path = path
    if !query.isEmpty {
      parts.queryItems = query.sorted { $0.key < $1.key }.map {
        URLQueryItem(name: $0.key, value: $0.value)
      }
    }
    return parts.string!
  }
}

public protocol CoreTransport: Sendable {
  func request(_ route: Route, body: Data?) async throws -> Data
  func stream(after: String, receive: @escaping @Sendable (SyncTransaction) async throws -> Void)
    async throws
  func stream(
    after: String, receive: @escaping @Sendable (SyncTransaction) async throws -> Void,
    transient: @escaping @Sendable (Data) async throws -> Void) async throws
  func cancel()
}

extension CoreTransport {
  public func stream(
    after: String, receive: @escaping @Sendable (SyncTransaction) async throws -> Void,
    transient: @escaping @Sendable (Data) async throws -> Void
  ) async throws {
    try await stream(after: after, receive: receive)
  }
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}

/// URLSession is thread-safe; all mutable client state lives in ClientEngine.
public final class HTTPTransport: CoreTransport, Sendable {
  private let endpoint: Endpoint
  private let session: URLSession
  public init(endpoint: Endpoint) throws {
    try endpoint.validate()
    self.endpoint = endpoint
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.urlCache = nil
    config.httpShouldSetCookies = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 60
    session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
  }
  public func cancel() { session.invalidateAndCancel() }
  private func urlRequest(_ route: Route, body: Data? = nil) throws -> URLRequest {
    guard var components = URLComponents(string: endpoint.url) else {
      throw ClientError.invalidRoute
    }
    components.path = "/api/v1/" + route.path
    components.queryItems = route.query.sorted { $0.key < $1.key }.map {
      URLQueryItem(name: $0.key, value: $0.value)
    }
    guard let url = components.url else { throw ClientError.invalidRoute }
    var request = URLRequest(url: url)
    request.setValue("Bearer " + endpoint.token, forHTTPHeaderField: "Authorization")
    request.setValue("1", forHTTPHeaderField: "X-Secretary-API-Version")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      guard body.count <= 1_048_576 else { throw ClientError.responseTooLarge }
      request.httpMethod = "POST"
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    return request
  }
  public func request(_ route: Route, body: Data? = nil) async throws -> Data {
    let (bytes, response) = try await session.bytes(for: urlRequest(route, body: body))
    defer { bytes.task.cancel() }
    guard let response = response as? HTTPURLResponse else { throw ClientError.invalidContract }
    guard response.expectedContentLength <= 8_388_608 else { throw ClientError.responseTooLarge }
    var data = Data()
    for try await byte in bytes {
      guard data.count < 8_388_608 else { throw ClientError.responseTooLarge }
      data.append(byte)
    }
    try Self.check(response.statusCode, data: data)
    return data
  }
  static func check(_ status: Int, data: Data) throws {
    guard (200..<300).contains(status) else {
      struct Failure: Decodable {
        struct Detail: Decodable { let code: String }
        let error: Detail
      }
      let code = (try? JSONDecoder().decode(Failure.self, from: data).error.code) ?? "HTTP_ERROR"
      // Display machine codes only; never raw response bodies or transport URLs/tokens.
      let safe =
        code.count <= 80
        && code.utf8.allSatisfy { (65...90).contains($0) || (48...57).contains($0) || $0 == 95 }
      throw ClientError.http(status, safe ? code : "HTTP_ERROR")
    }
  }
  public func stream(
    after: String, receive: @escaping @Sendable (SyncTransaction) async throws -> Void
  ) async throws {
    try await stream(after: after, receive: receive, transient: { _ in })
  }
  public func stream(
    after: String, receive: @escaping @Sendable (SyncTransaction) async throws -> Void,
    transient: @escaping @Sendable (Data) async throws -> Void
  ) async throws {
    var request = try urlRequest(Route("sync/stream"))
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    request.setValue(after, forHTTPHeaderField: "Last-Event-ID")
    let (bytes, response) = try await session.bytes(for: request)
    defer { bytes.task.cancel() }
    guard let response = response as? HTTPURLResponse else { throw ClientError.invalidContract }
    if response.statusCode != 200 {
      var data = Data()
      for try await byte in bytes {
        guard data.count < 65_536 else { throw ClientError.responseTooLarge }
        data.append(byte)
      }
      try Self.check(response.statusCode, data: data)
    }
    guard response.mimeType == "text/event-stream" else { throw ClientError.invalidContract }
    var decoder = SSEDecoder()
    for try await byte in bytes {
      try Task.checkCancellation()
      if let transaction = try decoder.append(byte) { try await receive(transaction) }
      if let data = decoder.transientData { try await transient(data) }
    }
    // A partial EOF frame is intentionally discarded; only committed cursor is resumed.
    throw ClientError.unavailable
  }
}

/// One frame at a time: no unbounded AsyncStream queue; the consumer supplies backpressure.
public struct SSEDecoder: Sendable {
  public private(set) var transientData: Data?
  private var line = Data()
  private var event = ""
  private var id: String?
  private var data = ""
  private var frameBytes = 0
  public init() {}
  public mutating func append(_ byte: UInt8) throws -> SyncTransaction? {
    transientData = nil
    frameBytes += 1
    guard frameBytes <= 4_194_304 else { throw ClientError.responseTooLarge }
    if byte != 10 {
      line.append(byte)
      return nil
    }
    if line.last == 13 { line.removeLast() }
    guard let text = String(data: line, encoding: .utf8) else { throw ClientError.streamMalformed }
    line.removeAll(keepingCapacity: true)
    if text.isEmpty {
      defer {
        event = ""
        id = nil
        data = ""
        frameBytes = 0
      }
      if event == "transient" {
        guard id == nil else { throw ClientError.streamMalformed }
        transientData = Data(data.utf8)
        return nil
      }
      guard event == "change" else { return nil }
      guard !data.isEmpty, let id else { throw ClientError.streamMalformed }
      let tx = try JSONDecoder().decode(SyncTransaction.self, from: Data(data.utf8))
      guard tx.cursor == id else { throw ClientError.streamMalformed }
      return tx
    }
    if text.hasPrefix(":") { return nil }
    let parts = text.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    let value =
      parts.count == 2
      ? String(parts[1]).replacingOccurrences(of: "^ ", with: "", options: .regularExpression) : ""
    switch parts[0] {
    case "event": event = value
    case "id":
      guard !value.contains("\0") else { throw ClientError.streamMalformed }
      id = value
    case "data":
      if !data.isEmpty { data += "\n" }
      data += value
    default: break
    }
    return nil
  }
}
