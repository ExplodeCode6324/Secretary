import Foundation

public protocol NotificationDelivery: Sendable {
  func schedule(identifier: String, text: String) async throws -> Bool
  func deliveredIdentifiers() async -> Set<String>
}

/// Testable boundary around UserNotifications. Scheduling is never evidence of presentation.
public struct NotificationAdapter: Sendable {
  public let engine: ClientEngine
  public let delivery: any NotificationDelivery
  public init(engine: ClientEngine, delivery: any NotificationDelivery) {
    self.engine = engine
    self.delivery = delivery
  }
  public func confirmDelivered(generation: UInt64) async throws {
    try await engine.requireGeneration(generation)
    let prefix = try await engine.notificationIdentifier("")
    let delivered = await delivery.deliveredIdentifiers()
    for identifier in delivered where identifier.hasPrefix(prefix) {
      let id = String(identifier.dropFirst(prefix.count))
      guard UUID(uuidString: id) != nil else { continue }
      try await engine.recordPresentation(id, proof: .deliveredNotification, generation: generation)
    }
  }
  public func update(_ notices: [NotificationDTO], generation: UInt64) async throws {
    try await engine.requireGeneration(generation)
    let delivered = await delivery.deliveredIdentifiers()
    try await engine.requireGeneration(generation)
    for notice in notices {
      let identifier = try await engine.notificationIdentifier(notice.id)
      if delivered.contains(identifier) {
        try await engine.recordPresentation(
          notice.id, proof: .deliveredNotification, generation: generation)
      } else if try await engine.shouldSchedule(notice) {
        try await engine.requireGeneration(generation)
        if try await delivery.schedule(identifier: identifier, text: notice.content.text) {
          try await engine.markScheduled(notice.id, generation: generation)
        }
      }
    }
    // Caller performs one delayed confirmation and another on application activation.
    // SCHEDULED persists across restart: uncertain OS delivery is not automatically duplicated.
  }
}
