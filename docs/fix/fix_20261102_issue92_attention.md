# Issue #92 — 待处理事项、授权与定向回答

日期：2026-11-02（Asia/Hong_Kong）。修订 R2，已纳入最终非阻断意见。状态：CLAUDE_PLAN_PASS / 等待 Master 批准实施。

[English](fix_20261102_issue92_attention.en.md) · [复核](evidence/issue92-attention/plan-review.md) · [验收](evidence/issue92-attention/acceptance.md)

## 1. 依据、基线与范围

仓库：https://github.com/ExplodeCode6324/Secretary 。Issue：https://github.com/ExplodeCode6324/Secretary/issues/92 。以当前正文及 `docs/tui/implementation-reference.md` v1.7 为要求。领取时最新 origin/main 为 `3a8a94ad93662fcfc2a889d9a2acbf1fe716343b`，已含 #95/#96/#97/#98；分支 `codex/issue92-attention-plan`。`f01076e6f5efad437d64b2a2890ae1af43ce97d7` 仅为历史业务事实基线，不回滚前置成果。保留无关文件与证据，维持 Node/TypeScript、pi-tui 0.87.0。

Master 本次只授权计划：中英文计划经浏览器 Claude **Opus 5.5 Extra** 往返复核，交 Master 批准后才实施。实施后必须真实接入模型验证并复核证据，另由同一 Claude 会话复核实现。计划 PASS 不授权实施、合并或关闭 issue。

交付 Main 输入框上方事项区、Main 与 Task `/show <item_id>` 的授权/问题处理、完整显示与版本绑定、业务完成核对、原稿保护及失败/UNKNOWN 只读行。不增加 Main `/show`、remember/revoke、直接建任务/聊天、指导/watchdog、失败处置、取消、UNKNOWN 裁定、产物打开或图片粘贴；#93/#94 保留对应动作。不新增权威 Main、推送通道或持久 UI 流水，退出 TUI 不停 Core。

## 2. 已核实的源码事实

- `application-service.ts` 的 attention 包含 PENDING **和 APPROVED** 授权及未过期、Execution 为 WAIT_DECISION 的 OPEN 问题；目前按 `[type,id]` 分页，缺发起时间、归属摘要、失败与 UNKNOWN。`task-browser.ts` 共用较宽的适用谓词，不能为隐藏待批准区 APPROVED 而改变 Task 当前集合。
- 普通详情校验 session/execution 归属，不套用 task-browser 的归档排除；authorization() 现有仅 task scope 校验缺口，第 3 节明确补入投影/详情/提交。授权详情有实际存储 display（scope/action/parameters）与 hash；问题详情包含整个事项、question、`options:string[]`、impact、deadline 和回答身份，选项没有独立 ID。事项来源不能依赖排除归档的 Task browser。
- `authorization.ts:decide` 校验 revision/hash/expiry/合法转移，记录 `decision_id=request_id`；`execution-recovery.ts:answer` 校验 OPEN/deadline/WAIT_DECISION，记录 answer_request_id、MASTER、`{value:answer}`。复用同 ID 幂等能力，不把自然语言解释为授权。
- `ApplicationService.command` 将 ApiCommand 接收与首次领域变更一起提交。同步命令可能一直为 ACCEPTED，不能等待不存在的 COMPLETED；须查真实事项及 decision/answer 请求身份。超时不等于取消。
- Store.firstSequence 与不可变 projection frame 提供创建事实；现有 actionableFailure 接收按创建排序的执行，FAILED 在被同 Task 更新执行替代前仍可见。失败展示不依赖留存可用性。但该旧替代规则不符合新 Main 失败区的 C09 语义，本批不复用它（见第 3 节）。
- TerminalApp 所有编辑当前进入 Main/Task Delivery，所有提交进入普通解析；首个可视行 Up 当前进入历史阅读。DraftEditor 有粘贴归属/光标保护，Enter 换行、Shift+Enter 明确发送。必须加入优先于这些路径的事项状态。
- 现有 sync 已映射授权、问题、操作、执行和 attention，但 RemoteViews 只据此刷新 Task。复用该流和两路共享读并发。Linux 为 PostgreSQL 全量 verify，macOS 为显式测试清单。

## 3. 公开待处理投影与完整排序

扩展 GET `/api/v1/attention`，增加明确的 **`view=master`** 投影；保留默认 attention 行为及其他消费者的原计数。同步 schema/operations、生成 DTO/OpenAPI。TUI 仅用公开 CoreClient，不读取 Store。

行字段：type（authorization/decision/failure/unknown）、稳定 id、事项 revision/state、适用的 session/task/execution/operation ID（Main 授权允许空 Task）、所属执行状态/不可继续执行提示、有界安全摘要、不可变 initiated_at/initiated_sequence、到期时间及可处理/只读分类。计数覆盖完整筛选集合，失败/UNKNOWN 分列。详情复用授权/问题/执行/操作接口，错误不能凭空形成操作入口。

- 授权：本 session 可访问且未过期的 PENDING；APPROVED/CONSUMED/REJECTED/REVOKED/过期不再出现。保留历史及默认谓词；finish() 不关闭授权，已结束 Execution 仍可留下 PENDING。保留 Core 允许的批准/拒绝，但显著显示所属执行/留存状态及“批准不能恢复此已结束执行，仅决定这份授权”。dispatch 会拒绝不活跃执行或 attempt 不符，不暗示继续执行成功。Main 级无 Execution 授权不加该提示。增加已结束/RETIRED 所有者真值表及测试；#92 不修生命周期、不静默删除。
- 问题：可访问、OPEN、未到 deadline、所属执行 WAIT_DECISION。已开始对象不因 Scope 归档排除。
- 失败：每个可访问的历史/当前 FAILED Execution 独立保留，不因后来排队/运行/成功执行移除；另有当前 TaskPlan INIT_FAILED（按初始化 episode 去重）。这里不复用 actionableFailure。采用保守过渡规则：基线无权威“本次失败已处置/重做成功”记录；continuation_of 只是父执行关系，不能单独证明新工作修复该失败，#92 不据此推断移除。#93 负责精确处置/重做结果关联及后续移除。现有 domain 的历史失败全部按原时间/ID 分页展示，不设时间截断或批量清除。Task browser 原当前集合语义不改，Main 为不同的待处理失败投影。#92 不增加处置动作或领域记录。
- UNKNOWN：每个可访问且 state=RESULT_UNKNOWN 的 Operation 一行；仅 effect=UNKNOWN 不足，已解决的 FAILED/SUCCEEDED 操作不重现。Execution 仅在 state=RESULT_UNKNOWN 且没有关联 RESULT_UNKNOWN Operation 时用执行级回退行，残留 unknown_operation_ids 不独立决定成员。随后变 FAILED 时替换为失败 episode，不同时展示两种执行异常。显示真实原因/身份及进程停止未确认事实，无裁定/普通失败动作。按 execution、仅 task 的 scope 或 session 完整校验，沿 operation() 更严格规则；授权投影/详情/提交共用最小归属辅助函数补齐仅 task scope 校验缺口。保留合法归档访问，拒绝其他 session；默认 attention 成员语义不变，登记新投影比默认多归属过滤。

授权/问题发起时间取首次持久创建；异常取进入该次失败/未知 episode 的首次持久转移。使用 frame committed_at + sequence，并以 type/id 稳定打破同刻顺序，不用 updated_at 或执行开始时间。历史来源缺失明确未知，排在有时间的事项之后，不造时间；真实新异常 episode 有独立键，普通更新不改变顺序。INIT_FAILED 仅从非 INIT_FAILED 进入时开始新 episode；当前每 300ms 初始化重试的同状态 revision 不重新发起，恢复 ACTIVE 后移除，后来再次失败才新建 episode。生产 FAILED Execution 优先取 firstSequence("TaskResult", result_id) 对应 frame，finish() 在同一帧创建结果并标执行 FAILED；校验关联，历史缺失按明确未知处理。执行级 UNKNOWN、INIT_FAILED 仍按转移检测。索引可从已有 frame 重建，不迁移领域 schema、不记 UI 审计。

完整集合先按新到旧排，再分页；默认 30、最大 100，摘要至多 160 grapheme 且有字节界限。复用签名、不可变键的 keyset 游标，绑定 owner/session/instance 与投影模式，键为 [provenance_known, initiated_at/sequence 倒序, type, id/episode]。成员或内容 revision 不使游标失效，不建成员摘要重置循环。变更时刷新首屏/总数，旧页保留选中 ID 并显示新事项提示；游标之前的新项在刷新头部出现，删项跳过、重叠 ID 去重，已打开目标保持不变。只有非法/旧实例游标才重置并按稳定 ID 重定位。valid_until 到时刷新，不依赖其他事件；不把单页计数当总数。

客户端只保留当前/相邻页简单窗口（默认每页 30 行）、前页游标检查点和稳定锚点，全部可达；不另建 200 行缓存/淘汰系统。选择用 `(type,id,episode)`，不靠行号；异步结果检查连接/选择/generation。已看是当前客户端会话内按身份存储的 UI 状态，不调用 executions/viewed、通知 read，不改留存或新增持久流水；重启可重置。TaskPlan 变更加入新 attention 刷新路径，覆盖 INIT_FAILED；突发刷新最多每秒一次，保留首个/末尾待刷新信号。成员/顺序及可见内容分别取摘要，排除只有 revision 的抖动，避免 300ms 重试反复重建/绘制。实际摘要/错误/状态变化正常刷新，不新增后台轮询或推送通道。

## 4. 布局、输入与明确操作状态

仅 Main：事项区固定在底部编辑器上方。常规尺寸最多 `min(8,max(3,floor(rows/4)))` 行（含标题），保留会话/编辑器/页脚可用空间；标题显示真实总量与当前范围，每项一行摘要；加宽只增加容量。明确验收 80×24、120×40，小窗退化为计数和可滚动选择，不丢事项。未看浅、已看深，类型/状态另有文字。进入真实详情才标已看，收到数据不标已看。

状态：普通 Main/Task、Main 事项选择、加载事项、授权/问题处理、提交/核对、只读异常详情。记录来源页、进入时草稿 generation/光标/视图锚点及事项完整 ID。处理期间普通 Main/Task 草稿仍由 Delivery 管理；后台核对可清除已接收绑定 Main 草稿或恢复未决草稿。返回显示当前 Delivery 草稿，只有 generation 未改变才恢复进入时光标/视图；绝不把旧快照覆盖更新后的 Delivery。普通编辑器及其 Delivery 独立保留，使用一个同位置临时富文本编辑器，不调用 Delivery.edit、不发 Main、不持久化未发送回答；草稿未变时恢复光标、粘贴块与斜杠来源；已被权威后台更新时保留新状态。

- 多行 Main Up 先按正常编辑移动；只有已经在第一可视行且无补全菜单时才进入事项选择。无事项沿原历史行为。上下键遍历/翻页；静止时显示最新窗口，编辑器 Up 落在该窗口底行；完整列表最旧一项再 Down 或任意位置 Esc 返回编辑器，静止区恢复最新窗口。无论总量多少，到历史最多只需一个可见区高度的 Up；第一项再向上进入既有 Main 历史阅读，保留 #91 的历史入口。选择态 Enter 仅进详情，不批准/回答/发送 Main 草稿。
- Task 普通列表/详情支持 `/show <完整事项ID>`，命令名大小写无关，ID 保留，单完整 token，不承诺短 ID。只按真实详情 API 精确解析授权/问题，权限/网络错误不猜另一类型。归档 Scope 有效事项可处理，但不增加归档任务浏览或计数。成功回 Task Scope 列表并刷新；未提交 Esc 回原浏览位置；目标失效回列表并保留错误。命令本身按既有规则消费，不作为事项回答。
- 处理态在 **Main 待发送重放、原始斜杠来源、解析、全局/页面命令与补全之前** 拦截。所有命令/命令补全停用，含 /help、/back、/send、/rawmessage、/m、/t、/open、/paste、/cancel；界面显示本状态操作提示。问题 `/M`、`/tmp/a`、`/send x` 都原样交当前事项。Esc 退出不提交，Enter 换行、Shift+Enter 发送。
- 授权用可滚动、安全渲染文档完整显示真实 action/resource/parameters/scope、有效期、ID、当前 revision/hash，不能只给截断摘要。固定显示版本；Tab/Shift+Tab 在中立阅读、批准、拒绝焦点间切换，**不预选任何动作**。Enter 可选焦点但不执行，只有明确聚焦批准/拒绝后的 Shift+Enter 才提交对应 enum。文字/斜杠不会批准。不加 remember/revoke。显示变化解除已选动作，需查看并重新选择，不能把旧意图静默绑定新参数。
- 问题完整显示 question、impact 与原始 options。Tab/Shift+Tab 聚焦回答编辑器或真实选项行（初始编辑器，不预选）；明确聚焦选项后 Enter 仅把该选项原文复制入临时编辑器，允许编辑，Shift+Enter 才提交。不新增裸数字映射或 option ID。长详情/选项复用滚动渲染；终端转义中和不静默改变提交答案字节。
- 失败/UNKNOWN 只读详情以 Esc 返回，无假处理控件、无点击清除，阅读不删除行。

真实终端必须验证上述 Tab/Shift+Tab、Enter、Shift+Enter、Esc；若必须替代，经过实际验证并更新帮助/验收，不以模拟键声称可用。Esc 不扩展为普通 Task 草稿导航键。

### 明确的焦点/布局参数

长授权/问题/异常详情替换同一底部输入框上方的会话内容区域，普通文档和锚点单独保留。Main 事项区仍在编辑器上方，Task 无事项区。尺寸/事项区高度变化保持 #91 消息/源码锚点及 follow 状态。授权用纯文本/JSON 转义展示完整参数，不把内容当终端控制或可交互 Markdown。现有详情 GET 返回完整内容、不分页，先使用完整响应及虚拟滚动，不以 operation 摘要代替 hash 绑定授权 display；若证实响应尺寸限制必须分片，应先复核精确 hash 绑定契约，不能静默截断。

| 焦点 | 键位/效果 |
| --- | --- |
| 回答编辑器 | Enter 换行；Shift+Enter 字面回答；Tab/Shift+Tab 转详情/选项焦点，不插 Tab、不补全。 |
| 详情阅读 | Up/Down、PageUp/PageDown 滚动完整详情；Tab/Shift+Tab 转编辑器/选项或中立/批准/拒绝。 |
| 选项行（SEEDED 正例） | Up/Down 明确选择行，Enter 原样复制到编辑器不提交；选项焦点的 Shift+Enter 不提交。 |
| 授权动作 | Tab/Shift+Tab 选择中立/批准/拒绝；Enter 不执行；仅明确选定合法动作后 Shift+Enter 执行。 |
| 所有事项状态 | Esc 离开视图（已提交未决信息留内存）；Ctrl+C 只退出 TUI，不停 Core、不把输入转业务。 |
| 普通 Main 历史 | 最底部 Down 有事项则回事项选择，否则原编辑器；保持视图切换不误发送。 |
| 普通 Task 补全 | 只补 /show 命令名，不要求 ID 建议；完整事项 ID 查详情，不使用任务 ID 补全。处理态关闭全部补全。 |

唯一真实问题生成入口 materials 为空。seeded/非空记录显示引用元数据和内容不可用说明，不暴露 CAS 原件或接入 #94 文件打开。seeded 选项仍走公开 API 的真实 Core 回答，证据标 SEEDED_CORE。

范围外已知矛盾：instructions.ts 让 Main 提示在客户端裁定 RESULT_UNKNOWN，但本 TUI 明确无裁定入口；登记给 #93/后续提示词对齐，#92 不补裁定控件、不改 Main 指令。

## 5. 提交、竞态、错误与恢复

建立小型事项提交控制器，复用 CoreClient/可用核对辅助能力，不复用 Main Delivery 的“ACCEPTED 即送达”业务完成判断。明确提交冻结**内存中** single-flight 信封 `{domain,route,item_id,request_id,payload,display_revision/hash}`；本 TUI 进程内同次重发（含同 domain 重连）保留完全相同 ID/载荷。最多一个未决事项提交，其他事项可读但在它完成前不可提交。不改 LocalState 版本、不持久化事项信封、不增恢复菜单或未发送回答存储；Main 已有持久送达机制不变。

TUI 进程重启后读取最新权威事项状态，不重放已丢失的提交、不认领其结果。Core revision/hash 和 OPEN/WAIT_DECISION 门禁防重复批准/回答。最新状态仍可处理时，重新打开并由 Master 明确操作，才是新尝试，不是自动重放；若旧网络请求与新操作竞争，Core 至多接受一个。明确崩溃恢复限制：可核对对象状态，但不恢复上个进程的请求身份/本地回答。

POST 接收不清行、不报成功。查询真实详情及 requests/{id}：授权必须匹配 decision_id 且 APPROVED/CONSUMED（拒绝为 REJECTED），问题必须匹配 answer_request_id、ANSWERED、MASTER 及回答。无需等整个 Task；及时记录已经证明的结果，避免后续到期/撤销掩盖。消费太快时匹配 decision_id 的 CONSUMED 仍证明批准；其他客户端处理只提示外部完成，不算本次成功。重查永久筛掉 APPROVED，不能只靠本地 tombstone。

断线/超时/5xx 且结果不明保留临时输入和信封，只读核对，明确重发才用同 ID；不自动换 ID。禁止在结果不明时把载荷改成另一操作沿用原 ID；允许 Esc 返回，但保留未决业务信封并有可见状态。旧目标迟到结果不覆盖新编辑器或导航新视图。进程内重连先核对信封，同 ID 重发仍需明确意图；进程重启遵守上面的最新状态规则，不自动重试。确定未接收的校验错误保留输入；证实没有先前业务接收后，修正内容才成为新的明确尝试。REQUEST_CONFLICT 不静默换身份。

过期/not-open/stale/not-found/非法转移或他端已处理，自动退出：Main 恢复 Delivery 当前草稿，Task 回列表刷新。APPROVAL_CONFLICT 表示已展示授权失效，退出并提示；重开取新内容。临时读取失败不能冒充目标失效。错误由父级局部提示承载，返回后仍可见，下一次主动用户动作按既定规则清除；任务异常独立保留。提交中的失效先核对冻结请求再区分外部完成；刷新不能把输入改投其他对象。

处理时刷新保留展示版本，确认适用性，变更授权解除动作选择，丢弃过期异步读取；valid_until 驱动到期检查，但 Core 校验仍权威。Esc 不能撤销已提交操作，须真实呈现未决/完成。未提交临时回答允许丢弃，不能回填普通草稿或另一个事项。

## 6. Master 批准后的实施顺序

1. 固定更新后的 main/环境；针对投影真值表、归属/归档、不可变发起时间、全量分页与错误写必要测试，实现最小 attention?view=master 和异常只读投影，保留默认契约/谓词。
2. 更新 schema/operations、生成 API、sync/到期刷新。复用完整详情接口；只有实际缺少核对身份/内容字段时才最小补充并登记，不新增业务命令。
3. 接入事项控制器、Main 区、稳定选择、同位置临时编辑器及 Task /show，先保证优先级/完整详情/版本绑定，再接动作。加入内存中 domain 绑定提交、核对及返回错误处理。
4. 通过公开 Core HTTP 和 TUI 输入/控制器做真实分层回归，保留首次失败；macOS CI 清单增加 #92。运行 PostgreSQL `npm run verify`、#82/#91/#83 相关回归和生成契约/文档检查。
5. 同步 docs/tui/run-and-test.md、api-coverage.md、正式 API/测试文档、中英文计划与证据、实际按键和容量。逐项登记方法/路径/字段及未接入的 remember/revoke、execution viewed、取消、失败处置、UNKNOWN 裁定、Scope/Memory/World/Settings、产物/图片操作，不能因 API 存在就补菜单。仅 task 授权归属收紧同时影响既有 GET authorizations/{id}、POST authorizations/{id}/decision，正式契约须登记，不只更新 view=master。
6. 完成下述真实模型和原生人工验收；创建实现 PR，取得同 HEAD Linux/macOS/aggregate CI；同一 Claude 会话按准确 SHA/diff/证据/限制复核往返，再交 Master 终审，不自动合并。

## 7. 验收矩阵

当前全部 NOT_TESTED。每项登记通过/失败/未执行及原因、真实 ID/顺序/状态、准确 SHA、macOS/Terminal/Node/pi-tui 版本、尺寸、IME 和实际动作；区分 fixture、真实 Core、LIVE_MODEL、物理人工输入。

| Gate | 必须证明 |
| --- | --- |
| A1 / AC16 + AC02 | >100 混合事项跨页用明确 SEEDED 或 scripted-provider 数据；真实 provider 授权/问题子集另列。有选项/deadline/显示变更/跨 session 案例均 SEEDED（无生产生成入口），不称 live-provider。全量新到旧、旧项更新不重排、全部可达、已看颜色、无 viewed/留存写、Main 专属位置。归档仍有效事项可处理，其他 session 拒绝，UNKNOWN 独立只读。 |
| A2 / AC17 | 两行 Main 富草稿含粘贴块/光标；Up 先编辑再选择，Enter 开详情无写入；重排/增删不换目标，>100 行时历史仍可访问；回归 #91 历史底部 Down 进入事项选择及区域高度变化后的源码锚点。 |
| A3 / AC18 | B 只答 D，真实长授权显示/revision/hash，明确批准及拒绝；APPROVED 尚未 CONSUMED 时已移除、刷新不复活，未变的原 A 恢复；另测处理期间 Main 未决送达被接收/清除或恢复，返回尊重 Delivery 最新状态，不复活已发送 A；已结束/RETIRED 所有者的 PENDING 提示无法恢复执行；拒绝活跃 Agent 授权后可产生独立 FAILED 行，验证授权行移除但不隐藏失败；仅接收回执不清行。 |
| A4 / AC19 + AC24 | Task 普通文本为草稿、/send 局部错页；完整 ID /ShOw；字面 /M、/tmp/a；处理态整个命令分派停用；不默认授权/答案、不映射数字；成功回 Scope 列表。 |
| A5 / AC34 | Main/Task 临时输入未发送 Esc 恢复未变富草稿/视图或 Delivery 最新状态，不提交、不退出 TUI；真实终端退出键，无未验证 fallback。 |
| A6 / AC20 | 真实入口他端回答/授权；到期、显示版本变化明确 SEEDED；Main/Task 自动返回、错误可见、原稿恢复。网络失败留输入，同 ID exactly-once；提交后丢响应、接收先于观察、消费竞态、进程内重连同 ID、进程重启不重放、未决 Esc、迟到回包、REQUEST_CONFLICT。 |
| A7 / AC28 + AC31 | 物理 macOS 中文候选确认不发送，换行/发送/选项/选择/补全/Esc 可区分。安静窗口对比 Main Inputs、模型调用、业务/UI 事件、留存：纯查看/导航/已看/错误不新增写；真实回答/授权记录允许，不额外复制 Main 用户回答。 |

受控真实 Core 子项使用现有 serveCore(...,{pump:false})，走真实批准 API，手动恢复 scheduler tick 前观察 APPROVED；该受控真实 Core 子项与不停顿真实模型链路分开标注。UNKNOWN 可明确 seeded，不为制造它实施危险效果。不认领 AC21/AC29，不把 #92 未完成行为转给 #84。

## 8. 强制真实模型接入与实施复核

使用全新 `.demo-data/issue92/live-*` Core domain、现有获准 provider 凭据、生产模型适配器/任务执行器。核对配置但不输出密钥，登记实际 provider/model/预算，复用 #83/#91 harness，不用录制/合成回复替代；计划阶段不调用 provider。

运行前设 Main/Task 各 48 次初始上限、150 次工具调用、每调用输出上限 8192 token、90 秒/请求、总 20 分钟；仅任务所有进程和隔离 scratch 资源。完成/耗尽时停本测试 Core；不建周期工作、不改生产配置。如需调预算，保留失败运行，登记新限制再开新尝试。

- L1：真实 Main 创建真实 Agent 工作，Agent 调用 request_decision；记录整个问题 ID/正文及实际空选项（request_decision 仅收 question，生成 options=[]、固定 impact、materials=[]、deadline=null）。不给 Main 足以代答的信息，记录全部 Main 工具调用；answered_by=MAIN 算外部完成/本 MASTER 回答 gate FAIL。从 Main 事项 UI/控制器回答，核对 MASTER、request_id 和恢复后真实 Agent 唯一标记结果；再从 Task 回答字面斜杠，准确 ID 且不额外产生 Main 用户消息。
- L2：真实 Agent 请求确需 Master 授权的有界 scratch 写入（如隔离 DIRECTORY scope default_write=ask），核对真实操作/资源、授权产生、TUI 批准、继续执行后的文件字节/hash；另有拒绝证明无被拒效果；活跃 WAIT_AUTH Agent 在拒绝后恢复时，execution-runner 会以 Authorization rejected/revoked 结束为 FAILED。授权行消失，但独立失败行保留至 #93，属预期，不误报拒绝失败。保留真实 provider HTTP 状态/调用 ID、链路身份/业务状态；模型未请求操作不能用假授权替代。
- L3：保留真实对象做重连、草稿、刷新及他端完成；受控故障注入明确标注，不称 provider 自发失败或独立人工验收。上节受控子项证明 APPROVED 未消费，正常 live 链路不停顿；保留首次失败/不支持分支为 FAIL/NOT_TESTED，直到实际解决。
- L4：任务稳定后对比纯 UI 前后记录，Main 后台反馈轮次单独归因；真实失败可用无害受控命令产生，UNKNOWN 无自然实例则保留 seeded 只读验证；若能核对任务所有进程清理，可选用无害 scratch shell 的 DISPATCHED→Core 重启恢复，提供 CONTROLLED_CORE 证据，不替代强制真实授权/问题链路，不扩为危险故障工程。

LIVE_MODEL PASS 必须真实成功 provider 交互及相关持久状态/效果，HTTP 200、fixture、Claude 意见或模型自称成功都不足。给 Claude 脱敏准确 HEAD 代码/证据、双语计划与完整英文请求；记录它实际查看内容与 Codex 执行证据的区别，源码复核不等于独立运行/原生验收。真实模型、物理人工验收、同 HEAD CI、Claude readiness、Master 合并授权、issue 关闭分开记录。

### Master 批准时须知及最终复核说明

Claude R2 为 PASS（仅计划），B1–B6 全部关闭，双语实质一致。它认可保守失败规则，并撤回 R1 以 continuation_of 成功推断消除失败的示例。本次仅源码阅读，未执行运行时/provider/原生测试；以上已采纳非阻断说明，不扩大批次。

请在批准时知悉：(1) 拒绝活跃等待 Agent 的授权可能让执行变 FAILED 并保留失败行；(2) 已有 domain 全部历史 FAILED 会出现，重启后会话内已看标记重置；(3) Main 完整失败区与 Task 最新失败标记、最近三轮 Agent 历史有意不同，较旧失败即使不在 Task 当前集合/历史，也必须经 Main 只读详情可达。实施时写入 run-and-test.md。成功重做/处置后的移除登记 NOT_DELIVERED_BY_92，属于 #93，不宣称全部 C09 动作完成。

SEEDED_CORE 使用 pump:false 且无真实 provider 凭据，授权参数无害且限 scratch；否则 seeded 问题回答会恢复真实 Agent，seeded 授权可能执行真实效果。真实 provider 链路使用另一个 domain。INIT_FAILED 持续初始化重试的 journal 增长属于既存独立 Core 问题；#92 只合并自身投影刷新。
