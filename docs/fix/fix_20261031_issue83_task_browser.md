# Issue #83 — Scope 总览、任务定位与 Agent 最近三轮

日期：2026-10-31（Asia/Hong_Kong）。R2（已纳入最终非阻断提醒）。状态：MASTER_APPROVED / IMPLEMENTING；Master 已于 2026-10-31 批准实施。

[English plan](fix_20261031_issue83_task_browser.en.md) · [复核记录](evidence/issue83-task-browser/plan-review.md) · [验收记录](evidence/issue83-task-browser/acceptance.md)

## 1. 授权与基线

仓库：https://github.com/ExplodeCode6324/Secretary 。Issue：https://github.com/ExplodeCode6324/Secretary/issues/83 。以当前正文及 TUI 临时实施参考 v1.7 为准，不继承被替换的旧 #83 要求。计划基线是经 GitHub branch API 核实的最新 main `c394866c772833ad1de6fac342afe5700665c95f`，包含 #82/PR #95 和 #91/PR #96。#91 已关闭，但 Task 的 CoT 继承仍须在本批验收。`f01076e6f5efad437d64b2a2890ae1af43ce97d7` 仅为 #81 历史业务事实基线。分支：`codex/issue83-task-plan`。保留无关未跟踪证据。

Master 要求先完成中英文计划、浏览器 Claude **Opus 5.5 Extra** 复核，再由 Master 明确批准实施。实施后必须**真实接入模型验证，并将证据交回复核**。Claude 计划/代码评审、fixture、模拟 HTTP 服务或 CI 均不等于真实模型接入。本任务后续复用同一 Claude 会话。合并、合后检查、产品关闭仍分别判断。

交付前台 macOS 终端 Task 页：正确的 Scope 当前任务集合、全局排序与计数、未归档历史 ID 定位、最近三轮真实 Agent 对话、继承 Main CoT 状态、稳定阅读位置及 Shared 独立目录验证。固定 `@earendil-works/pi-tui@0.87.0`、Node/TypeScript，Main/Task 整屏切换，仅保留两份已有草稿。宽屏只增加容量；Main 活动区不出现在 Task。

不增加 Task 直接创建/聊天、Scope 管理、第四轮历史、轮次选择器、详情草稿表、普通日志入口、自动关闭计划、调度器/工作区重写、清理/迁移/沙箱或新推送通道。授权/问题操作属 #92；取消/失败处置属 #93；产物/open/图片属 #94。AC33 只覆盖前段。已知 #83 缺项不能转移到 #84。

## 2. 源码事实

- `tui/remote.ts` 只读一页 Task（50）及一页 Scope（100），Scope 只保留名字；`tui/app.ts` 明示为按创建顺序的基础列表。只重排客户端当前页不满足本批。
- `application-service.ts` 已有 tasks、详情、请求、Execution 和 Scope 查询。Task 已提供计划状态、活跃执行状态、最新状态及待执行请求数，但没有所需当前集合判定、调度投影、计数和排序；通用分页按首次 journal sequence，而非最近执行时间。
- `WorkScope` 没有 created_at。`Store.projectionFrames` 保存首次 mutation 及其 committed_at；`firstSequence()` 也由重放产生。使用真实创建证据，不使用可变 updated_at 冒充。
- `execution-runner.ts` 在 message_end 持久记录按 task/execution 归属的 **agent.message**，并保存 checkpoint。事件 ID/sequence 可作为不重复的真实对话来源；不可拼接不同 Context/checkpoint 快照。Context.message_id 每次捕获重新生成，不适合跨快照显示身份。
- Execution 已有 started_at、ended_at、真实状态、waiting/unknown ID、留存状态；TaskPlan 已有 next_due_at、pending requests/occurrences、trigger/executor、初始化错误。`terminal()` 不把 RESULT_UNKNOWN 视为终态。复用调度语义，不能只相信 ACTIVE 或 active ID 数组。
- sync 已因执行/attention 变化失效 tasks；Scope 目前只失效 scopes，agent.message 目前失效 timeline。本批补必要映射，复用同一通道。
- #91 已有原始斜杠来源识别、富草稿、有限驻留历史/正文、源码位置锚点、Markdown 渲染、Main history.thinking。复用而非复制 Main 发送机制或新增独立 CoT 偏好。当前命令正则不含 `_`，须窄化扩展以接受 `/search_task`。

## 3. 当前集合、时间、排序与计数

在 Core 内增加小型只读投影模块，由 ApplicationService 调用；必要时复用/提取小型纯 attention 和 actionable-failure helper，保留现有消费者行为，测试与业务规则一致并登记有意增加的 deadline 显示规则，不扩大调度重构；列表、定位、补全、详情使用同一事实来源。TUI 只通过公开 CoreClient 查询，不直接导入业务实现或读 Store/数据库。

### 当前集合判定

可浏览任务满足以下任一条件即属当前：

1. 存在真实未终结 Execution：CREATED、WAIT_PRECONDITION、READY、DISPATCHING、RUNNING、WAIT_DECISION、WAIT_AUTH、CANCEL_REQUESTED、RESULT_UNKNOWN；即使计划 PAUSED/CLOSED 也不能隐藏其工作。
2. 本 Task 的 pending_requests、pending_occurrences 非空。按真实对象去重，保留身份及到期时间。pending_followup_ids 不单独构成当前理由：它可能指向另一个 Task；同 Task 复用已由 pending_requests 表示。只有跨 Task 后续引用的终结父任务属于历史，详情可只读展示关联。
3. 有效后续工作：state=ACTIVE、trigger.kind 属 AT/INTERVAL、next_due_at 非空且可解析，并且无 deadline 或 deadline > max(as_of,next_due_at)。登记为显示资格规则：已超 deadline 或到期时间不早于 deadline，不是有效后续调度。现有 tick 没有这项资格检查，仍可能先创建再将该轮 EXPIRED；真实排队/非终态/失败对象仍按其他规则显示，不修改 tick。IMMEDIATE 后续工作只来自 pending_requests，其初始 next_due_at 为 null。EVENT 在此基线仅为 schema 变体，没有支持的创建/订阅链路，单独不产生当前资格；不虚构 disabled/armed 字段。PAUSED 单独不是后续工作；ID 查询说明 deadline 不满足或调度不支持的事实。
4. INITIALIZING/INIT_FAILED，或本 Task 的 Execution.unknown_operation_ids 非空，或使用现有 attention 路由精确条件：AuthorizationRequest.state 属 PENDING/APPROVED 且 expires_at 无或 > as_of；DecisionRequest.state=OPEN、deadline 无或 > as_of、所属 Execution.state=WAIT_DECISION。先校验 execution/task 归属及当前 session 权限。APPROVED 表示等待消费，不是让 Master 再批准。失败按 activity.ts 既有规则：FAILED 直到被同 Task 更新创建的执行替代（journal 创建顺序，不是界面 invoked_at 排序）。不虚构失败处置标记；失败一次性任务可持续当前，直到被替代或后续 #93 处理，A1 数据须计入这一事实。执行结束会让问题过时，但不会清除授权，因此可能留下无过期时间的 PENDING/APPROVED；仍镜像现有 attention 规则并计入当前，处置留给 #92/#93。这类样例不要混入 4/3/2 数据，除非有意计数。普通一次性成功且无剩余理由，即使 ACTIVE 也属历史。

登记并测试下表。这些是投影规则，不表示每种组合都能通过现有公开 API 产生。此基线的 PAUSED-with-work/CLOSED-with-work 使用明确标为 SEEDED 的隔离 Store 记录；不为构造它们新增暂停/关闭 API。真实 PAUSED-without-work 可通过创建 AT Task、停止隔离 Core 直至超过到期时间、再重启产生。只读判定不修改计划、attention、留存或队列。若现行业务没有“已处理”标记，保留真实未解决事实并说明操作尚不可用；处置属 #93。

| 输入（除明确列出外无其他理由） | 当前与证据类别 |
| --- | --- |
| ACTIVE 一次性成功、队列空、无 attention | 否；真实公开流程 |
| 自己的 pending request/occurrence，包括 PAUSED | 是；暂停组合为 SEEDED |
| 终结父任务只有另一个 Task 的 followup | 否；单独计子 Task |
| ACTIVE AT/INTERVAL、有到期时间，无 deadline 或 deadline > max(as_of,due) | 是；真实调度 |
| 无 due、仅 EVENT 变体、deadline <= as_of 或 due | 不因调度单独计入；EVENT 为 SEEDED/不支持，真实工作仍计入 |
| PAUSED 无工作 | 否；真实恢复场景 |
| PAUSED/CLOSED 加非终态/队列/attention 字段 | 是；SEEDED 投影覆盖，不是公开流程/原生证明 |
| INITIALIZING / INIT_FAILED | 是；保留初始化错误 |
| 最新创建的 Execution FAILED，与留存状态/对象可得性无关 | 是，直到被替代；可得性只影响详情，不写 viewed/留存 |
| 旧 FAILED 已有同 Task 新执行，无其他理由 | 不因旧失败单独计入；新工作独立判断 |
| OPEN 有效问题且 WAIT_DECISION；有效 PENDING/APPROVED 授权 | 是；批准后为等待消费；仅已过期/失效/消费则否 |
| 执行已结束但授权仍为未过期 PENDING/APPROVED | 按既有 attention 规则计入；不自动到期/处置，留给 #92/#93 |
| RESULT_UNKNOWN、非空 unknown ID、CANCEL_REQUESTED | 是；保留真实 ID/状态 |

每个 Task 只出现一次。分别展示计划状态、executor/trigger、实际执行/等待状态、队列数量、最新结果与 current_reasons，含真实 ID 和目标。时间均明确标注含义：执行开始、尚未开始时的执行创建、下次调度、排队到期、结果观察时间。UNKNOWN 保留可定位 operation/execution ID，不提供裁定或重试入口。详情只列已实现的导航/阅读操作。

### 时间与稳定排序合同

- Scope.created_at 来自首次 Scope mutation（expected_revision=0）的 committed_at，附 created_sequence 来源。校验首次 mutation 后直接使用 projectionFrames[firstSequence("Scope",id)-1].committed_at，复用重放的 firstSequence，不增加冗余创建索引。首 revision 的 updated_at 只可作为历史来源证据，不能替代事务创建时间。创建证据缺失时返回 null 和原因，排在已知时间后并标明未知，不编造或补写。
- Execution.created_at 同样来自首次 mutation；invoked_at = started_at ?? created_at。保留两者和排序来源。活跃组必须有真实未终结执行；按该组这些执行的最大 invoked_at 排序。仅排队组仍属当前，但不冒充运行中组。
- 活跃组在前，时间倒序，同值按稳定 group ID 升序。其次为无活跃执行的普通组，Scope 创建时间倒序、null 最后、Scope ID 升序。无活跃执行的逻辑 Shared 固定最后；有活跃执行的 Shared 正常参与活跃排序，不伪造创建时间。同值使用不冲突的逻辑 ID shared:null，普通组用 scope:<id>。长期 RESULT_UNKNOWN 在此定义下仍属活跃层，层内位置取其不变的 invoked_at。
- 组内按最近执行的 invoked_at 倒序；无 Execution/null 最后；同值 Task ID 升序。最近三轮也按 invoked_at 倒序，同值 Execution ID 升序。明确尚未启动与相同时钟的规则，不用无关更新时间。
- 归档 Scope 及其任务不进入浏览；只显示 Archived Scope 数量。具名 kind=NONE 实体仍为普通 Scope，只有 scope_id:null 属 Shared。
- 页头 Scope 数只计有当前 Task 的非归档普通组。各组计数只含当前 Task；Shared 有本组数但不进入页头 Scope 总数。不新增全局 Task 总数。本实现省略空/仅历史组；历史定位在当前分组之前放一个明确标注的临时结果区，即使原组不存在也显示真实 Scope/Shared 名称，不改变任何当前计数；新查询替换该临时区。

对**完整授权集合先判断、计数、全局排序，再分页**。Scope 标题和 Task 行组成扁平有序序列，跨页延续标题携带完整组计数。计数和行使用同一投影 revision。起始每页 50 行、最多 100、响应不超过 256 KiB；长目标明确为预览，必要时详情分片提供全文。客户端最多驻留 200 行元数据，锚点可重新定位，不常驻全部历史；已加载长度不能当总数。

## 4. 拟新增公开只读合同

以下是**计划接口，并非已经存在**。复用现有 query/service 和游标机制；增加窄范围浏览投影，不改变已有 tasks/scopes 管理查询语义。均带 `/api/v1/` 前缀及 owner 鉴权。

| 方法/路径 | 拟定数据和语义 |
| --- | --- |
| GET task-browser | limit、cursor、direction；全局排序标题/任务行、完整普通 Scope/Archived/Shared 计数、投影 revision、前后游标、针对过期事实的 as_of/valid_until。 |
| GET task-browser/locate | 原样 task_id，match=exact 或 prefix，limit；查询当前及未归档历史全量集合。返回唯一目标及周边当前行/游标，或标注历史行；歧义/不存在明确报错。suggest=true 仅返回有限 ID 补全候选，不执行；完整匹配优先，唯一性须查完整可浏览集合（排除归档），不能只查候选首页；归档对象同前缀不应使唯一可浏览目标变歧义。 |
| GET task-browser/{task_id} | 可读详情：完整目标/提案展示、当前理由/状态/调度/结果、最多三轮最新执行描述、历史可得性、真实只读操作。轮次字段含 ID/kind/state/retention、创建/开始/结束时间和排序来源。大文本通过本路径绑定游标的详情分片读取，不静默截断。 |
| GET task-browser/{task_id}/executions/{execution_id}/messages | limit、cursor、direction、message_id（around 定位）、thinking；最近三轮之一的事件消息，包含 source ID、role/time、outcome/availability、revision 和正文游标。默认 50、最多 100、≤256 KiB。 |
| GET task-browser/{task_id}/executions/{execution_id}/messages/{message_id}/content | cursor、thinking；有限正文/工具/CoT 分片、满足既有源码锚点和长正文读取的 offset/availability。不暴露任意文件路径、原始 Context、凭据或隐藏 provider 元数据。 |

每次浏览定位/详情/消息/正文读取（含 cursor）均重查 Scope 可见性及 task→execution→message 归属。完整 ID、旧 cursor 不能绕过归档。通用 Core 管理 API 保留既有业务语义；错页命令不能写入或转交 Main。

游标签名且不透明，绑定 owner/instance、route、筛选、投影 generation、thinking；正文再绑定消息/内容 revision。成员/排序变化让旧列表 generation 可恢复地 reset，不静默漂移。由 ApplicationService.sync 的 frames 增量维护可重建投影，只有相关事实变化才失效成员/排序。列表 cursor generation 是有序 row keys 和页头/组/归档计数的 digest，不能绑定 Store sequence 或原始 Execution revision：每次 agent.message 会更新 checkpoint revision，不应让列表持续 reset。行展示 revision 可原位刷新，不改变分页 generation。仅缓存当前投影，不保留无界快照族。reset 后按稳定 task/row ID 重定位，原子发布新页及计数。异步结果检查 instance、页/详情身份、mode、generation；无关 Main 消息不能持续打断 Task 列表。过期变化由 valid_until 和已有刷新机制处理。valid_until 必须同时覆盖规则 3 有效计划的 deadline，以及相关授权/问题到期时间；增量缓存只存事实，查询时按 as_of 计算时间条件。即使没有其他 sync 事件也在最早成员变化时间刷新，再计算排序键/计数 digest。

选中任务完成时作为明确历史定位行保留，当前数正确下降；归档时清除缓存行/详情/消息并解释不可用，不能继续提供缓存对话。对象消失时选取记住的存活邻居并提示，不能按行号把命令转向别的 Task。换视图取消/忽略旧请求。分页错误保留已读内容和草稿，允许重试但不循环。

先修改正式 `docs/api/v1/schema.json`、`operations.json`，再 `npm run api:generate`，不手改生成 DTO/OpenAPI/contracts。若确需业务 schema 修改，则改源定义并 types:generate；本计划创建时间方案不需要持久迁移。api-coverage.md 和 PR 登记实际方法/路径/字段及全部相关未用接口。拟定名称若调整，必须在中英文计划及复核记录中保持等价语义。

## 5. Agent 历史与同一 CoT 状态

复用 Store.executionEvents() 按 execution 索引不可变 agent.message，轮内按 journal sequence。显示 ID 基于 execution + event ID，不能仅按文本 hash 或重建 checkpoint 中的下标；相同文本的不同消息必须保留，工具调用/结果关联正确。展示真实支持的 user/assistant/tool 正文、工具调用、可显示的已持久推理；不支持/非文本内容如实标注，不暴露内部结构。不能用 Main feedback、TaskResult.summary 或 checkpoint 拷贝冒充对话。

详情初始定位最新 Execution 标题；最近最多三组按新到旧连续显示，每组内部消息按实际时间顺序。不足三轮显示实际数量；程序执行明确无 Agent 对话。不增加轮次切换器或第四轮入口。新一轮到达后更新三 ID 集合，锚点仍在集合内则保留；若已被挤出，明确提示并定位最近保留组，不把第四组继续留为可浏览区。原文引用早期工作保持原样。

正常 agent.message 持久事件不依赖当前压缩快照。旧记录无事件、缺口、缺 CoT、对象不可取时说明事实，不重构未记录思考、不启动 RETIRED、不延长留存、不调用 executions/{id}/viewed、不请求模型生成摘要。启动/重连从权威 journal 重建事件索引；缓存不产生业务记录。

每页 50 条消息；Task 三组合计最多驻留 200 条消息元数据与 4 MiB UTF-8 正文/CoT。未加载/淘汰部分可补读，限制不缩减可读全文。渲染、正文、检查点缓存一并有界；Task 的 4 MiB 额外于 Main 原有 4 MiB。两页共享 RemoteViews.query 的最多两个读取，不增第二读取池。参数化 tui/body.ts、tui/remote.ts 中硬编码正文路径；语义适用时复用既有 Message DTO，复用 visibleThinking/thinkingPreview 排除 redacted reasoning。复用 #91 长 Markdown/block reader 及已接受的异常格式提示。锚点含 task ID、execution ID、event/message ID、body/tool/thinking 区域、source offset 和折行位置，不是绝对行号。沿用 Unicode/终端转义安全处理，不切断 grapheme。cursor 过期、mode 改变、重启时先按消息 ID 定位，再恢复 offset；需夹取或缺失时如实提示。

Main 独占 CoT 切换权；Task 消费 remote.history.thinking，或在不改变 Main 行为前提下提取为同一个共享状态。默认收起，显示已有摘要或前 20 个可显示 grapheme，沿用字节/安全限制，浅灰且与正文/工具分行。展开及新补读均继承同一状态。Task 调用 cotvisible/cotv 只局部报错、不改变模式；阅读/切换不产生模型调用或 UI/CoT 持久写入。

## 6. 导航、补全和输入

扩展唯一命令注册/解析/help；只有命令名不分大小写。允许已注册命令中的 `_`，不放宽整次提交语法。两个 ID 命令限定一个 ASCII 空格分隔、一个 [0-9A-Za-z-]+ ID token、可选尾随空格/Tab，不接受换行或额外参数，保留 ID 大小写。同步修改参数拒绝分支、isCompleteLocalCommand、命令名补全及独立 ID 参数补全；applyCompletion 只替换 ID token 范围，不重写整行。保留键入首斜杠来源与原始空白；粘贴或普通草稿末尾的 /T、/back 仍是正文。保留 #91 行内粘贴/多行行为和发送后处理。

- `/search_task <id>` 仅 Task 根页；完整或唯一短 ID 定位/高亮并滚入视口，不打开详情；歧义/不存在局部反馈，保留原位置。
- `/taskdetail <完整ID>` 在 Task 普通浏览态打开/替换根页之下的详情，保留列表锚点；验收用完整 ID，不承诺所有命令都接受短 ID。打开另一任务不叠加无界详情返回栈。
- 详情 `/back` 返回列表的 task-ID/source 锚点；Main/Task 根页静默无操作；保留现有 help 返回语义。/M、/T 恢复目标一级页最近视图/位置；重复当前页无操作。返回 Task 详情后仍能 back 回原列表。
- 根页及所有详情共用一份 Task editor/draft；普通文字留草稿，不发 Main/Agent。不增加按 Task 保存草稿。验收文字用正常编辑主动清空后再导航。不增加快捷导航或可选上键 Scope 筛选。
- 异步 ID 补全使用同一可见性及全量前缀判定；只编辑、不执行、不打开、不发送。按输入 generation 丢弃迟到结果；精确已注册命令提交不能默默变成另一命令；归档完整 ID 也不出现。
- 普通工具/读取错误在下一次主动编辑/导航/命令执行前清除，后台重绘不清除。持久 UNKNOWN/不可得事实独立。回归 Main/Task 富草稿、重连、明确发送后跟随和原生选择行为。

## 7. Shared 边界与批准后的实施顺序

Shared 仅为 scope_id:null 的逻辑组；复用 TaskPlan workspace 和 Execution workspace_binding。不同 Task 实际 cwd 不同；同一 Task 的续跑/周期执行可复用自己的目录。不增加共同 DIRECTORY 根、锁、全局串行或删除。隔离验收域中可只读核对实际 cwd/测试文件，公开浏览投影无须暴露私有绝对路径。

Master 批准后：

1. 固定环境/基线，实施当前集合真值表、创建来源、排序计数、归档策略及针对性测试。
2. 增补公开 browse/locate/detail/Agent 消息分片，含归属、大小、游标检查、sync 映射及生成合同；用真实 Core service 测试，覆盖重启和不可变 journal 证据。
3. 接入有界 Task 控制器、分组文档、锚点、命令/ID 补全、同一 CoT 状态；保留 Main 和输入适配器。
4. 复用验证单 Task 忙碌及 Shared 独立目录；只修已证实的本批缺陷，不靠隐藏后台失败或将不同 Task 串行达标。
5. 运行有效针对性回归、typecheck/docs/full npm run verify，使用既有隔离 PostgreSQL；macOS CI 纳入 #83，保留 Linux 全量。同步正式运行/测试/API/中英文证据及真实按键版本参数。
6. 完成下列原生与**真实模型**矩阵，保留首败、修复并补相关验证；创建实施 PR，完成精确 HEAD CI；将 SHA、diff、证据、限制交同一 Claude Opus 5.5 Extra 往返复核，再交 Master 终审。不自动合并或关闭。

## 8. 验收门槛

全部产品项初始 **NOT_TESTED**。记录实施 SHA、OS/Terminal/Node/pi-tui、字体/IME、80×24 与 120×40、实际按键（既有 Enter 换行、Shift+Enter 明确提交、Ctrl+C 退出；补全可能消费其接受键）、隔离 Core identity 和真实对象 ID。fixture/headless/PTY 与物理原生输入证据分开；读源码不等于独立执行。

| 项目 | 必须证据与失败边界 |
| --- | --- |
| A1 / AC10–12 | 完整 issue 数据：A/B 活跃，C/D 定时且 Scope 创建时间不同，空/仅历史/仅暂停组，Shared 3 当前 Task，2 archived，无 Execution Task，超过一页。普通 Scope=4、Shared=3、Archived=2。调起另一组、修改旧 Scope 无关信息、旧定时 Task 新执行、翻全页并查历史；全局排序/数值与 Core 相符，历史查询不抬高计数，覆盖不同异常；PAUSED-with-work/CLOSED-with-work 明确为 SEEDED 投影项，不宣称真实公开流程。PAUSED 无工作用真实 missed-AT 恢复；失败一次性/跨 Task 父任务样例不能意外破坏预期 4/3/2 计数。 |
| A2 / AC14 | 完整、唯一短、歧义、不存在、未归档历史 ID；归档完整 ID 查询/补全/详情/消息/正文/cursor；Main 错页；详情/请求途中归档。增加一个前缀同时匹配一个可浏览 Task 和一个归档 Task，须定位可浏览者。不能猜测、绕过、仅查当前页或产生业务写入。 |
| A3 / AC15、AC01 | 一个 Task 至少四轮真实 Agent execution，各有不同标记；最新三轮含跨消息页和正文页的长对话。核对三轮及无第四入口、不足三轮、程序任务、返回锚点、切任务、富 Task 草稿保留且不发送。读取失败/重试、模式/reset、缓存淘汰重读不能丢文。 |
| A4 / AC05 Task | 使用已合入 #91 Main 开关：展开进 Task 补读；Main 收起再返回；Task 直接命令报错。真实有/无 CoT 如实显示，锚点稳定，不产生显示引起的历史/模型写入。缺前置或证据则不能完整关闭。 |
| A5 / AC13 | 真实首轮未终结时出现下一次定时触发及继续请求，Core/TUI 对照；同 Task 至多一轮非终态，同 Task 继续请求应拒绝 TASK_BUSY，INTERVAL 定时项在 overlap_policy=QUEUE 下排队，只计一个 Task；不同 Task 不强制串行。 |
| A6 / AC33 前段 | 经真实 Main 建两个无 Scope Task，各写不同标记 report.txt；记录真实 task/execution ID、实际不同 cwd、两份内容/hash、Shared 分组及完成后的 ID 查询。无覆盖/共享锁/删除。产物列表、只登记产物、open 仍属 #94、NOT_TESTED。 |
| A7 / AC24、AC28、AC31 | 真实 macOS 中文 IME、命令大小写/ID 原样、补全只编辑、原始斜杠/粘贴命令回归；下一次主动操作清普通错误。在安静隔离域对比导航/help/滚动/CoT/补全前后相关 journal/message/model-call 边界，区分后台变化和 UI 写入。 |

### 实施后强制真实模型验证

使用隔离可丢弃 Core 数据域和私有证据目录、已授权 provider 配置/凭据（不打印），经过生产 Core adapter/Task executor。启动前登记实际 provider/model 和有效预算；保留预算 guard，依 #91 已修 harness 在持久捕获前设定上限；启动前登记有限请求/工具/token/时长预算、周期场景 deadline 及本任务进程句柄。此基线无公开暂停/关闭 API；deadline 本身不停止 occurrence 创建，所以捕获完毕或达到预算/时限就停止隔离 Core。长执行期间每个周期可能继续入队（最小周期 1 秒），选择 interval/deadline 使捕获后多余队列到期而不是继续实际运行，同时仍停止 Core。missed-AT 恢复产生 SCHEDULER input，可额外触发真实 Main 模型回合，须纳入调用预算；A7 将其归为后台变化而非 UI 写入，待真正安静窗口再比较。不重放旧预算不匹配的冻结域、不偷偷换 fixture。provider 失败记 FAIL/BLOCKED 并保留首败，不合成 PASS。

- **L1 Main→Agent 历史：**真实 Main 请求创建 Agent Task，通过合法继续/调度取得至少四轮真实执行；记录公开 ID、agent.message 身份及 provider 请求/status/outcome 元数据，将最新三轮 UI 的独特正文/工具标记与持久记录逐项对照。有意产生足够消息和长正文跨页；若真实输出未跨界，则该 live 子项保持 NOT_TESTED 并安排后续有限真实工作，不能伪造日志。fixture 可补充排序边界，不能替代该链路。
- **L2 Shared：**A6 必须经过真实 Main 和真实 Agent 文件操作；实际检查 cwd 与两份同名文件，不能用 Main/模型自述作为目录证明。
- **L3 忙碌与 CoT：**对真实运行 Agent 执行 A5，记录真实排队/忙碌及时间重叠。支持时验证真实持久可显示 CoT；所选 provider 没有可显示 CoT 则保留该事实，并另取得支持的真实模型运行后才能宣称正向分支通过。不推断或制造隐藏推理。
- **L4 只读与重连：**真实工作安静后浏览/翻页/切换/搜索，对比 model-call 和业务持久记录；受控重启一次 Core，以同一批记录验收 cursor 恢复，不重跑 Agent、不延长留存。原生锚点/草稿与 HTTP 证据分开观察。

适度复用 test-issue91-live.ts、task-reuse/API harness，必要时增加聚焦 #83 driver，不改普通生产配置。只停止本任务 harness 进程；首败、私有对话、测试目录保留到获准清理。公开证据仅脱敏 ID/status/hash、计数、版本和相对证据引用，不含密钥、凭据化 endpoint 或无关个人内容。

代码/CI、真实 provider、Claude 精确 HEAD、原生人工验收、Master 合并授权、合后 CI、Issue 关闭分别登记。AC33 产物/open 段仍不在本批。计划阶段不宣称产品验收。

## 9. 复核与回退

原始请求/回复/时间/截图保存至 Git 忽略的 `.demo-data/issue83/review/`，仓库仅记录脱敏结论、采纳/异议。向指定模型提交完整英文计划及仓库/Issue URL；首读十分钟后，后续如需每五分钟读取。不未经 Master 更换模型/provider。

计划实施为新增只读 API 与客户端行为，不迁移持久 schema、不清理用户数据。回退只停止 TUI 并恢复旧客户端/代码，保留 Core 记录、草稿、Task 目录；投影缓存可重建。如实际发现必须改持久模型或扩大调度修复，先记录具体差异并重新复核/批准后再改变该边界。


## 10. 最终计划复核

Claude Opus 5.5 Extra R2 结论为 **PASS**，B1–B4 全部关闭，中英文实质一致。结论只表示可交 Master 批准计划，不授权实施或合并。Reviewer 阅读了源码及完整计划，没有运行代码/测试。非阻断 N1–N5 已纳入上文：残留授权、计划 deadline 的 valid_until/查询时判定、与留存可得性无关的失败成员资格、missed-AT Main 调用预算、周期队列成本控制；Reviewer 明确无需 R3。产品、真实模型与原生验收仍为 NOT_TESTED；下一步等待 Master 批准。


2026-10-31: Master explicitly approved R2 implementation, real-model validation, the same Claude implementation review, PR and CI. No merge is authorized. / Master 已批准按 R2 实施、真实模型验证、同一 Claude 会话复核及 PR/CI，未授权合并。
