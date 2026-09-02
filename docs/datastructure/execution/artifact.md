# execution.artifact

## 1. 定义

`artifact` 保存任务产物的不可变引用和完整性元数据。产物包括报告、代码、补丁、日志、截图、导出文件和分析结果。Artifact 是任务输出目录，不自动成为外部效果证据或世界事实。

权威写入者为 Artifact Service，在校验对象完整性后登记。

## 2. 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `artifact_id` | `uuid` | 是 | 主键 |
| `task_id` | `uuid` | 是 | 所属任务 |
| `step_id` | `uuid` | 否 | 产出步骤 |
| `action_id` | `uuid` | 否 | 产出动作 |
| `attempt_id` | `uuid` | 否 | 产出尝试 |
| `artifact_type` | `text` | 是 | `DOCUMENT`、`CODE`、`PATCH`、`LOG`、`IMAGE`、`DATASET` 或 `OTHER` |
| `name` | `text` | 是 | 安全显示名 |
| `storage_ref` | `text` | 是 | 不可变对象引用或版本化工作区引用 |
| `content_hash` | `text` | 是 | 内容哈希 |
| `mime_type` | `text` | 是 | IANA MIME 类型 |
| `size_bytes` | `bigint` | 是 | 非负大小 |
| `produced_by` | `text` | 是 | Worker、Executor 或受控人工来源 |
| `source_refs` | `jsonb` | 是 | 输入文件、Observation、Artifact 和版本溯源 |
| `evidence_refs` | `uuid[]` | 是 | 支持产物真实性或生成过程的证据 |
| `confidentiality` | `text` | 是 | 数据分类 |
| `retention_class` | `text` | 是 | 保留策略 |
| `status` | `text` | 是 | `ACTIVE`、`SUPERSEDED`、`QUARANTINED` 或 `RETIRED` |
| `supersedes_artifact_id` | `uuid` | 否 | 新版本关系 |
| `created_at` | `timestamptz` | 是 | 登记时间 |

## 3. 不可变量

1. Artifact 内容不可原位替换。任何内容变化生成新 `artifact_id` 和哈希。
2. `storage_ref` 必须能定位精确版本，不能只指向会变化的分支或路径。
3. 产物包含的 Secret 必须在登记前隔离；无法安全脱敏时标记 `QUARANTINED` 并禁止进入模型上下文。
4. Artifact 不证明任务已完成，必须按成功条件独立验证。
5. 报告中的模型结论仍是结论，不因登记为 Artifact 而成为事实。

## 4. 关系与索引

- 引用 Task、Task Step、Action、Action Attempt 和 Evidence Index。
- 内容索引：`content_hash`。
- 任务查询索引：`(task_id, status, created_at desc)`。
- 版本链索引：`supersedes_artifact_id`。

## 5. 示例

```yaml
artifact_id: 0199a960-0000-7000-8000-000000000001
task_id: 0199a900-0000-7000-8000-000000000001
step_id: 0199a910-0000-7000-8000-000000000001
artifact_type: DOCUMENT
name: World Model 模型输入结构设计
storage_ref: workspace://docs/datastructure/context/world-model-input.md@sha256:b24e...
content_hash: sha256:b24e...
mime_type: text/markdown
size_bytes: 12840
produced_by: codex-worker
source_refs:
  design_document: workspace://docs/Design.md@sha256:0b9e...
evidence_refs: []
confidentiality: INTERNAL
retention_class: PROJECT_LIFETIME
status: ACTIVE
created_at: 2026-09-02T05:20:00Z
```
