import Darwin
import Foundation

public struct Endpoint: Decodable, Sendable {
  public let api_version: String
  public let url: String
  public let token: String
  public let pid: Int
  public let instance_id: String
  public let data_domain_id: String

  public static func discover(in directory: URL) throws -> Endpoint {
    let file = directory.appendingPathComponent("core-endpoint.json")
    let fd = open(file.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw ClientError.unsafeDiscovery }
    defer { close(fd) }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
      info.st_uid == getuid(), info.st_mode & 0o077 == 0,
      info.st_size > 0, info.st_size <= 65_536
    else { throw ClientError.unsafeDiscovery }
    var bytes = [UInt8](repeating: 0, count: Int(info.st_size))
    var offset = 0
    while offset < bytes.count {
      let count = bytes.withUnsafeMutableBytes { buffer in
        read(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
      }
      guard count > 0 else { throw ClientError.unsafeDiscovery }
      offset += count
    }
    let endpoint = try JSONDecoder().decode(Self.self, from: Data(bytes))
    try endpoint.validate()
    return endpoint
  }
  public func validate() throws {
    guard api_version == "1", pid > 0, UUID(uuidString: instance_id) != nil,
      UUID(uuidString: data_domain_id) != nil,
      token.utf8.count == 64,
      token.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
      let parts = URLComponents(string: url), parts.scheme == "http", parts.host == "127.0.0.1",
      let port = parts.port, (1...65535).contains(port), parts.user == nil, parts.password == nil,
      parts.path.isEmpty, parts.query == nil, parts.fragment == nil
    else { throw ClientError.unsafeDiscovery }
  }
}

/// Invoked only by the explicit Start button. The existing CLI detaches Core;
/// ending the app or this short-lived CLI does not stop Core.
public enum LocalCoreLauncher {
  public static func start(node: URL, repository: URL, directory: URL, mode: String) async throws {
    guard node.isFileURL, repository.isFileURL, directory.isFileURL,
      node.path.hasPrefix("/"), repository.path.hasPrefix("/"), directory.path.hasPrefix("/"),
      ["fixture", "live"].contains(mode), FileManager.default.isExecutableFile(atPath: node.path)
    else {
      throw ClientError.unavailable
    }
    let cli = repository.appendingPathComponent("src/pi_secretary/src/core-cli.ts")
    guard FileManager.default.fileExists(atPath: cli.path) else { throw ClientError.unavailable }
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, any Error>) in
      let process = Process()
      process.executableURL = node
      process.arguments = ["--import", "tsx", cli.path, "start"]
      process.currentDirectoryURL = repository
      var environment = ProcessInfo.processInfo.environment
      environment["SECRETARY_DATA"] = directory.path
      environment["SECRETARY_MODE"] = mode
      process.environment = environment
      // Avoid pipes that block or expose Core's stdout in UI/logs.
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      process.terminationHandler = { process in
        if process.terminationStatus == 0 {
          continuation.resume()
        } else {
          continuation.resume(throwing: ClientError.unavailable)
        }
      }
      do { try process.run() } catch { continuation.resume(throwing: ClientError.unavailable) }
    }
  }
}
