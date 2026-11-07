# Issue #106：TUI 精确引导与整批真实使用验收

状态：**Claude Opus 5.5 Extra R4 PASS（计划具备实施条件）**，2026-11-07 09:29 HKT 读取，无剩余阻断；已补入墙钟与原子账本两条非阻断说明；**本轮仅计划／复核，实施等待 Master 批准**。[完整英文计划](fix_20261107_issue106_guide.en.md) · [复核记录](evidence/issue106-guide/plan-review.md)。

- 仓库：https://github.com/ExplodeCode6324/Secretary
- Issue：https://github.com/ExplodeCode6324/Secretary/issues/106
- 核查基线：`cfc3ca6efd86137956a730a3986dfacfef5bfba4`（PR #109 合并），已包含 #103/#104/#105，三项均已关闭。#109 最新正文记录 Master 最终原生验收通过，优先于刻意保留的历史失败记录。
- 分支：`codex/issue106-guide-plan`。保留原有未跟踪证据；实施前重新核对远端 main，整合新增成果，不 reset 无关工作。
- Reviewer：浏览器 Claude Opus 5.5 Extra，全英文、同一专用会话往返。原始请求／回复／截图放 Git 忽略的 `.demo-data/issue106/review/`。提交后首次十分钟、之后每五分钟查看。本阶段不实施、不调用 provider、不部署、不合并或关闭 issue。

## 1. 用户结果与范围

Master 阅读具名 Task 的实时执行，在 Task 普通输入中明确提交 `/guide <task_name> <execution_round> <body>`，看到有服务端证据的已发送／已接收／已引导、处理结论和原因。切页、响应丢失、TUI/Core 重开及重试均保持原目标、原文和请求身份。**#106 代表主动引导整批收口，必须在准备好的真实模型隔离实例上由 Master 实际使用并验收。**

复用 #103 的受理与证据、#104 的 preview/follow、#105 的身份与导航；保留固定 Pi、Main/Task 两份普通草稿、最近三轮、授权／问题权限、取消／未知效果和容量限制。不造第二套 Core 投递引擎、逐 Task 长期草稿、改名、Watchdog、框架替换或 #70–#74。GUIDED 是可归因采用声明，后续实际行为单独验证。

## 2. 已核实接点

| 现有源码 | 接入方案 |
| --- | --- |
| `tui/input.ts`、`task-locator.ts`、`tui/editor-bridge.ts` | 仅解析 guide 前缀，保留展开正文、手打斜杠来源、补全范围和明确提交语义。 |
| `tui/app.ts` | 在通用本地命令清空之前分流 guide，加入作用域、目标提示、异步发送和草稿代际判断。 |
| `tui/state.ts`、`tui/delivery.ts` | 复用私有状态、排他锁和串行原子保存，新增独立有类型的引导待确认记录及迁移；不变成 Main 消息。 |
| Core/TUI `task-browser.ts` | 复用有界标题补全与精确 resolve，加入轮次补全和回执浏览，保留身份／历史界限。 |
| `task-messages.ts` | 已有 `guidance.sent` 消息保留为历史受理事件；当前回执放分页消息组外。 |
| `application-service.ts`、`guidance.ts`、`sync-service.ts` | 复用现有 POST、request 查询、引导详情／列表和失效通知，预期无需业务 schema 变更。 |
| `docs/tui/*`、`docs/operations.md` | 正式命令帮助、作用域、API 使用清单、增量验收编号及真实实例操作说明。 |

resolve 已返回 Task/Execution UUID、固定轮次、标题、状态及三种 revision/version。新引导定位拒绝最近三轮外、不可见／归档查找、终态、取消中、PROGRAM、RESULT_UNKNOWN。Core exact-ID 最终再次检查归属和状态；已开始的归档工作仍保留现有精确 ID 引导能力。原请求重放先于当前可操作性检查，不新增 stale-revision 前置条件或收紧既有权限。

## 3. 命令、补全与提交

1. 仅普通 Task 根页／详情可执行。Main 手打 `/guide` 明确报错并保留草稿。事项模式保持斜杠为字面文本：问题 Shift+Enter 原样回答当前问题，授权仍走独立控制；不以命令绕开。Task 普通文字和整段粘贴命令只保留草稿。不增加每次发送的审批对话框。
2. 手打首字符 `/`；命令名沿用不区分大小写。依次解析一个 ASCII 分隔空格、一个完整 Task 名、一个 ASCII 空格、严格 `[1-9][0-9]*` 且不超 safe integer 的固定轮次、一个语法空格。**最后这个空格之后每个字符都属于正文**：额外前后空格、中文、引号、反斜杠、美元符、TAB、多粘贴块、换行全部保真。“保真”从既有输入处理后的展开草稿开始：`normalizePaste` 已将 CRLF／单 CR 变 LF，过滤终端序列及 TAB/LF 以外控制符；实体 Tab 键用于补全／导航，不插入 TAB，粘贴块内 TAB 保留。这些既有输入处理不改；散列／冻结对象为展开草稿。trim 只判断全空白；之后的正文不再解析、转义、shell 展开或规范化。不能保真表示的非法 Unicode 明确拒绝。
3. 名称沿用 #105 NFC 精确标题。裸名称不能含空白／引号／反斜杠；双引号内仅允许引号和反斜杠必要转义。guide 固定 `selector_kind=title`，不猜 UUID 前缀；其他导航命令仍保留 auto／--id。guide 不增加 --id／单引号／shell 语法。轮次后直接换行、智能引号、全角分隔符／数字、前导零提供 ASCII 正确示例（正文须在同一行轮次后的空格之后开始），不改正文。
4. 提取窄范围标题前缀解析器，不将整个多行命令送入完整 locator 正则，不 split/join。DraftSnapshot 只展开一次，保留原 snapshot/provenance 和展开原文。仅 guide 正文允许多行，不放宽取消／跟随／导航命令。
5. 补全用现有最多 20 项建议，插入正确引用的标题，再提示真实固定轮次／状态，不默认当前或 latest。按编辑器、页面、导航和连接代际丢弃旧响应；正文开始后不补全或替换正文／粘贴块。现有 applyCompletion 重建首行并可能丢后续行；guide 必须只 splice 准确参数范围，保留后续所有行、来源范围和粘贴块，覆盖已有多行后缀时接受补全。Tab/Enter 仅接受候选；Shift+Enter 沿现有规则：不完整命令可补全，完整 guide 明确提交。保留 #105 逐字输入、方向键、撤销和 `start + oldLength` 来源范围修复；通过真实 EditorBridge 验证。
6. 按命令头身份 debounce 预览，正文编辑不重新查目标。引导不可用时可用 purpose=browse 只读显示真实状态／拒绝原因，不能因此放行。完整命令头解析后，在既有输入／状态区显示准确标题、轮次、状态及“仅本次执行”；命令头／连接变化即失效。明确提交时同步捕获草稿，按捕获的名称／轮次 resolve，任何 await 后都不读取新编辑值作为载荷。预览未及时完成时，命令本身仍含显式目标，resolve 后先显示目标再 POST，不多加一次确认。resolve 中切页不改投；连接／数据域变化停止尚未开始的 POST，保留并对账。
7. 单条超过 16,384 UTF-8 字节在 POST 前拒绝，保留草稿，不拆条截断。当前权威缓存已能确认超过每执行 64 条／总计 65,536 字节时，本地直接拒绝；并发以 Core 为准。不每次键入读取所有历史。语法／目标／正文不合法不产生业务写入。

## 4. 持久待确认记录与恢复

新增小型 `GuidanceDelivery`，复用 CoreClient/LocalFiles。每 local domain/mode **最多一条未解决的引导提交**，与已有 Main pending 相互独立；编辑、导航和 Main 发送仍可用。第二条不同引导留在同一 Task 草稿，直到前一条不确定性解决；不做无限本地队列或逐 Task 草稿。

本地状态 v4：迁移前备份 v1/v2/v3，保留两份草稿、snapshot、图片及 Main pending 身份；加载校验 envelope／摘要，损坏保留原文件并拒绝误发。串行保存深拷贝新增字段。旧版导出器遇到无法表达的引导 pending／恢复引用明确拒绝，不丢字段。保留私有权限、排他锁和原子 rename/fsync，不自动修复历史损坏来源区间。使用独立 guidancePending／guidanceRecovery／guidanceLast，不复用会被 Main 接受／失败逻辑覆盖删除的 state.recovery。collect 增加 v4 临时文件识别及引导引用保护；未解决或仍引用的恢复记录不得回收，未知／损坏内容保留，原有到期规则仅用于无引用的已结清恢复文件。

冻结记录含：格式版本、提交／request UUID、domain/mode、命令路径、Task/Execution UUID、标题／固定轮次、resolve revision/version、完整 `{request_id,task_id,text}`、UTF-8 原文散列及规范化 path/body 指纹、展开 raw command、富文本 snapshot/provenance、提交时 Task generation、创建时间、尝试过的 Core instance、可用 sync cursor、状态、服务端 guidance ID/receipt。无 token/key。revision 仅记录定位证据，不新增后端 CAS。

发送顺序：

1. await 前同步捕获草稿与 generation，设置 single-flight。解析／resolve／校验，UUID 只分配一次。
2. **首次 POST 前持久保存完整冻结记录与 attempted-instance 标记**；保存失败不得 POST。本地已保存／HTTP 发出只显示“结果待确认”，不能显示已发送。受理前不清 Task 草稿。这有意区别于 Main：guide 是面向准确执行的短命令，目标拒绝后应仍可编辑／复制，冻结 envelope 独立承载投递；不重构 Main 行为。
3. 仅 POST 冻结 execution 路径和 body。检查 receipt 的 request ID、准确 command path、受理／命令状态和 Guidance resource；读取该资源再次核对 MASTER 来源、Task/Execution 和原文／散列。普通 receipt 不含匹配资源时为一致性错误，不能宣称成功。若匹配请求 receipt 已关联 Guidance，详情 GET 暂时失败则持久标记 ACCEPTED_VERIFICATION_PENDING，只重读，不退回 UNKNOWN／重发／换 ID。Guidance DTO 没有 request_id，请求与 guidance 关联来自权威 receipt 的 resource list；原文／身份核验成功后才清提交草稿，详情不一致则记 ACCEPTED_WITH_INTEGRITY_ERROR：将已受理 envelope／证据持久移入独立 guidance recovery，释放未确认槽位，绝不提供重发。保留已受理草稿 binding 标记，重复 Shift+Enter 不能从同一提交生成新 ID；保留原文，允许无关新草稿。导出／保存失败时继续保留，完成持久保存后才释放。该路由目前同步执行；意外 pending/failed 必须明确保留待核对。
4. 先持久保存受理事实与 guidance 引用，再清理不确定状态。只在 generation、原文及来源一致，或明确绑定的恢复副本一致时清本次 Task 草稿；新输入、粘贴、Ctrl+C/undo、Main 或隐藏草稿都不吞。不得清新 Task 编辑器的 undo。接受后 Core 可查完整历史，本地保留有界最后提交引用。保存失败保留可恢复的已受理 envelope，不允许另造 ID 重发。
5. 网络超时／连接中断／不确定 server failure／receipt 不匹配保留 UNKNOWN；REQUEST_CONFLICT 固定为 CONFLICT，显示导出／复制恢复，不换 ID。确证拒绝的 envelope 可按下述证明释放回草稿；新草稿已占位则保留恢复证据，不覆盖，不能以裸 HTTP 状态或无关目标错误结清。

重开／重连核对 domain/mode/instance，**只查询，不自动 POST**：先原 requests ID，再关联准确 Guidance ID；不重新解析标题。旧提交即使目标已出最近三轮、归档或终态，仍按原 ID 还原阶段／结论。旧 client／旧代际异步结果不结清当前工作。

NOT_FOUND 单独不是迟到 POST 的取消屏障；同时必须避免槽位永久锁死。所有证明均核对同 domain/mode/client 代际和冻结身份：

- 明确同 ID/path/body 重试时，Core 先重放旧请求再检查目标。因此 TARGET_ENDED／TARGET_RESULT_UNKNOWN 的确证拒绝说明原 envelope 没被接受且以后也不能接受；若结束前已受理，则返回原 receipt。GUIDANCE_LIMIT_REACHED 因历史不删除也是单调拒绝。固定 GUIDANCE_EMPTY／GUIDANCE_TOO_LARGE 只在相同已核实合同、同 envelope 响应下结清。TARGET_MISMATCH／GUIDANCE_UNSUPPORTED_EXECUTOR 不作为不可逆证明：旧执行可能没有自身 proposal_ref 而读取当前 proposal。不能泛化到任意 4xx/5xx、合同变化后的 INVALID_REQUEST、存储身份不明的 TARGET_NOT_FOUND 或 TARGET_CANCELLING。
- 重开可只读证明：先 GET 准确执行并核对 Task 归属及终态／RESULT_UNKNOWN，再在同一核实实例 GET 原请求得到 NOT_FOUND；顺序不可反。该状态不可返回可引导工作，迟到 POST 必拒绝；如查到匹配 receipt 则受理结清。读失败／换实例／仅取消中继续 UNKNOWN，取消状态目录存在 READY 边，不据此释放。
- 满足前提仍可使用原不同实例＋sync cursor 连续性屏障；cursor 缺失不妨碍上述有序不可逆状态证明。
- REQUEST_CONFLICT 说明这个准确 envelope 不拥有该请求身份。提供明确“导出并释放冲突”：先将 envelope／证据写入私有恢复文件，再持久记录本地释放并空出槽位；导出／保存失败仍阻挡。不取消／修改其他命令，不自动换 ID 重发。无匹配受理 receipt、无 REQUEST_CONFLICT 的一致性错误才作为真正未知隔离；已证明受理者走 ACCEPTED_WITH_INTEGRITY_ERROR，不永久占槽。

Task 普通状态区有可键盘聚焦的提交记录，F6 进入引导状态／回执焦点，Esc 返回原编辑器／锚点；不占用 Tab 补全，不改变事项模式键位，帮助和测试覆盖 F6 作用域／焦点切换；Mac 帮助／页脚标 Fn+F6（启用标准功能键时直接 F6），G106-08 验证，不更改系统设置：Enter 打开只读详情，Esc 返回原锚点／草稿。提供“重试原提交”“复制原文”“恢复到空 Task 草稿”，以及仅冲突时的“导出并释放”；Shift+Enter 明确执行选中动作，聚焦／导航不提交，只启用合法动作。这是异常恢复出口，不是正常发送新增审批。
明确重试先查回执，再沿原 path/body/ID，不重新 resolve／换身份。恢复草稿以 binding 直接走冻结记录，即使手打 slash 来源未知也不重新解释；编辑破坏绑定但不能改 envelope。未知引导未解决时不同新文本留草稿，不误发。提供可见待确认／恢复入口，能复制或在空草稿中恢复冻结命令，不覆盖非空新草稿。Esc／导航／Ctrl+C 不撤销已提交请求。

## 5. 服务端回执展示

现有 task-messages.ts 的 `Guidance SENT` 消息保留为历史受理事件及唯一默认全文，不把新回执行插进分页消息组。另在每执行标题与分页消息组之间、组外设置紧凑回执区：稳定 `guidance:<id>` 元数据行，显示 MASTER/MAIN 来源、标题／轮次、阶段时间、结论及原因，不重复正文。Enter 打开独立只读全文／有界证据详情文档，Esc 回原视图和锚点；详情是显式替换视图，不在原消息旁再复制一份全文。列表聚焦／分页沿用只读控制。

SENT=持久受理，RECEIVED=持久上下文接收，GUIDED=真实调用采用。历史 GUIDED 后 CONFLICT 两事实同时保留。preview、2xx、动画、提到 ID 以及历史 SENT 消息都不能证明当前阶段；回执区阶段只来自 Guidance 查询。
复用详情／列表和 guidance/task-browser 失效；不仅按最后 sequence 增量追加，还刷新已有行 revision。失效后从 sequence 起点重读单执行，最多四页×20，debounce／合并刷新，丢弃过期代际。每页 20 可继续读取，每执行最多 64。遵守现有正文预算，全文／证据按需读，不扫全部历史。读操作绑定 execution 和导航／连接代际，稳定行与锚点，丢弃错目标响应。测试跟随中回执刷新与 lastRowFor 尾部定位，回执排版变化不能把最新消息挤出跟随视窗。发送不偷偷开启 follow、切执行或从历史跳底，保留 #104 显式跟随及 >50 消息最新窗口。

根页也能看提交状态；保留的最后提交引用／未确认 outbox 在终态或目标出三轮后仍可直接查看。准确引导读取不扩成第四轮浏览器。拒绝、未知、冲突、终态均可查看／复制原文。普通回执只刷新客户端，不由 TUI 创建 Main Input/Feedback；一次知情与控制升级仍由 Core 去重。

## 6. 批准后的实施与验证

顺序：解析／补全／路由 → v4 状态与投递恢复 → 目标提示／回执分页锚点 → 正式文档／增量 `G106-*` 清单／在线 harness 和持久验收 launcher → 定向测试、隔离 PostgreSQL 完整 `npm run verify`、生成一致性、改动文件格式检查 → 精确 PR HEAD 的 Linux/macOS CI 和同一 Claude 实施复核。macOS 显式加入 #106 测试；Linux 全套自动发现。必要公共 DTO 变更从 schema/operations 源生成，不手改生成文件。保留首败、源 SHA/散列和实际环境；不以源码复核冒充测试执行。Master 验收前准备可用实例，后续修复补相关重测；不自动合并关闭。

确定性覆盖：

- 中文／空格／引号／反斜杠标题、NFC、像 ID 的名称；非法分隔／数字／参数，UTF-8 边界、非法 Unicode、全空白；多块粘贴及后续 `/` 行逐字保真；显式覆盖 CRLF、单 CR、终端序列过滤、块内 TAB、NFD 正文（标题 NFC 不泄漏）、ZWJ emoji、不换行／全角空格、U+2028 和尾空格，按展开草稿逐字节断言。
- 真实逐字 Editor/TerminalApp：手打／粘贴／未知 slash、补全／方向键／undo／IME 样式提交、正文后缀、多行范围、Main／事项边界、Ctrl+C 和发送中导航／Esc／点击。
- 真 Core HTTP/LocalFiles：慢 resolve 冻结，persist/POST/receipt/save 各断点，受理响应丢失、NOT_FOUND 后迟到 POST、Core/TUI 重启、保存失败／锁／v1-v3 迁移／导出拒绝、跨域／旧 client、重试／冲突／伪 receipt/资源/原文、限额／终态竞态；Guidance/Input 不重复。明确三例：受理丢响应后终态应查询／重放为已受理，未抵达后终态／UNKNOWN 应只读证明释放，取消中仍 UNKNOWN；另测单调限额、冲突导出失败／成功和 Main 结清／清理不动引导恢复记录；已受理一致性错误的 checkpoint/binding 释放槽位但不允许重发。Harness 覆盖自动窗口过期后才首次连接、重启保留 ACTIVE／人工截止／计数，TUI 自动重连后引导越过 SENT 且不执行 connect；使用 31 分钟或低于 60/180 后仍可重连直到真实预算耗尽；真正耗尽先说明而不调用模型；rehearsal／Master 草稿根分离；记住规则、World 初始化及身份安全停机。
- 受理仅清同一草稿；新输入／恢复副本保留，Main 与 Task pending 不串；旧目标对账不走新 recent-three/title resolve。
- 历史消息与当前回执区不重复全文／不修改消息窗口，阶段真实性、MAIN 来源、历史阶段与新结论、超过 20 条、已有项变化、取消／终态／Master-only 冲突；正常刷新无客户端 Main 通知。
- 真 Core＋真实 TUI＋脚本 provider 联调：标题轮次→完成前 preview→中途引导→后端真实回执路径→行为变化→恢复。同场多 Task、>50 消息、锚点、点击／Esc、授权／问题／取消／失败／产物；未改内部复用上游有效证据，不重复无关付费用例。

## 7. 必须交付的真实模型隔离实例

实施获批后，在忽略目录 `.demo-data/issue106/acceptance/` 建立可重复私有 launcher，可复用 harness 源放 `test_case/online/`。**新 data domain、独立 journal/objects/workspaces、隔离 PostgreSQL 库／集群、独立 TUI stateRoot、只监听 loopback**。显式指定所有路径，不继承 interactive-live 默认数据或数据库。保留既有实例、数据和证据；停止只命中本实例，不 broad kill。

实例采用验收专用的**进程内 App/serveCore 常驻服务**，复用 `serve-issue94-live.ts`、`acceptance-stream.ts` 和 `tool-budget.ts` 的计量模式，不假设 npm run start:live 有累计限额。真实 roleModel 外包计量；产品 TerminalApp 通过真实 HTTP/SSE core-endpoint.json 连接，所有 connect/reconnect/status/stop 都显式 live mode 和独立 stateRoot。不另写解析／投递／回执实现。与正式部署的差异仅为独立数据／DB、计量、样本／等待点；不伪造 provider 响应／回执或绕过产品权限。

凭据准确复用 `issue103-guidance.ts` 的文件校验方式：默认从仓库根解析绝对路径 `/Users/muy/Desktop/Codex_Work/secretary-core/.env.local`，detached 前固定，不依赖 ambient cwd；当前用户拥有、普通非符号链接、无组／其他权限，用 node:util.parseEnv 读取非空 DEEPSEEK_API_KEY。**同一现有 key 用于 Main 和 Task**，两个角色各自归因计量；不声称 start-live.ts 自带权限检查或使用不同 key。两角色都用真实 deepseek-flash。实施批准后才核对可用性；不将明文复制到文件、命令参数、控制台、截图、Git 或 reviewer 材料。此来源不可用就报告并取得替代来源授权，不探查无关凭据或暗换 fixture/provider。

子进程从允许的基础环境构建，清除全部继承的 SECRETARY_* 再显式配置 mode/data/DB；不继承 live-runtime、push、credentials-file override 或正式 DSN。**启用 World**，新建隔离数据库并明确将 DSN 传入 App.open，manifest 记录集群／库所有权，公开 DSN 无密码，优先独立本地 socket。调用既有认证 admin/world/migrate 初始化，memory search ready 后才可 READY。start/restart 用现有 pg_ctl 模式检查并在必要时启动本实例拥有的集群，不管理正式集群。key 只在 server 内存使用，不另加到子进程环境／argv。

沿用 startCore 的 detached spawn/unref，私有 PID/log/manifest。启动器退出后用独立 shell 检查存活，交接前再查。正常停止在 domain、endpoint instance_id、manifest PID 匹配后用认证 core/stop；备用 signal 也须证明 PID 仍属于记录实例，PID 复用／身份不符就停止操作，不 broad kill，明确接入 serveCore shutdown callback，复用 serve-issue93-manual.ts（issue94 单独示例缺少回调）。停止先取消 harness pump timer、禁模型受理、abort model lifetime，等待 harness 自己在途的 app.pump()（serveCore 不会代等），再关闭 server/App、flush 账本，仅 instance 匹配才删 endpoint；Store 锁仍为权威。
分两条验收线：

- 有界自动真实 provider 联调：真实请求／响应／结构化回执，不伪造采用。用无害样本和普通 WAIT_DECISION/WAIT_AUTH 或已知读取步骤留可控介入点，再于真实调用进行中提交，核对后续请求、输出／文件散列、三阶段、丢响应／重启身份和 Main 普通过程输入次数。另测 Main 不可用直投。延时或脚本响应不能声称是真实完成前流式证据，没看到的瞬态为 NOT_OBSERVED。
- Master 持续交互实例：Main/Task 都用真模型，安全样本工程和足够 preview 工作量。准备的 Task 通过真实模型工具，在新 DIRECTORY scope（default_write="ask"，否则 builtin:workspace-write 自动放行）写一个无害样本文件。准备前先检查匹配的 remembered rules；若此前批准记住了规则则用新隔离 scope，不删除历史规则／证据，再开始花模型预算，使该写入进入真实 WAIT_AUTH；现有 Authorization.prepare 默认 expires_at=null，Main 不能批准。Master 可先 guide 再明确批准，观察旧操作退役／再规划和后续真实流式；另一个在途场景验证 RUNNING 中介入。不伪造问题或等待，确认真实 pending authorization 才报 READY。提供实际名称、轮次和命令，允许 Master 自建任务。status 若发现任务已不可引导／授权不再 pending，报 NOT_READY 并给 prepare-task.command 明确创建新场景，不删除／复用旧执行；准备任务不设短 deadline，不靠可能由 Main 自答的普通问题保持等待。实例贯穿交接保持运行，不像 smoke 脚本结束即退出。利用 TerminalApp 已有可注入 stateRoot，不修改 HOME；与历史 fixture 草稿／Core 完全隔离。

真实调用前设置并公开累计预算：100 次物理 provider 尝试、300 次模型提出的工具调用，含 Main/Task、提取和重试。自动／人工两线顺序运行，共用同一私有、原子 fsync 的账本与排他持有锁。实际 fetch 前递增并保存次数（崩溃可保守计入未发尝试）；成功响应交给执行器前登记工具提案，先保留计量再可能执行。并发角色也服从总量上限；每 dispatch 原 20 次不变，不降低生产上下文／输出限制。

两小时是**墙钟窗口**，Mac 睡眠／合盖时间也计入，status／交接须明确说明。阶段、截止、累计计数和扩容事件同属一份记录，在同一次原子 fsync 账本写入中保存，不能 ACTIVE 无截止或扩容无对应事件。准备、预演、等待任务设置计入自动阶段持久的两小时窗口与共享计数。人工窗口只在 **Master 首次明确执行 connect.command** 时启动；owner-local handshake 先持久记录 manual_started_at/manual_deadline，再放行人工模型工作。Agent 预检使用明确标记的 rehearsal connection 和独立 TUI 草稿根，不消耗首次人工连接。初次交接为 Master 新建／核实独立根，草稿为空且无 pending/conflict，不清空已有根来伪造此状态；后续 Master 重连始终复用同一根并保留状态。重连／重启／重复准备都不重置已开始的截止，两线仍共用 100/300。

准备并 drain 真实 WAIT_AUTH 场景后，服务保持 ARMED_FOR_MASTER：真实 HTTP/SSE／只读可用，无在途模型，业务 pump 尚未放行（serveCore pump:false＋harness 控制的 app.pump 门），不向 Main/Task 注入预算拒绝错误。授权的本地 connect handshake 核对就绪／预算并持久写截止后放行；这是验收 harness 生命周期，不新增产品 API／伪造模型行为。等待时直接业务 API 不是交接支持入口，也不启动人工时钟；文档 connect 必先校验／放行。自动准备窗口到期不能在等待 Master 时耗掉／失败掉已准备场景。session/compact/resume 等 long-route 可绕过 App.pump，pump 不是权限边界；ARMED 支持流程不发送这些命令。模型受理计量检查阶段，授权 preparation/ACTIVE 之外不发 provider；status 显示 ARMED 中所有模型进入／拒绝尝试及其 recovery 状态，异常活动使初次就绪失败，不能掩盖已受损场景。不增加对任意带外业务命令的稳健性承诺。

status／交接显示剩余尝试／工具计数及香港时区绝对截止。首次 connect 前明确“人工窗口未开始，Master 首次连接后两小时”，不虚构绝对时间；开始后显示持久截止。采用持久阶段，不每次重连重新套交接门槛：

| 持久阶段 | 服务与命令行为 |
| --- | --- |
| ARMED_FOR_MASTER | 准备完成、无人工起点／截止、pump 关闭；Master 首次明确 connect 核对初次交接条件，原子记录 ACTIVE 和两小时截止后启用 pump。自动阶段截止不套用到人工阶段。 |
| ACTIVE | start/restart 在持久截止未到、总量未耗尽时自动恢复业务 pump；仍开着的产品 TUI 通过 endpoint 自动重连即可，不用再次运行 connect。显示余量、低量告知，**不要求再剩 90 分钟或 60/180 次数**。现有／普通新工作可用至真实耗尽；不重置计数／截止。 |
| EXHAUSTED | 真实截止或总量耗尽；持久该阶段，停新模型／业务 pump，中止在途模型并保存真实预算证据，API／历史仍可查。connect 在打开模型交互前说明耗尽，明确授权扩容并落账后才回 ACTIVE。 |

60/180 和 90 分钟门槛**仅用于新场景准备／交接就绪**，不限制已开始的重连。人工窗口未开始时交接承诺完整两小时；进程运行／停止与持久阶段分别显示。Core 重启保留 ACTIVE 并自动恢复 pump，包括 TUI 未退出而自行重连；会话用至真实截止，重连不暗中延期。fetch 前及可执行响应释放前检查截止／预算，耗尽以既有 model lifetime 中止模型活动，真实记失败／等待，Core／只读历史保持。扩容须明确授权并追加账本事件，不删账本清零。

交接须至少剩 **60 次物理尝试、180 次工具提案**，人工窗口尚未启动（首次 Master 连接获得完整两小时），或 Master 已明确启动时至少还剩 90 分钟；不足先取得扩容授权，不能交已耗尽实例。报告实际用量。每条 Master 引导的一次知情 Input 可以触发 Main 模型工作并计量；“没有额外 Main 输入”指除此一次及必要去重控制／结果事件外无普通过程输入，不为了回执刷新额外调用。
**邀请 Master 验收前**，Codex 必须启动／健康检查，证明两个角色实际用真模型，跑完有界全链路预演，再留下新的可控任务。交付 manifest：候选 SHA、model IDs、domain、endpoint、PID、独立数据／DB／草稿路径、预算／消耗；交付验收清单和**已实测、无占位符的绝对路径命令**，覆盖启动／状态／连接／重连／重启／停止。拟交付：

```sh
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/start.command
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/status.command
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/connect.command
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/restart.command
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/prepare-task.command
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/stop.command
```

这些是**待批准后实现的交付约定，目前尚非可运行命令**。启动／重启必须保持同数据域与预算，新场景另行明确。可用时 connect 拉起真实 Terminal TUI；若工具拒绝原生 Terminal，说明阻断并将准备完成的实例／准确连接命令交 Master 操作，不能换系统输入路径绕过。真实 IME／剪贴板从原生使用／Master 报告留证，VirtualTerminal 不能代替。

交付时填入真实名称／轮次的验收清单：

| 编号 | 应观察结果 |
| --- | --- |
| G106-01 | Main/Task 真模型健康，标题／轮次发现和补全，Task 根页／详情提交。 |
| G106-02 | 完成前真流式，中途引导改变允许来源／输出 marker／不写入行为；分别核对三阶段和最终行为。 |
| G106-03 | 中文／空格标题、多行多粘贴、空格引号反斜杠美元符及后续 slash 保真；非法／超限／错页／整段粘贴不误发、保留草稿。 |
| G106-04 | 发送后编辑新草稿、切页／点击／Esc、TUI/Core 重连，对账原请求目标，不重复／转投下一轮；附受控丢响应证据。 |
| G106-05 | Main 不可用仍可直投，普通阶段不增加 Main 输入，Main 来源引导可见。 |
| G106-06 | 授权／问题等待、Master-only 冲突、不能采用、结束／取消／未处理原因真实，原文可查／复制。 |
| G106-07 | 多 Task 不串流，>50 消息最新／历史锚点／跟随及相关失败／产物；脚本／真实 provider 证据分账。 |
| G106-08 | 真键盘／中文 IME／粘贴／补全／undo／导航和 Master 自由实际使用，记录环境及精确构建。 |

逐项 NOT_RUN / PASS / FAIL / BLOCKED，附证据。Master 明确确认前产品验收始终 PENDING；#106 完成也不自动宣告 UI 稳定，#70–#73 等后续明确稳定裁定，#74 数据驱动。
