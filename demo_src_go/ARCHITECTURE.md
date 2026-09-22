# 实现与设计对应

## 权威和代码边界

BrainStorm 不改动。代码按 `domain / store / model / engine / world / transport` 收敛目录，`engine` 内分文件维护宿主、调度、授权、程序和记忆服务。单应用维护一个协调 writer；主会话与任务 agent 是可退出的 Go 执行流程，等待授权/决定时不占用 worker。应用重启可载入同一任务的完整记录，不要求原进程持续存活。

`domain.R` 是保存扩展 JSON 原件的内部表示；每个领域记录提交前均通过内嵌的 canonical JSON Schema。不是允许客户端上传任意状态的接口。模型/UI 输入是 DTO，宿主填充 ID、revision、hash、状态及权限身份；状态改变校验 canonical graph 的边，并由服务执行相应守卫。Go 的 RE2 不支持 canonical RelativePath 的负向前瞻，该一个表达式用等价的路径片段/NUL 检查实现，其他表达式仍采用线性时间 RE2。

代码不依赖 `demo_pi`。仅参考本地 Pi agent-core README 中「模型输入转换与运行事件分离」和完整响应后串行工具循环的设计思路；Consciousness 三种事项层级与第四种待整理原文来自 BrainStorm。未引入向量库、外部 agent 库或第二套任务权威。

## 持久化

journal 外帧 `{payload_b64,sha256}` 与 canonical `JournalTransaction` 一致。对象精确字节保存、Sync、rename、Sync 目录后才能引用；journal Sync 后才 ACK。所有者用系统 flock，不能用 PID 文件替代。事务序列、事件序列独立，epoch 在重启后可靠保存。跨对象引用、revision、任务/结果/检查点归属与批准范围在候选视图检查。

完整末尾的坏帧阻塞；只有没有换行的最后残帧可截断，并保存诊断副本。必要对象缺失、散列错误、跨引用缺失或 context adapter/profile 不兼容均阻塞恢复。SIGKILL 测试证明进程崩溃后的 ACK 保留；尚无物理断电证明。

首版直接重放 journal，不生成设计中的可选快照缓存，也不执行历史 GC。启动时间随日志增长；这是明确的 demo 性能边界。任务 workspace/execution manifest 是从 journal 重建的定位文件，immutable objects 才是证据。

## Agent loop 与 Context

主会话只注册 `memory_read`、`memory_propose_change`、`task_propose`、`task_query`、`task_control`、`master_remind`。每次认领当前一条 durable Input；运行期间新输入继续 ACCEPTED。只有对应 loop 的输入在完整回复和工具结果保存后变成 HANDLED。

ModelCall 的实际 HTTP body 不含密钥，按原字节保存到 Context.raw_context；完整响应原件另存，部分响应不执行工具。工具命令的请求 ID 从 loop/model-call/tool-call 稳定派生。恢复先处理已保存响应的未完成工具；已完成命令按 receipt 返回，不重放外部影响。主会话模型错误保留进度，由「继续保存的进度」重试，避免错误期间无限计费。

任务 Checkpoint 保存精确模型输入及包括后续完整响应/工具结果的 immutable Task Log 引用。等待恢复先完成已保存工具调用，再将相同历史材料加上新的结果装入下一请求。后续入口使用 `parent_execution_id` 创建新计划；同时指定 `reuse_task_id` 可在同一活动计划内创建新执行，必须保持原目标、约束、验收与 executor，且原执行已经结束并处于保留期。旧执行不复活。

上下文预算采用保守的 UTF-8 字节上界作为 token 估计；不是该模型的精确 tokenizer。默认 64,000 上界、8,000 reserve、24,000 整理阈值；这会提前阻塞，不截断原文。Task context 达上限时保存并暂停，需调整预算或分解后续任务；任务 context 不由 Consciousness 摘要替换。

## Consciousness

完整已处理 loop 是可承接最小单元。固定原文集合和原 Consciousness revision，专门整理调用可与主会话并行。候选检查 canonical WorkItem、引用归属、完整组覆盖、未履行承诺、CAS 后提交；可以承接部分完整 loop，不移除其他材料。整理不创建 Scheduler task，也不额外触发主会话。

待整理原文引用先随 QUEUED job 持久化，失败时保留；完整模型响应也在解析前保存。模型用已有事件 ID 标记证据，宿主解析成精确对象引用，再执行相同的严格归属校验，避免让模型重新拼写对象哈希。只有候选通过验证并完成原子交接，才清除已覆盖的待整理引用。

原文留在日志中；未承接原文随下一 Context 装入。程序只证明结构和交接，不证明摘要语义完整。已有未履行承诺采取保守保留检查，不能仅用时间删除。当前未提供独立的人工语义编辑器。

## 调度、执行与授权

支持 IMMEDIATE、AT、INTERVAL；周期是 UTC 固定秒数，不含 cron/DST/未知 EVENT 来源。调度检查间隔 300ms，超过触发点 2 秒视作错过窗口，按持久化策略处理。QUEUE 保存 occurrence 并在前一执行结束后接续；它不会因排队时间被误判为遗漏。只有登记的本地资源/设备和执行依赖检查器生效，未知前提记录 UNKNOWN 并等待。

任务 agent 支持 workspace_read/list、file_write、ask_decision、task_finish。写入限制任务 work 目录，拒绝路径穿越/静态 symlink，并通过 `os.Root` 执行防越界文件替换。Master 看到的参数、资源与已有文件内容版本绑定在同一 Operation；最终 gate 重新检查版本、取消状态、一次批准/规则和时效。

一次请求默认 30 分钟有效。持续规则的 schema 约束和资源路径段边界在每次 gate 检查；无默认通配放行。规则由独立认证 UI 提交。UI 的普通决定不调用批准接口。

PROGRAM 的协调流程可处于 RUNNING/WAIT_AUTH，但**真实程序只在 `program.run` Operation.DISPATCHED 与批准消费已 durable 后启动**。程序仅带最小 PATH/LANG 环境，不继承 API/PG/界面凭据。stdout/stderr 原件保存，进程组取消等待真实退出；中断可能发生外部影响时转 RESULT_UNKNOWN。共享 OS 账号下，人工登记的任意程序不是安全沙箱。

普通本地通知采用 durable delivery_key 和浏览器确认；刷新不会重复创建通知。未接入邮件、Slack 或外部推送。未知文件写入可只读比较目标现有内容；无法证明时保持 UNKNOWN，不靠重试推断。

## World Model

采用根目录现有 PostgreSQL migrations。change_id 锁、slot 锁、expected_revision、不可变主张/证据、SUPPORTING/CONTESTED、显式解决冲突、更正/撤回、receipt/outbox 同事务。来源种类和证据必须与已有身份、原日志一致；批准写入不代表事实真实。

PG 已提交但 JSON 未交接时，用同 change_id 取回 receipt；JSON 完成后才标 outbox exported，字段指向实际 journal transaction ID。该恢复只适用于已授权的同一数据库变更，不能推广成任意外部动作自动重试。

UI 的字符串检索提供当前投影和实体/来源/谓词目录，每类最多 100 条并明确标记 truncated。`POST /v1/world/query` 和 memory_read.world_query 接受 canonical WorldQuery，按事实有效时间、历史状态和筛选查询；返回 canonical WorldReadResult、原始来源/证据、freshness、omitted_count 和稳定游标。每页使用短 REPEATABLE READ 事务，跨页校验相关 slot revision 摘要，变更时返回 CONFLICT 并要求重开查询。谓词仍由人工 SQL 维护。

## 接口收敛与限制

可运行接口见 `internal/transport/server.go`。没有对外 worker HTTP 接口：同进程受控 gateway 绑定执行身份，外部 HTTP 只有 Master token/cookie。Host 严格限制 127.0.0.1，写 cookie 请求验证 Origin，UI 不以 body.actor 取得身份。

短期详情访问刷新 TTL；列表、日志读取不刷新。归档验证后保留 RETIRED 墓碑和全部对象。自动备份、历史压缩、多机租约、独立账号/容器、外部通知及未知程序效果的通用核验均不是本 demo 的已实现能力。

## 参考依据

- 本仓库 `BrainStorm_Baseline_v3.md`、`demo_design`、`state_machine/catalog.json`、`json/contracts.schema.json` 与 `schema`。
- [OpenCode Go 官方端点说明](https://opencode.ai/docs/go/)：Go 的 Responses 路由为 `/zen/go/v1/responses`，不同于 Zen 的 `/zen/v1`。
- 本地 `demo_pi/pi_resource/packages/agent/README.md`：仅阅读模型输入转换与事件循环设计；Go demo 不调用该包。
