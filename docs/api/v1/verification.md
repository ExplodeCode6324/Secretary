# Issue #8 验证与边界

当前状态：已补齐真实工具执行、API 产物下载和独立验算，严格补充验收通过，详见末节。此前记忆进程重启结论保留。初轮失败完整保留；PR 仍等待 PERRI 独立复审和 Master 终审。

改动前固定分支 HEAD 为 `f8dbddcf4338914c1d264efff0fd26d5bc07c2cb`，远端 main 为 `38daab6cbbccf9f6a85071ff5933eaa198d77de8`。固定 Pi 子模块 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`。首次缺少子模块的类型失败与初始化后结果分别保留。runtime 基线 167 项：162 通过、5 跳过、0 失败；类型检查通过。

原始日志、临时 PostgreSQL、合成崩溃工作目录保留于本机临时位置或测试后清理，不提交真实会话、身份、数据目录、凭据或运行快照。数据库测试使用单独初始化的 loopback PostgreSQL，并且只写合成数据。

## 测试责任映射

| 原验证内容 | 新版验证位置 |
| --- | --- |
| TUI/Web 双客户端共享后台与关闭独立性 | `issue8/api.test.ts` 的并发 detached Core 启动、两客户端、退出/停止/重启 |
| 文本命令、旧 routes/static/SSE | 旧兼容断言退出新版范围；API 认证、旧路由拒绝、严格 body 验证替代；可靠 SSE 属于 #9 |
| 预览先于持久结果、可见思考过滤、call ID、重启历史 | 原 `streaming.test.ts` 保留断言并改为 API v1 timeline/command；消息签名与 redacted 内容仍不暴露 |
| 活动状态、并发慢查询、无输入泄漏 | 原 `activity.test.ts` 改为活动详情与 World 慢查询；保留在途活动投影与无泄漏断言 |
| 历史分页、定位、限制、无旧正文扫描 | 原 `activity-history.test.ts` / `timeline-window.test.ts` 使用新版接口，底层大历史 oracle/性能断言保留 |
| Settings CAS、有效说明不提前改变、非法文本、显式 apply | 原 `instructions.test.ts` 通过新版 draft/apply 运行原断言 |
| 记忆恢复来源、一次授权和期限 | 原 Issue #4 的 Host/expiry HTTP 用例迁移到新版受理/对账，保留原 owner 提交、提取次数和过期拒绝断言 |
| 纯详情查询与显式续留 | `issue8/api.test.ts` 比较查询前后 Execution 整条记录；viewed 增加 revision，RETIRED 不复活 |
| 命令崩溃一致性 | `issue8/crash.test.ts` 真正 SIGKILL：消息/任务/审批/Settings 在 fsync 前和 fsync 后、内存安装前各一个故障点，长命令在 QUEUED/RUNNING 落盘后分别 SIGKILL；重启验证受理与领域变更同帧，无重复执行 |
| API Schema / Swift | 生成 DTO、响应实例校验、固定合成示例、Swift Codable 解码；超出 JS 精确整数范围的版本字符串及未知字段保留 |
| World 精确槽、目录、版本与数据库领域回归 | `issue8/world.test.ts` 加原 World/Settings/边界套件，在隔离 PostgreSQL 运行 |

仅三个特定旧 UI 验收保留为显式 skip：dual-ui 的 TUI 进程 UI 文本，web 的旧 UI 共享协议，web-render 的旧静态 allowlist；它们不代表新协议缺测。Markdown 安全渲染、底层 TUI 领域测试仍运行。新版本不恢复旧路由来让旧兼容断言变绿。

测试中曾发现并修复：通用投影错误处理审批参数/任意 JSON 中的同名元数据字段（已保留参数原值并加入断言）、API 活动详情遗漏实时投影、旧测试调用已移除路由、混合时间线把活动条目误计作消息。首次失败日志未覆盖；更正后验证相同业务断言。取消请求使用既有 `CANCELLED_OR_REJECTED` 状态，并额外断言 `MASTER_CANCELLED` 原因。

## 交付边界

初次交付尚未调用真实模型；本次追加授权的 online 验证见下节。此分支没有部署现有实例、运行生产数据迁移、操作 Portable 或实现 SwiftUI。UI 字体与比例、真实网络接入、原生用户体验与可靠事件补发分别留给后续工作。长命令在未知中断后不会自动重发；外部效果必须基于原领域记录核验。

数据库第二次复跑时复用了上一轮合成库，固定 fixture 的 source_key 冲突导致旧 World 用例拒绝；改用全新隔离数据库验证，不修改原领域断言。

文档检查已有缺失历史报告/迁移目标的基线错误；交付报告按错误集合比较新增与消失项，不伪报全部通过。最后执行的精确测试数量附于 fix 计划。


## PERRI 四项复审缺陷的修复

修复基线 `a1b69ec35436d1c727748c4ad2e6c0c206424769`；修复代码与永久回归提交 `ee386efe953b8319f4e83a5a44e263062f55e590`。仍在 draft PR #15，等待 PERRI 独立复审和 Master 终审。

| 项目 | 修复与永久验证 |
| --- | --- |
| 历史决定 request ID 被新命令重新占用 | 从 journal 的 DecisionRequest.answer_request_id 重建占用索引。MASTER/MAIN × 重开前后四个 HTTP 用例必须返回 409，名称和 journal 序号不变；既有 API 相同请求回执重放仍通过。 |
| PostgreSQL 时间变成空对象 | Date 输出 ISO 字符串；真实数据库和 HTTP 对照 entity/fact 的时间与 null。 |
| 自定义 predicate schema 键被删除 | value_schema 原样输出；SQL 写入含 entrypoint/workspace/payload_ref 的合成 schema，经 HTTP 取回后检查精确相等及值校验。另断言 Program schema CAS 引用继续隐藏路径。 |
| TypeScript 公共类型缺失 | 生成用 namespace 展开全部 66 个命名定义，公开 ApiV1 根语义不变。外部消费者编译 47 种操作 request/response 和所有定义，并有错误字段/类型的负向断言；不以重复生成成功替代消费验证。 |

首次针对性运行 7/7 失败；修复后同一组 7/7 通过。随后增加的日期与 schema 引用隔离用例也通过。日志、基线全文件哈希及后续重跑结果留在私有本地证据目录。

全套验证同时并行时出现 5 个首次失败：runtime 的 activity/TUI 等待超时两项，Issue #2 两项 SIGKILL worker 在固定 20 秒期限被 SIGTERM，API DTO 流程一次 fetch failed。随后各套件依次运行；未改变原断言、超时、重试或生产 HTTP 代码。首次 fetch 未记录 cause，不能断言其根因已确认，也不能把这次失败从记录中删除。

记忆恢复边界：已有 Issue #4 的 expiry-host/evidence-expiry 回归证明未消费票据重开后失效，而已消费回执仍可重放。API QUEUED 的调度不绕过此校验；本轮检查代码与既有回归，未新增该 API 特定崩溃窗口的独立复现，不列为第五个已修复缺陷。

PERRI 提供的原始复现 ZIP 未能导入：当前 Mac executor 无 Library materialization 工具及对应技能，无法验证归档 SHA-256。本节 red/green 来自本机独立永久回归，不声称运行过原 ZIP。


### 最终离线验证

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test`，独立复跑 | 167 项：159 通过，8 跳过，0 失败；跳过原因仍为 5 个未配置 PG、3 个已退出旧 UI 兼容范围 |
| `npm run test:api`，独立复跑 | 32 项：30 通过，2 个 PG 用例在数据库套件运行，0 失败 |
| Issue #2–#5 全部 offline，独立复跑 | 183 项：181 通过，2 跳过，0 失败 |
| 新隔离 PostgreSQL：API World + runtime World/Settings/settings-memory-boundary | 14/14 通过，无跳过；临时服务已停止 |
| API 再生成 / 外部 TypeScript 消费者 / Swift 示例 / diff whitespace | 均通过；生成文件内容哈希不变 |
| `npm run docs:check` | 49 个继承错误，较本轮基线新增 0、消失 0；不宣称文档检查全绿 |

### 初轮独立 Astra/high 有界 online（保留原失败）

使用现有 OpenCode 配置和已有私密凭据，未修改部署配置；全部为合成数据及隔离 Store，无设备访问。三轮运行的 10 个生产文件哈希均与修复代码提交一致。总共 12 次实际 HTTP 尝试（均收到 200，但 HTTP 成功不等于业务验证通过），达到上限后停止；每请求 90 秒、输出最多 4096 token、上下文最多 80000 bytes。实际运行合计 90.863 秒；首个到最后一个请求含离线排查为 346.758 秒，均在 15 分钟内。

| Provider / 模型 | 角色 | 真实请求 | token 合计 | SDK 目录费用估算 USD |
| --- | --- | --- | --- | --- |
| opencode-go / deepseek-v4.1-flash | main | 11 | 25,814 | 0.007439172 |
| opencode-go / gpt-5.6-luna | task | 1 | 833 | 0.000266600 |
| 合计 | | 12 | 26,647 | 0.007705772 |

输入 8,771、输出 10,452、cache-read 7,424，cache-write 0；推理 token 已包含在输出，不重复累计。12 次请求都有 usage；真实账单费用不可用，目录估算不等于实际收费。

**初轮 online：NOT PASSED / PARTIAL COVERAGE。**

- 已通过：API 主会话；第一个算术任务的 TaskDetail 与持久 Execution 成功、结果 42；Settings APPLIED；真实模型在设置后仍记得合成事实并遵守英文说明；显式重试后的真实整理达到 COMMITTED；同一进程内关闭/重开后 session 身份一致。
- 第一轮（4 次请求）：测试脚本只在最终 payload 限制输出，未同步上游整理预算，被 `CAPACITY_OUTPUT_LIMIT_CHANGED_BY_ADAPTER` 在发送前正确拦截；第二段任务未成功。另有一次 loopback fetch failed，原 cause 未记录。不能据此断言生产任务接续存在已确认缺陷。
- 第二轮（5 次请求）：测试进程在 App 打开前统一输出/整理预算为 4096，loopback 仅在 harness 中使用 Connection: close，无自动 HTTP 重试。设置及事实/语言 oracle 通过；真实整理候选被原 `SUMMARY_PRIOR_BOUND_EXCEEDED` 校验拒绝，自动验证重试在发送前被测试策略阻止。
- 第三轮（3 次请求）：保留第二轮失败目录，仅复制其合成 Store 到新私密目录，通过显式 API 整理及原有验证重试完成摘要与提取，原边界不变。重开后准备真实回忆时预算已耗尽，被 harness 在传输前阻止；这不证明生产恢复失败。
- 未通过/未验证：完整两执行任务链；整理并重开后的真实回忆。不得计为端到端 online 通过，不转嫁给 #9–#14。若继续验证，应在核准的新有界预算内补足这两个场景。

原始上下文、响应、运行身份、endpoint 和 Store 均不入库。online 不覆盖 World/PostgreSQL（已由独立离线数据库套件覆盖）、OS 进程重启、可靠 SSE 或真实长期记忆质量。原始输入锚点可能保留，不声称只靠摘要完成回忆。

#9 的持久同步，#10 的 SwiftUI，#11 的真实设备接入，#12 的 EVENT，#13 的远程执行及 #14 的模拟界面仍是独立后续范围；本轮四项缺陷全部在 #8 修复。交付保持 draft、等待独立复审，不合并、不关闭 Issue。


## 前次追加验收：执行关系与进程重启（产物覆盖不足）

基线 `e150e37c47a044a3835567044b43914ad55ffa4a`，仍由独立 Astra/high 子代理在 Mac 使用已有 OpenCode 配置执行。此次仅修改 harness、worker 与文档；生产源码、公共 schema、依赖和原业务断言未变，原四项修复代码仍是 `ee386efe953b8319f4e83a5a44e263062f55e590`。两次运行的完整生产及 harness 源码哈希均与交付文件一致。

### 原失败分类

- 初轮第二段 TaskResult 错误为 LIVE_BUDGET_EXHAUSTED。此前零 HTTP 的 CAPACITY_OUTPUT_LIMIT_CHANGED_BY_ADAPTER 关闭了共享 harness 开关，导致任务尚未发出真实请求就失败；不是已确认的任务模型拒绝或生产任务接续错误。
- 第二轮整理的原始 items 为 1971 UTF-8 bytes，低于明确给模型的 2048 candidate_byte_limit；在宿主添加 item_id/source_refs/last_activity_at 后超过 prior_bytes。不能把 SUMMARY_PRIOR_BOUND_EXCEEDED 简写为模型违反已声明的候选上限。保留生产原来的两次验证及第二次 0.8 倍候选限制，不改断言。
- 初轮 loopback fetch 的 cause 未记录，根因仍未确认。追加 harness 使用 Connection: close、记录 cause code，不在生产 HTTP 中添加自动重试。
- 初轮重开后回忆未发出 provider 请求，属于预算阻止的未验证项；由本节新的真实进程重启场景补齐，原记录不改成通过。

### 新预算与实际结果

每个场景分别使用全新合成 Store、独立私密报告目录，最多 12 次实际 provider HTTP 尝试、600 秒；单请求 90 秒、输出不超过 4096 token、上下文不超过 80000 bytes。模型请求前的运行时预算与最终 payload 一致。允许原生产验证重试且计入总预算；记忆 prepare 最多使用 10 次，为重启后 recall 保留 2 次。没有使用旧失败 Store 重放或未知副作用。

| 场景 | 精确 provider/model | 实际请求 / 上限 | Token | SDK 目录估算 USD | 执行耗时 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 同任务两段执行关系（仅 summary） | opencode-go / gpt-5.6-luna（task） | 2 / 12 | 2,228 | 0.000712450 | 10.092 秒 | PASS |
| 整理后进程重启及真实回忆 | opencode-go / deepseek-v4.1-flash（main） | 7 / 12（prepare 6、recall 1） | 14,390 | 0.004744650 | 48.170 秒 | PASS |
| 本轮合计 | | 9 / 24 | 16,618 | 0.005457100 | 58.262 秒 | 两个场景通过 |

任务场景 usage：input 729、output 202、cache-read 0、cache-write 1297；记忆场景 input 8643、output 5747、cache-read/write 均 0。所有真实请求均有 usage，费用只为 SDK 目录估算，实际账单不可用。与初轮合计 21 次请求、43,265 token、目录估算 USD 0.013162872；没有在追加验收通过后继续调用。

任务场景通过 API 创建任务、提交父执行关联的接续和查询结果，按正常 Scheduler.tick/idle 推进；核验只有一个任务、两个不同执行，均为 SUCCEEDED，父执行 ID 精确一致，summary 为 42→84，两个执行均有真实 task provider 请求；当时未生成产物。聚焦任务生命周期，主会话通知消费与自动维护不在该场景覆盖范围。

记忆场景通过 API 发送合成事实、保存并应用说明、执行真实整理，确认 APPLIED/COMMITTED 与整理前事实/英文 oracle。旧 worker 正常关闭 Core/App 并退出 0，确认旧 PID 已不存在；新 worker 使用不同 PID 和 Core instance，打开同一 Store，session/data domain 保持不变。此后确实发出一条 main provider 请求，独立 oracle 再次校验项目名、代码、日期与当前英文规则。不是同一进程 App.close/open，也不是重启整台 Mac；使用 harness worker 的 Core 服务，不替代完整 CLI 部署验收。

两个场景均断言 Operation 和 AuthorizationRequest 为零。未验证 World、设备、可靠 SSE、自然长期记忆质量或仅摘要回忆；独立审计确认原始事实仍在回忆请求上下文中。没有更换模型、密钥或部署配置，没有放宽业务断言。

### 交付复核

本轮 `npm run check`、online oracle/预算预留/进程身份正负自检通过，0 次自检调用；`npm run test:api` 32 项中 30 通过、2 个 PG 用例条件跳过、0 失败。生产源码未改，上一轮 runtime 159/8、Issue #2–#5 181/2、隔离 PG 14/14 的完整记录继续保留，本轮不冒充重新运行这些套件。docs 仍为 49 个继承错误，无新增。

745 份原始失败与汇总证据逐文件 SHA-256 均未变化。新报告和真实运行身份保存在私有证据目录，公开版本仅保留本节汇总；精确本地路径交给 Master/PERRI，不提交 raw 会话、凭据、PID 或任务 ID。README 已移除“本分支未进行真实模型验证”的错误陈述。

上述两个限定场景通过；任务真实工具执行、非空产物与 API 下载独立验算当时尚未覆盖，不构成完整产物验收。原失败仍保留。交付状态为 WAITING_FOR_PERRI_REVIEW，独立复审后仍由 Master 终审；不合并、不关闭 #8、不部署。


## 严格补充验收：真实工具、API 下载与宿主独立验算

独立审计对 `b4549eb2c85908bad4c6cfdf0976dfc1f073060a` 确认：前次两段算术任务的产物为空，verified_by=NOT_VERIFIED，42/84 来自模型 summary。正确的执行父关系与 Store 对象散列不能证明工具执行或产物内容正确。本次保留该结果的有限覆盖和所有原报告，新增 `test_case/online/test-api-v1-artifacts-live.ts`。

| 原始断言 | 旧用例保障 | 新增场景对应证据 |
| --- | --- | --- |
| 真实工具执行 | task-reuse 仅 file.write，明确禁止命令；test-live 写出程序后由宿主执行 | 模型真实 write + bash；精确源码/命令/cwd/10 秒审批，持久 Operation 成功回执与 stdout |
| 审批保护 | test-live 使用错误 display_hash 后正确批准 | 新版 API 拒绝错误哈希，操作仍 WAIT_AUTH 且无回执，再批准精确动作 |
| 产物存在与身份 | task-reuse 检查非空产物、工作文件与 CAS 一致 | 每阶段程序和 JSON 两项；API 列表/元信息/内容、结果引用、task/execution、长度/ETag/SHA-256 |
| 独立验算 | test-live 在受限 VM 执行生成的 result.mjs，验证 total 三组输入 | 只以 API 下载字节进行独立算术验算和新目录程序复跑；第二段使用下载的 first.json |
| 接续与保留 | task-reuse 同任务 continuation_of、首段不可变及更多轮次/重开/独立任务 | 两成功执行、parent_execution_id 与 continuation_of、read 实际首段产物、续接后 API 重新读取首段确认不变 |
| 意外效果/结构化结果 | 原脚本精确写入许可、输出与结构化结果检查 | 精确文件/命令/源码许可、四项预期操作和产物、禁止重复 shell 或 UNKNOWN 重发 |

旧测试原样保留；新两段场景不替代原多轮/重开/独立任务覆盖，也不验证通用代码生成能力。预先批准的程序只包含运算及文件读写，不含 42/84 结果常量；产物不预填，必须由真实模型请求产品工具生成。产品 verified_by 仍为 NOT_VERIFIED；宿主验算属于独立测试证据。shell 生成 JSON 的 producing_operation_id 可为空，来源依据执行作用域、精确获批程序、shell 回执 stdout 与 API 下载散列共同确认。

本轮不重跑已通过独立审计的记忆场景。原始事实仍在重启后的真实请求上下文中，结论是进程重启后的持久连续性，不是仅凭摘要回忆。


本轮首次严格场景保留为 FAILED：7 次真实 opencode-go/gpt-5.6-luna 请求均收到 HTTP 200，但第 7 次模型 stopReason=error，provider 明确报告 token rate limit exceeded；此前 6 次 stopReason=toolUse。两次 file.write 与两次 shell.run 均有 SUCCEEDED/APPLIED 回执，没有 UNKNOWN；首段结果含两项产物并通过 API/独立算术检查，第二段 shell 已执行，但最终模型 submit_result 未完成，失败结果产物为空，因此不能计为完整通过。前 6 次已知用量 23,048 token、SDK 估算 USD 0.003875080；失败请求无可用 usage，不能把其用量或费用记为零。

定位为 provider 限流后，下一轮仅在 harness 加入请求开始间隔至少 20 秒，在全新 Store/工作区重新执行同一严格场景；不重放失败任务、不复制其产物，不改变任何业务或验收断言。每轮仍最多 12 次实际 HTTP 尝试/600 秒，单次 90 秒/4096 输出 token/80000 bytes 上下文。第一次失败源码与报告单独保存。


### 最终严格场景结果

第二轮 PASS：真实 `opencode-go / gpt-5.6-luna` 调用 7 次，均 HTTP 200、stopReason=toolUse，耗时 124.724 秒。用量为 input 21、output 854、cache-read 18221、cache-write 15258，共 34,354 token；SDK 目录估算 USD 0.005207920，账单费用不可用。实际请求开始间隔均至少 20 秒。两轮共 14 次实际请求；有 usage 的 13 次合计 57,402 token、目录估算 USD 0.009083000，另 1 次限流请求用量/费用未知。每轮均低于各自 12 次/600 秒边界，成功后未继续调用。

- 一个 TaskPlan、两个不同 Execution 均 SUCCEEDED；第二段 parent_execution_id 和 continuation_of 同时指向第一段。
- 模型真实工具链为 write → bash → submit_result；续接为 read(first.json) → write → bash → submit_result。四项 Operation 均 SUCCEEDED/APPLIED，两个 shell exit_code=0、无 timeout/signal/truncation，stdout 与 API JSON 下载字节完全一致。
- 错误 display_hash 返回 HTTP 409，未授权或执行；四次正确批准仅开放精确合成操作。两阶段各两项 TaskResult 产物，API 结果引用、列表/元信息/下载 HTTP 200、长度/ETag/SHA-256 及任务/执行归属全部吻合。
- API 下载的 first.json 独立验算为 17+25=42；second.json 的 source_sha256 等于实际第一文件 SHA-256，source_result=42，独立验算为 42×2=84。下载程序在全新 oracle 目录重执行，生成结果与下载字节逐字相同，第二次 oracle 明确使用 API 下载的 first.json。续接后重新下载第一产物仍相同。
- 协调宿主另用独立 Python 核验下载字节、元信息、工具 stdout、执行父关系与 57 项运行时源码散列；未使用模型 summary 作为数值 oracle。产品 verified_by 仍为 NOT_VERIFIED，不把宿主验证写回产品字段。

| API 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `stage1.py` | 303 | `6e5a7d114c6269a691c7061d069e629594f123efb524b11f8a5dcdd5866c46d2` |
| `first.json` | 51 | `18f774bcb0ae5c7b953669fca1e15b39e527bc2113cd56208def17f73fe923bc` |
| `stage2.py` | 656 | `72dd171fe387fca9f73790ef80416e5e6aed7fdadbdba6b7f0a75613c0d68569` |
| `second.json` | 181 | `353cc5170bf63a60d4213db1db4b4716be822ce6514b8e118ed56f32ae9adb22` |

成功运行捕获的 harness SHA-256：`5d1ce0c514289f64befb50245f7ce535e13dceca709c46086522723adcd93c2e`，与交付源码一致。首次失败版本 SHA-256：`7f08f654d052df504f4893cdbe0c7802a3a336f0e444af9be5eac6411f97d639`；其完整源码私有归档，差异只有请求节流、对应自检和报告字段，未修改业务或验收 oracle。

本轮类型检查、精确权限/路径/输出篡改/输入散列/排他创建及节流离线正负自检通过；API 回归 32 项中 30 通过、2 个 PostgreSQL 条件跳过、0 失败。64 个生产/schema/依赖基线文件 SHA-256 与 b4549eb 一致；旧 online 测试未改。此前 1,114 份证据及本次首轮 339 份原始文件逐一散列不变，失败未删除、覆盖或改为通过。docs 仍有 49 项既有错误，无新增。完整 runtime/Issue #2–#5/隔离 PG 的前次结果保留，本轮未重复运行也不声称重跑。

私密证据包含两轮报告、逐调用 usage/stopReason、API HTTP 审计、产物下载与 provenance、独立复核和源码清单；公开记录不含运行身份、原始 prompt、凭据或私密数据。交付状态仍为 WAITING_FOR_PERRI_REVIEW，之后由 Master 终审；不合并、不关闭 #8、不部署。
