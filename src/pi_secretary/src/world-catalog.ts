/** Versioned, closed ontology. Legacy SQL catalogs remain archival only.
 * Retire catalog entries; never delete their keys, which historical facts retain.
 */
export const WORLD_POLICY = "world-store-v1";
export const ENTITY_KINDS = [
  "PERSON",
  "ORGANIZATION",
  "DEVICE",
  "SERVICE",
  "RESOURCE",
  "PROJECT",
  "GOAL",
] as const;
export const NOTE_TOPICS = [
  "identity",
  "goals",
  "current_context",
  "working_notes",
  "free",
  "other",
];
export type Predicate = {
  predicate_key: string;
  labels: [string, string];
  subject_kinds: readonly string[];
  cardinality: "SINGLE" | "MULTI";
  value_type: "STRING" | "NUMBER" | "OBJECT" | "ENTITY";
  value_schema: Record<string, unknown>;
  topics: string[];
  retired: boolean;
};
const text = { type: "string", minLength: 1, maxLength: 4000 };
function p(
  key: string,
  en: string,
  zh: string,
  kinds: readonly string[],
  cardinality: Predicate["cardinality"],
  type: Predicate["value_type"] = "STRING",
  schema: Record<string, unknown> = text,
  topics = ["other"],
  retired = false,
): Predicate {
  return {
    predicate_key: key,
    labels: [en, zh],
    subject_kinds: kinds,
    cardinality,
    value_type: type,
    value_schema: schema,
    topics,
    retired,
  };
}
export const PREDICATES: readonly Predicate[] = [
  p(
    "person.display_name",
    "Person name",
    "人物姓名",
    ["PERSON"],
    "SINGLE",
    "STRING",
    text,
    ["other"],
    true,
  ),
  p(
    "person.height",
    "Height",
    "身高",
    ["PERSON"],
    "MULTI",
    "NUMBER",
    { type: "number", exclusiveMinimum: 0 },
    ["other"],
    true,
  ),
  p(
    "person.contact",
    "Contact",
    "联系方式",
    ["PERSON"],
    "MULTI",
    "OBJECT",
    {
      type: "object",
      required: ["kind", "value"],
      properties: { kind: text, value: text },
      additionalProperties: false,
    },
    ["email", "phone", "address", "other"],
  ),
  p(
    "person.member_of",
    "Membership organization",
    "组织关系",
    ["PERSON"],
    "MULTI",
    "ENTITY",
    {},
    ["employment", "membership", "other"],
  ),
  p(
    "preference.statement",
    "Preference",
    "偏好",
    ["PERSON"],
    "MULTI",
    "STRING",
    text,
    ["communication", "work", "language", "other"],
  ),
  p("goal.statement", "Goal", "目标", ["GOAL"], "SINGLE"),
  p(
    "project.constraint",
    "Project constraint",
    "项目约束",
    ["PROJECT"],
    "MULTI",
  ),
  p(
    "resource.location",
    "Resource location",
    "资源位置",
    ["DEVICE", "SERVICE", "RESOURCE", "PROJECT"],
    "SINGLE",
  ),
  p(
    "resource.depends_on",
    "Dependency",
    "依赖",
    ["DEVICE", "SERVICE", "RESOURCE", "PROJECT"],
    "MULTI",
    "ENTITY",
    {},
  ),
  p(
    "resource.observed_state",
    "Observed state",
    "观察状态",
    ["DEVICE", "SERVICE", "RESOURCE"],
    "SINGLE",
    "OBJECT",
    {
      type: "object",
      required: ["state"],
      properties: { state: text },
      additionalProperties: false,
    },
  ),
  p(
    "entity.guideline",
    "Guideline directive",
    "守则指令",
    ["PERSON", "SERVICE"],
    "MULTI",
    "STRING",
    text,
    ["communication", "work", "safety", "other"],
  ),
  p(
    "entity.note",
    "Descriptive note",
    "描述记录",
    ENTITY_KINDS,
    "MULTI",
    "STRING",
    text,
    NOTE_TOPICS,
  ),
];
export const predicate = (key: string) =>
  PREDICATES.find((p) => p.predicate_key === key);
export const normalize = (s: string) =>
  s.normalize("NFKC").trim().toLocaleLowerCase("en-US");
export function validateWorldLabel(s: string) {
  if (
    !s.trim() ||
    s.trim().length > 256 ||
    normalize(s).startsWith("role:") ||
    /[\r\n\u0000]/.test(s)
  )
    throw Error("INVALID_WORLD_LABEL_RESERVED_ROLE");
  return s.trim();
}

export const TOPIC_LABELS: Record<string, [string, string]> = {
  identity: ["identity", "身份"],
  goals: ["goals", "目标"],
  current_context: ["current context", "当前背景"],
  working_notes: ["working notes", "工作笔记"],
  free: ["free note", "自由笔记"],
  other: ["unclassified", "未分类"],
  communication: ["communication", "沟通"],
  work: ["work", "工作"],
  safety: ["safety", "安全"],
  language: ["language", "语言"],
  email: ["email", "邮箱"],
  phone: ["phone", "电话"],
  address: ["address", "地址"],
  employment: ["employment", "雇佣"],
  membership: ["membership", "成员关系"],
};
