# Settings 与 World 生效

SettingsSource 冻结完整摘要/提取证据；新 Context 的原文窗口使用与普通整理相同的选择器，并计入实际 system 和工具声明。候选退出回执只有与 APPLIED 一起提交才生效；失败候选不改变退出事实。FAILED/BLOCKED 重试重建请求视图，APPLIED 前再次核对候选的检索水位；World 的已提交结果及回执继续保留。索引故障时承接最后回执，不回填已退出原文，也不新增退出。旧来源身份不明确时继续保护，已认证包装来源损坏时明确阻止发送。

Settings 将有效说明、World 修改和运行配置切换统一为一次可恢复的应用。实现位于 [settings.ts](../src/pi_secretary/src/settings.ts)、[settings-memory.ts](../src/pi_secretary/src/settings-memory.ts) 和 [world.ts](../src/pi_secretary/src/world.ts)。

## 草稿与应用

App 初始化共享 SettingsDraft。owner 保存整份 payload，再按草稿 revision 提交 apply；模型提出的 WorldCommand 获批后也进入同一协调器。

payload.instructions 包含 content 和有效说明 expected_revision，null 表示保持说明，空文本表示停用。edits 包含 World 变更，实际领域批次上限为 50 项；command_ids 关联模型提案，人工草稿使用空数组。助手显示名通过独立 AssistantProfile 更新。

应用步骤如下：

1. QUEUED 固定草稿、运行配置和待整理来源，暂停主会话与新任务领取。
2. SUMMARIZING 整理未覆盖原文和旧工作记忆，验证来源与摘要，预先构建新 context 并检查容量。
3. 存在 World 变更时进入 COMMITTING，在一个数据库事务内检查版本、执行全部 edits，保存批次回执和 outbox；仅修改说明时直接进入 REBUILDING。
4. REBUILDING 完成回执桥接，在一个 Store 事务中提交有效说明、工作记忆、context 指针、配置哈希和 APPLIED。
5. 继续处理期间已持久化的新输入和任务反馈。

现有异步任务继续按已固定的要求运行。承诺提取单独登记 MemoryExtractionJob，补提进度独立于有效设置。历史 Master 输入在新 context 中保留未覆盖来源和近期原文窗口，完整来源仍可经检索及原事件分片读取。

## World 数据

World 目录提供实体、predicate 和来源，facts 提供当前或历史陈述，slot 提供精确 revision。同批可创建实体并引用它登记事实。

ENTITY 编辑可带 aliases（最多 20 个、每个最多 128 字）；去空白、去重后保存。缺省 aliases 保留已有值，空数组清空。名称/别名可用于主会话 World 查询，多个匹配会返回候选；新实体仍由 Settings 创建。

更正新增 assertion，并把旧陈述标为 SUPERSEDED；撤回标为 RETRACTED。默认查询读取当前状态与有效时间，history 查询展开历史。实体类型保持固定；停用存在 ACTIVE / SUPPORTING / CONTESTED 引用的实体时返回关联冲突，便于先处理引用。

World 事务保存来源、证据、变更回执和审计 outbox。字段与 SQL 约束见[数据库参考](database.md)。

## 恢复

| 状态 | 处理 |
| --- | --- |
| FAILED | 已确认有效变更尚未提交；保留旧配置，可重试或将人工批次恢复为草稿 |
| BLOCKED | 提交结果待确认或本地重建未完成；查询批次回执后继续 |
| SUMMARIZING 重启 | 按固定来源和已保存候选继续分段 |
| COMMITTING / REBUILDING 重启 | 使用同一数据库锁查询回执，再推进桥接和本地提交 |

回执查询与提交使用同一事务锁；数据库不可访问时保留待确认状态。提交后的设置修改通过新批次表达。普通人工批次在提交前失败时继续使用旧配置；启动配置切换失败时等待恢复完成。

运行配置指纹覆盖主/任务模型身份、容量与预算、提示词、数据库连接配置哈希、整理和并发参数。已有未完成应用时先使用其原配置恢复，再发起下一次切换。首次空会话记录配置；已有上下文的配置变化触发整理和重建。

## API

路径前缀均为 `/api/v1`；字段以[公开 schema](api/v1/schema.json)和[操作表](api/v1/operations.json)为准。

| 方法与路径 | 用途 |
| --- | --- |
| GET `/settings` | 有效说明、草稿、最近应用及 blocked 状态 |
| POST `/settings/draft` | 按 expected_revision 保存完整 payload |
| POST `/settings/apply` | 应用指定草稿版本；无变化时保存 NO_CHANGES 回执 |
| POST `/settings/applications/{id}/retry` | 重试或对账应用 |
| POST `/settings/applications/{id}/restore-draft` | 将 FAILED 人工批次恢复至指定版本的空草稿 |
| GET `/world/catalog` | 按 entities/predicates/sources 分页 |
| GET `/world/facts` | 按 subject/predicate/history 查询 |
| GET `/world/slot` | 按 subject/predicate/scope 查询 revision |
| POST `/memory/extraction/retry` | 重排受理时的失败提取来源 |

所有写命令包含 UUID request_id，公开 revision 使用十进制字符串。业务应用进度从 `GET /settings` 读取，受理对账使用 `GET /requests/{id}`；补提状态从 `GET /memory` 读取。
