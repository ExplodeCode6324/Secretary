# Issue #104 — Task 流式预览、实时阅读与 Main 通知分流

Master 已明确批准构建，要求至少一次真实模型测试。以下计划阶段的未实施状态为历史记录；现按 R2 合同实施，合并仍须另行授权。

状态：**R2 PASS**，2026-11-06 21:35 HKT 读到通过结论，已落实 reviewer 要求的细化，等待 Master 批准。Master 要求先完成中英文计划与独立复核，批准后才实施。本轮不修改产品代码、合同、测试，不部署或调用产品模型。复核通过不等于实施或合并授权。

- 仓库：https://github.com/ExplodeCode6324/Secretary
- 本项：https://github.com/ExplodeCode6324/Secretary/issues/104
- 关联：[#103](https://github.com/ExplodeCode6324/Secretary/issues/103) · [#105](https://github.com/ExplodeCode6324/Secretary/issues/105) · [#106](https://github.com/ExplodeCode6324/Secretary/issues/106)
- 已检查基线：`main@9a8049a42cd7d20f6e928bb699e9e4b9d5b222ea`，包含 #84 / PR #102 和 #103 / PR #107。#103 已关闭，其关闭记录记载合并后 CI 42220394758 通过；这是前置证据，不是 #104 验证。实施前重新检查最新 main，整合后续工作，不回退基线。
- 本轮分支：`codex/issue104-streaming-plan`。原始英文请求、回复、截图保留在 Git 忽略目录 `.demo-data/issue104/review/`。复用 Master 已打开的 Claude 会话，首次等待十分钟，再每五分钟查看。
- [English plan](fix_20261106_issue104_streaming.en.md)

## 1. 用户结果与当前接点

AGENT Task 的长回复尚未完成时，Master 就能看到已有的真实文本；完整消息保存后替换预览一次，长正文尾部仍可分页读取。Master 明确跟随某次执行，主动阅读或选择文字就停止跟随。普通过程和正常 Guidance 阶段不生成 Main Input；授权、问题、未知效果及最终结果继续可靠送达 Main。

| 源码 | 现状与改动接点 |
| --- | --- |
| `transport.ts` | observe 能消费供应商事件，但完整响应持久化为 RESPONSE_SAVED 后才交 Agent。已有 ModelCall ID、transport_attempt，保持这个顺序及恢复/重试/取消规则。 |
| `preview.ts`、`host.ts`、`app.ts`、`scheduler.ts` | 当前预览属于 Host/Main，最多 8 项，每项 128 块、32,768 UTF-16 单元。改为 Main/Task 共用的每 Store 瞬态注册表或等价依赖注入，Task 显示不依赖 Main 正在运行。 |
| `execution-runner.ts` | Task 已用 onPrepared 绑定 Guidance，但没有 observe；message_end 保存 checkpoint 和 agent.message，却没有明确的生成 ModelCall 关联。补可信关联，不改模型上下文原文。 |
| `sync-stream.ts`、`tui/remote.ts` | SSE 每 100ms 采样、连接上限 512KiB，目前所有预览都当作 Main 刷新。按来源和精确目标分流，不逐 token 查询历史。 |
| `task-browser.ts`、`tui/task-browser.ts` | 最近三轮历史支持持久正文分页；首读从最旧消息开始，刷新围绕旧锚点。需增加直接取最新窗口及目标执行刷新。 |
| `tui/app.ts`、`tui/view.ts` | Main 已有跟随/onReading/onPointerRead；Task 已有 selectionActive/onViewport，需补阅读/指针钩子。复用 AnchoredScroll/DocumentView，定位目标执行区段尾部，不能简单滚到整个三轮文档底部。 |
| `authorization.ts`、`main-loop.ts`、`guidance.ts` | 授权与 WAIT_AUTH Operation 原子保存，但未通知 Main；所有 QUEUED Feedback 会转 Input。#103 冲突 Feedback 已原子保存并使用稳定 ID，保留其 Master 专属回答限制。 |

## 2. 预览身份、生命周期与持久交接

预览增加来源 MAIN/TASK、Core 预览运行期 epoch、Task/Execution ID、真实 ModelCall ID、transport_attempt、派发 attempt 来源和递增版本。身份来自 runner 与持久 ModelCall，不从供应商文本解析。开始时绑定句柄；旧身份/epoch 事件不能覆盖别的尝试或复活已经结束的预览。重试使用不同 ModelCall，不把两次正文拼接；RESPONSE_SAVED 重放显示为已保存，不伪造新流。

注册表只在 Core 内存中存在。不逐 token 写 journal，不生成 Input/Feedback，不改模型上下文，不推进 Guidance RECEIVED/GUIDED。显示异常不影响执行结果。保持固定 Pi 版本、循环及 #103 所有引导门禁。预览不增加 Task prompt/tool 文本，避免挤占 #103 已较小的续接容量余量。

当前 Task 在 result() 完成前已积累未消费的供应商事件；observe 路径会将消费的 delta 另存到未消费 replay。Task 观察应主动消费供应商流，并避免第二个队列，减少现有瞬态成本。Task 应消费供应商事件、更新有界预览后释放中间事件，只在 RESPONSE_SAVED 提交后返回现有 done-only savedResponse(complete)；固定 Pi 已支持该恢复形态。Main 保持现有消费语义，除非有单独验证的必要共用简化。Task 原有抛错/失败分类也保持，不得因新增 observe 而进入目前偏向 Main 的诊断 error-stream 分支。对比有无观察时正常/恢复成功、toolUse、length、error、abort、retry 的请求身份、最终内容、工具及领域结果。

Task message_end 只能关联经证明属于该 ModelCall 的实际保存响应。每次 durableStream 入口、容量/调用数/引导/恢复检查之前清空旧显示 token；宿主成功保存/重放回调设置一次性 token，包含实际调用 ID 和精确已保存响应。message_end 仅在 assistant 消息与该响应结构完全相等时消费一次；下一调用入口、catch 路径及 runner 生命周期结束时清除。token 必须跨过 durableStream 返回，不能在 transport finally 或包裹 stream promise 的 finally 清除，因为 Pi 在取得返回流之后才触发 message_end。onPrepared 继续服务 Guidance，单独不足以证明显示来源。容量不足、MODEL_CALL_LIMIT、GUIDANCE_NOT_PROCESSED、恢复身份错误等 Pi 合成失败消息保留独立 event 身份，不能抹掉上一条真实消息。关联前校验 TASK purpose 和精确归属。

使用已有 journal 元数据：对真实关联的 agent.message、与 RESPONSE_SAVED 同事务的 model.response 设置 causation_id=ModelCall ID，必要时 related_object_ids 加引用。不新增 OperationLogRecord 字段或 payload 包装，保持 Agent 消息和原始事件内容。旧 causation=null 的消息继续按 event ID 阅读。user/tool 不因共享调用就合并。既有冻结调用重放可能重复记录工具结果；保留这些真实记录并说明此既有局限，不在 #104 猜测删除。

新 assistant 消息对外具有 execution + ModelCall 导出的稳定显示键，同时给出 source_event_id、model_call_id 与 attempt。保留历史 event-ID 正文查询。预览与最终消息同键，持久 agent.message 优先；RESPONSE_SAVED 到 agent.message 之间，以持久 ModelCall response 提供同键的“响应已保存、消息待衔接”回退，随后仅替换来源，不显示两份正文。此机制覆盖保存响应后、Agent/checkpoint 提交前崩溃。用可重建的执行级调用/消息索引关联，不在每次查询扫描所有 ModelCall；不为显示伪造 agent.message/checkpoint 或重放工具。

展示事实分开：生成中、响应已保存、继续执行、正常完成、供应商长度截断、尝试中断/失败。某次供应商失败不等于 Task 已失败，可能重试。Task 最终状态、未知效果与取消取持久领域记录。断线/预览丢失只是显示缺口。Core 重开后丢弃旧 epoch 的预览，恢复持久响应/历史；未保存的部分显示中断/缺口，不冒充完整正文。迟到的 saved/incomplete 不能覆盖持久消息或较新版本。预览上限造成的截断与供应商 length 分开标注，完整保存后仍可读尾部。

## 3. 有界同步与断线恢复

兼容 Main 现有行为，扩展生成的 API/SSE 合同。Task 使用独立 `task_transient` SSE 事件，避免被过大的 Main 预览/活动混合帧一并丢弃；主要携带有界元数据/失效通知（身份、版本、状态、截断、epoch），不广播每个 Task 的完整 32K 正文。Main 可继续沿现有正文查询路径获取内容；若改已有传输结构，必须兼容旧客户端或明确版本/新增字段。SSE 不广播完整思考正文。Task 正文和预览查询沿用 CoT 开关、redaction 与 safeText，只显示供应商已有可展示内容，不暴露签名或隐藏推理。

增加执行级预览快照/读取能力，可作为现有 messages/content 的附加投影或窄预览接口；返回当前成员、epoch、版本，执行同样的浏览权限、最近三轮和归属检查。SSE 使用带版本水位的完整采样成员快照，或显式 removals，成员消失不等于业务失败。重连时先取得 durable cursor、当前历史/预览快照，再按 epoch/版本对账后续通知；并发变化通过 dirty 标记重读，不靠到达顺序。各瞬态通道独立采样、水位和预算；即便 durable cursor 未推进，新连接也取得当前状态。验证三个同时存在的 32K 中文 Main 预览使旧混合帧溢出时，Task 元数据及正文仍继续推进。保留有效跟随意图，但不把旧运行期内存正文当当前流。

初始上限：Main 保持 8 项，Task 最多 32 项；每项 128 块、32,768 UTF-16 单元；Task 注册表文本总量最多 1MiB UTF-8；瞬态元数据帧最多 64KiB；保持现有 512KiB 连接预算、5 秒 drain 和 8 客户端上限。先淘汰已结束/旧非活跃项，必要时淘汰最旧活跃预览，在相应详情显示“预览已释放”，不影响执行或持久响应。客户端只缓存当前 Task 最近三轮的预览，纳入既有 200 项/4MiB 历史与正文预算，包括渲染引用，不另保留未计费副本。Unicode 截断不拆代理对。实现可按观测降低上限，调高需记录依据。

注册表→SSE 和可见正文读取约 100ms 合并一次。每个选中执行最多一个在途刷新和一个 dirty 标记，复用 RemoteViews 两个并发读取上限。请求绑定选择/epoch/CoT/跟随代次，迟到结果不能覆盖新页面。delta 只刷新相关可见预览/正文及渲染项；后台 Task 不刷新 Main 历史或重读 Task 根列表。持久任务/控制变化按实际对象失效；完整 assistant 消息只做一次同键衔接。索引热路径与新增 frame、请求行/正文有关，不随无关历史或该执行的全部消息线性扫描。首次从保留 journal 建立消息 ID/序列/尾部及调用关联索引，随后增量维护；复用正文分片及页面字节上限。

## 4. Task 明确跟随与真正的最新窗口

在执行消息查询增加如 `position=latest` 参数，与 cursor/message_id 互斥。返回按时间正序排列的最后一个有界窗口；字节预算缩减时保留最新端，before/after 游标正确。默认历史查询保持兼容。按执行索引直接取尾部，不从第一页走到最后；超长单条正文也能直接到真实尾部。最近三轮、归档和保留边界不变。

#104 最小交互建议：Task 普通详情输入 `/follow` 明确开启“回到最新并跟随”，定位当前阅读锚点所在执行区段；锚点不在执行区段时取当前已展示最新执行。明确提交时从最后接受的详情快照解析、立即冻结真实 ID 并显示目标，后续刷新不重新解析。`/follow <execution_id>` 可指定另一已展示执行，并提供 ID 补全和状态标签。#105 前不隐式解析名称或相对轮次。无执行、非本详情执行、非 AGENT 明确报错，不改投另一目标。阅读操作不发业务输入，保留 Main/Task 两份普通草稿。#105 可在同一内部目标上加名称/轮次友好入口。配套 `/follow off` 或主动阅读关闭跟随，事项/授权输入态不执行这些阅读命令；头部显示跟随/暂停及明确目标，不只写无归属的“最新”。

跟随状态为 `{task_id, execution_id, intent_generation}`，与阅读锚点分开；目标冻结至下一次明确操作。三轮区段同时存在时定位目标区段最后内容行，不滚到整个文档末尾，并围绕目标裁剪/加载。目标进入终态后展示最终尾部并结束跟随；新执行不能接管。目标退出最近三轮或不可浏览时停止并提示，沿已有诚实锚点回退，不暗中跟随另一轮。

PageUp/PageDown、进入阅读的方向键、滚轮、指针按下/拖选/选择、历史/正文翻页、返回/打开别的 Task、Main/Task 切页，在导航前停止跟随。手动到底及后台消息都不自动开启。resize 和 CoT 切换保留有效目标/意图，旧模式请求失效。SSE/Core 重连重新校验相同目标后保留有效意图；不要求 TUI 重启后保存跟随偏好。沿已有选择冻结机制保护拖选期间的文本和锚点。接通 Task onReading/onPointerRead/selectionActive，区分程序跟随定位与用户阅读，避免自己关闭跟随。Main、事项优先级、Ctrl+C、编辑器行为保持。

## 5. Main 分流与授权通知

采用固定类型分流，不另调用模型分类：

| 事实 | 去向与去重身份 |
| --- | --- |
| token、文本、工具对话、普通进展、正常 Guidance 阶段 | 仅前端/任务历史，不新增 Main Input 或 PROGRESS Feedback。 |
| Master 直投 Guidance 原始内容 | 沿 #103 原子知情 Input 一次，阶段更新不重发。 |
| Guidance 冲突/无法采用 | 沿 #103 DecisionRequest + 稳定 Feedback；需要 Master 时保留 required_answerer。 |
| 普通问题、未知效果、最终结果/失败 | 现有 decision/operation/result 控制链，以真实事实身份去重，保持失败/事项口径。 |
| 需要授权 | 新增 AUTHORIZATION_REQUIRED Feedback，按 authorization_id 去重；Main 只能协调，不能代批。 |

仅对有效 Task/Execution 作用域，在 authorization.prepare 的 PENDING AuthorizationRequest + WAIT_AUTH Operation 同一事务中创建通知，覆盖 AGENT 和 PROGRAM。没有 Execution 的 Main/World 授权保持现有路径，不伪造 Task ID 或纳入 Task Feedback。引用精确 task/execution/operation/authorization 及已有 display_ref，不额外复制敏感内容或授权能力。合同源为 Feedback 增加 kind 与可选 authorization_id，Main Input 携带同一引用；生成类型、状态/API 文档并审计 timeline/push/retention/recovery/Main 所有读取方。Feedback→Input 前在同步边界明确检查：AuthorizationRequest 为 PENDING 且未过期，关联 Operation 为 WAIT_AUTH，Execution 非终态且没有 cancel_requested，并照常验证归属/引用。不要求 Execution.state=WAIT_AUTH：授权先提交、执行状态后更新，间隙崩溃恢复后有效等待可能暂为 READY。“授权事务后崩溃”的测试必须在重开后仍得到恰好一个 Input，不能永久压掉有效通知。已解决、过期、取消或不再可操作的授权不新增 Main Input；将排队 Feedback 原子置为明确终态 `SUPPRESSED`，保存原因/时间、input_id=null，保留原授权事实。状态源 `src/state_machine/catalog.json` 只增加 QUEUED→SUPPRESSED，审计所有终态读取方；尤其 `retention.ts` 当前把非 HANDLED 都视为未结清，必须将 SUPPRESSED 计为已结清并验证仍能退休，类型/文档从源生成，不伪称 DELIVERED/HANDLED。仍可处理则原子生成 Input + DELIVERED。Input 提交后才解决的，不撤回已受理 Input，Main 协调前仍读取当前状态；通知不是批准或持续待处理的保证。一次授权规则与 API 权限不变。

复用 #103 确定性 Feedback ID。Feedback→Input 与 DELIVERED 原子保存；反复 prepare/recover/pump/刷新不为同一授权多发。升级恢复只为仍活跃、待处理而缺少通知的旧授权补发，使用窄索引，在启动及后续增量中处理，不回放全部已解决历史授权。新事务本身没有这个缺口。SUPPRESSED 已结清，重开/刷新不重新入队；新的授权有独立 ID。普通问题/结果按 decision_id/result_id 稳定去重，并尽量与事实原子生成 Feedback，保留恢复修补。当前 Execution 最多一个 RESULT_UNKNOWN episode：恢复不会继续它，对账后只会 FAILED，保持此语义。UNKNOWN 按一次执行异常发一条，不按每个受影响 Operation 分发。新确定性身份由 execution_id 加首次持久进入 RESULT_UNKNOWN 的 Execution revision 导出；当前没有所谓中断事件，也无需新增。运行及恢复用同一首次转换，不用反复恢复后的新 revision；共用生产入口尽量与该执行转换原子生成 Feedback，恢复按同一转换修补缺口。多个 Operation 只是同一通知的证据引用。升级时该执行任意既有 legacy UNKNOWN Feedback 已覆盖唯一异常，即便是随机 ID/没有 Operation 引用也保留、不另发新键通知。本项不增加未来恢复继续/多异常周期语义。保证每个事实一次送达所需窄修复属于本项，不另建通知总线。保持 Guidance 冲突身份。验收证明持久 Input 去重及既有 Main 批次恢复，不宣称模型物理调用恰好一次。

源码目前无运行时 PROGRESS 生产者，枚举仅为历史兼容保留；普通对话已只走显示，不给流式代码加 Feedback。不删除、改写旧 PROGRESS/已受理 Input，不做猜测性迁移。验证所有新普通过程/阶段不生成 PROGRESS 或 Main Input。分流和回执不增加模型调用，#103 最终结果中的 Guidance 摘要仍供 Main 阅读。

## 6. 批准后实施顺序与验证

1. API/合同源、共享预览注册表、可信关联及投影/重试定向测试。
2. Task observe 与持久响应/消息交接，含崩溃/重放/redaction/取消。
3. 定向 SSE/快照、索引化最新窗口、有界正文，含重连竞态及成本。
4. Task 跟随与草稿/选择/锚点接线，保留 Main 和最近三轮边界。
5. 原子 WAIT_AUTH 类型通知、恢复/控制去重审计、正式 `docs/api/v1/README.md`、`docs/tui/api-coverage.md`、`docs/tui/run-and-test.md` 与验收证据；源文档及生成/本地化派生通过仓库脚本更新。
6. 针对性回归、所需 PostgreSQL 下完整 `npm run verify`、生成一致性、Linux/macOS CI、同 Claude 会话精确提交复核，另交 Master 授权合并。

复用真实 Store/App/HTTP、可控延迟流、故障注入及现有 TUI/headless 夹具，要求覆盖：

- 完成前可见真实文本且 Agent/工具尚未收到响应；两 Task 与 Main 并发，重复/迟到/乱序/重试不串流；saved 重放不生成假 token，不为显示执行工具；注册表异常不影响任务。
- 预览→RESPONSE_SAVED→agent.message 全程同键单份正文、完整尾部；各交接点崩溃、失败后重试、length、partial error、取消、RESULT_UNKNOWN、Core 重开；旧无关联消息可读，user/tool 不误合并。先成功一次，再分别触发 onPrepared 前的容量/调用数/引导/恢复错误及后续传输失败，断言先前真实消息和新合成失败同在、身份不同。
- 快照/完成中断线，旧 epoch/CoT/页面/跟随代次，删除成员、慢 SSE；CoT 开关、redacted 替换、中文/emoji/长正文。
- 同执行至少 125 条消息，直接跟随最新窗口及超长正文尾部；关闭后锚点/选择保持；最近三轮替换、区段排序、终态/新执行、resize/重连/CoT 意图、手动到底不重开；导航不发业务、不清草稿。真实滚轮/拖选/复制单独观察。
- 普通输出/正常引导阶段新增 Main Input/ModelCall 为零；原始直投仍一次。问题、结果/失败、未知效果、授权、引导冲突在重试/重开后一次送达；同一未知结果涉及多个 Operation 仍只有一个 Input，旧随机 ID UNKNOWN 升级不重复，新生产/恢复键指向同一首次持久转换。授权事务及 Feedback/Input 事务前后故障、重复 pump、先批准/拒绝/过期/取消后投递应 SUPPRESSED 且零 Input，先投递后解决应一个 Input 且不重复；升级待授权恢复及没有 Execution 的 Main World 待批请求不产生 Task Feedback；Main 不获代批或解除 Master 专属问题的权限。
- 固定活跃/可见工作量，扩大无关历史，记录索引访问/读取/journal 写次数、刷新频率、队列深度、缓存/注册表字节、慢连接峰值。不逐 token 写盘或扫全史，上限包含预览；索引重建内存与热路径成本分开报告。
- 相关 #9 同步/预览、#80 响应状态、#91 阅读/重连、#92 事项、#93 恢复、#94 产物、#103 引导及原 A06/A15 续接容量夹具。不无关扩跑真实验收，不放宽容量限制。

独立数据根的受控真实模型任务：足够长的回复在完成前显示，时间戳与 ModelCall 响应保存及最终消息对应。供应商重试仅在安全可复现时实测，否则明确只有确定性覆盖。真实 macOS Terminal 用受控夹具加真实流检查 >50 条跟随、暂停阅读/选择复制、resize/CoT、断线重连和最终交接，记录环境和首个失败。native 操作、headless/PTY/源码检查分开，Master 产品验收另列。本计划阶段产品测试/真实模型/native/CI 均 NOT_RUN。

## 7. 顺着当前路线推演到 #106（供 Master 判断，不是实施授权）

- **#103 已完成可靠投递。** 精确 execution_id、持久原文、三阶段证据与恢复由它统一负责。**#104 补足看得见与普通更新不唤醒 Main**，不再造历史、投递队列或权限系统。
- **#105 解决好定位、好进入。** 原子分配唯一稳定标题与 Task 内永久 execution_round，历史映射确定性回填保存；UUID 仍是真身份。保留中文、空格、`_1` 及双引号语法；标题+轮次准确解析，固定 Pi 的稳定 ID 命中测试接最小点击/Esc。#104 跟随仍以精确 ID 工作，可接更方便入口；阅读不成为业务操作。
- **#106 接起来。** 仅 Task 普通输入解析 `/guide <task_name> <execution_round> <body>`，只解析前两定位参数，展开后的正文逐字保留。解析后冻结真实 ID、正文、请求身份，走 #103 投递；结果不确定按原身份对账。前端展示并拒绝已知超出 #103 的每条 16,384 UTF-8 字节、执行总量/条数上限；失败保留草稿，发送期间的新草稿不被清空。只用后端事实展示 SENT/RECEIVED/GUIDED 与冲突/未处理原因，不从流式文字猜“已引导”。
- **最终使用路径：** 按名称找到 Task/固定轮次 → 跟随这次执行的实时正文 → 暂停阅读 → 中途发送限制 → 查看三阶段 → 检查后续行为/结果 → 断线后仍查询同一目标。普通流和阶段不唤醒 Main，Master 原始引导让 Main 知情一次，真正控制事件按持久身份送达。
- #106 用真实集成补齐 native/产品验收，并复用上游有效证据。之后进入实际使用驱动 TUI 迭代；Master 明确 UI 稳定后才推进 #70–#73，#74 仍由数据决定。Watchdog、设备线、框架替换、全局存储治理均不作为本批前置或范围。

## 复核记录

R1 于 2026-11-06 21:22 HKT 在规定十分钟等待后读到 **CHANGES_REQUIRED**：合成失败可能继承上一调用身份；authorization.prepare 还服务 session-only World。两点全部采纳。另采纳已有 causation 元数据、Task 独立 SSE 通道、已解决授权不唤醒 Main、无参跟随与 ID 补全；保留工具结果重放可能重复的既有局限。Codex 独立补充无第二 delta 队列、Task 失败语义不变、按事实控制去重，移除猜测性 PROGRESS 迁移。R2 完整计划重新送审。Claude 检查了基线及固定 Pi 源码，获取 #104 页面摘要，未运行测试/供应商/native 验收。未获得实施批准，未开始实现。

R2 最终结论：**PASS**，2026-11-06 21:35 HKT 在规定十分钟等待后读到。Claude 确认两项阻塞已解决，并确认 token 队列/错误分支发现。四项要求已同步落入两种语言：精确授权可操作条件且不强制 Execution WAIT_AUTH；token 必须跨过 transport 返回；SUPPRESSED 不阻塞退休；按当前单一 UNKNOWN 周期兼容旧通知并采用真实持久转换身份。此前假设的同执行多个异常周期已按源码纠正。Reviewer 将这些归为实施前精化，不要求重新设计或作为新阻塞。本轮仅计划/源码复核，#104 测试、模型、CI、native 均 NOT_RUN，等待 Master 实施批准。

Review dispositions / 复核处置：[plan-review](evidence/issue104-streaming/plan-review.md).

## Master 批准后的实施更新

实施与首次失败处置见[证据账本](evidence/issue104-streaming/implementation.md)。每次调用的显示标记与 IN_FLIGHT 同事务提交，复用 OperationLogRecord 字段，使旧完成调用不会额外生成重复正文行。直接末尾读取记录 UTF-16 偏移/总长，并明确标示缺失的格式上下文。Feedback 的新增抑制迁移由 Store 强制检查。工具拒绝访问原生 Terminal，物理终端验收保持 NOT_TESTED，与真实 DeepSeek HTTP/SSE 证据分开。本次不包含 #105/#106 功能。
