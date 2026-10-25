# Issue #82 — R4 云端验收与 Linux 前置修订

日期：2026-10-25（Asia/Hong_Kong）。当前范围：修订计划和窄范围 G0/Linux 前置准备；产品实现待委托协调裁决本修订后释放。仓库：https://github.com/ExplodeCode6324/Secretary ，Issue：https://github.com/ExplodeCode6324/Secretary/issues/82 。继续现有 checkout/分支 `codex/issue82-tui-main`，从 `37f6ae3547dfe166ff747c9719461d89d61670bf` 准备，不创建会话/worktree，不访问 provider，不恢复退役 GUI，不部署主机。

## R4.1 当前授权与历史保留

Master 已通过协调直接更改政策：“视觉验收由claude在其独立云端沙盒环境完成，如果claude无法完成则延后，先合并并接着往下做”；Claude 首次等待改为**五分钟**，后续仍五分钟，并补齐云端所需 Linux 前置工作。这覆盖旧的 Mac 必须解锁/真实 IME 后才能实现以及 Linux TUI 一律延期的门槛，不豁免功能缺陷、必需验证、准确 HEAD 复核/CI，也不取消协调对准确 PR HEAD 的单独合并授权。账号/模型不可用仍由 Master 决定 Hermes fallback。#84 的本人日常体验保持待本人验收，顺序 #82→#83→#84，不启动 #70–74。

下方 R3 正文作为逐字保留的历史附录；其中范围、门禁、间隔和 Linux 陈述仅在本节明确覆盖的地方失效，其他业务合同继续作为实现合同。R3 在 `937f3031...` 的 PASS、G0 的 FAIL_PROTOCOL_PROVENANCE 和 Mac NOT_TESTED 均在审查记录与 [G0 交接](evidence/issue82-tui/g0-probe.md) 保留原貌，不追改历史。现有代码是隔离探针，不是产品实现。

## R4.2 证据与延期矩阵

| 层次 | 所需证据 | 环境不可用时的处置 |
| --- | --- | --- |
| 平台/runtime | 实际 OS/Node/Python/fcntl/locale/PTY、准确 SHA、命令与退出码 | 保存前置失败；云端不能执行如实记录，本机/CI 证据独立归属 |
| 功能合同 | 命令/草稿/outbox/同步/身份/有界读取/恢复；完整必需验证及实际 CI | 功能失败必须修复或可靠限制，不能归入视觉豁免 |
| PTY/headless 渲染 | 独立运行探针、raw bytes、尺寸网格、cells/SVG 哈希；能看图时实际审阅 | 无渲染/看图能力可 DEFERRED；生成 SVG 不等于视觉验收 |
| 真实 Linux terminal | 准确终端版本/配置/字体/剪贴板交付/Reset；确有 IME 才测 | 能力缺失记 DEFERRED/NOT_TESTED；不能证明 macOS |
| 真实 Mac Terminal/IME | 拼音按键、候选窗、Enter/Space、raw/动作轨迹、布局复制/Reset/窗口关闭 | 不重试解锁，记 DEFERRED/NOT_TESTED；环境原因本身不阻塞实现及获批合并 |
| 协议来源 | 反例和明确的生产安全边界/修复 | 继续 FAIL_PROTOCOL_PROVENANCE，不能用时间/分块或同通道二次确认伪造来源 |
| Master 日常体验 | #84 的实际本人使用 | 保持待本人验收，不阻塞其余可做工作 |

云端产物必须由 Claude 独立运行生成，Codex 的 PNG/日志只是参考。分别记录字体替代/缺字、截断、光标/底栏布局及实际操作。合并后在原 issue/交接保留延期项，不改写成验收通过；完整 API 清单/消费者文档、必需验证、同会话准确 HEAD 复核和实际 CI 仍是协调合并前条件。

## R4.3 当前获准的 Linux 窄范围前置

- 保留 pi-tui `0.87.0` 与 Pi 子模块；仅添加固定开发依赖 `@xterm/headless@5.5.0` 供隔离证据渲染，不给产品新增浏览器/GUI/xterm 程序依赖。
- macOS/Linux 均固定 `/usr/bin/python3`+fcntl；macOS 先做不触发安装的 CLT 检查，Linux 直接核实解释器。限时调用、明确错误、无自动安装。helper READY 前忽略终端进程组信号，只用管道，当前原子写完成/失败后处理 BrokenPipe，仅持有自己的锁；Python 显式 UTF-8并记录 locale。
- POSIX helper/renderer 测试不再仅在 Mac 执行，macOS/Linux 外的平台仍跳过；保留 raw mode、输出过滤和模式恢复，不加 native addon 或 OSC52/OSC8 fallback。
- 剪贴板是显式平台能力：Mac 保留有界 pbcopy，Linux 目前返回 UNSUPPORTED，不调用剪贴板子进程或更改剪贴板；不凭 DISPLAY/可执行文件存在等自动猜测后端，不能假报复制成功。
- 有界 PTY runner 运行实际探针，生成 ANSI→cells→SVG 和哈希/尺寸/text；覆盖 80/120/40×24/40/12 及低于最小尺寸、中文/emoji/组合字符、持续输出、raw 输入和 helper 生命周期。headless 宽度/字体可与真实终端不同，标明限制；鼠标/选择/IME/剪贴板分开验收。
- 现有 Core Linux CI 增加窄范围 environment/PTY/render 步骤，Mac 所选测试包含 G0，保留原 Core suites/services。后续仍须实际 CI 结果；Mac 跑 portable code 不等于 Linux 已运行。
- [英文独立运行说明](evidence/issue82-tui/g0-cloud-run.en.md) 提供复现命令和失败报告规则。协调已明确允许将本准备正常 push 到现有分支供 Claude 按完整 SHA 获取，当前不建 PR、不强推。

## R4.4 协议来源功能处置提案

保留的 parser 是刻意暴露缺陷的 witness，不能搬入产品编辑器。同块隔离不能认证下一 raw chunk；多等一段时间、同通道二次确认、TERM 检测或粘贴预览都不能区分相同字节流。Reset 还可能在下次 redraw 前丢失 bracketed framing。

**推荐分阶段边界 P1，待 reviewer/协调裁决：** 产品命令/持久状态/Core 路径置于带类型的输入来源边界之后。**未验证的原始终端只允许读/编辑字面数据，不派发动作**：文字不能授权发送、执行命令、丢弃、切换草稿、对外复制或退出；OS 信号仍可进行有界安全退出。live POST 和这些动作须来自已支持的输入生产者，其粘贴路径必须独立于分块/Reset 排除动作控制字节注入。不得添加用户自行声明的 `--trust-terminal` 绕过，也不能以一次样本证明完整安全。功能测试可用受控合成事件验证该类型边界，但不是终端认证。

候选生产者是准确 Linux xterm build 加进程局部资源策略，始终排除 paste 控制字节，不依赖 bracketed mode。[xterm 官方手册](https://invisible-island.net/xterm/manpage/xterm.html) 记载 `allowPasteControls` 及排除集合；这里只是研究候选，**没有批准换终端，也没有声称 Terminal.app 如此**。采用前必须完成源码/配置分析和独立真实剪贴板/Reset 证据，保留“终端交付文本”的合同并记录生产者拒绝了什么。`TERM=xterm` 或 headless xterm.js 都不是这个生产者。本提案不授权修改 Master 机器的全局资源或安装软件。

若云端无法建立这样的生产者，P1 可继续实现/复核基础功能并让原始终端动作保持锁定，**但只有协调明确接受这项交付缩减才可据此合并**；不得描述成已可用的完整 live terminal client，也不关闭 #82 的交互验收条件。P2 是另行明确复核的结构化输入传输，把 key/paste 来源分开；属于实质范围/UX 变化，须先交协调再编码。本前置没有实现 P1/P2；请 Claude 给出具体选择/修正及仍应阻止的命令/动作，不能把功能裁决混入非阻塞视觉延期。

## R4.5 后续执行与当前证据

1. 验证窄范围准备、push 准确提交；向同一 Claude Opus 5.5 Extra 会话提交**完整英文 R4+历史 R3 正文**、repo/issue、准确 SHA、原 G0 证据与 runbook；核实模型。首次与后续均五分钟，不提前轮询。
2. Claude 先报告独立沙盒 OS/runtime/GUI/渲染能力，再真实执行可行检查，返回命令、退出码、产物/截图和限制；分别判定计划可实施性、协议处置与视觉环境状态。
3. 交协调修订差异、原始复核结论和独立证据后释放产品实现。仅视觉能力缺失不能恢复旧的无限 Mac 门禁，不要求 Master 重批相同授权；账号/模型失败仍单独处理 fallback。
4. 获批后实现范围内 C1 合同，更新全部 API 行/消费者，完整必需测试/docs/formatting、实际 CI、准确 PR HEAD 代码/功能复核，再取协调明确合并授权；原 issue/交接保留延期验收。

历史 Mac G0 的7项有限检查、PTY生命周期、36字节剪贴板往返通过，但协议来源失败、真实 Mac UI/IME不可用。R4 portable 准备目前仅本机 macOS 已验证，Linux/Claude 执行以其实际结果为准。当前 npm audit 还报告原有 transitive fast-uri advisories（锁条目未改）；本次不进行无关 audit-fix 升级，另交协调处置。

---

## 历史 R3 计划 — 以下保留原始正文

# Issue #82 — macOS TUI 基础与可靠 Main（R3）

日期：2026-10-24（Asia/Hong_Kong）。范围：**仅计划**，实施待协调批准。仓库 [Secretary](https://github.com/ExplodeCode6324/Secretary)，[Issue #82](https://github.com/ExplodeCode6324/Secretary/issues/82)。基线 `f2f3c1929bfb3e2f40e67868861f41f7e94e781a`，分支 `codex/issue82-tui-main`，使用现有 secretary-core checkout。[完整英文计划](fix_20261024_issue82_TUI基础与Main.en.md)与本计划共同约束实施。浏览器 Claude **Opus 5.5 Extra** 使用本项独立会话复核；协调代 Master 审批计划，合并仍需准确 PR HEAD 的单独授权。

## 1. 范围与核实事实

交付从零实现的 TypeScript TUI：固定底部输入、默认 Main、Task 明确占位及独立草稿、确定性命令、可靠 outbox、顺序粘贴、CoT/历史有界读取、重连与冷启动一致性、客户端独立退出。复用 CoreClient、生成 DTO 和本机 HTTP/SSE。不重写 Core 业务/恢复策略，不迁移旧客户端，不提前实施 #83 的 Task 操作、图片/剪贴板导入及外部查看器，不做结构化引用、一次性业务 CLI、Linux TUI 或 #70–74 优化。#84 承接真实 provider 准备和 Master 日常体验。

已核实 main/origin/main 均为基线，tracked clean；393 个继承未跟踪报告已列清单并保留。#79/#80/#81 经 PR85/86/87 合并。现有 Core 进程、数据、分支、日志以及 Portable/Band 均不动，只管理本项创建且可确认归属的测试资源。API 当前 86 项（GET 52、POST 34），新 TUI 消费者 0；#81 fixture/loopback 结果不能算真实 provider 成功。

源码依据位于 `src/pi_secretary/src/`：`core-client.ts`、`api-v1.ts`、`api/contracts.ts`、`application-service.ts`、`sync-service.ts`、`sync-stream.ts`、`timeline.ts`、`conversation.ts`、`thinking-preview.ts`。需求依据为 `docs/tui/requirements-and-backend-plan.md` 的 IN/CMD/PASTE/REL/VIEW/RUN/AUTH 规则。

固定历史行为参考：[conversation.rs@1e450d4](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/conversation.rs)。4–50 行保护失败/未知原文、超出前 50 项仍可访问并拒绝跨域；52–85 行容量满拒绝新意图但保住草稿；87–103 行拒绝危险 URL。前两项写入 AC11/AC12 与 PASTE-04 可靠性用例，PASTE-03 另验证完整文本展开，第三项在 C1 无外部导航及 #83 后续 URL/argv 约束中保留。不复制或恢复 Rust 实现，不把旧测试当新产品证据。

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

状态放所选 Core data/profile 下独立 `tui-v1/`，不写 Core Store。检查所有权和 symlink，目录 0700、文件 0600，不将 token 写草稿或日志。状态根采用内核 flock 与唯一写者 helper，进程死亡后释放；具体见 R2 实施约束。不得用遗留 PID 文件阻止正常崩溃恢复。按 `data_domain_id`、API version、mode 分区；instance_id 只表示连接世代。端点替换/重连/对账/发送前重新 attach 校验。跨域/API/mode 保留隔离草稿/outbox/cache/清理凭据，不自动迁移、重放或依新域删除；同域重启换 instance/token 可重新连接。

采用小型 fs 原子 manifest + 不可变正文/paste blobs。先 exclusive create 写 blob 并 fsync，再把完整带版本 manifest 写临时文件、fsync、rename、目录 fsync。串行写者一次提交草稿引用、outbox 和该精确 revision 的草稿交接；只有持久完成才允许 POST。写失败保留旧已提交状态并提示未保存/禁止发送。输入可先显示，但保存完成前明确未持久；不声称未刷盘按键抗掉电，正常退出等待保存。损坏文件保留报错，不自动 reset；启动检查 schema/hash/大小/引用/归属。逐一注入 blob、manifest、rename、清理崩溃，要求恢复旧或新完整状态且不丢唯一正文。

冻结 method、route、完整 JSON（request_id、原文、有序 attachment_ids）、序列化字节/hash、绑定、视图/revision。请求体全 JSON **1,048,576 UTF-8 字节**上限，同时检查 schema/text 限制，超限保留原稿不截断。C1 产品为文本发送；结构预留有序附件 ID/input 状态，不静默丢未来非空附件引用，不假装已有图片 UI。

状态：saved draft → durable PREPARED → SENT/UNKNOWN → RECEIVED（权威回执）→ 最小交接记录。断线/超时/崩溃不等于拒绝；未知项在原绑定 GET `/requests/{id}`。匹配回执证明接收，先持久回执/交接再释放正文；只有原绑定真正 NOT_FOUND 才可相同 ID/相同冻结请求重试。鉴权/网络/版本/域错误不是 NOT_FOUND。不得自动换 ID。明确前置拒绝保留可修改原文，原拒绝已确认后用户修改并显式提交才能成为新意图。冲突保留报错。重试串行，1–30 秒有界退避，每项至多一个在途，总并发 1；启动未知项自动对账，明确失败需显式重试/修改。

接收与业务终态分别展示。POST/动画不代表完成；显示 Input/message/session 权威排队/运行/完成/失败/未知。acceptance=ACCEPTED 即使 receipt.state=FAILED 仍是可靠接收，持久最小审计后可释放重复正文，历史留 Core；未知交接原文通过分页 /outbox 始终可达，不限首 50 项。

只删除已确认本 TUI 创建且处于受管根的 blobs，绝不删源文件；扫描所有草稿/outbox/域引用。回执持久后幂等清理，清理前 crash 重做。用户明确删除的无引用草稿片段可立即删；未知/在途 outbox 不可丢弃。其他孤儿/暂存默认从持久 created_at 起 **三个日历年**，记录时区（默认 Asia/Hong_Kong），2 月 29 日对应周年夹到 2 月 28 日，不用 1095 天。活跃/未知引用优先保护。中断 blob 有 created_at envelope；缺失/损坏来源保留待显式检查。不扩 Core 历史 GC。

默认容量：受管暂存总计 256 MiB、outbox 1,000 个未解决项、manifest 2 MiB、单编辑草稿 4 MiB；配置有限正值。计入旧新原子写入与 crash 残留，预留 manifest 替换和交接元数据空间。满额拒绝新编辑/粘贴/入队，保住旧稿，显示用量与显式清理方式；不驱逐受保护/保留期内孤儿。可丢读缓存独立 8 MiB，不含草稿/outbox 唯一正文。配额、磁盘满均实测。

## 5. 粘贴与显示安全

先按明确规则将终端交付的 CRLF/孤立 CR 转为 LF，其余正文包括 tab 保序，不 trim、不展开 tab、不补路径空格。行数与冻结载荷均使用该可见规范形式；不能宣称恢复 Terminal 已过滤的原剪贴板字节。多行折叠为带 opaque UUID/字节数/行数的 UI 节点；标签不进入正文，手打同标签只是文字。多次粘贴、插入、撤销、编辑/删除保序；展开编辑形成新持久 revision，copy/remove 绑定稳定 ID。必要时显式 copy 用固定 macOS 程序加独立参数/stdin，不经 shell；若原生复制足够则避免助手程序。不自动读取剪贴板或支持图片。只展开一次成为冻结正文，重试不重新读可变外部来源。

存储/请求正文与显示分开；显示时去除/中和不可信 C0/C1/ESC/CSI/OSC、双向控制字符，newline/tab 用受控布局。禁止文字改变标题/光标/剪贴板/链接；不修改冻结正文、不触发解析。测试转义分片、CJK、ZWJ emoji、marker 仿冒。

## 6. 同步、阅读与 CoT

SSE 流式 UTF-8 framing 支持分片码点/行、LF/CRLF、多行 data、注释、event/id、空行 dispatch。解码/单帧缓冲最多 512 KiB；异常/超限重新连接和持久追赶，不推进 cursor 或猜测跳过。校验 DTO/事件身份；只有 change 推进持久水位，transient/heartbeat 不推进。单一重连循环有界退避，退出可取消。

初始化/重建：绑定 → GET sync/cursor C0 → 读有界 Main snapshot/session → 从 C0 按 100 tx/页追赶，应用 invalidation 并刷新窗口 → 一致提交视图/水位 → 从已提交 cursor 开 SSE。异步 fetch 标记 generation，切页/域/instance 后忽略旧响应。快照重叠变化按权威刷新或稳定 revision 合并，不能倒退。事务整批应用，水位仅与相应 snapshot 或持久 pending invalidation/rebuild 标记一起落盘；刷新失败不能丢标记后推进。内存/已驱逐窗口冷启动必须重建，旧 cursor 不能代表缓存还在。RESYNC_REQUIRED 只重建派生缓存，保护草稿/outbox；具体 marker/snapshot 机制写测试。

transient 按 message_id/call_id 替换；durable 同身份接管，保留 event/message 锚点，不叠重复。expired/missing 不能证明没有 durable event：脱敏空 stop/tool-only 可有意省略。不虚构失败，不改 Core recovery policy。空失败/截断/部分回复沿用 #80 身份，不能污染上一条回答。

默认 thinking=false，显示服务端 20 grapheme thinking_preview；服务端已有 U+2026，可合法以换行+省略号结尾，客户端不重复附加或按 code unit 重截。`/cotvisible [message_id] [on|off]` 操作显式/选中稳定 ID，无选择报错；展开才 thinking=true，当前 transient 才 streaming=true。每次至多 4 片或 128 KiB，明确更多提示；/more 有界继续并让出输入；收起取消并隐藏全文。无内容/脱敏不虚构，不后台补全、不改模型参数。

最多 200 timeline rows / 2 MiB 可见正文、8 MiB LRU fragments；首屏 30、历史每页 50、单 loader，不无界串读。cache key 含绑定、instance、ID、revision、thinking/streaming、fragment cursor。instance 改变或 CURSOR_EXPIRED 失效分页 cursor，按 message_id/event_id `/timeline/around` 定位再有界读取。永久书签是视图+稳定 ID+grapheme/行偏移，不能是 cursor。流中保持阅读位置，显示新消息数，/latest 显式转最新；resize 从相同锚点重算。锚点缺失明确提示降级。

#80 graceful-stop fixture reopen RECOVERY_BLOCKED 是已记录事实；length 持久后 finish 前 crash 导致 replay Agent.continue 失败仍是未验证源码推断，留 #84。若实际阻塞 #82 硬 gate，保存首败交协调裁决窄范围增修，不擅自豁免或扩改。

## 7. 文件/API 与交付

新模块 `src/pi_secretary/src/tui/` 包括 entry/app、terminal/editor、commands、state/outbox、paste、sync、history/render/theme；测试 `test_case/offline/issue82/`；G0 探针在 `src/pi_secretary/scripts/`。增加交互 TTY-only `npm run tui`，无一次性 send 参数。C1 两种模式都只 attach，禁止自动调用 startCore，具体身份/错误/退出策略见 R2；不注册 core/stop，不向 Task child 传 owner token，不声称同账号强隔离。CoreClient 必须补 typed error/status、abort/bounds 与直接发送冻结 UTF-8 字节的 commandFrozen，保持既有调用兼容。

预计消费 10 项：GET core、session、requests/{id}、timeline、timeline/around、messages/{id}/content、sync/cursor、sync/changes、sync/stream；POST messages。活动基本信息来自 timeline/transient；仅实际有详情交互才加 activities/{id}。无新增 Core operation。`docs/tui/api-coverage.md` 保留当前全部 86 method/path，已用列实际 file/function，未用按原因明确；fixture 不算产品消费。更新需求状态、操作/键位说明；生成/本地化遵循既有脚本。

保留 #81 约束：K=0，后续 loop 只有认证元数据，再看像素要显式重发 ready attachment ID；预留有序 ID/input/withdraw 状态，不声称相邻自动看图或 #83 命令已完成。仅 PNG/标准 JPEG，MPF/HDR gain-map JPEG、HEIC 不支持，不静默转换。R1 已完成 docs/fix README 的 #81 PR87 已合并/main CI 通过与最终评论跟进，历史证据未改。

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

## 9. R2 明确实施约束（替代 R1 中未定机制）

Claude 对精确 R1 `78f9aa00fd3e8ef9a3982f4027a9daaa355ecc76` 给出 CHANGES_REQUIRED。以下九项全部采纳，并与英文 R2 对齐；依然仅计划，不能当 G0 或产品已通过。

1. **启动/连接**：C1 在 fixture/live 均只 attach，无自动启动。必填绝对 `--data` 与 `--mode fixture|live`，或显式绝对--config文件（位于Core data外，owner-owned/非symlink/0600）的同等配置；不取 cwd/.demo-data 默认值、不以进程环境猜 mode。头部/help 显示实际 profile/mode。结果区分 ATTACHED、STOPPED（仅端点缺席的非权威提示，显示“未运行或正在启动”）、UNREACHABLE（拒绝/超时/启动未完成）、IDENTITY_MISMATCH、MODE_MISMATCH、UNSAFE；TUI绝不打开/探测/获取Core owner.lock或其他Core数据文件，只读core-endpoint.json与自己的tui-v1子目录；缺端点本身不代表可启动。所有错误/wrong-mode 均测试零 spawn。提示独立 Core 生命周期命令，live 指向 npm run start:live；TUI 不读取 provider keys/DB URL，不调用 startCore。未来显式 fixture bootstrap 需另行批准。
2. **传输结果**：保留 HTTP status/code/v1 envelope/route/network failure，响应有界，支持 AbortSignal。commandFrozen 校验 hash 与 request_id 后逐字节发送冻结 JSON，不重新 stringify。有效 v1 202 且 ID/command=messages 匹配方可认证 POST 接收；GET requests 返回嵌套 receipt/result/resources，不能当裸 Receipt。原绑定重新 GET core 校验且路由可用的 GET requests/{id} 404+v1 JSON NOT_FOUND 才允许同 ID/bytes 重试。INVALID_REQUEST/INVALID_INPUT/INVALID_JSON/REQUEST_TOO_LARGE/UNSUPPORTED_MEDIA_TYPE 的预期 400/413/415，且没有更早未知尝试，才判明确前置拒绝；否则先对账。409 REQUEST_CONFLICT 保留隔离；401 重 attach 再对账；版本/mode/域/安全错误隔离；其余4xx、5xx、非JSON、abort/timeout/断线全部 UNKNOWN，不删正文。GET 回执无指纹：若原成功 POST ACK 丢失，先查询，再以相同冻结 bytes/ID 重入让 Core 校验指纹，成功匹配后才交接清理；“冲突响应丢失+GET同ID不同正文”必须负向测试。
3. **outbox**：每次 POST 前必须先 fsync attempted=true；只有 attempted=false 的 PREPARED 才可与 dispatcher 串行 discard，已经尝试且仍UNKNOWN的项即使 NOT_FOUND 也不据此删除可能仍在途的请求。每绑定持久 enqueue sequence FIFO，UNKNOWN 头阻塞后续。确定前置拒绝移为 NEEDS_EDIT 并保正文，可显式discard，明确提示后后续可继续；用户显式编辑提交才形成队尾新意图。1,000 上限只计未解决状态；完成最小回执移入 manifest 外分页归档，manifest 只留有界最近索引，归档字节仍计256MiB。created_at 三周年且清理已完成/无引用才可回收，未完成清理票据受保护，不能1000条成功后永久卡住。
4. **粘贴**：CRLF/CR→LF 是唯一预先规范化，tab等保留。G0 必须粘贴 ESC[201~+Ctrl+S/G/C、重复/嵌套结束标记、含控制码内容，记录真实字节和零动作。自有 Terminal adapter 在原始 stdin 进入 key dispatch 前处理粘贴；含结束标记同一raw chunk的后续控制码隔离，不执行。但这不是对任意分片的完备证明；若 Terminal 把嵌入结束标记/控制码作为可执行输入交付，**G0失败，停止产品实施**，交协调选择有证据的安全终端/协议或经审查的独立提交方案，不用时间启发式伪称解决。
5. **导航/复制/状态**：Ctrl+U/D 半屏滚动，PageUp/Down（Mac实际对应键）在G0验证，方向键编辑；/select <message_id> 明确选择，供无参CoT使用；Ctrl+Z/Y撤销/重做，Ctrl+O通过公开copyActiveSelectionToClipboard与固定callback显式复制当前app选区；无选区只提示不改剪贴板。固定输入状态始终显示视图、NORMAL/LITERAL/COMMAND、Main或“本地草稿；/send→Main”目标、SAVED/SAVING/ERROR。TuiAltScreen 固定 mouse=true、copyOnSelect=false、openUrl未设、无右键粘贴、无OSC52/OSC8。显式 /copy <message_id> [loaded] 通过固定 /usr/bin/pbcopy stdin复制，LANG/LC_CTYPE=en_US.UTF-8，不经shell；默认最多四片/128KiB且正文完整，否则不改剪贴板，解释显式loaded仅复制标识清楚的已加载片段。pasteblock copy最多4MiB。G0比较alt/main screen复制，布局仍须固定底部；重大renderer改变交协调。
6. **锁与退出**：参考既有 lock.py 模式新建小TUI helper，只有它持flock并写全部blobs/manifest/清理，不触Core journal/lock协议；Node父进程不越过helper写。固定路径/argv、最小环境、限长请求ACK pipe；解释器固定/usr/bin/python3（只读盘点3.9.6），G0记录路径/版本与fcntl可用，缺失明确报前置失败不自动装；helper在READY/持锁前忽略SIGHUP/SIGINT/SIGTERM/SIGTSTP，普通生命周期仅由stdinEOF或显式close结束；SIGKILL仍释放内核锁。父死stdinEOF，helper完成或失败当前事务后退出释放；helper死立即阻止后续写/POST。测试双开、父SIGKILL、helper kill、重启。ambiguous仅指unsafe路径/归属或不响应活锁持有者，不杀其进程。/quit、Ctrl+C、SIGINT、SIGHUP、SIGTERM、uncaught exception、unhandled rejection统一幂等关闭：停止接入/发送、abort网络、最多2秒flush、finally恢复bracketed paste/mouse/modifyOtherKeys/alt-screen/cursor/raw模式、关pipe。stop({preserveScreen:true})避免退出倾倒聊天；终端消失尽力恢复，未保存不冒称保存，SIGKILL仅恢复最后持久状态。窗口关闭纳入G0/Core继续运行测试。
7. **同步**：采用独立于draft/outbox manifest的view-checkpoint.json（≤64KiB），含≤2MiB body-only Main/session snapshot引用、binding/instance/timeline generation、最后完整应用cursor、dirty keys并集及各键dirty generation。唯一helper优先attempt/handoff和draft，checkpoint仅一个在途+一个可替换合并待办槽，500ms合并而非每SSE事务fsync。内存应用完整事务并保存最新cursor/dirty并集，不阻塞SSEreader/编辑；cursor+dirty原子持久后才准把刷新结果durably清dirty，fetch可先运行但ACK后按generation发布，更新失效保留。snapshot先fsync再small checkpoint，两者属独立8MiB可丢缓存。失败保持旧durable checkpoint/dirty义务并标stale；输入不等view进度，最多遇到已在途单次有界I/O。重连从durable checkpoint重放未落盘变化。接收队列最多256事务或2MiB，溢出断流并标stale，从durable水位追赶，不跳水位。必须测200tx/s持续30秒同时编辑发送、每fsync注入20ms：draft/attempt ACK从请求起≤500ms（不含autosave debounce），输入到render p95≤100ms/max≤250ms，checkpoint待办至多一个。真实Terminal fixture burst另记录延迟；失败属C1响应问题，不弃持久性或借机启动#70–74，不承诺任意坏盘/阻塞下时限。冷启动缓存只作stale/offline显示，始终新C0重建；逐出先持久标记absent/dirty再删除，RESYNC_REQUIRED只重建派生状态。timeline revision/generation仅同instance/generation内可比，绝不与SyncChange record revision比较。处理TIMELINE_RESET_REQUIRED 409、CURSOR_EXPIRED、TIMELINE_ITEM_NOT_FOUND 404，重定位或明确降级；不是请求NOT_FOUND。15秒无字节watchdog标stale重连，503 BUSY退避。SSEPreview.id映射message:<call_id>，但保留服务端实际ID/source_event_id，异常历史可为event_id；本地pending按request_id与durable行替换。
8. **草稿持续性补强**：typed body存blob，2MiB manifest只存元数据。150ms idle合并保存，连续输入最多1秒触发，仅一项在途；send/切页/quit前flush。undo最多20操作/512KiB替换文字；更大替换在应用前明确不可撤销提示。新revision持久且无draft/outbox/undo引用后，记录superseded_by票据，才可删除被用户编辑替换的旧逻辑draft存储副本；它不是每个按键新建的三年档案。无明确replacement/discard/handoff票据的真实孤儿仍三年，不因配额删。测试大稿反复编辑、undo引用、supersession前后crash。CoT/content每动作最多四片/128KiB已解码内容，单response另设1MiB wire cap且流式计数；实际baseline每text/thinking字段截为28,000 JSON bytes，导出FRAGMENT_BYTES不是实际字段cut；合并片调度前最多预留56,000解码UTF-8 bytes并计实际量，不能跨128KiB剩余预算。
9. **真实输入补充**：G0增加marked text/候选中Ctrl+S/G/C、Enter/Tab及LF/CRLF原始字节、鼠标滚轮/选择、窗口关闭。优先自有Terminal adapter实现pi-tui公开接口与raw输入framing，避开ProcessTerminal每个CR触发AppKit Shift探测/可选native clipboard；published renderer若不能适配则记录依赖交协调，不能悄悄加载。CR/LF/协商Shift+Enter都按换行。真实IME规则仍不降级。

其他采纳：/send必须精确为命令结束或后接单个ASCII空格，只剥离该一个分隔空格，其后空白保留；/sendx未知，/send后立即换行不作有效命令前缀。/cotvisible的on/off按枚举区分，其余必须稳定ID，可再跟on/off。空白预检遵守JS trim（含U+3000），只是本地建议，Core仍权威。InputState为ACCEPTED/CLAIMED/HANDLED/WITHDRAWN，与Receipt状态、Message.outcome独立标记，HANDLED不是回答成功。

跨域UNKNOWN保持保护，提供手工export/relocate文档而非自动丢弃：关闭TUI确认无锁持有者，复制整个自有client状态根至用户选定私有备份，校验hash/manifest/引用，然后把整个profile归档移出活跃配额目录。保留原ID/绑定/正文供未来对账，不标拒绝、不换ID重发、不动Core/源文件；C1不另做in-app abandon命令。

## 10. R3 复核修订与剩余门槛

Claude R2 精确复核7330c920d2d1ad1963969a9c38e2df9df7aa3e18，确认九项R1已解决，另提四项窄CHANGES_REQUIRED。R3全部采纳：STOPPED非权威且不碰Core锁；helper忽略终端进程组信号；独立small checkpoint合并低优先级写/有界reader队列/具体响应测试；Ctrl+O显式选区copy。上节对应机制已替换。

补充非阻塞意见亦采纳：G0用合成CJK/emoji验证pbcopy→pbpaste UTF-8往返；禁用内置altScreen search/next/previous/close、prompt-jump/top/bottom，仅配置约定page/half-page，Home/End回归editor、Ctrl+G不被search截走并实测有效键图。PTY hangup+queued save验证helper与ACK/未保存状态，不能当IME证据。Terminal Reset后立即输入/粘贴纳入G0，focus-in/redraw重设bracketed-paste等模式；若Reset后仍丢控制码来源，同样G0硬失败。真实G0仍NOT_TESTED。

有界内存undo在崩溃后可能留下其有界正文作真实孤儿，保留三年，除非存在明确持久supersession/discard票据。fixture/live均attach-only是协调待批准的RUN-01范围取舍，C1落地时明确写入requirements状态，不称已实现startCore复用。未扩业务或Core恢复范围，待R3复核与协调批准。
