// Public API v1 projections. Unknown state strings are preserved.
import Foundation

public struct MArtifact: Codable, Sendable {
  public var id: String
  public var name: String
  public var task_id: String
  public var execution_id: String
  public var content_version: String
  public var bytes: DecimalString
  public var media_type: String
  public var state: String
  public var relative_path: String?
  public var path_base: String
  public var scope_id: String?
  public var path_unavailable_reason: String?
}

public struct MArtifactPage: Codable, Sendable {
  public var items: [MArtifact]
  public var version: String
  public var next_cursor: String?
}
