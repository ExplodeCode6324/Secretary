import Foundation
struct Resource: Decodable { let resource_type: String; let resource_id: String; let revision: String; let query: String }
struct Batch: Decodable { let transaction_id: String; let sequence: String; let index: Int; let final: Bool; let changes: [Resource]; let cursor: String? }
struct World: Decodable { let availability: String; let world_version: String?; let world_history_id: UUID? }
struct Bootstrap: Decodable { let history_id: UUID; let projection_version: String; let instance_id: UUID; let cursor: String; let world: World }
struct Delivery: Decodable { let id: UUID; let notification_id: UUID; let client_id: UUID; let revision: String; let content_version: String; let received_at: String?; let presented_at: String?; let read_at: String? }
struct Content: Decodable { let id: UUID; let content_version: String; let text: String; let next_cursor: String? }
struct Examples: Decodable { let bootstrap: Bootstrap; let batch: Batch; let delivery: Delivery; let content: Content }
let example = try JSONDecoder().decode(Examples.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
precondition(example.bootstrap.projection_version == "1")
precondition(example.batch.final && example.batch.cursor != nil)
precondition(example.delivery.received_at == nil && example.delivery.presented_at == nil)
precondition(example.content.text.contains("😀"))
print("Issue9 Swift sync DTO decoding passed")
