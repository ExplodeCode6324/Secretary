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
struct Examples: Decodable { let core: Core; let receipt: Receipt; let message: Message }
let examples = try JSONDecoder().decode(Examples.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
precondition(examples.core.api_version == "1")
precondition(examples.core.capabilities["devices"]?.allowed == false)
precondition(examples.message.revision == "9007199254740993")
precondition(UInt64(examples.message.revision) == 9007199254740993)
precondition(examples.message.text.contains("😀"))
precondition(examples.message.role == "future_role")
print("API v1 Swift decoding passed")
