# Issue #82：有限回滚为终端 TUI

日期：2026-10-28（Asia/Hong_Kong）。范围：**fix**；计划已在 `493ec825` 获 Claude R3 PASS，终端候选实现中。Master 本次明确要求终端 TUI，取代历史 R7 的浏览器产品选择。本文件不代表实现或验收完成；合并须另行授权。完整英文复核稿见[英文计划](fix_20261028_issue82_terminal_rollback.en.md)。

实施合同索引：英文稿顶部按输入、兼容、发送许可、绘制、生命周期和原生验收列出控制章节（R3 > R2 > R1）；结果见[实施证据](evidence/issue82-terminal-rollback/implementation.md)。新增后台进程组 PTY 测试暴露切屏后的读取阻塞，现于获取状态/进入终端模式前执行固定、有界的 Python 前台 ioctl 检查，后台启动明确拒绝；不放宽验收。

实施复核 R1 的三项阻断（动作栏跨决定重放、同次读取连续粘贴、长面板滚动）及新增剪贴板竞态已修正并保留首次失败。键盘退出先恢复终端、撤销发送许可，再最多用一秒处理已排队普通编辑；该短暂输入许可不允许 POST，最后关闭时撤销。外部信号/终端丢失仍立即关闭。详情及验证见[实施证据](evidence/issue82-terminal-rollback/implementation.md#implementation-review-r1-disposition)；当前提交复核和原生验收仍待完成。

## R3 裁定（覆盖 R2/R1 冲突表述）

R2 已关闭原架构问题，仅要求七处文本补全，全部采纳；完整条文以英文稿 R3 为准。

- A：区分输入会话与发送许可。缩小/解析隔离时同步 disconnect(g) → connect(g+1)，不 reset 输入或清除剪贴板/确认；保留查看、滚动、Escape、退出，恢复后积压仍需 Resume。仅关闭/终端丢失纯撤销。
- B：Ctrl+T 为候选动作栏主入口，F2 仅加速；栏内增加 Set/Clear mark，Ctrl+Space 降为可选。栏内收到括号粘贴时返回编辑器插入数据，不能驱动动作。
- C：沿用浏览器确认语义：确认首次绘制前排队的普通编辑可恢复，此后输入拒绝并提示；任何授权动作都不跨决定重放，尤其 Ctrl+S 不能在 Apply 后自动发送。迁移原测试。
- D：固定恢复序列补齐 autowrap、同步输出结束、SGR reset 等 G0 RESTORE 项；恢复后 write 永久关闭，迟到绘制不得再次进入 alternate screen。验证各退出路径字节尾。
- E：不完整粘贴超过 10 秒闲置或丢弃总量 8 MiB 后放弃，显示计数、轮换许可、要求显式恢复；正文不提交。之后按键重开只保证活性，仍属于 C3 来源丢失限制。
- F：改用 fatal 的流式 TextDecoder，错误/尾部残缺 UTF-8 重置并隔离，保留草稿，不默默换成 U+FFFD。
- G：提交供 Master 操作的原生 runbook，包含精确命令、合成载荷、预期和记录模板。fixture Core 留 request ID/count/body 字节；产品显示 paste 来源但不记录原始按键。C2/C3 用历史 G0 合成 trace 分类。必需按键不交付须改码复核；IME 确认误发送或退出泄漏阻止合并。所有决定入口、C2/C3 实测确认、IME 不误发、关窗口/Ctrl+C/SIGTERM 恢复均为合并条件；视觉细节仅 Master 可准予延期。工具禁令不绕过，未测保持 NOT_TESTED。

另覆盖后台启动的锁/raw 残留；首次 pristine 提交中断仅文档指导手动移走目录，不自动删除；config 文件与 CLI 一致支持 color；明确 Ctrl+C 退出。R1/R2 为源码/计划复核，不能当作独立执行测试。已发布 R2 为 a2c1c26，与原本地 7a5c060 树完全一致。

## R2 裁定（覆盖下文冲突的 R1 表述）

Claude R1 返回 CHANGES_REQUIRED；以下采纳五项阻塞意见及其余具体修改。英文稿的 R2 控制章节列有完整实施合同，尚未声称原生验收完成。

### 输入合同及支持边界

保留 bracketed paste 生效时的粘贴数据来源、Enter 换行、显式 Submit/Resume、原字节 replay。新终端 producer **不沿用浏览器 R7 的事件来源认证保证**，明确分为四项：

| 项目 | 合同与验收 |
| --- | --- |
| C1 普通括号粘贴 | 内容插入一次、保留 paste 来源和中英文/emoji/组合字符/Tab，仅规范化 CR，容量有界，不执行内容中的命令；PTY 和真实 Terminal 分别验证 |
| C2 恶意剪贴板控制字节 | 仅在实测终端版本中声明实际交付行为；若原样交付内嵌结束标记或尚无证据，Cmd+V 仅支持可信文本，不声称恶意来源认证 |
| C3 模式丢失、Reset/Hard Reset | 未括号包裹的粘贴可能被识别为键盘输入，进而触发命令/动作；重设模式只能缩小窗口，不能消除此原始字节流限制。实测 Reset 后立即粘贴的结果 |
| C4 IME | 提交后的字符为 typed，Enter 不能发送；候选框锚点、组合期间 Ctrl+S/Ctrl+G、流式重绘期间组合输入须原生测试 |

两种 C2 分支均提供独立的 **Import clipboard text / 导入剪贴板文本** 操作：异步、有界、固定 argv 调用 `/usr/bin/pbpaste`，使用明确 UTF-8 locale，经原编辑事务插入 paste 来源数据；不解释内容、不提交，也不认证触发它的键。它是终端输入适配操作，不占用预留的 `/paste` 命令，图片与 `/paste` 仍 NOT_IMPLEMENTED。候选键 Ctrl+V，并有底部键盘动作栏入口。时间窗口、分片边界、带内确认都不作为来源认证。C2/C3 相对 R7 的收窄，须在**合并前连同具体终端验收结果交 Master 确认**。

raw mode、粘贴模式和首次绘制就绪前收到的输入丢弃并显示计数，不派发；重新初始化也如此，启动预输入不能触发发送或 Resume。

### 输入适配与绘制

使用自有注入式 Terminal，不使用会探测全局修饰键/加载原生 addon/协商键盘协议的 ProcessTerminal。已在本地已安装 dist 核实 reviewer 的对应发现。一个 StringDecoder 统一解码，StdinBuffer 如使用只收普通键字符串，绝不收原始 Buffer 或粘贴起始标记。产品 framer 有界接管粘贴；超限持续丢弃到结束标记，不能把剩余正文当按键；游离结束标记当数据；仅在非粘贴状态处理 ESC 超时。原 split-marker witness 保留，不能改成安全 PASS。

既有 InputProtocol / app.event 为唯一业务入口；typed 按 UTF-8 边界切为最多 64KiB，完整粘贴作为一个串行任务 begin/chunk/commit，中间不插入网络、定时器或磁盘等待。framer 限 4MiB，待处理输入队列限 8MiB，超载可恢复且显示错误。revision 在任务执行时取 canonical editor 的值，不维护第二编辑器。大编辑确认期间仅派发 Apply/Cancel 与安全查看；后续已捕获输入有界保序，不能自动当成决定执行。

所有不可信文本在交给 pi-tui 测宽/换行/布局**之前**转义，包括 draft、command、record、路径/ID、消息与故障；维护原偏移到显示单元映射，Tab 固定四个显示单元，只有渲染器能加入 CURSOR_MARKER。每次绘制后硬件光标置于编辑 caret。输出 guard 仅移除库固定的空 OSC8 close，其他 OSC8/OSC52 拒绝。

明确关闭鼠标上报、copy-on-select，并注入返回 UNSUPPORTED 的 copySelection 防止 OSC52 fallback。系统选择只是显示文本便利操作；应用 Copy/Cut 始终复制 canonical 原文。剪贴板异步，不能用 spawnSync 阻塞 writer ACK。

候选键：Enter 换行、Ctrl+S 提交、Ctrl+G 命令、Ctrl+P 纯文本、Tab 补全、Esc 取消、Ctrl+R Resume、Ctrl+V 导入文本、Ctrl+O Copy、Ctrl+X Cut、Ctrl+_ Undo、Ctrl+Y Redo、Ctrl+C/Ctrl+\\ 安全退出、Ctrl+Z 提示不支持挂起；箭头移动，Shift+箭头在可交付时扩选，Ctrl+Space 切换选区锚点，Ctrl+B/F 左右，Ctrl+A/E 行首/尾，Ctrl+U/D 消息半页。F2 进入底部动作栏，Tab/左右选择，Enter 激活、Esc 返回；包含全部原按钮动作及确认，大编辑和 Restore 保留显式决定。打开动作栏的键不能直接执行默认动作。Home/End/PageUp/Down、Ctrl+箭头仅可选加速键，不能成为唯一入口。

这只是实现候选与自动键序列测试合同，**不能当成真实 Terminal 交付证据**。当前工具禁止控制 com.apple.Terminal，因此在成品 fixture 上列出 Master 需操作的具体步骤；原生键表在验收/合并前实测冻结，不阻止先写适配器和可评审 PR。小于 40×12 时全部授权动作（发送、Resume/retry、discard/restore、cut、导入、Apply）禁用，撤销自动队列派发许可；恢复尺寸后有积压则须 Resume。保留安全退出和查看。

Apple_Terminal 默认按 256 色映射，不能从 TERM 推断 truecolor；提供 `--color auto|truecolor|256|none` 显式覆盖，故障有文字表示。headless 宽度结果不替代原生 emoji/ZWJ 验收。

### 生命周期与持久化

Outbox 现有 generation 已具备可撤销许可语义，保持算法与 fsync 前后检查，改由本地终端会话拥有。最终检查到 POST 发起之间无同步绘制或 await；onChange 只安排后续 paint。撤销阻止新发起，已发起 POST 仍按现有规则完成；关闭保留现有 abort/对账语义。

关闭**开始时**先撤销许可，移除输入/resize listener，恢复 raw mode、光标、粘贴/alternate screen，取消 renderer timer，然后才有界 flush 与 stderr 报告。信号/异常 handler 持续存在且幂等，第二个信号不能跳过恢复。stdin/stdout error/end/close，EIO/EPIPE 归为终端丢失：停止写屏并关闭。可恢复解析隔离则清掉未完成事务、撤销许可、显示原因，显式恢复后才能继续，不重放含糊操作；普通不支持键只提示。

选择不支持 job-control 挂起：Ctrl+Z 提示，外部 SIGTSTP 安全关闭；SIGSTOP/SIGKILL 不可捕获，可能需 shell reset 和重开；强制 stop 后 SIGCONT 保守关闭，不恢复发送。分别验证 Node/tsx/npm 父进程、进程组信号、PTY hangup、slow flush 时重复信号和 EPIPE。Core 仍独立，writer fsync/QoS 算法不改。

新 producer 精确为 `{class: terminal-bracketed-paste, policy: issue82-terminal-r1}`，表示上述 C1–C4 合同，不声称认证；旧 pair 原样保留。增加成功 open 后才允许公开 store mutation 的显式守卫，只有内部 pristine 初始化事务例外。失败加载不能经 save/close 发布替换状态。

writer 最小增加缺失 manifest 检查：`tui-v1` 无 manifest 且存在 writer.lock 以外任何文件时以 MISSING_CLIENT_MANIFEST 拒绝，保留 orphan blob/checkpoint/receipt/temp；真正空目录才初始化。精确收窄旧“绝不清理”措辞：启动可完成已有 durable retirement ticket 对**不被引用** blob 的合法清理，但不能删受保护引用、生成新退休票据；语义校验与 binding 验证完成前不做按龄收集。不另设计 writer 协议。

### 退出浏览器与验收

迁移业务断言后，从当前树移除 server.ts、web 和浏览器专属测试，用 `e090a9c` 与既有历史报告作归档；HTML/CSS 参考链接固定到旧提交。无其他使用后删除 ws/@types/ws。检查运行时导入图（排除 type-only）无浏览器服务器/node:http/ws，拒绝 --open，客户端不建监听 socket。保留 G0 与历史失败但改清 CI 标签，新增实际产品 PTY。

Linux 同入口允许显式实验与 CI，原生 UX 未验收，clipboard 操作返回 UNSUPPORTED，不启动平台命令。macOS 追加 Reset/Hard Reset、所有候选/备用键、重绘中 IME、光标位置、色彩、emoji 宽度和小窗口全部授权动作验收。

旧 anchor 数值加载时原样保留，定位稳定 ID 时按当前宽度的 wrapped rows 解释并 clamp，必要时提示；新记录也用 wrapped rows，不声称像素级迁移。补 pi-tui 依赖清单，Core API 不扩展。

R1 处置：采纳所有阻塞与较小意见；澄清真实键位测量和 Master 对 C2/C3 的确认在验收/合并前完成，不以当前 UI 工具不可用阻止候选实现。计划 PASS 不代替产品验收或合并授权。

## 基线与边界

已拉取主线 `e090a9c79f69fc68cb4b81caa392e1b82675cf34`（[PR #88](https://github.com/ExplodeCode6324/Secretary/pull/88)，[Issue #82](https://github.com/ExplodeCode6324/Secretary/issues/82)）；其文件树与原开发分支 `4bb7dbb` 相同。工作分支 `codex/issue82-terminal-rollback` 从主线创建。历史未跟踪报告与混合数据目录保留；新增合成证据放 Git 忽略目录 `.demo-data/issue82-terminal-rollback/`，测试不读取或迁移 Master 的真实数据。

1. 保留 #79 退役 Tauri、#80 回复结果/失败状态/思考预览、#81 图片 Core 链路。终端附件操作仍为 NOT_IMPLEMENTED，不将 Core 完成混为 TUI 完成。
2. 保留命令注册表、Main/Task 草稿隔离、显式发送、编辑模型、粘贴块与撤销、writer、outbox、同步和阅读恢复。只拆出与浏览器混合的部分。
3. 保留顶部状态、中间消息、固定底部输入；沿用背景 `#121c29`、前景 `#d8e3ee`、蓝 `#79acd9`、浅蓝 `#b1d5ec`、故障红 `#ed8791`。终端按字符单元重绘，低色彩能力保留可辨颜色与文字状态，不重新设计布局。
4. 浏览器服务器、网页输入与浏览器启动退出正式客户端依赖路径。历史 HTML/CSS 和报告仅作归档参考；`npm run tui` 无浏览器 fallback。

## 实施拆分

- `entry.ts` 在当前 TTY 启动；重定向 stdin/stdout 提前拒绝。保留显式 data/mode、只连接已运行 Core。`--open` 明确报废弃错误；`config.ts` 删除浏览器发现/启动，保留路径和配置权限校验。
- `app.ts` 提取 publish、scroll、clipboard、close 的小型呈现接口；命令调度、确认/恢复、快照和草稿逻辑继续复用。正式构造绑定终端适配器，不再导入 BrowserServer 或创建监听端口。
- 新增终端输入、绘制和生命周期模块，核对并复用已锁定的 `@earendil-works/pi-tui@0.87.0` 公共 API，不升级依赖或修改参考子模块。只保留一份 canonical draft。
- `outbox.ts` 用本地客户端会话许可替代浏览器连接代次。退出、输入故障、挂起或终端丢失撤销许可；ATTEMPTED 持久化 ACK 后、POST 前再次同步校验，中间不能 await。Core/SSE 重连不授予发送权；重开及挂起恢复后待发送记录须显式 Resume，新提交不代替 Resume。
- 浏览器专属测试归档到正式终端验收路径之外；混合测试拆分并迁移业务断言，不整批删除。仓库级检索证明无其他用途后才能移除 ws。历史 G0 及首次失败保留。

## 输入、绘制与生命周期

Enter 换行，Ctrl+S 显式提交，Ctrl+G 命令缓冲，Ctrl+P 纯文本，Tab 只补全。移动/选区/删除/撤销映射既有编辑操作。所有原按钮操作均提供终端键盘入口：Resume、复制/剪切、大编辑 Apply/Cancel、Copy record、两步 Restore；具体键位在页脚与帮助列明。

增量 UTF-8 与跨分片键序列/粘贴解析有界。粘贴节点保留 provenance，折叠、展开、编辑、撤销、重开不升级为键盘命令；仅沿用 CR/CRLF→LF 规范化。不完整、超限、未知序列明确拒绝或隔离，不清掉现有草稿。输出中 ESC/C0/C1/OSC 安全显示，不改存储与发送正文。验证 CJK、emoji/ZWJ、组合字符、长 grapheme 的边界、宽度、换行与光标；小于 40×12 保留草稿并禁提交，恢复尺寸不丢焦点。

**原 G0 的跨分片伪造粘贴结束标记是仍有效的失败证据。** 原始终端字节本身无法鉴别控制字节来自键盘还是恶意粘贴，不能直接把 ProbeFramer 转正，或声称超时/括号粘贴能认证来源。重跑原 witness，并用合成文本检查真实 macOS Terminal 的剪贴板→PTY 行为；按证据确定支持的终端版本与普通文本粘贴边界。若不能满足所选合同，向 Master 报告具体限制及可实施的纯终端替代（例如显式读取剪贴板），不得自行改回网页。此边界须在实现前由 reviewer 明确评估；普通粘贴和恶意来源认证分别作结论。

IME preedit 由终端管理，不模拟浏览器 composition 事件；中文候选确认不能提交。剪贴板采用固定 argv、无 shell、有界超时/字节；复制原文而非折叠标签，剪切须剪贴板成功且 revision/选区/许可仍匹配才删正文，失败保留草稿。不发送用户可控 OSC52。真实剪贴板字节往返和适配器 mock 分开验收。

消息区采用有界 viewport、稳定 ID/阅读锚点；流式输出不拉走旧消息阅读位置。保留默认 CoT 摘要、按需有界展开、outcome、UNKNOWN、保存状态与并列故障信息。合并绘制调度，但不放宽既有持久化性能门槛。

客户端负责 raw mode、alternate screen、cursor、paste/mouse modes 的初始化和 finally 恢复。覆盖 `/quit`、退出键、SIGINT/SIGTERM/SIGHUP、EOF、启动失败、未处理异常、挂起/继续。挂起前撤销许可并恢复终端，继续后重建终端且待发队列需 Resume；若不支持挂起，需拦截并清楚说明。SIGKILL 无法执行恢复代码，仅验证 durable reopen 并记录手工 reset 限制。关闭立即撤销发送、停止同步、有界 flush，即使 writer 失败也恢复终端；Core 与其任务继续运行。

## 持久化兼容

可采用 additive producer union 保持现有 `tui-v1/` 与 version 1 envelope，无须改写旧状态：旧 `{class: browser-structured, policy: issue82-r7}` 与复核后的新终端 pair 分别精确校验。未知 pair 原样保留并拒绝读写/清理。旧记录永久保留原标签，新记录在 admission 时写终端标签；producer 是来源，不是当前发送许可。旧二进制可能拒绝终端记录，明确不支持降级，不能为降级重新标记。

加载后保留草稿/节点 ID/来源/undo/redo/view/anchor/receipts/next sequence，以及全部 outbox 字段。request_id、原 JSON 字节/hash/blob、binding、顺序、created_at、attempted/uncertain/state 不变；不重序列化、不换 ID、不重置保留期限。ATTEMPTED/UNKNOWN 直到原字节 replay 得到合法 POST receipt 且 durable handoff 才能清理，GET 不足。外域隔离、已知拒绝恢复、三年保留、容量限制和唯一 writer 锁继续有效。

改 loader 前用基线实现生成 fixtures，保存原始副本，仅操作隔离副本。覆盖 PREPARED/ATTEMPTED/UNKNOWN/NEEDS_EDIT/CONFLICT 和新旧混合队列；比较 open/save/close/reopen 前后字段和受保护 blob 字节；Resume 前零 POST，Resume 后原 ID/原字节；mismatch/corrupt/crash 不清理、不以空状态覆盖已有内容。

## 验证与交付

1. 首次基线日志单独保留，所有失败区分产品/测试设施/环境原因；执行迁移、输入、控制器测试和既有 editor/outbox/writer/sync、#80/#81 回归，再完成类型、文档、隔离 PostgreSQL 的完整 verify 及必需 CI；保留既有 500ms ACK 门槛。
2. PTY 使用真实产品入口验证启动、不启浏览器/无新增客户端监听 socket、UTF-8 分片、粘贴、换行/提交、缩放、信号、恢复、竞争锁、异常。通过隔离 Core fixture 比较确切请求；headless terminal 验证单元布局，不当成真实 IME。
3. 真实 macOS Terminal 记录系统/终端版本、字体/profile/输入法/命令，验证中英文候选确认/取消、多行 CJK/emoji 粘贴、换行/提交、长稿、缩放、滚动锚点、剪贴板、确认控件、退出/重开。记录实际输出与请求；自动 UI 注入不能冒充物理键盘。需要 Master 操作的具体步骤留 NOT_TESTED，不能借旧浏览器 PASS 完成本次终端验收。Linux 原生 TUI 延后，Core Linux CI 保持。
4. 更新当前需求状态、终端运行指南、README/当前多语言指南和 API 使用清单；历史浏览器计划/报告不改写。按 operations.json 重新核对消费者，预期无 Core API 改动。附件/Task 功能延期。
5. 同一 Claude 会话复核完整英文计划及实现后的准确 PR HEAD，附代码与证据，原始回复存忽略目录。交付 PR/HEAD/CI、首次失败、真实终端结果及未测项；等待 Master 独立授权合并。

## 复核记录

- R1 尚未提交：检查时无已打开的 Claude 页面，Master 已表示会打开。继续使用浏览器 Claude，不切换 Hermes。
- 首轮保留能力基线测试 76/76 通过，0 失败/跳过；包括 editor、outbox、sync、writer、writer-barriers、regressions、responsiveness、performance-policy 与 G0。首次日志 `.demo-data/issue82-terminal-rollback/baseline-first.log` 保留。G0 失败 witness 的测试通过意味着限制仍被复现，不代表已修复；这些是原有模型/持久化基线证据，不是终端实现或验收。
