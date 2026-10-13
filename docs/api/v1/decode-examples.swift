import Foundation
// Smoke fixture only. A future native client must keep unknown enum values closed.
struct Capability: Decodable { let state: String; let allowed: Bool; let reason: String? }
struct Core: Decodable {
    let api_version: String; let data_domain_id: UUID; let owner_id: UUID
    let instance_id: UUID; let session_id: UUID; let capabilities: [String: Capability]
}
struct Resource: Decodable { let type: String; let id: UUID }
struct Receipt: Decodable {
    let request_id: UUID; let command: String; let acceptance: String
    let state: String; let revision: String; let resource_ids: [Resource]
}
struct Message: Decodable {
    let id: String; let revision: String; let role: String; let text: String
    let next_cursor: String?
}
struct SyncCursor: Decodable { let cursor: String; let sequence: String; let instance_id: UUID }
struct SyncChange: Decodable {
    let kind: String; let resource_type: String
    let resource_id: String?; let revision: String?; let query: String?
}
struct SyncTransaction: Decodable { let cursor: String; let changes: [SyncChange] }
struct SyncPage: Decodable { let transactions: [SyncTransaction]; let next_cursor: String; let has_more: Bool }
struct Presentation: Decodable { let client_id: UUID; let presented_at: String }
struct NotificationContent: Decodable {
    let text: String; let media_type: String; let content_version: String
    let bytes: String; let truncated: Bool
}
struct Notice: Decodable {
    let id: UUID; let revision: String; let state: String
    let created_sequence: String; let read_at: String?; let presented: [Presentation]
    let content: NotificationContent
}
struct OperationText: Decodable {
    let state: String; let text: String; let bytes: String; let content_version: String?
    let truncated: Bool; let next_cursor: String?; let unavailable_reason: String?
}
struct OperationDisplay: Decodable {
    let parameters: OperationText; let stdout: OperationText
    let stderr: OperationText; let reason: OperationText; let source_truncated: Bool?
}
struct Operation: Decodable { let id: UUID; let revision: String; let display: OperationDisplay }
struct Artifact: Decodable {
    let id: UUID; let bytes: String; let relative_path: String?; let path_base: String
    let scope_id: UUID?; let path_unavailable_reason: String?
}
struct Examples: Decodable {
    let core: Core; let receipt: Receipt; let message: Message
    let operation: Operation; let artifact: Artifact
    let sync_cursor: SyncCursor; let sync_page: SyncPage; let notification: Notice
}
let examples = try JSONDecoder().decode(Examples.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
precondition(examples.core.api_version == "1")
precondition(examples.core.capabilities["devices"]?.allowed == false)
precondition(examples.message.revision == "9007199254740993")
precondition(UInt64(examples.message.revision) == 9007199254740993)
precondition(examples.message.text.contains("😀"))
precondition(examples.message.role == "future_role")
precondition(UInt64(examples.sync_cursor.sequence) == 9007199254740993)
precondition(examples.sync_page.transactions[0].changes[0].kind == "invalidate")
precondition(examples.notification.read_at == nil)
precondition(examples.notification.presented.count == 1)
precondition(examples.notification.content.truncated)
precondition(examples.notification.content.text.contains("😀"))
precondition(examples.operation.display.stdout.text == "中文 😀")
precondition(examples.operation.display.stderr.state == "available")
precondition(examples.operation.display.stderr.text.isEmpty)
precondition(examples.operation.display.source_truncated == nil)
precondition(examples.artifact.relative_path == "reports/result.txt")
precondition(UInt64(examples.artifact.bytes) == 9007199254740993)
print("API v1 Swift decoding passed")
