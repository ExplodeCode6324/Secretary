# Issue #82 — 终端 Main/Task 基础实施计划

## Master 后续键位调整（2026-10-30）

Master 随后要求优化完整命令：`/T`、`/M`、`/back`、`/help` 不再弹出自动补全，也不需要尾随空格，一次 Shift+Enter 执行。未完成的命令仍先补全；即使旧补全响应尚未更新，也不得截获已完成命令。

Master 在 macOS Terminal 实测 Cmd+Enter 无反馈，随后明确选择 Enter 换行、Shift+Enter 发送或执行命令。此决定覆盖以下旧 Enter 提交方案及中间的 Cmd+Enter 试验方案。补全菜单打开时 Enter/Shift+Enter 仅补全。无需反斜杠降级，反斜杠保留为正文。Shift+Enter 此前已在原生终端被识别为换行；新的发送行为仍须原生确认。


日期：2026-10-30（香港）。R3。状态：MASTER_APPROVED / IMPLEMENTING；实施须经 Master 批准。

## 1. 依据与边界

仓库：https://github.com/ExplodeCode6324/Secretary
Issue：https://github.com/ExplodeCode6324/Secretary/issues/82
依据：重新编写的 #82 与 `docs/tui/implementation-reference.md` v1.7，重点 C01–C04、C12–C16。从领取时最新 main `ceb50543423e4cfabbbf532fed8432030fb8b061` 开始；它比回滚提交 `f01076e6f5efad437d64b2a2890ae1af43ce97d7` 仅增加文档，源码、包文件和测试未变，回滚树与 #81 完成树一致。不恢复已撤回的两版 #82。计划分支 `codex/issue82-terminal-plan`。

交付真实 macOS 终端的 Main 和非空 Task 双入口、主会话收发、两份普通草稿与失败恢复。精确锁定 `@earendil-works/pi-tui@0.87.0`（上游 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`），复用 TuiAltScreen、容器/ScrollView、Editor、Markdown、键位与补全；Node >=22.19.0，不重新选框架。

#91 承接完整历史分页/缓存、CoT 切换和 Hermes 多行粘贴块；#83 承接完整 Scope 成员/计数/排序和详情；#92 待处理；#93 失败处置；#94 产物和图片。不带回旧浏览器合同、逐键 fsync、通用 outbox 或压力指标。保护无关未跟踪材料、历史证据和混合数据目录。本阶段仅计划，不实施、部署或合并。

## 2. 已核实支持与修改位置

- `core-client.ts` 已有 query/command、同步游标/changes/stream 和安全本机 attach。TUI 只 attach，Core 缺席或不可用时明确提示，不调用 start/stop、不创建第二主会话、不在前端直接导入 Host/Store。
- `application-service.ts` 的 tasks 列表只有计划状态、目标、scope_id、active_execution_ids，缺实际执行状态。详情已有最新执行和排队请求。补最小增量只读列表投影：活跃执行 ID/真实状态、最新执行 ID/状态或 null、排队请求数；同步 schema 源、生成 DTO/OpenAPI 与合同测试。复用已有索引/Store，不改调度器和生命周期。在 TaskSummary 本身增量加字段，供 #83 继续扩展；保留 state 表达计划；无活跃执行明确显示无，排队不等于运行，最近 FAILED 不能冒充当前执行。Scope 名称读既有 scopes，null 显示逻辑 Shared；读取失败显示不可取得，不编造状态。
- 提交完全由应用拥有：Editor 设置 disableSubmit=true，不用 onSubmit 路由。复用 ProcessTerminal/StdinBuffer 对拆分粘贴的组装，每个完整包装的paste事件只交给Editor、不提交，不另写粘贴解析器；测试真实StdinBuffer拆包路径。换行/编辑交给Editor，只有独立提交键且菜单未打开时提交。处理 Enter 前记录 isShowingAutocomplete()，菜单打开时此次 Enter 只补全，即使处理后菜单已关闭也不得提交。明确提交时读取原始 getExpandedText()，不调用私有 submitValue。局部错误、Task 普通提交保持原 Editor 实例/文本/光标/undo；只有导航或可靠本地交接消费文本时才清空。disableSubmit 会越过 Pi 的反斜杠+Enter 降级，应用须通过公开编辑/输入 API 补上并先测。
- 自定义 AutocompleteProvider，不使用 CombinedAutocompleteProvider。仅原始第0行第0字符为 / 且光标位于命令名 token 时提供当前范围已实现命令；前导空格、正文参数、其他行和路径不建议、不做文件补全。补全可追加分隔空格，无参数命令允许末尾 ASCII 空格/Tab，但拒绝额外行或非空白参数；正文命令只去掉第一个 ASCII 分隔空格，余下原样保留。只折叠命令名大小写。补全键处理后显式捕获展开草稿，因为 disableSubmit 的斜杠确认路径可能不触发 onChange。覆盖 Enter/Tab 补全、菜单关闭后的下一次 Enter、前导/尾随空格、无文件建议、粘贴边界、失败时光标/undo 不变。
- 拟新增 `src/pi_secretary/src/tui/`、薄入口 `tui-cli.ts` 和 npm 启动项；测试 `test_case/offline/issue82/`。模块仅页面状态、渲染/编辑器适配、命令注册、Core 同步和小型本地草稿存储，不另建服务层。

## 3. 交互合同

Main/Task 整屏切换，仅底部编辑器和可选简短提示行常驻，各页可有自身标题。无跨页顶栏、侧栏、宽屏双栏。窄小窗口保住输入可用并提示尺寸不足；增宽/增高只增加容量。启动 Main 定位近期最新消息；往返按稳定消息/Task ID 与正文偏移恢复，重复导航与一级页 /back 不产生提示、历史或滚动重置。首次定位后新内容不自动跟随，刷新不覆盖输入/光标。

统一声明式命令表负责解析、作用域、补全和帮助。命令名不分大小写，参数保留大小写和字节。只有原始首字符 / 进入解析；未知命令和错参局部报错、保留输入。导航只允许补全产生的末尾空格/Tab，拒绝非空白参数和额外行、不串联、不做 shell 求值。/send、/rawmessage 后是字面载荷，不递归解析。命令与正文以第一个 ASCII 空格分隔，保留其后全部字符（含额外空格和换行）。空/纯空白拒绝并保留输入；本批纯文本 /send 无正文拒绝，不能发送不可见的旧草稿。/rawmessage 仅 Main、本次有效。

实现全局 /M、/T、/back、/help，以及 Main 的 /send、/rawmessage。Task 调用后两者只报作用域错误、零 POST；Task 普通提交保留正文。草稿后追加 /T 仍是正文，须替换/清空为独立命令才能导航；不新增隐藏命令缓冲或导航快捷键。仅 Main/Task 两份普通草稿。帮助明确后续命令未实现；补全只列当前可用项、绝不执行。本批无对象参数命令，因此不伪造对象补全，随其消费功能后续接入。

拟用 Enter 提交（补全菜单打开时只补全）、Shift+Enter/Ctrl+J 换行、应用自己的反斜杠+Enter 降级、Tab 补全、PageUp/PageDown/滚轮浏览、Ctrl+C 正常退出（有选区也退出）。保留 Pi 选中即复制，与 Ctrl+C 分开；本批禁用 AltScreen 搜索和前/后 prompt 跳转；Home/End 属编辑器行首/行尾，不切到视口导航；不调用 addToHistory。预检核实父层/编辑器优先级与实际键位，不增加导航热键。旧错误在下一次普通编辑或提交命令时先清除，再展示新错误，后台渲染不清除错误。UI 操作不产生业务消息或审计。

模型正文白色，Master 浅蓝加上下分隔线，工具浅粉另起行，已有 thinking_preview 浅灰；复用 Core 已有不超过20个字素的脱敏预览及省略号，不二次截断、不推导隐藏推理。流式/结束/历史共用渲染器。固定样例验证段落、标题、强调、列表、引用、行内/块代码；链接、表格按实测登记，不宣称数学/Mermaid/HTML。远端控制字符是不可信显示数据，复用安全渲染并验证不能操作终端或进入命令解析。

## 4. Core 读取与有限阅读范围

按实际需要消费 /core、/session、/timeline、/timeline/around、/messages/{id}/content、/tasks、/scopes、/sync/cursor、/sync/changes、/sync/stream、/requests/{id} 和 POST /messages。完成后按 operations.json 记录实际 method/path，以及每个未用操作的原因；token 不入证据。

Main 首次最近50条加本次运行的新消息，运行期间驻留，#82 不做淘汰/缓存限额/重读引擎；明确近期窗口边界，不伪称历史起点。H、淘汰重读和向前历史分页属于 #91。已载入内容按稳定 ID/正文偏移保持切页、resize/reflow 锚点；ScrollView follow:none，上方内容高度变化后应用重新定位。自己发送也不自动滚动：本地可靠交接后清空输入，以简短局部“已提交，正在查询接收状态”提示进度，阅读位置不变。首次加载失败或同域 Core 重启可重取近期快照，重连期间保留已加载记录和本次阅读位置；权威内容确实缺失则原位说明，不静默挪到别处。

Task 每API页50条，从现有最早创建/first-sequence 顺序首屏开始，标明“基础任务列表—创建顺序”，不伪称最终当前集合。滚动到明确的前/后页边界触发翻页，刷新能保留时保留 ID，明确翻页可定位目标页。无完整筛选/排序或 Scope 计数。pending_request_count 显示为“排队请求”，与 #92 待处理事项分开。验收必要时翻首屏以外的真实运行/等待任务。

单一 SSE 连接由应用持有并以 abort/连接代次防旧事件；cursor/changes 增量消费，reset/游标失效重新快照，按 query key 合并失效通知，只刷新受影响查询，不把同步事件当最终正文。旧连接/旧域响应不能覆盖新状态。退避重连保留草稿、阅读锚点和当前内容；同域 instance_id 改变重取游标，data_domain_id/API/mode 改变隔离原草稿和发送材料，不跨域重投或清理。鉴权/网络错误不能伪装 NOT_FOUND。

## 5. 最小草稿与待确认提交保护

Core attach成功前禁用输入、明确显示连接/mode错误，不能在未知域下让正文看似已保存。Core 数据目录按 core-cli 的 SECRETARY_DATA 或相对启动目录的 .demo-data 解析，CORE_MODE_MISMATCH 与 Core 不存在分开提示。TUI 状态置于 Core 根目录之外的 ~/Library/Application Support/Secretary/tui/v1/<data_domain_id>/<mode>/，v1 表示 API 版本，限制权限；用版本化原子 JSON 快照保存两份完整展开草稿、至多一个未解决 Main 提交；不建通用队列/服务/Core 草稿库。待提交记录保留域/API/mode、created_at、request_id、原Core instance_id、每次最后尝试的实例/时间、原始编辑输入及完整固定序列化请求。使用小型内核 flock 持有进程拒绝多写，复用仓库 Python/flock 模式但不导入 JournalOwner 及其 journal/worker 协议。父管道关闭释放锁，helper 死亡立刻停止写和发；测试互斥、父/helper 退出。不删重建已锁 inode、不做 stale PID 删除，仅是锁而非持久化服务。不导入旧 Tauri/旧 TUI 状态。

草稿拟 300ms debounce，加切页/提交/正常退出前 flush；临时文件+原子替换。明确突然崩溃/断电可能丢最后一次保存后的编辑，正常退出重开与发送失败不得丢稿；不逐键 fsync。网络前的提交记录和清理前的接收事实采用持久 checkpoint（文件 sync、rename、支持的目录 sync）。磁盘错误保留内存/原文，提交快照失败则不发网络，退出保存失败不能静默退出。损坏/未知版本文件保留并阻断，不重置为空。

提交验证原始展开正文、schema text最大1,048,576及完整JSON总UTF-8字节不超过1,048,576（含外壳/转义，api-v1.ts:183）。原序列化请求/ID可靠落盘后才POST，随后可清空普通草稿供继续编辑。单个未解决提交与两份普通草稿分开，双Enter不得启动新事务。区分本地待确认、Core可靠接收和下游业务状态。Receipt.acceptance=ACCEPTED 表示交接，即使 state 后来是FAILED/UNKNOWN也不撤销接收，但绝不能显示业务成功。交接事实落盘后只清对应副本，不碰新草稿。

超时/断线/重开保留原ID、正文及原始编辑输入（例如 /rawmessage /T，而非只存 /T）。启动、重连、被阻塞提交之前，验证域/API/mode 后自动只读GET对账；先对账，再恢复编辑器，绝不自动POST。已接收则完成交接；可证明未送达才经共用拒绝恢复路径释放槽。证明限定为：同域、比全部持久尝试更新的Core实例返回NOT_FOUND，旧连接已abort，且从未对新实例POST；Core单Store所有者和实例替换排除旧请求在途。同实例的NOT_FOUND、经过某时长、fetch失败/abort均不证明未送达，保留UNKNOWN并解释。15秒requestTimeout加任意余量不是可靠取消屏障；不由TUI强制重启Core。用户可明确重试原请求；若不愿再发则不重放，并如实说明已在途请求无法安全宣称取消。之后同域Core重启或权威接收/拒绝可以解决。这是交Master审阅的保守限制，不承诺未证明的取消。

对账后，Main为空且命运未知/已证明未送达时才恢复原始RAW输入，并持久绑定 {request_id, raw_input, draft_generation}；有新稿则保持不变、显示恢复信息。恢复条目放在允许的底部提示行，含截断预览/ID/路径，不加面板、不入历史；全文可由编辑器恢复或自有恢复文件取得。之后发现已接收，以同一原子快照完成交接并清除未改动的绑定副本，再更新UI；已编辑则解除未修改绑定、保留新稿。重启/崩溃后也不能留下已接收的原绑定副本作为新消息。被阻塞的Enter触发对账后，如果绑定副本刚被确认并清掉，不得顺势创建新请求；剩余新稿须下一次明确提交。

只有解析正文与待确认原载荷相同、可见提示标识原ID时，普通Main明确提交才重试。不同正文保留，仅命运未解决时阻塞，不暗发旧请求。已证明未送达/明确拒绝后原始输入可正常编辑或放弃；未改原稿可复用ID，改后是新明确请求。每次发送重新验域/API/mode。既有CoreClient.command()重发持久正文即可，Core按canonical {owner,path,body}取指纹，等价JSON序列化不改变身份，不新增专用传输方法，绝不从已编辑草稿重建旧请求。409冲突保留证据、不换ID、不当成未送达；鉴权/5xx/传输错误保持未解决、重新attach/对账，不删稿。

只有对应尝试真实返回准确错误码 INVALID_REQUEST（schema）、INVALID_INPUT、INVALID_JSON、REQUEST_TOO_LARGE才算明确接收前拒绝；排除401/403、409、503 CORE_STOPPING/BUSY、500与传输错误。按固定API准确错误映射判断，必要时小型typed API error保留HTTP状态，不宽泛匹配INVALID子串。明确接收前校验拒绝与已接收后的业务失败分开：无新稿时恢复可编辑原文；有新稿绝不覆盖/合并。把被拒文本保存为唯一命名的自有恢复JSON文件，局部恢复条目显示路径和可复制原文，保存成功才释放已解决的待提交槽；恢复条目仍引用时受保护，解除引用后按三年孤立规则保留。新普通草稿之后可发送；恢复材料不是第三份普通可编辑草稿或通用队列。修正后的明确提交使用新ID；冲突不是校验拒绝，不释放槽。验证拒绝竞态及新稿不触发旧请求重试。

只清理本客户端自建的已交接/过期副本，不碰 Core 历史、用户文件、Task 目录。其他孤立/临时材料按 created_at 三个日历年（闰日周年落非闰年 2 月 28 日），活跃草稿/未知请求不因年龄删除。#82 不新增配额，工作状态在结构上限定为两份普通草稿与一个未解决提交；恢复/孤立材料按留存规则，不宣称三年留存下总磁盘量有界。真实磁盘错误保护已有材料并阻断不安全转移。普通多行粘贴仍须保全文、不自动发送；定制折叠块归 #91、图片归 #94，不宣称未实现的来源识别已验收。

## 6. 批准后的实施顺序

1. 登记 macOS/Terminal 版本、字体、尺寸、locale、Node/精确包版本、上游参考，优先复用固定版本test/key-tester.ts。先做薄编辑器/布局预检，在原生终端验证真实中文候选确认、换行/发送、resize、输出时编辑。协议阻塞时记录实际失败交 Master，不用浏览器或合成 IME 替代。
2. 命令/编辑器适配、双页面与草稿状态；原始空白、作用域、组件清空测试。
3. 最小 Task 投影及 schema/DTO 测试，接真实 Core，显示非空 Task 与近期 Main，接同步/锚点及统一渲染。
4. 本地快照、单一待确认恢复、正常退出，验证 POST/回执前后故障与重开；不整体搬回旧实现。
5. 专项、全量检查与原生验收，更新运行/API/证据文档。实施获批后才创建 PR；同一 Claude 会话复核准确最终 SHA、核实 CI、交 Master 终审。合并另行授权。

## 7. 验证和门槛

自动化：实际 Pi API 的解析/编辑器适配，前导空白/多行/字面命令/补全；Markdown 流式结束一致与控制字符；虚拟终端布局/尺寸/锚点（复用固定上游测试辅助，精确devDependency @xterm/headless@5.5.0）；Task RUNNING/等待/ACTIVE 无执行/Shared/最新失败；sync reset/旧连接；真实 Core 的丢回执幂等、重复提交、磁盘失败/损坏快照、新草稿保护、跨域隔离、正常退出重开、可控时钟留存。集成用独立 Core、数据库和数据目录，不用生产数据/凭据。fixture 明确标注，不能满足原生产品门槛。

准确被测提交必须完成 #82 七行：① Main 发送、/T /M，至少一个真实运行和一个真实等待 Task；②重复导航、根 back、resize；③真人系统中文输入法、换行/宽字符、流式编辑、固定 Markdown；④大小写/错页/正文内命令/前导空格/rawmessage/补全矩阵；⑤ Task 独立草稿退出重开、追加 /M 仍是正文；⑥可控失败/丢回执、退出不停止 Core/后台；⑦安静 Main 验证 UI 操作零权威历史。Task 来自真实 Core 执行路径，fixture/组件截图不够；中文输入由真人实机完成并记录，自动化不能认证。缺失则 NOT_TESTED、issue 保持 open，不暗自豁免。

记录环境和首次失败。实施后跑 npm run check、npm run docs:check、专项，再用正确隔离 PostgreSQL DSN 跑 npm run verify。保留 Linux Core/macOS 检查，macOS CI 加 #82 专项，不宣称 runner 证明原生 IME。Linux npm test 会发现所有 offline 文件，专项保持跨平台，原生 helper 延迟加载与 macOS 人工验收分开。本计划尚未运行实施测试。CI、Claude 实施复核、原生产品验收三列分开。映射 AC01 一级页、AC02 基础布局、AC03 默认呈现、AC04、AC25/26/30 及 AC24/28/31 已交付分支，不提前勾选后续内容。

交付同步中英文计划、docs/fix/evidence/issue82-rebuild 脱敏结论、Git 忽略的 `.demo-data/issue82-rebuild/review/` 原始英文请求/回复/截图、运行说明、更新现有 docs/tui/api-coverage.md 台账和准确 SHA 验收表。本阶段止于计划复核后交 Master 明确批准。

## 8. R1 复核处置与明确提案

采纳 B1–B4：应用接管提交与自定义补全；去配额、写准正文总字节限制；补拒绝/冲突/重试；缓存淘汰留 #91。采纳其非阻断建议：mode/data/state 路径、内核锁、真实 Task 顺序/排队标签/增量 schema、不二次截预览、键优先级、resize 锚点/自己发送不跟随、精确虚拟测试依赖和既有API台账。Claude 读过固定源码/需求，未执行测试或安装依赖；issue 读取是摘要且首次陈旧，R2 另提供现行正文原文辅助核对。未知斜杠输入局部报错（含/usr/bin/x等路径样式，通过/rawmessage发送）与空 /send 拒绝仍作为本次交 Master 批准的明确解释，不伪称此前已批准。原生验收门槛保持不变。

## 9. R2 处置与 R3 专项验证

采纳先对账再恢复、原始RAW输入、绑定请求的恢复副本、原子交接/清稿、自动只读对账；按源码简化粘贴和canonical正文重发，补键位测试辅助、未连接输入、底部恢复提示与明确交互提案。不采纳“15秒加余量即可证明未送达”：该计时不是保证未来不会提交的屏障；R3只采用更新同域实例+NOT_FOUND释放，原实例的幂等重试仍需明确提交。请reviewer评估这一更窄而真实的保证，不批准计时猜测。

新增测试：/rawmessage /T、/send /x 原样恢复；恢复前后确认接收；回执到UI更新间重启；绑定Enter不顺势换新ID；新稿保护；新实例NOT_FOUND释放；同实例15秒前后NOT_FOUND仍保留；延迟POST提交/GET竞态；400/413与401/409/5xx区分；StdinBuffer拆包粘贴。本轮无业务实现或运行变更。

## 10. R3 PASS 与已纳入的实施细化

2026-10-30 09:08香港时间读取 Claude Opus 5.5 Extra 的 R3 PASS。它用沙盒Node 22.23.4小实验观察到请求体晚于requestTimeout仍能提交，撤回计时证明。这是reviewer提供的超时语义证据，不是Secretary测试或原生macOS验收。

包括重试在内，每次POST前必须先可靠记录实际endpoint的instance身份，checkpoint失败则不发。测试向新实例重试中崩溃：该实例已记为尝试过，不能再用于“从未向此实例POST”的证明。保留在尝试时或之后观察到的最新sync cursor，用既有changes/position在新实例核验后才能凭NOT_FOUND释放。缺游标、RESYNC_REQUIRED、sequence/digest不匹配或已知数据复制/恢复均保持UNKNOWN。这只是连续性加固，不能证明所有共享相同前缀的外部复制/恢复均会被发现；此类人工恢复超出自动正常重启对账范围，不能暗自当作新的空Store。

attach未成功时Ctrl+C仍可退出，有限频率继续重试，验证成功后启用编辑器。运行说明直说UNKNOWN限制；TUI不重启Core，人工重启可能打断后台工作。专项补每次尝试checkpoint和连续性案例。准确拒绝白名单只有INVALID_REQUEST、INVALID_INPUT、INVALID_JSON、REQUEST_TOO_LARGE；超大请求中途传输中断仍为UNKNOWN。

Master审批对象是完整R3，含未知斜杠/空send解释和单个未解决提交的限制。PASS只表示可交Master决策，不是实施授权、CI通过或产品完成。

### R4 实现复核修订

接受 Claude 实测发现的真实 Core 角色/工具活动映射和 UNKNOWN 原文恢复问题；补充按查询分流刷新、同修订片段保留、退出重连保护及失败翻页一致性。恢复保持同 ID、只读对账后每请求最多一次，不自动重发。详见关联验收记录。Apple Terminal 使用处理时的实时 Shift 状态，最终原生复测增加流式回复期间快速输入；SSH/tmux 未验收，不保证传递 Shift+Enter。
