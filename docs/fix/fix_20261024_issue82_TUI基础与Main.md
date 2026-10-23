# Issue #82 — macOS TUI 基础与可靠 Main（R1）

日期：2026-10-24（Asia/Hong_Kong）。范围：**仅计划**，实施待协调批准。仓库 [Secretary](https://github.com/ExplodeCode6324/Secretary)，[Issue #82](https://github.com/ExplodeCode6324/Secretary/issues/82)。基线 `f2f3c1929bfb3e2f40e67868861f41f7e94e781a`，分支 `codex/issue82-tui-main`，使用现有 secretary-core checkout。[完整英文计划](fix_20261024_issue82_TUI基础与Main.en.md)与本计划共同约束实施。浏览器 Claude **Opus 5.5 Extra** 使用本项独立会话复核；协调代 Master 审批计划，合并仍需准确 PR HEAD 的单独授权。

## 1. 范围与核实事实

交付从零实现的 TypeScript TUI：固定底部输入、默认 Main、Task 明确占位及独立草稿、确定性命令、可靠 outbox、顺序粘贴、CoT/历史有界读取、重连与冷启动一致性、客户端独立退出。复用 CoreClient、生成 DTO 和本机 HTTP/SSE。不重写 Core，不迁移旧客户端，不提前实施 #83 的 Task 操作、图片/剪贴板导入及外部查看器，不做结构化引用、一次性业务 CLI、Linux TUI 或 #70–74 优化。#84 承接真实 provider 准备和 Master 日常体验。

已核实 main/origin/main 均为基线，tracked clean；393 个继承未跟踪报告已列清单并保留。#79/#80/#81 经 PR85/86/87 合并。现有 Core 进程、数据、分支、日志以及 Portable/Band 均不动，只管理本项创建且可确认归属的测试资源。API 当前 86 项（GET 52、POST 34），新 TUI 消费者 0；#81 fixture/loopback 结果不能算真实 provider 成功。

源码依据位于 `src/pi_secretary/src/`：`core-client.ts`、`api-v1.ts`、`api/contracts.ts`、`application-service.ts`、`sync-service.ts`、`sync-stream.ts`、`timeline.ts`、`conversation.ts`、`thinking-preview.ts`。需求依据为 `docs/tui/requirements-and-backend-plan.md` 的 IN/CMD/PASTE/REL/VIEW/RUN/AUTH 规则。

固定历史行为参考：[conversation.rs@1e450d4](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/conversation.rs)。4–50 行保护失败/未知原文、超出前 50 项仍可访问并拒绝跨域；52–85 行容量满拒绝新意图但保住草稿；87–103 行拒绝危险 URL。前两项写入新 PASTE-03/04 针对性用例，第三项在 C1 无外部导航及 #83 后续 URL/argv 约束中保留。不复制或恢复 Rust 实现，不把旧测试当新产品证据。

## 2. 框架、终端与首个实施门槛 G0

只读盘点发现 Terminal.app **2.14**、Node **22.22.0**；/Applications 未发现 iTerm/Ghostty。首个支持目标选择系统 Terminal.app，实际 macOS、终端 profile/字体/尺寸/输入源在 G0 记录。当前 CUA 报告 Mac 锁屏，真实终端与 IME 为 **NOT_TESTED**；Chrome 扩展仍可操作。不以安装存在替代可用验收，无法解锁或真实输入时交协调裁决，不越过 G0。

首选固定 `@earendil-works/pi-tui@0.87.0`，已只读核对 npm 版本/integrity；尚未安装。Pi 子模块 `16787ad5b2dc748047f314ca1bfe7708f30f54f3` 含对应源码，TuiAltScreen/VStack/ScrollView 提供固定视口、宽字符与粘贴基础。G0 先核实实际 npm exports。对比候选 [Ink 上游](https://github.com/vadimdemedes/ink)：可行但多一层 React，可靠编辑器仍需自建。子模块不改；首选不能过门槛时带失败与替代方案交协调，不自行重大换框架。

stock Editor 的粘贴会归一化/过滤、展开 tab，并用可编辑 marker 字符串查正文，不能直接作为可靠草稿模型。新建小型结构化编辑器，复用渲染/按键/字符宽度原语；节点保存正文或不可变 paste ID，文字标签不拥有数据。不得引入 coding-agent 运行时或模型路由。

批准后首先做隔离输入/布局小验证，无真实 provider：Terminal.app 中启动退出、底部固定、80/120/40 列与 24/40/12 行、持续模拟输出中编辑、中文/emoji/组合字符、选择复制、多段/分片 bracketed paste。真实系统中文 IME 必须通过按键拼音输入、可见候选窗、Enter/Space 候选确认、不误发计数、显式提交一次的动作链验证。直接插入已合成中文、PTY 或单张截图都不是 IME 验收。留时间、终端/输入法身份、动作与输入事件/提交计数、必要截图；仅用合成数据。工具无法生成真实 composition 时，把就绪探针与步骤交协调安排真人操作。

具体键位：**Enter 换行，Ctrl+S 提交，Ctrl+G 命令栏，Ctrl+P 强制纯文本开关，Tab 仅补全，Esc 退出候选/命令栏，Ctrl+C 或 /quit 退出 TUI**。G0 必须验证 raw mode 下 Ctrl+S 不被流控吞掉；不依赖 Cmd+Enter/Shift+Enter。可配置键位必须唯一且目标终端可区分。命令栏与当前草稿分离，导航不会抹掉草稿；普通编辑区整次键入命令也可解析，纯文本开关是直接动作。只以 bracketed paste 作为原子粘贴；不支持时不能用可误执行的启发式冒充通过。

布局：顶部一行视图/Core 模式/域后缀/连接；中部滚动正文；底部固定 3–6 行编辑器与一行状态/键位。小于 40×12 显示 resize 提示，保留草稿并禁止提交。Task 明示“操作在 #83 提供”，允许 /M、/help 和显式 /send。可加可关闭的节流加载动效，不代表成功。

颜色沿用 `docs/tui/color-provenance.md` 精确来源：浅主题蓝 `#285ea6`、浅蓝 `#8bbde0`、故障红 `#b84550`；深主题 `#79acd9`、`#b1d5ec`、`#ed8791`。默认深色，可配浅色；truecolor 原值、256 色记录最近色映射、16 色/无色保留文字状态与对比。选择复制可读性纳入 G0。不渲染任意 ANSI 或 OSC 链接。

## 3. 确定性输入/命令

单一声明式注册表覆盖大小写敏感名称、别名、作用域、参数、帮助、补全、handler。全局 `/M`、`/T`、`/help [command]`、`/send [literal text]`、`/quit`；Main `/cotvisible [message_id] [on|off]`（别名 `/cotv`）、`/more <message_id>`、`/latest`、`/history [before|after]`；两视图的本地草稿/outbox 操作 `/pasteblock <id> <expand|collapse|edit|remove|copy>`、`/outbox [request_id]`、`/retry <request_id>`、`/discard <request_id>`。discard 仅限安全拒绝或从未发出的项，未知态拒绝删除。名称若微调须在实现复核前记录，语义不得变。Task `/cancel` 与 #83 的 `/attach`、`/paste`、`/open` 保留明确 NOT_IMPLEMENTED 帮助与错误，不能伪装完成。

只解析非纯文本模式、从键入斜杠开始的整次独立提交。粘贴节点、/send 字面载荷、消息中间、模型/工具输出均不递归解析。未知斜杠报错且保留，不自动转消息。除 /send 外：ASCII 空白分词，单双引号及引号/反斜杠转义；拒绝未闭合引号、错误/重复/多余参数、控制字符、换行串联和 shell 操作符。无 eval、shell、插值、管道、模糊目标或命令串联。/send 后余文全部字面化，包括分号、斜杠、引号与换行。

Main 普通提交冻结当前草稿发出；功能页普通文本/纯文本提交只保存并提示 /send。命令栏单独 `/send` 发送当前页草稿；带正文时是显式替换候选，若会覆盖已有非空草稿，显示新载荷并要求第二次显式提交，取消保留原稿，不能拼入隐藏旧草稿。普通编辑区 `/send 正文` 仅去前缀并发送显式正文/已加入附件 ID。无文字无附件拒绝。切页/选择/粘贴/补全不发送。冻结后继续输入形成新 revision，迟到回执不能清掉新稿。

别名只做固定名称映射，不带参数、不冲突、不扩大权限/作用域。补全覆盖适用命令、枚举、当前可见稳定 message/paste/outbox ID，最多 20 项并显示辨识信息；短 ID 唯一解析后固定目标并可见。C1 无路径参数，路径补全留 #83 复用注册表。Tab 即使补全 /quit 也不执行。

## 4. 持久状态、outbox 与清理

状态放所选 Core data/profile 下独立 `tui-v1/`，不写 Core Store。检查所有权和 symlink，目录 0700、文件 0600，不将 token 写草稿或日志。状态根独占写锁，过期/归属不明确时明确拒绝，不自动抢锁。按 `data_domain_id`、API version、mode 分区；instance_id 只表示连接世代。端点替换/重连/对账/发送前重新 attach 校验。跨域/API/mode 保留隔离草稿/outbox/cache/清理凭据，不自动迁移、重放或依新域删除；同域重启换 instance/token 可重新连接。

采用小型 fs 原子 manifest + 不可变正文/paste blobs。先 exclusive create 写 blob 并 fsync，再把完整带版本 manifest 写临时文件、fsync、rename、目录 fsync。串行写者一次提交草稿引用、outbox 和该精确 revision 的草稿交接；只有持久完成才允许 POST。写失败保留旧已提交状态并提示未保存/禁止发送。输入可先显示，但保存完成前明确未持久；不声称未刷盘按键抗掉电，正常退出等待保存。损坏文件保留报错，不自动 reset；启动检查 schema/hash/大小/引用/归属。逐一注入 blob、manifest、rename、清理崩溃，要求恢复旧或新完整状态且不丢唯一正文。

冻结 method、route、完整 JSON（request_id、原文、有序 attachment_ids）、序列化字节/hash、绑定、视图/revision。请求体全 JSON **1,048,576 UTF-8 字节**上限，同时检查 schema/text 限制，超限保留原稿不截断。C1 产品为文本发送；结构预留有序附件 ID/input 状态，不静默丢未来非空附件引用，不假装已有图片 UI。

状态：saved draft → durable PREPARED → SENT/UNKNOWN → RECEIVED（权威回执）→ 最小交接记录。断线/超时/崩溃不等于拒绝；未知项在原绑定 GET `/requests/{id}`。匹配回执证明接收，先持久回执/交接再释放正文；只有原绑定真正 NOT_FOUND 才可相同 ID/相同冻结请求重试。鉴权/网络/版本/域错误不是 NOT_FOUND。不得自动换 ID。明确前置拒绝保留可修改原文，原拒绝已确认后用户修改并显式提交才能成为新意图。冲突保留报错。重试串行，1–30 秒有界退避，每项至多一个在途，总并发 1；启动未知项自动对账，明确失败需显式重试/修改。

接收与业务终态分别展示。POST/动画不代表完成；显示 Input/message/session 权威排队/运行/完成/失败/未知。acceptance=ACCEPTED 即使 receipt.state=FAILED 仍是可靠接收，持久最小审计后可释放重复正文，历史留 Core；未知交接原文通过分页 /outbox 始终可达，不限首 50 项。

只删除已确认本 TUI 创建且处于受管根的 blobs，绝不删源文件；扫描所有草稿/outbox/域引用。回执持久后幂等清理，清理前 crash 重做。用户明确删除的无引用草稿片段可立即删；未知/在途 outbox 不可丢弃。其他孤儿/暂存默认从持久 created_at 起 **三个日历年**，记录时区（默认 Asia/Hong_Kong），2 月 29 日对应周年夹到 2 月 28 日，不用 1095 天。活跃/未知引用优先保护。中断 blob 有 created_at envelope；缺失/损坏来源保留待显式检查。不扩 Core 历史 GC。

默认容量：受管暂存总计 256 MiB、outbox 1,000 项、manifest 2 MiB、单编辑草稿 4 MiB；配置有限正值。计入旧新原子写入与 crash 残留，预留 manifest 替换和交接元数据空间。满额拒绝新编辑/粘贴/入队，保住旧稿，显示用量与显式清理方式；不驱逐受保护/保留期内孤儿。可丢读缓存独立 8 MiB，不含草稿/outbox 唯一正文。配额、磁盘满均实测。

## 5. 粘贴与显示安全

节点按终端交付的正文保存 tab/newline 原序列，无隐藏归一化。多行折叠为带 opaque UUID/字节数/行数的 UI 节点；标签不进入正文，手打同标签只是文字。多次粘贴、插入、撤销、编辑/删除保序；展开编辑形成新持久 revision，copy/remove 绑定稳定 ID。必要时显式 copy 用固定 macOS 程序加独立参数/stdin，不经 shell；若原生复制足够则避免助手程序。不自动读取剪贴板或支持图片。只展开一次成为冻结正文，重试不重新读可变外部来源。

存储/请求正文与显示分开；显示时去除/中和不可信 C0/C1/ESC/CSI/OSC、双向控制字符，newline/tab 用受控布局。禁止文字改变标题/光标/剪贴板/链接；不修改冻结正文、不触发解析。测试转义分片、CJK、ZWJ emoji、marker 仿冒。

## 6. 同步、阅读与 CoT

SSE 流式 UTF-8 framing 支持分片码点/行、LF/CRLF、多行 data、注释、event/id、空行 dispatch。解码/单帧缓冲最多 512 KiB；异常/超限重新连接和持久追赶，不推进 cursor 或猜测跳过。校验 DTO/事件身份；只有 change 推进持久水位，transient/heartbeat 不推进。单一重连循环有界退避，退出可取消。

初始化/重建：绑定 → GET sync/cursor C0 → 读有界 Main snapshot/session → 从 C0 按 100 tx/页追赶，应用 invalidation 并刷新窗口 → 一致提交视图/水位 → 从已提交 cursor 开 SSE。异步 fetch 标记 generation，切页/域/instance 后忽略旧响应。快照重叠变化按权威刷新或稳定 revision 合并，不能倒退。事务整批应用，水位仅与相应 snapshot 或持久 pending invalidation/rebuild 标记一起落盘；刷新失败不能丢标记后推进。内存/已驱逐窗口冷启动必须重建，旧 cursor 不能代表缓存还在。RESYNC_REQUIRED 只重建派生缓存，保护草稿/outbox；具体 marker/snapshot 机制写测试。

transient 按 message_id/call_id 替换；durable 同身份接管，保留 event/message 锚点，不叠重复。expired/missing 不能证明没有 durable event：脱敏空 stop/tool-only 可有意省略。不虚构失败，不改 Core recovery policy。空失败/截断/部分回复沿用 #80 身份，不能污染上一条回答。

默认 thinking=false，显示服务端 20 grapheme thinking_preview；服务端已有 U+2026，可合法以换行+省略号结尾，客户端不重复附加或按 code unit 重截。`/cotvisible [message_id] [on|off]` 操作显式/选中稳定 ID，无选择报错；展开才 thinking=true，当前 transient 才 streaming=true。每次至多 4 片或 128 KiB，明确更多提示；/more 有界继续并让出输入；收起取消并隐藏全文。无内容/脱敏不虚构，不后台补全、不改模型参数。

最多 200 timeline rows / 2 MiB 可见正文、8 MiB LRU fragments；首屏 30、历史每页 50、单 loader，不无界串读。cache key 含绑定、instance、ID、revision、thinking/streaming、fragment cursor。instance 改变或 CURSOR_EXPIRED 失效分页 cursor，按 message_id/event_id `/timeline/around` 定位再有界读取。永久书签是视图+稳定 ID+grapheme/行偏移，不能是 cursor。流中保持阅读位置，显示新消息数，/latest 显式转最新；resize 从相同锚点重算。锚点缺失明确提示降级。

#80 graceful-stop fixture reopen RECOVERY_BLOCKED 是已记录事实；length 持久后 finish 前 crash 导致 replay Agent.continue 失败仍是未验证源码推断，留 #84。若实际阻塞 #82 硬 gate，保存首败交协调裁决窄范围增修，不擅自豁免或扩改。

## 7. 文件/API 与交付

新模块 `src/pi_secretary/src/tui/` 包括 entry/app、terminal/editor、commands、state/outbox、paste、sync、history/render/theme；测试 `test_case/offline/issue82/`；G0 探针在 `src/pi_secretary/scripts/`。增加交互 TTY-only `npm run tui`，无一次性 send 参数。复用 attachCore/startCore，退出只关闭连接/raw mode/listeners；不注册 core/stop，不向 Task child 传 owner token，不声称同账号强隔离。CoreClient 仅补必要 typed error/status、abort/bounds 等传输 helper。

预计消费 10 项：GET core、session、requests/{id}、timeline、timeline/around、messages/{id}/content、sync/cursor、sync/changes、sync/stream；POST messages。活动基本信息来自 timeline/transient；仅实际有详情交互才加 activities/{id}。无新增 Core operation。`docs/tui/api-coverage.md` 保留当前全部 86 method/path，已用列实际 file/function，未用按原因明确；fixture 不算产品消费。更新需求状态、操作/键位说明；生成/本地化遵循既有脚本。

保留 #81 约束：K=0，后续 loop 只有认证元数据，再看像素要显式重发 ready attachment ID；预留有序 ID/input/withdraw 状态，不声称相邻自动看图或 #83 命令已完成。仅 PNG/标准 JPEG，MPF/HDR gain-map JPEG、HEIC 不支持，不静默转换。小文档跟进：docs/fix README 补 #81 PR87 已合并/main CI 通过与最终评论，历史证据不改。

## 8. 顺序与验收矩阵

1. 双语计划、源码证据、同会话 Claude PASS、协调批准。
2. **G0 真实 Terminal.app/中文 IME 优先；不可执行/失败就停在门槛交协调，不铺开产品。**
3. 命令/草稿/paste、原子持久/outbox，先故障测试再 API 写入。
4. 接收对账、snapshot/SSE/cold start、有界历史/CoT。
5. 真实终端连接隔离 fixture Core，保留首败、修复和复验；维护 API/docs。
6. check、issue82 针对测试、相关 API/process/80/81 回归、docs/format、完整 npm run verify；必要 PostgreSQL 使用本项独有实例。平台无关测试纳入 Linux 全套，macOS workflow 纳入相关用例；Core Linux/macOS/verify 保留，Linux TUI NOT_TESTED。
7. PR 发布附本会话，同一 Claude 准确 HEAD 复核、实际 CI、协调单独准确 HEAD 合并授权；HEAD/base 变化重查。获准合并后核实 main CI 与实际退出条件。IME/终端未过不能以合并替代结项。

| 门槛 | 必要证据 |
| --- | --- |
| 输入/路由 | 真实 IME 候选确认不发送；换行/提交/宽字符/resize/选择/流中编辑；Main/Task/literal/send；独立草稿；大小写/作用域/参数/Tab 不执行；占位明确 |
| 粘贴/容量 | 多段、tabs/newlines、marker 仿冒/命令粘贴、edit/undo/remove/copy、JSON UTF-8/转义实际上限；超限保稿；三日历年/闰日、活跃未知引用、磁盘满拒收不驱逐 |
| outbox | POST 前后中断/丢回执、fsync/rename/交接/unlink crash、同 ID/同 bytes、冲突、无重复 Input、失败未知原文跨分页可达、源文件不删 |
| 身份 | 同域重启允许；跨域/API/mode 隔离；auth/unavailable 不当 NOT_FOUND；迟到回执不清新稿 |
| 同步/阅读 | SSE 分片/多行/合并/错误/超限；快照/追赶/事务应用中断；RESYNC_REQUIRED/缓存丢失；预览接管与省略边界；空失败归属；resize/restart/cursor expiry 锚点 |
| CoT/边界 | 默认 HTTP spy 无 thinking=true/隐藏全文；emoji/newline/ellipsis/control；显式限额展开/收起/more；取消旧响应；缓存/页数/输入响应 |
| 生命周期 | fixture Core PID/任务在 TUI 退出或 crash 后继续，无 core/stop；再 attach 恢复；既有 Core 不受影响 |
| 报告 | API 逐项消费/未用与位置；完整验证/CI/Claude 原始限制；源码、fixture、真实终端、provider、Master 体验分开 |

计划阶段未改业务、未装依赖、未跑 Core 测试/终端探针，只做源码/配置/库存读取及后续 docs-only 校验。原始英文请求、回复、截图、时间在 Git 忽略 `.demo-data/issue82-tui/review/`；脱敏结论在 [复核记录](evidence/issue82-tui/plan-review.md)。每次提交首次 10 分钟、后续每 5 分钟查看。账号或模型异常交 Master 决定是否 fallback Hermes，不能自行切换。
