# Issue #93：人工验收模型超时、Main 阻塞与恢复方案

日期：2026-11-04（香港）。范围：**R6 复核后已获 Master 批准实施，要求真实模型场景验收及终端交付**。基准 `c660a89a7103b3257993448d8904c5b61bd46189`，PR #100 继续 Draft，禁止合并。英文对应 `fix_20261104_issue93_model_timeout.en.md`。

## 结论与证据边界

这次不是“请求一直在本地队列中等待发送”。第一条 A REDO 于 02:31:34.226 接收、约 0.366 秒后进入 ModelCall、约 0.483 秒后构造实际 payload。返回记录含 114 字符的部分流式内容及 provider response ID，但没有工具调用。不能把 AssistantMessage.timestamp 当作首 token 时间。

02:33:04.627，人工验收包装器的 **90 秒总时限**先于 Core 默认 **120 秒单次时限**触发。SDK 把该中断转成通用 `Request was aborted`；外层 Core 不知道内层计时器原因，将其归为 LOCAL，既不有界重试，也不填入可恢复模型调用标识。Main 转为 RECOVERY_BLOCKED。02:33:15 B DISMISS 正确接收，但 drain 在该状态立即返回；C、D 同样排队。B 提示保留符合尚未处置的事实，不是 Master 误操作。

所以需区分两个层次：首个请求在响应完成前触及本地验收时限；**随后队列不再推进是已确认的本地暂停状态，并非调度死锁**。首个响应为什么超过 90 秒，目前无法细分为上游排队、生成慢、传输停顿或其他原因；历史日志未记录 headers、首/末 SSE 事件时间。部分内容证明已开始收到响应，不证明当时持续生成，也不排除上游曾经排队。

还确认验收 `boundedTools` 会消费完所有事件再返回 replay；人工包装器又先等待 result，因此预览被延迟到完成/失败。它不阻止 HTTP 请求发出，不是发送队列；它会掩盖请求中途的可见进度。

初步诊断未接付费模型；随后 Master 明确要求按需真实模型验证，本轮已完成下述真实诊断。没有重启人工域或执行其中的待处理输入。诊断脚本位于 Git 忽略目录 `.demo-data/issue93/timeout-diagnosis-20261104/`，使用当前源码、当前 SDK、loopback HTTP 和虚拟密钥。六组结果：内层短时限→LOCAL/1 次；Core 时限→TRANSIENT/3 次；明确取消→CANCELLED/1 次；直接成功流即时预览；缓冲成功流完成后才预览；完整 Main 流程复现 CLAIMED+ACCEPTED 与 RECOVERY_BLOCKED。模拟只证明本地机制，不证明远端服务性能。

## 真实模型诊断（Master 本轮已明确授权）

同一 opencode-go / deepseek-v4.1-flash、当前生产源码，隔离调用 durableStream；只接收响应，不执行模型提出的工具。A 使用故障时冻结的 request context（哈希 b47ac730…），新隔离会话身份，不声称服务商缓存/负载条件与原来相同。三次均 HTTP 200、单次发送成功：

| 请求 | fetch 开始 | 响应头 | 首 delta | 完成 |
|---|---:|---:|---:|---:|
| 无工具短请求 | 97 ms | 1914 ms | 1920 ms | 1938 ms |
| A 原请求上下文，旧 90 秒/缓冲包装 | 20 ms | 1731 ms | 1739 ms | 2088 ms |
| A 原请求上下文，Core 120 秒/直接流 | 18 ms | 1242 ms | 1244 ms | 1753 ms |

耗时相对各次 SDK 包装入口。两次 A 返回 task_query 调用提案但均未执行，未重做或移除真实对象。当前不能复现最初长延迟，不能据此将原故障归咎于模型速度或排除当时上游排队。旧包装在本次真实返回中仍将约 349 ms 的中间预览延迟到完成；本地慢流对照更清楚证明相同机制。

新增 3 Main、0 Task、2 个工具提案、0 个工具执行；含此前人工失败 1 Main 后，总累计 92 Main / 29 Task / 73 个工具提案。各历史账本保留，汇总写入 ignored usage-cumulative.json。三次真实诊断不等于完成新实现验收，也不证明原故障远端根因。

## 建议实现

### P1 验收包装器修正：一个单次超时负责人

生产 transport 已正确处理它自己的超时与取消；除非新失败用例证明必要，本次不修改其超时/分类/重试逻辑。LOCAL 不自动恢复是正确的保守行为。Core transport 是单次请求超时的唯一负责人，保留现有默认 120 秒、最多 3 次、2 秒/10 秒及 Retry-After 策略，不增加并发、队列、自动无限恢复或 SDK 隐式重试。删除人工/在线验收包装器中竞争的 90 秒单次计时器；调用数、工具数及验收新请求接收窗口继续受限。

包装器在每次发送前检查调用/工具/窗口上限，抛出带 BUDGET_ 的明确错误；不再创建会中断在途 SDK 的隐藏计时器。停止顺序明确为“新请求接收截止 → 至多 120 秒排空 → 通过已知父信号正常关闭 Core”。截止后不允许新的物理发送/重试；重试等待（包括未设上限的 provider Retry-After）可能超过单次请求计时器，因此最后的 Core 关闭同时终止仍在等待或在途的工作，明确归因 CANCELLED。记录实际排空时间及关闭完成，不称严格 25 分钟结束。发送前 BUDGET_ 拒绝单独记为 rejected，不计作物理请求。用户取消和 Core 关闭继续通过 Core 已知的父信号即时终止，属于 CANCELLED，不能因这条包装器规则而失效。人工服务总生命周期关闭也用已知 Core 生命周期信号，不另造 SDK 内层 abort。验收包装器必须先禁止接收并以 CORE_STOPPING 触发 modelLifetime(store)，再 await server.close()；当前 API close 会先等运行命令，再由 App.close 触发该信号。新增本地 503 + Retry-After:3600 探针确认 API close 等待 150 ms 后仍未完成，显式触发已知父信号后 88 ms 完成，全程仅 1 次物理发送。重试等待的取消独立记录，不把前一条已失败的 TRANSIENT ModelCall 改写成 CANCELLED。不要把所有 aborted 错误都改成 TRANSIENT；未知中断保留 LOCAL。

修正验收工具预算包装器为实时消费/转交预览、完成时判定工具预算。计数在每次物理请求内完成，拒绝超限结果，并保持 durableStream 的核心不变量：**成功响应持久化以前，Agent 不得执行任何流式工具调用**；半截工具、错误流和超限流均不得产生业务副作用。不更换模型或升级 SDK。

### P2 本次仅补验收侧阶段证据

本次在验收包装器记录 fetch 开始、headers、首/末 SDK 事件、完成/终止、HTTP 状态、中断来源；分开 Input 接收至 claim、claim 至请求构造与实际网络阶段。只记录时间、状态、数量和允许的请求关联标识，不存认证头、完整响应头或额外正文，不按 token 写 journal；未观测字段为 null，不把 SDK 创建消息时间当 TTFT。

生产 ModelCall 的持久化性能字段、首字节/空闲/总时限拆分移为后续建议，不在本批改生产模型调用 schema。当前 120 秒是总时限，持续有输出也可能到时重试；如实验证和披露，不偷换成空闲超时。P3 所需 session/failure API 字段仍按源 schema 生成，不手改生成物。

### P3 明确 Main 阻塞和显式恢复

GET session 增加由 state/model_blocked_call 导出的安全 recovery_mode（NONE、EXPLICIT_REQUIRED、NEXT_MASTER_INPUT、CAPACITY_COMPACTION_REQUIRED）及有长度上限的类别化提示；不直接渲染任意 recovery_error。CAPACITY_BLOCKED 映射为 CAPACITY_COMPACTION_REQUIRED：显示 Main 暂停、不提供 /resume，说明需要压缩且压缩功能不属于本批。RECOVERY_BLOCKED 且 model_blocked_call 为空（包括 LOCAL、CANCELLED）明确映射 EXPLICIT_REQUIRED。保持原行为：LOCAL/CANCELLED 需要明确恢复，已标记 TRANSIENT/PERMANENT 的故障会在下一条 Master Input 到来时恢复之前批次，失败意图提交提示也须说明这一点。TUI 订阅已有 session 资源与同步失效信号，在 Main 明确显示“Main 已暂停，已接收操作尚未执行”、最近安全错误摘要和恢复入口。FailureDetail 对未完成 Input 叠加 session 阻塞状态，避免把 A 仍显示为正在处理、B 仅显示已提交却没有阻塞原因；不改变 UNRESOLVED、不伪造 HANDLED、不允许重复 intent。

建议将仅普通 Main 可用的 `/resume` 纳入本批，随本方案交 Master 明确批准，复用已有 `POST session/resume`、ApiCommand 和请求对账机制。说明它会继续已认领批次及已排队输入，可能消耗模型额度；手打 `/` 加 Shift+Enter 是显式恢复指令。Task 错页局部错误；授权/问题/失败处理态优先于命令，整段粘贴继续按字面。独立 controller 保留请求 ID/字节、single-flight，响应丢失先对账；恢复 receipt 不是完成，恢复时不得重送 A/B/C/D Input 或覆盖草稿。接收新业务输入不作为 LOCAL 故障的隐式恢复。

恢复命令 body 增加可选 expected_revision，TUI 必须发送刚读取的 revision，并冻结 domain/session ID；无该字段的旧调用保留原兼容行为，但所有调用统一增加活动循环保护：Main 循环实际运行时 resume 返回 applied:false，不改变状态或 generation。判断真实活动循环而非仅持久 RUNNING，保留崩溃残留状态的恢复能力。明确记录并测试这一适用于所有调用者的安全修正；其余可选 revision 兼容语义不变。带字段的路径只允许 RECOVERY_BLOCKED 且 revision 相符：入队前不符返回 409；入队后实际执行前再次进行不可分割的检查与 session 更新。两个不同请求 ID 携带同一旧版本时，只有一个能改变 generation。排队期间版本/状态改变时，返回确定的 applied:false 拒绝结果、无副作用（不能仅因 API 已接收而执行）；记录清晰错误码，controller 读取 result 与最新 session。

session/resume 的命令会 QUEUED→RUNNING，整个 drain 返回后才 COMPLETED；再次阻塞也可能 COMPLETED，因此 command 完成不等于 Main 正常。Core 重启把 RUNNING 命令变为 UNKNOWN / INTERRUPTED_DISPATCH，不自动重派，TUI 只对账并显示真实 session 状态；不换新 ID 自动恢复。若仍需恢复另一次故障，必须重新观察并由用户发出新指令。已接收旧 LOCAL 输入不重写，只显式恢复原 batch。

Session 改变同时失效 session、timeline、attention、failure detail；派生 MAIN_BLOCKED 仅用于 ACCEPTED/CLAIMED Input 且会话阻塞，不写 FailureHandling。继续测试旧工具 receipt 和 generation 边界，不能泛化为所有 LOCAL 自动重试或跳过损坏工具状态。

### P4 修正交付实例与清单

保留本次失败域和全部账本，修正授权请求 ID 与 Operation ID 混淆；重建手测说明时将“接收”和“业务完成”分列。提供受控故障提示/恢复项目，确保用户能识别 Main 阻塞。新实例继续独立数据域、零调用空闲检查、无无人值守周期任务、调用/工具限制、明确接收截止、限定排空及正常 Core 生命周期关闭。不得直接启动旧的含 120 秒周期计划的自动验收域。

## 验证与通过条件

1. 本地 HTTP：headers 前挂起、首事件后挂起、持续慢流达总时限、正常流；证实单次计时器归属和最多 3 次重试，停止/预算结束后 0 次新发送。
2. 部分工具流后中断/预算超限：Agent 工具执行数为 0；已持久成功回放不重复发送；重试保留 frozen request、逻辑身份及每次调用累计账本。
3. Main：A 正在请求时 B/C 入队；超时重试耗尽后明确阻塞；一次显式 resume 恢复原批次与后续队列。重复/丢响应/进程重启不重复恢复副作用、不重复 redo/dismiss。旧 LOCAL 中断域仅通过明确恢复路径继续，不修改旧证据。
4. 读模型/TUI：session 改变刷新 Main 和失败详情，空闲读取不写 journal；/resume 来源/处理态/错误页/草稿与 #91–#93 快捷键回归。
5. 定向检查后执行仓库必需 verify、Linux/macOS/aggregate exact-head CI，交同一 Claude 会话复核最终新 SHA。当前 I3 结论不自动覆盖新实现。
6. Master 已明确授权按需真实模型验证，不能为省成本跳过。旧 +64 Main/25 分钟窗口已结束，本轮真实诊断使用新授权而非偷用旧窗口。实施获批后的下一轮先登记保护上限（建议 32 Main、12 Task、80 工具、25 分钟）；物理发送含重试均计数，历史累计不清零。先做有阶段计时的受控短请求，再补 A–D/H 和必要 L1–L4 受影响路径；这些只是运行保护的起始值，不能成为跳过真实验证的理由。Master 已授权必要模型验证、不以省成本降覆盖；在该验证范围内按需登记追加窗口/上限，保留累计和每次停止/失败证据，不放宽断言。
7. Master 亲自确认终端反馈、显式恢复、IME/草稿及完成状态；长 shell 中断仍是独立未验证项。合并授权、合并后 CI、issue 关闭分别进行。

## 复核状态

R4：Claude Opus 5.5 Extra 独立读取冻结源码，认同诊断但给出 CHANGES_REQUIRED。已采纳 R4-1（Core 版本/状态保护与 command/session 分离）、R4-2（不同恢复模式、提示脱敏）、R4-3（P1 限定验收包装器，保留 Core 原有保守分类）。D1：推荐 /resume 纳入本批，待 Master 批准；D2：接受本批只做验收侧阶段计时，生产详细性能字段另议。R5 已认可入队/执行两次版本校验及可选 revision 兼容；要求补容量阻塞恢复模式，以及排空窗口结束后正常关闭 Core，均已采纳。另采纳所有调用统一的活动循环保护建议。R6 及关闭顺序补充均获同一 Claude Opus 5.5 Extra 会话 PASS_PLAN_ONLY。Claude 独立核对冻结源码和关闭顺序，但未自行执行本地探针或真实模型调用；通过范围仅为计划，不包括未来源码、人工验收或合并。

补充本地诊断：实际 Core API 的同 ID /resume 重复提交恢复后 generation 只加 1、原 CLAIMED 与排队 ACCEPTED 均变 HANDLED、Main 回到 IDLE；未调用真实 provider。另一组不同 ID 本地探针在当前源码上令 generation 增加 2，证明需要所提保护；未观察到重复业务执行。上述结果不替代并发不同 ID/版本/崩溃的新实现测试。

R6 计划复核时生产代码尚未修改；Master 随后批准实施，仍不合并。

R6 非阻断意见处置：活动循环保护区分 Main 执行阶段与后续 extractPending 维护；维护导致恢复暂不可用时，显示真实维护/重试提示。已知关闭/用户取消（包括重试等待的 AbortError）映射为受限的“已停止/取消”提示，阻塞会话为 EXPLICIT_REQUIRED；人工实例生命周期到期也执行先取消、后等待关闭。生产 core stop 的相同关闭顺序及过长 Retry-After 缺乏提示，单列后续项，本批不默默扩大生产 transport 范围。

授权记录：Master 原话“不要省成本啊，该接模型验证就接模型验证，不缺这点。”已明确授权必要真实模型验证；Claude 无法独立看到该用户指令。Codex 据现有授权执行，逐次记录运行保护上限扩展、原因及累计用量，不重复请求相同的费用授权。Master 随后已批准包含 /resume 的本次实施方案。


2026-11-04，Master 已批准按本复核方案实施（含 /resume），要求模拟真实使用场景并接入真实模型验收；完成后提供终端 TUI 命令及亲自操作清单。仍未授权合并。

实施：增加恢复入队及原子执行时的状态/版本保护、活动循环拒绝；安全 session 恢复投影、派生 MAIN_BLOCKED 和同步失效；TUI 常驻暂停提示及可对账的 /resume。验收预算包装即时转发预览，保留成功响应持久化后才能执行工具的边界。新增验收阶段计时、真实模型排队恢复/丢响应/字面答案场景，以及带一次明确受控 LOCAL 故障的独立人工实例。

源码冻结时验证：35 项定向检查通过，扩展流式/controller/TUI 再检 14/14 通过；类型与文档检查通过。完整 PostgreSQL 检查、新提交 CI 和真实模型验收进行中，最终状态记录 PR 会话和忽略证据目录。首次失败保留：运行时路由 schema 漏接已修正；包装器 pending 事件类型已修正；诊断测试按现有错误流合同断言错误结果、无成功持久化/工具执行。未改生产超时/重试分类器。

真实模型恢复 R3 暴露额外语义缺陷：Main 把共用 UI 投影的 `redo_available=false` 误读成当前已接收 REDO 被拒绝；实际该字段只防止当前输入 CLAIMED 时再次提交 Master 输入。保留失败实录。修正范围：模型 task_query 投影把这些标记放到 `new_input_actions`，仅标出本轮绑定的意图，并明确执行结果以指定工具返回为准。API/TUI 输入准入及全部执行守卫不变。补只读查询与已接收意图回归，并重跑真实恢复和完整线上场景，不把失败轮次改成通过。
