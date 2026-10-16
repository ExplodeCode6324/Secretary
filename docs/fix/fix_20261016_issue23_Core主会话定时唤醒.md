# Issue #23：Core 主会话定时唤醒

状态：**实施完成，Hermes R2b 条件通过，最终全量验证/CI 进行中**。Master 已于 2026-10-16 授权：经 Hermes 复核通过后执行，再提交 PR/CI 并完成合并条件复核。

## 1. 决策、范围与基线

- 2026-10-16，Master 要求先写 fix 计划，确认后再实施；同时明确 SwiftUI 路线已废弃，后续 Hermes 复核只看 Core 服务本身。
- 对应 [Issue #23](https://github.com/ExplodeCode6324/Secretary/issues/23)。本计划以该决定取代旧 issue 中“客户端与 #10 集成后才能结项”的要求。交付对象是可独立运行的 Core、公开 API、持久语义和测试证据。
- 实际基线：`main@4786b1263c862a4327871acc97c8f1e69ba64d97`，本轮开始时与远端 main 一致。原目录分支 `codex/issue23-core-wakeup-plan`；不建立独立工作区，不触碰既有未跟踪报告。
- 已有 API v1、幂等命令、持久同步、通知、记忆检索与输入退出作为基础。#22 推送不作为本项前置；本项只验证通知记录，不把记录生成等同手机送达。
- 不实现任何前端，不构建或验收 SwiftUI，不恢复旧 Web/TUI，不删除现有原生源码。设备、远程接入、周期调度器、自然语言日期解析和 #24/#25 的整体优化重构不在范围内。

## 2. 当前代码与必须处理的差异

| 位置 | 已核对的行为 | 本项处理 |
| --- | --- | --- |
| [app.ts](../../src/pi_secretary/src/app.ts) `pump` | 调用 Scheduler、反馈交付和 Host drain | 加入独立的到期定时器交付；不依赖执行 agent 完成任务 |
| [host.ts](../../src/pi_secretary/src/host.ts) `accept` | 独立提交 Input；非 MASTER 日志统一标 SCHEDULER | 不能先调用 accept 再单独改定时器；专用交付事务，日志 actor 使用现有 HOST |
| 同文件 `tools` | 包装工具，按稳定工具调用身份恢复结果 | 创建/取消本身也要幂等，覆盖领域提交成功、main.tool.result 尚未保存的崩溃窗口 |
| [input-projection.ts](../../src/pi_secretary/src/input-projection.ts) `inputMessage` | payload 正文直接进入 user message；MASTER 输入另有保护规则 | TIMER 使用有来源标识的持久正文；不伪装 Master 输入，不进入 MASTER 专属保护/承诺来源 |
| [contracts.schema.json](../../src/contracts/contracts.schema.json) | Input producer 尚无 TIMER，尚无 WakeTimer | 扩展权威 schema、记录联合及生成类型/文档 |
| [application-service.ts](../../src/pi_secretary/src/application-service.ts) | ApiCommand 与首个领域变更同帧受理，支持无变化回执 | 取消复用短命令机制，查询纯读 |
| [sync-service.ts](../../src/pi_secretary/src/sync-service.ts) | 各公开资源显式映射到 ChangeFeed | 将 wakeups 纳入变更资源和失效映射 |

上述为静态核查，不是本项功能已实现或测试通过。

## 3. 方案

### 3.1 持久记录与唯一事实来源

新增 WakeTimer，使用既有 base/revision/schema_version，字段如下：

| 字段 | 语义 |
| --- | --- |
| session_id | 所属主会话 |
| at | 带时区输入归一后的 UTC ISO 时间 |
| note | 到点交给主会话的说明；非空，最多 4 KiB UTF-8 |
| source_event_ids | 创建轮次领取的 Input 对应 input.accepted 事件，去重保存；不让模型填写来源 ID |
| state | PENDING / FIRED / CANCELLED |
| fired_at / cancelled_at | 对应实际提交时间，否则 null |
| input_id | FIRED 对应的稳定 TIMER Input ID，否则 null |

创建轮次可能领取多个输入，因此使用来源数组，避免任取一条 Master 输入。TIMER 轮次再排下一次时，来源记录当前 TIMER input.accepted；通过其 timer_id 可以追溯上一计时器和最初来源。没有可追溯输入的创建调用拒绝，不伪造来源。

权威状态只存 journal/CAS。由记录重建 session 内的 PENDING 集合，最多 100 项；创建、取消、触发在提交成功后更新集合，失败不污染集合。每轮仅遍历该集合，不反复遍历无限增长的历史计时器。重启先恢复集合，再在首次 pump 处理到期项；不引入数据库表或系统 cron。首版保留 FIRED/CANCELLED 历史，不新增定时器清理或留存任务。

### 3.2 主会话工具

- `schedule_wakeup({at, note})`：仅注册在主会话，返回 timer_id、归一时间与状态。at 必须为有效、带明确时区的 ISO 时间，首次创建必须晚于当前时间；无时区、无效日期、空白/超长说明、超过 100 个 PENDING 明确拒绝。自然语言解释与时区换算由模型负责。
- 创建使用包装层提供的稳定 call 身份生成 ID/幂等摘要；先查询既有结果，再做“未来时间”和容量检查。重放发生在约定时间之后也返回原计时器，不误报过期或再创建一个。
- `cancel_wakeup({timer_id})`：与公开取消 API 共用领域方法；仅能取消当前主会话内的计时器。
- 相同工具调用重放返回原结果。领域事务同时保存工具级回执，覆盖 main.tool.result 保存前崩溃；取消无变化时也用 `store.commit([], [], receipt)` 持久保存工具结果。当前 toolKey 包含参数 hash，异参构成不同工具身份；“同身份异参冲突”只作为公开 HTTP request_id 的保证，不虚构工具层保证。
- 显式扩展 `Host.recoverTools`：仅对 schedule_wakeup/cancel_wakeup 检查稳定 `stableID(key)` 回执，校验所属会话及对应 WakeTimer，恢复原始工具结果并补 main.tool.result。没有已提交回执时保持现有 RECOVERY_BLOCKED，不盲目执行未确认调用；不扩大其他工具的自动重放范围。
- 提示词只增补这两个工具的用途、时间格式、TIMER 来源和“提醒不需执行 agent”；整体提示词重写仍属于 #26。已有 MainPromptSnapshot 恢复语义保持不变。

### 3.3 到期交付与排队

在 app.pump 中、host.drain 前执行有界到期交付，按 at、id 稳定顺序处理。每个计时器单独事务；一次最多处理 100 个当前 PENDING 项。

Wakeups 领域模块接受 `clock: () => number`，默认 Date.now；创建的未来时间判断、到期判断、fired_at 和 late_by_ms 均使用同一时钟。App 的创建入口提供仅用于注入依赖的时钟选项，pump 与 settle 使用同一 Wakeups 实例；不新增生产环境变量或公开改时 API。settle 也通过 pump 交付当前已到期项，但不等待未来定时器。Store base/revise 与日志时间仍使用真实时钟，模拟时间测试不要求它们与 fired_at 相等；真实进程重启使用真实时钟和短未来时间。

同一事务保存：WakeTimer → FIRED、唯一 Input（producer=TIMER，dedupe_key 由 timer_id 确定）、input.accepted 与定时触发日志。Input ID 使用稳定派生身份，日志 actor=HOST；不复用会单独提交的 host.accept。

Input 的持久正文使用固定来源标题和序列化数据，包含 timer_id、note、scheduled_at、fired_at、late_by_ms（非负毫秒）。主会话可以识别它是先前安排的自我唤醒，note 不是 Master 当前新指令。首次请求、保存上下文、重放、设置重建和压缩后的投影必须保留来源语义；需要调整来源定位/哈希时同步保持输入投影身份规则一致。

FIRED 表示已持久入队，不表示模型已响应或通知已送达。Host 正忙时按既有 Input 规则等待；RECOVERY_BLOCKED 时不借 TIMER 自动解除阻塞。主会话自行决定是否调用 MasterInteract，后续业务失败不将计时器回退为 PENDING。

停机或系统睡眠错过时间后，在恢复 pump 时交付并记录迟到量；不承诺进程停止或整机睡眠期间执行。系统时钟前移按新的当前时间判到期，后移则等待；已 FIRED 不再交付。首版不做周期字段，后续提醒由新的工具调用建立独立记录。

### 3.4 取消与竞态

- PENDING → CANCELLED；提交后不能再生成 TIMER Input。
- CANCELLED 再取消：无变化，按原回执或 NO_CHANGES 语义返回。
- FIRED 再取消：无变化，明确返回已触发；不撤回已排队 Input，不声称取消了模型执行。
- 不存在或其他 session 的 ID：NOT_FOUND。状态和目标检查在领域提交前完成。
- 到期和取消的检查/提交区间保持同步，不插入 await；现有单写者进程内先成功提交者生效。失败不得留下半个状态或接受回执。

### 3.5 公开 API 与同步

| 操作 | 合同 |
| --- | --- |
| GET /api/v1/wakeups | state 可选为 PENDING/FIRED/CANCELLED，默认全部；复用普通列表分页（默认 30、最大 100）、稳定顺序及筛选绑定 cursor |
| GET /api/v1/wakeups/{id} | 查询一个计时器，返回公开 DTO；不存在返回 404 |
| POST /api/v1/wakeups/{id}/cancel | request_id UUID；复用 EmptyCommand、owner 认证、同 ID 同参回执和同 ID 异参冲突规则 |
| GET /api/v1/requests/{id} | 沿用既有写入响应丢失对账，回执关联 WakeTimer |
| sync/changes、sync/stream | 创建、触发、取消映射为 wakeups 变更；过滤列表和重启追赶遵守既有失效合同 |

DTO 暴露 id、字符串 revision、session_id、at、note、state、source_event_ids、fired_at、cancelled_at、input_id、updated_at。时间统一 UTC。取消是短命令，ApiCommand 与状态变化同帧；无变化仍保存受理回执并关联目标，调用者查询计时器判断最终状态。GET 不触发 pump、模型或计时器状态变化。

取消路由在 withAdmission 前验证目标存在且属于当前 session，并预置 ApiCommand.resource_ids 为 WakeTimer；无变化受理保留此关联，不被空 mutations 覆盖。

公开 schema、操作表、OpenAPI、TS DTO、能力声明及必要示例随实现同步生成；不手写修改生成产物，不为 SwiftUI 增加解码/界面工作。首版不加公开创建/编辑 API，创建由主会话工具完成，Master 通过普通消息提出安排。

## 4. 实施文件与顺序（确认后）

1. 在 contracts schema 新增 WakeTimer/TIMER，更新生成类型、数据文档、Store 的记录识别和引用检查。旧 journal 无此记录时继续可读。
2. 新增独立 wakeups 领域模块，落实创建/取消回执、来源、100 项限制、PENDING 集合和原子触发；避免继续把全部逻辑堆进 Host。
3. 接入 app pump、Host 主会话工具及最小提示词；核对输入投影、上下文重建、记忆来源和通知链。
4. 接入 application-service、api/routes、公开 schema 与 sync-service；生成公开合同并补必要说明。
5. 补 `test_case/offline/issue23/`，复用现有 Store/HTTP/隔离数据库与 fixture 帮助代码；按下表验证，保留首次失败。
6. 更新 docs/api/v1、interfaces、operations、memory-and-prompts、计划执行记录和路线。按最终差异报告源码净增减，提交 PR 后 Hermes 只复核 Core。

## 5. 验收矩阵

| 层级 | 必须证明的行为 |
| --- | --- |
| 创建与工具恢复 | 未来时间/显式时区/边界日期/4 KiB/容量边界；第 101 项拒绝；同调用不重复；创建成功但工具结果未写时重启，恢复原 timer |
| Host 恢复专项 | schedule 与 cancel 各覆盖领域提交成功、main.tool.result 被抑制后的实际 Host 重启；原工具结果可重建且不 RECOVERY_BLOCKED；无变化取消同样覆盖；缺回执继续阻塞 |
| 来源与模型输入 | 多输入轮次来源正确；TIMER 首次输入、重放、设置重建、压缩保留标识；不伪装 MASTER、不解除 RECOVERY_BLOCKED、不成为新的 Master 承诺依据 |
| 原子交付 | 提交前/提交失败/提交后崩溃；重启后恰好一个 TIMER Input；FIRED 与 Input 不分离；重复 pump 无变化 |
| 取消 | 取消先提交和触发先提交两种交错；CANCELLED/FIRED 再取消；不存在 ID；取消领域提交与 ApiCommand 同帧；工具取消恢复 |
| HTTP | 认证、查询参数、分页/筛选 cursor、纯 GET；同 request_id 重投、异参冲突；响应丢失后 requests 对账；状态变化前后回执关联保持正确 |
| 同步 | 创建/触发/取消在 ChangeFeed 可见；过滤集合刷新；SSE 断线及 Core 重启后用旧同步 cursor 追赶；普通分页 cursor 仍按现有实例规则处理 |
| 无 UI 闭环 | fixture 经公开 messages 安排 → 主会话工具创建 → 到期 TIMER → 主会话 MasterInteract → notifications 可查；无需客户端，计时机制不新建 TaskPlan/Execution 或任务目录、不启动执行 agent |
| 停机与时钟 | 隔离 Core 进程停机跨过到期时间，重启交付且 late_by 正确；时钟前/后移、相同时刻多计时器；模拟时间不冒充真实睡眠测试 |
| 有界成本 | 100 个 PENDING 加大量 FIRED/CANCELLED 历史；用访问计数证明周期检查仅依赖 PENDING；提交失败/重启重建后集合与权威记录一致 |
| 回归 | 类型检查、API 生成一致性、文档检查、现有输入/记忆/通知/幂等/同步回归和带隔离 PostgreSQL 的完整 npm run verify |

离线时间逻辑使用可注入时钟，不靠长 sleep 或放宽断言。真实进程重启用隔离合成数据；不操作主数据目录，不安排整机睡眠。真实 provider 探针不是 fixture 验收的替代：如后续安排真实模型语义复核，单列模型、环境与首次结果，当前计划不调用付费模型。

TIMER 闭环使用 TIMER-only 输入，不混入 UNKNOWN Feedback；另保留现有 UNKNOWN Feedback 禁止自主替代任务的回归。周期扫描计数可监视 `store.all("WakeTimer")`，证明首次构建后 pump 不扫描历史；使用稳定 Input ID 与 Store revision 检查验证去重，不另加锁或触发标记。

Hermes 复核范围：Core 源码、持久与失败恢复、API/同步合同、来源和权限、Core 测试/CI、文档一致性。SwiftUI 构建、GUI、美学、通知系统弹窗、VoiceOver、新前端页面均不作为 #23 门槛。现有仓库 CI 中原生任务不在本计划内删除；若有无关失败，记录归属，不据此扩大到原生修复或削弱 Core 检查。

## 6. 风险与回退

- 重复提醒：以工具稳定身份、事务内回执、timer_id 输入唯一身份和同帧交付共同覆盖，不依赖内存标记。
- 误解来源：固定来源正文与请求构造边界测试一起验收；旧输入格式保持可读，不将 TIMER 当 MASTER。
- 并发与失效：所有状态变更沿用单写者事务；有界集合只在成功提交后更新，ChangeFeed 不能遗漏过滤列表失效。
- 历史兼容：新代码读取旧数据；新记录出现后，旧二进制可能不识别 WakeTimer/TIMER。升级前备份完整隔离验证目录，生产回退使用匹配代码/数据备份并对账已触发输入，不直接把新 journal 交给旧程序。
- 本项无生产部署、真实数据迁移或删除。现有 SwiftUI 代码与历史证据保留，路线废弃不等于本次授权删除。

## 7. 当前执行记录与批准点

- 已完成：读取 GitHub #23、当前 Core 实现与历史计划规范，建立本计划和索引；按 Master 指示更新 GitHub #7/#10/#23 的路线与复核范围。
- 当前只允许计划、issue 标注和文档检查；未实现 WakeTimer，未运行功能测试、启动服务、调用模型或部署。
- 文档检查通过：220 份 Markdown、3281 个本地链接、0 错误；`git diff --cached --check` 通过。仅暂存本计划与索引，未提交或推送计划。
- Master 后续授权以 Hermes 计划复核通过作为实施条件；该条件已由 P2 PASS 满足，第 4–5 节已实施。最终合并条件由 PR #47 的冻结 head 验证评论记录。实施、PR/CI、合并、issue 关闭和部署分别报告；本次不自动合并或部署。

### Hermes P1 处置

两项阻塞均采纳：B1 补 Host.recoverTools 的有回执恢复及无变化取消回执，并修正工具身份异参表述；B2 明确定时模块和 App 的同一可注入时钟及真实进程时间边界。N1–N7 建议全部纳入：无变化 API 目标关联、复用 revision 去重、无 await 竞态区间、有界集合计数、settle 语义、TIMER-only 场景和不新增清理任务。无异议项，详见[协作记录](evidence/issue23-collaboration-20261016.md)。

### 实施与验证记录

Hermes P2 已明确 PASS，按 Master 条件授权开始实施。实现及首轮测试见[Core 验证记录](evidence/issue23-core-20261016.md)。具体适配：CommandReceipt.object_id 保持 UUID；通过其计时器引用和 Store 强制的不变字段/终态重建原工具结果，不把 JSON 塞入 UUID，不重跑领域方法。创建始终恢复原 PENDING 回应，取消恢复其持久终态。此前 PLAN_ONLY、未测试的段落保留为历史过程记录。
