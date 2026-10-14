import CryptoKit
import Darwin
import Foundation

/// Managed files have content-addressed names. Server filenames and absolute paths never become destinations.
public actor ArtifactCache {
  private let root: URL
  private let budget: Int64
  private var downloading = false
  public init(root: URL, budget: Int64 = 1_073_741_824) throws {
    self.root = root
    self.budget = budget
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var info = stat()
    guard lstat(root.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
      info.st_uid == getuid(), info.st_mode & 0o077 == 0
    else { throw ClientError.storage }
  }
  public func fetch(
    _ artifact: MArtifact, identity: Identity, transport: any CoreTransport,
    progress: @escaping @Sendable (Double) async -> Void
  ) async throws -> URL {
    try Task.checkCancellation()
    guard !downloading else { throw ClientError.downloadBusy }
    guard let size = Int64(artifact.bytes.rawValue), size >= 0, size <= budget,
      artifact.content_version.count == 64,
      artifact.content_version.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }
      )
    else { throw ClientError.responseTooLarge }
    downloading = true
    defer { downloading = false }
    let digest = SHA256.hash(
      data: Data((identity.domainKey + "|" + artifact.id + "|" + artifact.content_version).utf8)
    ).map { String(format: "%02x", $0) }.joined()
    let ext = (artifact.name as NSString).pathExtension
    let suffix =
      !ext.isEmpty && ext.count <= 12
        && ext.utf8.allSatisfy({
          (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
        }) ? "." + ext : ""
    let target = root.appendingPathComponent(digest + suffix)
    if FileManager.default.fileExists(atPath: target.path) {
      if try Self.validate(target, size: size, hash: artifact.content_version) {
        try Task.checkCancellation()
        try FileManager.default.setAttributes(
          [.modificationDate: Date()], ofItemAtPath: target.path)
        await progress(1)
        return target
      }
      try FileManager.default.removeItem(at: target)
    }
    try makeSpace(size)
    let temporary = root.appendingPathComponent("partial-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: temporary) }
    try await transport.download(
      try Route("artifacts/\(artifact.id)/content"), to: temporary,
      bytes: size, version: artifact.content_version, progress: progress)
    try Task.checkCancellation()
    guard try Self.validate(temporary, size: size, hash: artifact.content_version) else {
      throw ClientError.invalidContract
    }
    try Task.checkCancellation()
    try FileManager.default.moveItem(at: temporary, to: target)
    return target
  }
  private func makeSpace(_ incoming: Int64) throws {
    let fm = FileManager.default
    let files = try fm.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [
        .fileSizeKey, .contentModificationDateKey, .isRegularFileKey, .isSymbolicLinkKey,
      ])
    var entries: [(URL, Int64, Date)] = []
    for file in files {
      let value = try file.resourceValues(forKeys: [
        .fileSizeKey, .contentModificationDateKey, .isRegularFileKey, .isSymbolicLinkKey,
      ])
      guard value.isRegularFile == true, value.isSymbolicLink != true else {
        throw ClientError.storage
      }
      if file.lastPathComponent.hasPrefix("partial-") {
        try fm.removeItem(at: file)
        continue
      }
      entries.append(
        (file, Int64(value.fileSize ?? 0), value.contentModificationDate ?? .distantPast))
    }
    var total = entries.reduce(Int64(0)) { $0 + $1.1 }
    for entry in entries.sorted(by: { $0.2 < $1.2 }) where total + incoming > budget {
      try fm.removeItem(at: entry.0)
      total -= entry.1
    }
  }
  static func validate(
    _ url: URL, size: Int64, hash: String,
    checkCancellation: () throws -> Void = { try Task.checkCancellation() }
  ) throws -> Bool {
    try checkCancellation()
    let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw ClientError.storage }
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    defer { try? handle.close() }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_size == size else {
      return false
    }
    var digest = SHA256()
    while true {
      // FileHandle creates autoreleased Foundation buffers. Drain each chunk rather than
      // retaining an entire large artifact until the surrounding async job returns.
      let count = try autoreleasepool {
        try checkCancellation()
        let bytes = try handle.read(upToCount: 65_536) ?? Data()
        digest.update(data: bytes)
        return bytes.count
      }
      if count == 0 { break }
    }
    try checkCancellation()
    return digest.finalize().map { String(format: "%02x", $0) }.joined() == hash
  }
}
