# 数据模型

Secretary 使用本地 journal/CAS 保存运行记录，使用可选 PostgreSQL World Model 保存结构化事实。客户端通过独立的 API DTO 读取它们。

## 核心记录

| 记录 | 含义 |
| --- | --- |
| Session、Input、Notification | 主会话、输入队列与面向 Master 的通知 |
| Context、ModelCall、MainPromptSnapshot | 恢复上下文、模型调用与一轮固定提示词 |
| Consciousness、CompactionJob | 工作记忆、覆盖水位与整理进度 |
| MemoryCommitment、MemoryExtractionJob | 承诺状态、来源与待补提工作 |
| TaskPlan、Execution、TaskResult | 任务基线、单次执行与结果 |
| Scope（WorkScope） | 可复用工作范围：DIRECTORY 或 NONE |
| Operation、Authorization、AuthorizationRule | 一次作用、审批与匹配规则 |
| Decision | 执行中需要 Master 回答的工作决定 |
| SettingsDraft、SettingsApplication、UserInstructions | 共享草稿、应用进度与有效说明 |
| CoreIdentity、AssistantProfile、ClientRegistration、ApiCommand | 数据域身份、显示名、客户端登记与 API 回执 |

内部 Schema 的 `WorkScope` 定义持久记录 `record_type=Scope`；旧 `Scope` 定义是事件与资源的关联字段组合。二者分别用于工作目录管理和记录关联。

## 身份、版本与原件

`record_type + id` 定位记录，`revision` 支持版本检查。跨记录变更、事件和请求回执在一个 journal 帧中提交。ObjectRef 用 SHA-256、字节长度和媒体类型引用不可变原件；可变工作文件留在 Execution 的绑定目录。

TaskPlan 保存计划基线与排队请求，每个 Execution 用 `proposal_ref` 固定本轮要求。Execution 创建时冻结 `scope_id` 和 `workspace_binding`，后续修改范围只影响未来执行。TaskResult 的产物引用固定 CAS 版本；`verified_by` 当前为 `NOT_VERIFIED`，验收评估来自执行者，外部验算可单独记录。

ModelCall 区分逻辑调用与物理尝试；成功响应和已保存工具结果用于恢复。MemoryExtractionJob 以固定来源及分段保存提取进度，承诺合并读取最新账本。旧 ExtractionRecovery 记录保留读取支持，新运行使用 MemoryExtractionJob。

## Context 的两种用途

`CHECKPOINT` 保存恢复所需的完整上下文，`MODEL_REQUEST` 保存经过预算投影的实际模型输入。`source_context_id` 关联两者。目前 `source_event_ids`、`omitted_refs`、`wm_fact_versions` 尚未完整填充，`tools_schema` 存放 system 消息；相关编码和字段整理安排在 #24。实际模型请求仍由当前适配器构造并检查容量。

## World 与公开 DTO

World 将实体、predicate、事实 slot、assertion、证据、冲突、状态投影和变更回执分开保存。更正新增 assertion 并替代旧陈述，撤回更新其投影状态，来源历史继续可查。

API DTO 使用十进制字符串表示 revision、事件序号和字节长度，资源内容通过 ID 与版本读取。公开 TaskCommand 使用 `acceptance`；内部 TaskProposal 使用 `acceptance_criteria`。客户端类型从公开 schema 生成。

详细字段见[内部字段索引](data/README.md)，数据库见[SQL 参考](database.md)，客户端合同见 [API v1](api/v1/README.md)。
