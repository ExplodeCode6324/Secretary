# Issue #93：明确取消与失败处置计划

日期：2026-11-02（香港时间）。范围：**实施中；Claude R3 已通过计划，Master 已于 2026-11-03 明确批准实施**。

仓库：https://github.com/ExplodeCode6324/Secretary
Issue：https://github.com/ExplodeCode6324/Secretary/issues/93
基线：`843836ef156ee0cd0dda3549cbf9c8ced2458e6a`（main，已含 #99 / #92）。分支：`codex/issue93-failure-plan`。英文对应文件：`fix_20261102_issue93_failure_handling.en.md`。

复核使用 Master 已打开并已核实的浏览器 Claude **Opus 5.5 Extra**；全程英文交流，实施后复用同一会话。计划阶段不实施、不调用业务 provider、不合并。英文请求、原始回复及截图放 Git 忽略目录 `.demo-data/issue93/review/`；仓库仅保存脱敏结论。

## 1. 目标、前置与源码事实

Master 在 Task 普通状态取消明确请求/执行；在 Main 明确委托唯一主会话处理某一次失败。历史 FAILED 保留，只有真实“不再重试”处置或**显式关联的重做成功**才移除原待处理提示；新失败独立显示。UNKNOWN 保留准确对象和原因，TUI 只读，不替代既有后端核验与恢复。

#83/#92 代码已合入，但 issue 仍开放，不能把合并等同完整验收。#92 最新评论记录 Master 已完成修订后的人工清单、合并后 CI 通过；新 Ctrl+C 的物理按键验收未被认领。本批重验所依赖的路径，前置的原生/产品验收缺项明确保留，不推断关闭。#84 负责组合终验，不承接本批已知缺失功能。继续 Node/TypeScript、pi-tui 0.87.0，保留 #91/#92 草稿、粘贴、导航规则及无关工作树和历史证据。

源码依据：

- `execution-recovery.ts:cancel` 对终态直接返回；运行中进入 CANCEL_REQUESTED，RESULT_UNKNOWN 可能继续不确定。这不构成失败处置。
- `task-triggers.ts:cancelRequest` 取消已派发执行或移除排队的即时请求。`task-planning.ts:requestStatus` 返回执行状态或带原因的排队移除；仅 CANCELLED_OR_REJECTED 不能证明 Master 取消成功。
- `main-tools.ts` 有 task_query、task_propose(reuse_task_id,parent_execution_id)、task_control(cancel,cancel_request,answer)，没有 retry。`accepted:true` 不是最终结果。
- `continuationParent` 校验所有权、ACTIVE 计划、无活跃/排队工作、最新终态且非 RETIRED 父执行、无未决操作、周期时机及工作目录；保留这些约束和继承需求规则。
- `master-attention.ts` 展示全部所属 FAILED、INIT_FAILED episode 和独立 UNKNOWN，保留 #92 失败分类/原因证据。`task-browser.ts` 当前主要取最新失败，需共享权威未解决处置口径，不能被无关后续成功隐藏旧失败。
- `tui/matter.ts` 异常只读，`tui/input.ts` 尚无 cancel。现有 Main Delivery 在本地 outbox 保存后、Core 接收前就会清已发送稿，不能原样用它提交独立失败意图，否则会破坏原稿 A。
- `instructions.ts` 仍要求在客户端裁定 UNKNOWN；将其改为符合当前 TUI 只读能力的说明，同时保留后端核验/恢复及禁止自动重试/替代。

## 2. 拟新增的最小持久业务契约

在现有 Store journal、schema、重放、admission 和 sync 内增加每个失败一个小型 **FailureHandling** 业务记录及尝试事件，不另建 attempt-record 类型；由独立小服务供 Main 工具、master-attention、task-browser 复用。这不是 UI 阅读流水或新调度器。schema、类型、索引、兼容默认值与恢复测试一并登记。

失败身份在所属数据域/session 内由服务端生成：FAILED 执行为 `EXECUTION:<execution_id>`（终态，每个执行只失败一次）；初始化失败为 `TASK_INIT:<task_id>:<episode_sequence>`。result ID/发起 sequence 是不可变且需核对的证据属性，不另造执行失败身份。结果或原因缺失/损坏不妨碍处置所属 FAILED；REDO 仍需有效原 proposal/证据及既有前提。把 INIT_FAILED episode 跟踪从 master-attention 私有 map 移到接收与各投影共享的 journal 重建服务。当前每个计划只产生一个 INIT_FAILED episode，重复初始化失败仍是同一 episode，不为制造多 episode 新增生命周期。活动区 key 与提交 failure_key 共用同一派生；执行失败 key 不随原因缺失变化，发起排序独立保留。历史初始化来源从真实校验帧重建，不虚构 sequence、不在读取时新增写入。

只在 Master 明确提交业务意图时建立记录，查询/查看不写入。无记录旧失败默认 UNRESOLVED。保存原始身份、revision、意图/Input/request ID、时间、尝试状态、错误及关联后续 request/execution/result ID。有效处置为 UNRESOLVED、DISMISSED 或 REDO_SUCCEEDED；尝试区分 REQUESTED、Main 处理、关联排队/运行、BLOCKED/FAILED、SUCCEEDED；传输送达另列。按失败索引并提供按 Task 的未解决数量，能从 journal 重建，避免每次刷新重读所有历史。

拟新增只读 `GET /api/v1/failures/{failure_key}`：返回准确身份、权威处置、当前/最近尝试、原因、关联工作及当前继续前提。活动区、Task 投影补展示所需字段，历史执行状态不与处置混淆。Main task_query 同样可按可选 failure key 查询，与其他选择器互斥。接口/schema 名称实施时在使用前登记；此处不声称已存在。

### Main 接收与授权边界

扩展既有 `POST /api/v1/messages`，可选结构化 `failure_action` 含服务端 failure key、expected handling revision、REDO/DISMISS，稳定 request ID 即意图身份。Core 验证所有权/身份，拒绝 UNKNOWN、目标不匹配和同身份不同内容，通过现有接收事务**原子保存意图和一个正常 MASTER Input**。Core 根据动作构建或校验只包含动作及规范 ID 的可读正文，不插入 Agent 生成的失败正文，也不把任意附加正文当另一项指令；不发送原稿 A。无此字段的普通消息不变。结构化内容进入幂等指纹、Input、消息/历史投影及恢复上下文。

结构化失败 Input 独占一个 Main batch，保留顺序及已 CLAIMED batch 恢复；普通 Input/feedback 随后正常处理。工具拿到权威的当前 Input/intent 上下文，不能根据模型自填 ID 或自由文本获得权限。仅对此上下文限制任务变更：REDO 只能查询并以准确 Task、失败 parent 和意图绑定发起继续；DISMISS 只能查询并处置这一失败。拒绝新建替代 Task、换 parent/task、取消、回答或计划管理等无关变更。普通 Main 的工具行为不变；查询、解释和汇报仍可用。后续另行明确提出的新工作走普通 Main，不能从失败处理推断。

权威绑定从 claimed Input 派生，模型所填可选绑定仅用于相等校验；task_propose 增加可选失败意图绑定，Main task_control 新增 `dismiss_failure` 动作并携带失败/意图身份（不是新增 task_control.retry）。Core 根据当前 MASTER Input/session 复验，恢复 loop 同样生效。助手口头答复、feedback/timer、其他 Input 或过期 intent 不构成处置授权。

### 原子关联、恢复和完成条件

REDO 沿用全部 continuation 校验。Core 锁定 parent 有效 proposal 的 goal、constraints、acceptance criteria、preconditions、deadline、executor/program parameters 及原 source materials。仅 REDO 上下文的工具 schema 把 goal 改为可选，由 Core 从 parent 填全省略要求；工具说明要求 Main 只发 reuse_task_id、parent_execution_id 及可选相等校验绑定。普通 task_propose 仍要求 goal，Core 在非 REDO 下正常校验。省略字段继承规范值，明确提供不同值（包括空数组、缩减目标、新材料）则 BLOCKED。正常 parent 证据补入及立即继续的 trigger 元数据不算修改业务要求。保存规范 requirements digest，判 REDO_SUCCEEDED 时再次验证关联 proposal 一致。变更要求只能另走普通、无此处置关联的 Master 新请求，本批不增加修正正文 UI。在 task.request.accepted 与 pending work 的**同一次提交**保存意图关联的 request ID。一个意图最多接收一次后续工作；网络重发、模型用不同 call ID 重复调用、崩溃恢复都返回既有关联，不重复发起。拒绝记录 BLOCKED 与真实原因，不创建工作。沿用工具恢复方式处理 scheduler 已接收、Main tool-result 尚未写入的边界，不能为补结果再创建一次。

通过准确 request/occurrence、Task/parent/proposal 身份关联派发执行。REDO_SUCCEEDED 必须由该执行与匹配 TaskResult 的 SUCCEEDED 共同证明，parent 匹配且原失败仍未解决。无关周期成功、任意 continuation_of 成功、模型话语、HTTP 回执、Main 完成、排队/运行及 CANCELLED/EXPIRED/UNKNOWN 均不算完成。重做又失败，原失败保留尝试错误/关联，新失败独立出现、独立处置；再次要求重做仍受 latest-parent 限制，不偷偷跳到新 parent。关联损坏则明确原因并保留未解决。

DISMISS 由 Main 新动作原子将这一失败标为 DISMISSED，保留业务 Input/request 归属；不改 FAILED/INIT_FAILED、不改留存、不关闭/暂停计划、不撤销授权、不取消其他排队或运行。RETIRED 或无法继续仍可处置。已接收重做时，DISMISS 只结束原提醒，既有工作和后来新失败不受影响。串行校验解决竞争：处置完成后未接收的旧重做不能再排队；已接收重做可以结束但不能覆盖 DISMISSED。同一活跃尝试的并发操作按后文接收表执行。同 request ID 精确重放幂等；已解决失败的新意图拒绝，不能重开。新工作须单独授权。

根据持久关联和执行/结果推导有效状态，避免依赖 UI 回调才能记录成功；读接口只重建投影、不写业务或留存。匹配 Input 已 HANDLED 且无持久处置/关联或已登记失败结果时，派生 NO_ACTION，不需 finish() 再写一次。Core 工具校验/接收失败持久记录 BLOCKED、原因和稳定工具 receipt；持久 model-call/session 错误投影为处理错误或恢复受阻，不能当成功。Main 尚待处理或 RECOVERY_BLOCKED 则如实显示，不引入虚构超时。接收及已知错误应可持久重查，不仅是瞬时 toast。

INIT_FAILED 没有可执行 parent：REDO 在 UI 明确不可用，Core 拒绝这一类型的直接 REDO 接收；显示真实初始化错误，允许处置 episode。动作标注“结束本次提醒；后台初始化重试继续”，因为 scheduler 现有每 tick 重试初始化。不增加初始化调度器或自动替代 Task。处置只隐藏提醒，不隐藏 TaskPlan 实际 INIT_FAILED 条件及真实后台初始化过程；后来新的失败仍显示。不延长留存、不激活 RETIRED。Task 当前集合保留暂停计划中的真实运行、排队、等待；没有其他工作且失败都处置完的纯暂停计划不显示。归档 Scope 的 Task 浏览排除不变，Main 仍可处理所属历史失败。

## 3. TUI 交互与送达语义

### Task 取消

仅普通 Task 支持 `/cancel --request <task_request_id>`、`/cancel --execution <execution_id>`。严格一个互斥 flag + 一个完整 ID，无默认、短 ID 猜测、多余参数、双目标或换行。命令名大小写不敏感，flag 按登记字面，ID 原样保留。沿用 typed-slash/paste 来源规则，粘贴命令文本不自动执行。Main 错页局部报错；授权/问题/失败处理态先于普通解析。问题斜杠正文仍为字面答案。仅补命令名补全/帮助，不猜目标。

直接复用 POST `task-requests/{id}/cancel`、`executions/{id}/cancel`，不经 Main。先读目标解释错误，执行时 Core 再校验才是权威。小型取消 controller 复用 MatterController 的请求身份/对账方法，冻结 domain、类型/目标、body、命令 request ID，双提交 single-flight，不确定重发同身份。结合 `requests/{command_id}` 与真实目标状态分别显示已发出、接收/排队、取消请求/停止中、最终状态。未派发请求需 MASTER_CANCELLED 的真实移除原因；已派发则跟踪实际执行。两个 cancel 路径都没有命令因果身份，MASTER_CANCELLED 可来自 Main 或 TUI；始终分别展示目标实际状态和请求 receipt，不宣称“由这个命令取消”。竞态已终结只显示“已结束/当前状态”。CANCEL_REQUESTED、RESULT_UNKNOWN 不算最终取消。核对未来周期仍有效，明确取消一轮不停止周期。

待核对状态在切页和同进程重连可见，旧异步结果不覆盖新视图/稿件。TUI 重启只读真实对象，不自动重发或冒认上个进程的取消结果。不新增持久 UI 取消队列，不影响 Main Delivery。覆盖响应丢失、重复/冲突、接收未完成、请求派发竞态、终态和 UNKNOWN。

### Main 失败选择

保留 #92 输入框上方区域、完整排序、失败分类和稳定选择。首行上键选择，Enter 仅打开准确详情，无业务写入。详情展示原失败/原因、留存/继续限制、处置状态及关联工作。Tab/Shift+Tab 在中性阅读、“重做本次失败”、“取消本次失败的重试”间切换，无默认动作；Enter 不执行，**Shift+Enter** 明确提交。结束提示文案：“仅结束本次失败提示；历史仍为 FAILED，其他工作和未来周期继续。” INIT_FAILED 改用前述初始化专属文案，不宣称后台重试已停止。UNKNOWN 无动作按钮。这些键位须真实 macOS Terminal 验证，不能只凭模拟按键。

Esc 保留 #92 两段返回：详情→仍有效的同一选择→输入。意图确认送达后回 Main 普通输入，恢复 **Delivery 当前拥有的 rich draft**，包含粘贴块/光标/generation；期间 A 被编辑或已发送时不能被旧快照覆盖。失败意图使用独立小型 envelope/controller，复用 CoreClient/对账，但不调用 Delivery.submit(A)、不临时覆盖 A。只送一个结构化业务 Input，不直调 proposal/cancel/disposition。接收后解除动作选择，防止误重复；原失败行等待权威处置才移除，分别展示已送达/处理中/受阻/重做运行中。

同进程不确定重发保留 ID/字节，重连先查询，REQUEST_CONFLICT 不换 ID。仅传输身份未确定时暂缓其他失败提交，Core 接收后由每个失败的服务端串行规则管控，不阻止处理其他失败。允许在关联重做运行中明确结束原提醒，含义如上。重启从 Core 恢复状态，不自动重放本地丢失意图。Esc/Ctrl+C 不取消已接收业务。局部错误跨视图显示、按规则清除，而持久未解决/受阻标记在 toast 消失、刷新、重开后仍在 Main 和对应 Task。仅选择/阅读/刷新不新增 Main Input、模型调用、UI 流水或 execution viewed 留存写入。

## 4. 批准后的实施顺序

1. 更新 main/基线与前置验收记录；先建立身份、终态 cancel 空操作、无关成功的针对性失败用例，再实现最小业务服务/记录、schema/默认兼容、索引/重放及原子接收关联。批准前不改实现。
2. 实现结构化 Main 接收、batch 隔离/工具上下文权限、查询/继续/处置工具、恢复对账与 prompt；保持正常继续、取消、授权规则。登记实际只读契约并生成产物。
3. master-attention、task-browser 与 activity.ts 共用未解决集合（activity 的后台 FAILED 成员也有 latest-only 判断）；意图/Input/关联执行/结果/处置变化接入既有 sync 失效重查，保留原始发起顺序与 #92 warmed read-cost 上限，不新建推送通道。
4. 实现 Task cancel parser/controller、Main failure controller/焦点/显示/草稿路由；回归处理态优先级、rich draft、过期异步结果、Ctrl+C 清空/undo、字面斜杠答案和稳定选择。
5. 更新 `docs/tui/run-and-test.md`、`api-coverage.md`、正式 API/schema/operations、测试说明、双语计划/证据；区分新增/复用接口，保留 UNKNOWN 裁定、viewed、计划管理、产物/图片等未使用项。执行生成检查、#82/#83/#91/#92/#93 针对测试、PostgreSQL `npm run verify`，macOS CI 显式列表加入 #93。
6. 完成以下真实 provider 与原生门槛，创建实施 PR，准确 HEAD 的 Linux/macOS/aggregate CI 通过，向**同一 Claude 会话**提交 SHA/diff/证据/限制并往返到就绪；交 Master 终审，另等合并授权。本计划阶段尚未授权这些实施步骤。

## 5. 验收矩阵

所有项初始 NOT_TESTED。记录准确 SHA、环境/尺寸/键位、failure key、Task/Execution/TaskResult/Input/command/follow-up ID、前后状态与证据来源；离线 fixture、SEEDED_CORE、受控网络故障、LIVE_MODEL、物理人工验收分别登记。

| 项目 | 必须证明 |
| --- | --- |
| A1 / AC29 | 真实排队请求、运行执行的取消；无参/双目标/无效 ID/大小写；错误无业务变化，真实最终状态/原因，未来周期保留。终态、派发竞态、UNKNOWN 不误报。 |
| A2 / AC21 | rich draft A；进入/阅读/Esc 不操作；明确重做只有一个 Main Input、一个关联继续，无 TUI 直调；A 保留。接收/排队/运行及无关成功不移除，关联成功才移除。正常清空 A 再 /T，空输入 /M 返回。 |
| A3 / AC21、AC30 | Main 真实处置 FAILED；TUI/Core 重开、重连后原提醒不复活，FAILED/结果/历史保留，计划/其他工作不变；同 Task 新失败独立出现。运行中的重做不被取消，其后来失败不被屏蔽。 |
| A4 / AC21 | RETIRED、非最新、忙碌、暂停、未决操作等继续拒绝；错误及未解决标记可见，仍能结束提示；另行明确新工作之前不创建替代 Task。INIT_FAILED、历史/未分类身份需要播种时标 SEEDED_CORE。 |
| A5 / AC11、AC16、AC21 | 真实处置失败或重做又失败，toast 消失后标记仍在；原/新失败独立显示。无关新成功不抹掉旧未解决 Task 标记。UNKNOWN 独立、对象准确、无裁定/重试/替代；无新调度或留存捷径。 |
| A6 / AC24、AC31 | Main /cancel 局部错误，处理态禁命令且问题字面答案保留，ID 大小写不变。阅读/选择/参数错/刷新不新增 Input/model/UI audit/viewed/留存写；明确失败意图/处置是允许的业务记录。 |
| A7 / 竞争与恢复 | 响应丢失、重复 ID/不同模型 call ID、内容冲突、原子接收及 tool-result 前后崩溃、并发 redo/dismiss、他端完成、重排/旧选择、重连、Main 无动作/错误/恢复受阻、待定 Esc/Ctrl+C；不重复发起、不破坏草稿。 |
| A8 / 原生及前置回归 | 真实 macOS Terminal 中文 IME 确认、Enter/Shift+Enter、Tab、两段 Esc、键入/粘贴命令、Ctrl+C 清空 undo、Main/Task 草稿及列表/历史导航。只认 Master 实际验证项，PTY 不冒充物理验收。 |

## 6. 必须真实接入模型及实施复核

批准后使用全新 `.demo-data/issue93/live-*` 数据域与任务专属 scratch，通过生产模型适配器、Main、Agent executor 调用真实 provider。安全检查现有已授权 provider 配置可用性，不输出密钥；不把播种 fixture 与带凭证 pump 混用。记录实际 provider/model、调用 ID/status、Main 工具轨迹及持久效果；计划阶段不调用 provider。

初始预算：Main/Task 各 48 次、工具 150 次、每次最大输出 8192 token、90 秒超时、总计 20 分钟；完成或到上限停止本任务 Core/进程。保留首次失败并跨尝试累计用量，不静默扩预算、不使用生产周期计划。隔离域可运行受限无害周期用例；断言取消不停止周期后停止专属 Core/pump，不虚构计划关闭 API，也不无意中带凭证重开此数据域。UNKNOWN/INIT_FAILED 播种采用另一 pump:false、无凭证数据域。

- L1：真实 Main 建立 Agent 工作，要求固定为读取具名 scratch `input.txt` 并输出含唯一标记的登记产物；缺文件必须失败、不能编造。首轮获得真实缺文件工具错误及 FAILED TaskResult。按预先登记并带时间戳的 harness 环境步骤创建该文件，保存内容/hash，不改 proposal/prompt/goal。TUI 提交 REDO，记录 Main 关联 task_propose、锁定 requirements digest、Agent 真读取及成功结果。TaskResult verification 为 NOT_VERIFIED，因此独立核对登记产物内容/hash。原 FAILED/history/A 保留，只有一个 intent/Input/关联 proposal。记录失败与明确 REDO 之间全部 Main 调用，自主 proposal 使本轮验收失败；不暗改要求、不伪造 provider 回复或 TaskResult。

- L2：真实 Main 对另一真实失败调用新增处置工具，重启重查，确认没有取消计划/其他工作；通过明确授权的工作再产生同 Task 新失败。包含真实重做再失败及持久标记。provider 拒绝、tool 失败、Main 无动作不算成功。
- L3：真实 provider 产生 WAIT_DECISION 或 WAIT_AUTH，作为稳定非终态取消对象，通过 TUI/Core 取消，断言实际 CANCELLED，不依赖非运行分支已有的“Cancelled before dispatch”误导性原因文字。要认领运行中取消，另外观察任务专属、时长有限的 scratch 长操作 RUNNING/DISPATCHED，再核对停止及终态/不确定分支。排队请求使用受控 scheduler 暂停，标 CONTROLLED_CORE，不靠时序运气。另有有限隔离周期任务，取消一轮后核实未来 schedule 及下一轮正常运行，再停止专属 Core/pump，不增加 public 计划管理。取消后记录 Main 调用，自主替代工作使本轮失败。

- L4：使用真实失败对象验证 RETIRED/非最新导致重做受阻及 Main 处置；使用受支持的隔离 lifecycle/retention 控制并标注。新的明确 Main 请求之前不产生新 Task。UNKNOWN 单独播种只读。安静 Core 比较 UI 操作前后 Input/model 数、journal 业务帧及 retention 不变；此子项不应调用 provider。

真实模型 PASS 需要 Main/Agent 真调用、指定工具路由和相符持久效果；Claude 意见、HTTP 200、accepted、fixture、模型说成功都不能替代。原生验收单独完成。live 后源码变动须做范围分析，影响路由/业务/provider 时重跑对应真模型检查，并用源码 hash 防止错认证据。Claude 接收脱敏源码/证据，明确其自行阅读/执行与 Codex 提供结果的区别。live/native/前置硬门槛未完不得宣称 issue 完成或 GO；合并须 Master 单独授权。

## 7. R2 明确规则与待批准影响

### 接收状态表与 revision（B5）

尚无记录的失败 handling revision 为 0。只有 FailureHandling 写入递增 revision，关联 Execution/TaskResult 进展和读取派生状态不递增。接收检查 expected handling revision；后续串行业务变更复验冻结意图/当前适用性，而不再次使用旧 UI revision。不自动为 stale revision 换新身份重发。

| 当前有效状态 | 新 REDO | 新 DISMISS |
| --- | --- | --- |
| 任意状态，同 request ID 同指纹 | 返回原接收/结果，无新 Input/工作 | 同左 |
| 同 request ID 不同内容 | 409 REQUEST_CONFLICT | 同左 |
| 未处理 REQUESTED/Main 处理中意图 | 409 FAILURE_INTENT_PENDING | 409 FAILURE_INTENT_PENDING |
| REDO 已处理，关联工作排队/运行/不确定 | 409 FAILURE_REDO_PENDING | 当前 revision 可接收，只结束原提醒 |
| UNRESOLVED 无活跃意图，或前次 BLOCKED/NO_ACTION/失败 | 执行类型可接收，Main 再验证原样继续，失败明确原因 | 可接收 |
| DISMISSED 或派生 REDO_SUCCEEDED | 409 FAILURE_ALREADY_RESOLVED | 409 FAILURE_ALREADY_RESOLVED |
| INIT_FAILED | 接收即拒绝；UI 禁用并说明 | 可处置所属 episode |

只有持久 Input/receipt 证明结算才认无动作/失败尝试已处理；仍 CLAIMED/recovery-blocked 继续 pending。E1 关联 E2 失败后，E1 展示 PARENT_NOT_LATEST 预测但仍允许明确提交 REDO，由 Main 返回权威原因；仍可结束提醒，E2 有独立失败项。RETIRED、忙碌、暂停等执行继续限制同理：只有 INIT_FAILED 和接收表的 409 状态禁用提交。预测不代替 Main 处理，不偷换目标。锁定期限已过时，现有继续可能先接收、随后调度为 EXPIRED；提前提示并展示实际结果，不称成功。改期限须另提新工作。合法目标在读后变得不可继续，保存真实 blocker，不换目标。DISMISS 接收后、Main 执行前重做已成功，返回 already-resolved，不覆盖 REDO_SUCCEEDED；相反顺序则保留 DISMISSED。重放后按 journal sequence 的首个持久终结事实决定胜者：比较 DISMISSED 提交帧与关联 Execution/TaskResult 首次同时证明成功的帧。以上均需逐项测试，不静默吞掉意图。

### 失败终态反馈不自主恢复（B3，交 Master 批准的政策）

选择沿现有 UNKNOWN guard 的最小服务端扩展：每个 FAILED/CANCELLED RESULT feedback Input 独占 Main batch，沿用附件/结构化失败输入的有序边界方式，不能混入无关 SUCCEEDED feedback 或 MASTER 消息。已 CLAIMED batch 维持恢复，新接受输入到 claim 时应用该边界。EXPIRED 明确不纳入新 guard、保留原行为；UNKNOWN 保留既有单独 guard，本批不泛化重做 UNKNOWN 机制。Main batch 含 FAILED/CANCELLED RESULT feedback（不论谁取消）且没有 MASTER Input 时，禁止任何 task_propose（既不能 reuse，也不能新建替代）。汇报真实结果，等待 Master 的明确失败动作或独立新工作要求。恢复该 batch 时同样检查，覆盖 Core 服务直接恢复入口；timer/feedback/旧 intent 不延续失败动作权限。普通明确 Master 请求及独立到期周期调度不变。prompt 同样禁止在该权限外自主恢复失败/取消。记录被拒绝和已接收调用；L1–L3 发生自主恢复即不通过。这是本计划需 Master 批准的行为收紧，不声称基线已做到。

### 恢复契约与最小存储（B6）

每个失败一个 FailureHandling，加不可变尝试/业务事件即可。REDO 关联和 DISMISS 均在业务提交内写 stableID(toolKey) 工具 receipt 及 action 级幂等身份，recoverTools 根据真实持久 receipt 重建两种结果。绑定/所有权、当前 Input/intent、锁定要求都在 **Core 服务内部**校验，覆盖直接 proposeTask 恢复入口及 wrapper。已完成效果可重放 receipt，即使失败已解决；新副作用不能绕过 guard。服务内捕获 continuation 校验失败，幂等提交 BLOCKED/原因/receipt，返回可恢复的结构化失败工具结果，不能只抛异常丢记录。不重放任意副作用。NO_ACTION 按 HANDLED Input 派生。增加处置/关联/错误提交后、main.tool.result 前崩溃，错误 Input 恢复，不同模型 call ID 重复意图，以及 FAILED 带未决 operation 可处置但 UNKNOWN 保留/REDO 因 UNRESOLVED_OPERATION 拒绝的用例。

### 真实调用预算分配（B2）

| 场景 | Main 次数 | Task 次数 | 工具次数 | 时间分配 |
| --- | --- | --- | --- | --- |
| L1 | 12 | 12 | 40 | 5 分钟 |
| L2 | 14 | 14 | 45 | 6 分钟 |
| L3 | 14 | 14 | 40 | 6 分钟 |
| L4 | 8 | 8 | 25 | 3 分钟 |
| 合计上限 | 48 | 48 | 150 | 20 分钟 |

在不变的总上限内预留反馈轮：L1 的 12 次 Main 中最多 4 次、L2 的 14 次中 6 次、L3 的 14 次中 6 次、L4 的 8 次中 2 次用于独立终态 feedback，其余用于明确任务/处置 Input 及其他 Main 工作。这是执行上限，不保证有波动的真实模型必能完成所有门槛。标明取消来自 WAIT 还是受限运行中操作并计入对应反馈轮。执行总上限并记录各场景用量，包含反馈及失败尝试。耗尽即 NOT_COMPLETED，保留证据并由 Master 明确批准额外付费运行/预算，不能静默归零。受阻 live 场景不能换 fixture 冒认 PASS。

### 请 Master 批准时知悉的影响

1. 旧失败默认未解决，可浏览 Task 只要仍有旧失败就进入当前集合，现有数据域可见 Task/计数可能增多。没有批量隐藏或自动处置历史迁移，每次明确 Main 处置都消耗模型工作。归档 Scope 浏览仍排除。Main、Task、activity 失败成员口径统一，不改历史消息/结果。
2. 解决关系采用**仅直接关联**：E1→E2 又失败，E2→E3 成功只解决 E2，E1 仍需明确结束提醒。不增加祖先传递解决，也不偷偷替换 E1 parent；这是“该次重做成功”的最小解释，界面保留两个准确对象和原因。
3. 采用上述不自主恢复政策及 FAILED/CANCELLED feedback 单独分批（可能增加 Main 调用次数）；INIT_FAILED 后台重试仍按旧规则继续，提醒文案如实说明。物理验收、真实 provider 证据继续是独立硬门槛。

## 8. 复核记录

R1：CHANGES_REQUIRED，B1–B6 已采纳并按上文修订。R2：B1–B6 实质关闭，双语一致性通过；R2-1–R2-4 及非阻断澄清已采纳（REDO 专属可选 goal、无取消者假设的 CANCELLED guard、feedback 独立 batch、受阻执行仍可明确提交、journal 顺序胜者与过期预测）。R3：PASS（仅计划），香港时间 2026-11-03 收到；全部阻断关闭，中英文实质一致。实施批准 GRANTED（Master 于 2026-11-03 回复“通过，可以实施。”）。运行/provider/原生/实施 CI 均 NOT_TESTED。逐轮结论和重要修订写入 `evidence/issue93-failure-handling/plan-review.md`，同步两种语言。


R3 非阻断实施提醒已采纳：通过权威 Feedback.result_id 指向的 TaskResult outcome 判定 feedback 隔离，不解析摘要正文；RESULT 无法读取时保守隔离并禁止自主 proposal。恢复时从持久 claimed Input/intent 重建 REDO 专属工具 schema，再建 Agent 工具，保持 tool key/receipt 语义一致。EXPIRED 明确仍是新 guard 的例外，包括锁定期限导致的关联重做过期；基线可能从该反馈自主发起后续工作。将此限制交 Master 批准，live 门槛观察到自主恢复就记失败，不静默通过。这些是实施/证据澄清，不代表 Claude 执行过运行验证。
