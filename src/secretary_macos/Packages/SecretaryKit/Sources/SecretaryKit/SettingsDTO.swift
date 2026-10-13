// Public API v1 projections. Unknown state strings are preserved.
import Foundation

public struct MSettingsDraft: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var payload: JSONValue
}

public struct MSettingsApplicationsItem: Codable, Sendable {
  public var error: String?
  public var id: String
  public var revision: DecimalString
  public var state: String
}

public struct MSettingsEffectiveInstructions: Codable, Sendable {
  public var revision: String
  public var content: String
}

public struct MSettings: Codable, Sendable {
  public var draft: MSettingsDraft
  public var applications: [MSettingsApplicationsItem]
  public var blocked: Bool
  public var world_available: Bool
  public var effective_instructions: MSettingsEffectiveInstructions
}

public struct MWorldPage: Codable, Sendable {
  public var items: [JSONValue]
  public var world_version: DecimalString
  public var next_cursor: String?
}

public struct MWorldSlotSlot: Codable, Sendable {
  public var slot_id: String
  public var subject_id: String
  public var predicate_key: String
  public var scope_key: String
  public var revision: String
}

public struct MWorldSlot: Codable, Sendable {
  public var slot: MWorldSlotSlot?
  public var world_version: DecimalString
}

public struct MWorldEdit: Codable, Sendable {
  public var kind: String
  public var expected_revision: DecimalString
  public var entity_kind: String?
  public var display_name: String?
  public var external_key: String?
  public var retire: Bool?
  public var mode: String?
  public var predicate_key: String?
  public var scope_key: String?
  public var value: JSONValue?
  public var resolution_note: String?
  public var entity_id: String?
  public var subject_id: String?
  public var assertion_id: String?
  public var object_entity_id: String?
  public var resolve_conflict_id: String?
  public var valid_from: String?
  public var valid_to: String?
  public var fresh_until: String?
  public var aliases: [String]?
}

public struct MScope: Codable, Sendable {
  public var id: String
  public var revision: DecimalString
  public var updated_at: String
  public var name: String
  public var description: String
  public var kind: String
  public var root_path: String?
  public var notes_path: String?
  public var state: String
  public var default_write: String?
}

public struct MScopePage: Codable, Sendable {
  public var items: [MScope]
  public var version: String
  public var next_cursor: String?
}

public struct MProfile: Codable, Sendable {
  public var name: String
  public var revision: DecimalString
}
