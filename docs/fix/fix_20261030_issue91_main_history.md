# Issue #91 — Main 长历史、CoT 与多段粘贴实施计划

日期：2026-10-30（香港时间）。版本 R2，已纳入最终交接修订。状态：MASTER_APPROVED / IMPLEMENTING；尚未获准实施，单行粘贴方案待 Master 明确选择。

[English plan](fix_20261030_issue91_main_history.en.md) · [复核记录](evidence/issue91-main-history/plan-review.md) · [验收登记](evidence/issue91-main-history/acceptance.md)

## 1. 依据与交付范围

仓库：https://github.com/ExplodeCode6324/Secretary 。目标：https://github.com/ExplodeCode6324/Secretary/issues/91 。依据当前 issue 和 TUI v1.7 的 C04/C05/C13–C16/B01。计划基线为最新 main **9324283c58f65cc5d783d0f3a33f79ca14575689**，已包含 #82 / PR #95；不能回退至旧 #81 业务基线。计划分支 `codex/issue91-main-history-plan`。

Master 要求先编写中英文计划，经浏览器 **Claude Opus 5.5 Extra** 复核，再交 Master 明确批准后实施。实施完成后必须**真实接入模型验证，并将证据交回复核**。Claude 对话、fixture provider、CI 通过均不能替代真实模型链路验证。实施复核复用同一 Claude 会话；合并仍须另行授权。

本批交付：越过驻留缓存后仍能连续浏览可取得的 Main 历史；稳定消息与正文位置；新消息不强制跟随；由 Main 控制的统一 CoT 状态；Hermes 风格多段文本粘贴及完整草稿恢复。沿用 Node/TypeScript、精确 `@earendil-works/pi-tui@0.87.0`（上游 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`）和 #82 的终端、输入、交接、CoreClient、状态生命周期。

Task 历史和继承界面在 #83，事项处理在 #92，失败业务处置在 #93，图片/产物/open 在 #94。本批提供可复用 CoT 状态，不认领 Task 验收。不新建历史库、UI 操作流水、永久游标、逐键 fsync 框架、全文搜索、清理工程或新前端，不自动重发。保留无关未跟踪证据和用户数据。

## 2. 当前源码结论

- `tui/remote.ts` 首读 50 条、从持久尾锚点追赶，但消息 Map 无界增长，正文全部片段会拼接入内存，没有向前历史导航。`confirmed`、提示、组件缓存也需共同限制，不能只缩小消息 Map。
- `tui/view.ts` 已用 `follow: "none"`。现有锚点累计标题/摘要/正文渲染后 trim 的字符数；CoT 或 Markdown 布局变化后不够稳定，而且当前所有渲染行均物化。
- `tui/app.ts` 已有两份编辑器、视图、首次定位最新、方向键查看以及粘贴返回编辑器；Main 边界尚不分页，加载错误也未定位到具体边界。
- `tui/input.ts` 已禁用 Pi 默认提交，并在 Shift+Enter 前读取展开文本，避免其 trim/清空。但随后把展开文本交给命令解析，丢失斜杠是否来自粘贴的区别。没有 CoT 命令或 Hermes 摘要。
- `tui/state.ts`、`delivery.ts` 的 v1 草稿是展开后的字符串和 generation；单 pending 保留不可变请求体/ID、UNKNOWN 对账和恢复。复用这些规则，但快照、绑定及恢复须一起扩展为可重建粘贴结构。
- `application-service.ts`、`timeline.ts` 已支持 before/after、around、正文分页、thinking/streaming、revision 和 preview。正文 cursor 编码 UTF-16 正文/推理偏移和版本；公开接口只收 cursor，没有直接偏移定位。时间线 limit 上限 200，字节上限可使实际页更小。模式/实例/版本变化使游标失效。R2 复用现有 cursor 行走，删除新增 offset 投影提案，见第 4 节。
- 固定 Pi Editor 的 paste Map、分段及 marker 解析是私有实现，写死 `[paste #…]`；`setText` 清 Map，`submitValue` 在回调前展开、trim、清空。只替换渲染文字会破坏光标和换行计算，因此须有明确兼容适配层及测试。

## 3. 参数与有界历史读取

开工前登记初值：**N=50 个时间线条目、B=每次 50 条、H=驻留 200 条元数据**，另加**驻留正文/CoT UTF-8 文本 4 MiB**上限。包括被过滤的非工具 activity 均计入 N/B/H；Core 字节限制可能缩短页。正文与元数据独立淘汰：正文未驻留的行保留稳定 ID 和局部加载占位，不能显示为空正文；先淘汰非可见正文并保护阅读窗口。已结束消息的正文+推理不超过 **1 MiB** 且符合共享预算时可以完整拼接；超过阈值走最多 **8 个邻近 Core 片段**的窗口路径。以上只限制驻留，不限制可浏览内容。Main 发送仍使用既有 1 MiB 序列化 wire 上限；历史预算不声称限制用户主动增长的草稿、V8 开销或独立 Core 进程。

新增小型 Main 历史控制器（拟 `tui/history.ts`，由 RemoteViews 接入），维护有界有序窗口及两端定位。依 API 顺序和稳定 ID 去重，不能只靠 Map 插入顺序或时间戳排序。阅读窗口与最新消息水位分离；新消息只更新有界尾部/未读提示，不淘汰正在阅读的锚点，也不下载所有未读正文。旧位置走向新位置时逐页穿过中间区间，不将不相邻两窗拼成连续历史。

上下边界按方向补 B 条，同边界请求合并，旧 generation 响应丢弃，新页准备好之前保留当前位置。淘汰最远的非可见消息/片段，同时清理对应组件、渲染行、引用、提示和版本标记。仅保留有界边界信息与当前锚点，不积累所有历史 ID/cursor。需要时通过 Core 重读；不另写日志或删除 Core 历史。失败保留现有内容；确实缺失时显示明确间隔/不可取得标记。

正文按可见范围和少量邻近区域读取；超长消息沿既有不透明 cursor 链从起点或有界有效检查点行走，通过累加实际正文/推理片段长度定位，丢弃窗口外前缀，支持双向淘汰重读。保留有界 Markdown 续接上下文，或重走前缀重建；直接 offset 跳转同样不能解决 Markdown 上下文。不能为预算将已支持 Markdown 降级为纯文本或截断消息。可行性门槛必须演示代码围栏、长段落、嵌套/松散列表跨窗口；若固定渲染器不能安全满足，先修订方案再越过门槛实施。

整页均为被过滤 activity 时，每个异步批次最多扫描四个 B 页或 200 个原始行，直到找到可显示内容或真实边界；仍有后续时保留已推进 cursor 和可见继续加载提示，主动让出事件循环，由同次排队导航或下一次方向键继续。不能反复读取同一无可见内容页或误报首尾。分页/正文最多两项并发，每方向仅一个合并后的后续请求。响应首片立即计入文本预算，不能只计算拼接后的正文。

在启动、遍历超过 H、反向重读及重复往返后观察消息/片段数、驻留文本字节、组件/渲染缓存数和 Node heapUsed/RSS。计数器用于测试，不持久化 UI 流水。对实际保留内容与结构设确定上限，heap/RSS 只作佐证，不保证 V8 立即归还内存；在途请求和渲染窗口也要受限并测量。

## 4. 锚点与既有读取接口的游标恢复

锚点为 `{item_id, region: body|thinking|header|activity, block_start_utf16, row_in_block, measured_width, instance_id, timeline_generation, revision}`，附视口提示。它是源块及块内正文位置，不是绝对屏幕行号。用固定 Pi 导出的 `Marked`（锁定 marked 18.0.11）获取顶层块的 `raw` 范围，再用 Pi Markdown 渲染有界块并关联组件行；不假称 Pi 原生提供 source map。保留全文块间距和引用定义，验证标题、编号/松散列表、引用、代码围栏、基线支持的链接/表格、重复文字和未完成流式语法；不新增 math/HTML/Mermaid 承诺。超长块保留源块起点、续接上下文和当前窗口源范围，以不保留完整旧正文的前缀行走重建。

标题/摘要/正文分区，宽度不变时 CoT 插入后准确恢复正文块及块内行；前插、淘汰重读、Main/Task 返回同理。resize 在同一源块内重排并夹取最近仍存在的行，不宣称任意 Markdown 变换都能精确恢复源字符；验证不会跳至另一消息或最新位置。底部收到新消息也不能重复首次定位。

推理区域收起后保留逻辑锚点，暂显示摘要；用户未主动导航时，展开后恢复原块/行。revision 是进程内时间线计数器，只在同 `(instance_id, timeline generation)` 内可比，不是内容散列。依据新读区域的实际内容/长度判断缩短，仅锚点确实被删时提示；跨实例/generation 丢弃版本比较并重新验证。不同版本片段不拼成同一正文。重启后临时内容缺失须明确显示，不伪造持久 CoT。

cursor 绑定 instance、timeline generation、查询模式，正文另绑定 revision。切换模式/重启/明确拒绝时清理 token、递增客户端 generation。用 **`timeline/around?message_id=…&limit=1&thinking=…&streaming=true`** 重定位，断言目标实际返回，再用新 before/after 向两侧按 B 补读；limit=50 可能在目标之前耗尽字节预算，不能用于定位。每侧保留至多两个最近持久邻居及可用 `source_event_id`。锚点消失先尝试原 source event，再定位最近仍存在的邻居，明确提示位移/间隔；均不存在则保留不可取得标记，由下一次主动导航从新查询的近期窗口继续并提示间隔，不能因被动刷新默默跳最新。实例/generation 改变后根据当前 Core 页重建顺序；旧显示只作独立标注的临时快照等待替换，不拼成当前连续历史。跨数据域隔离仍保持。

错误映射：`CURSOR_EXPIRED`、`TIMELINE_RESET_REQUIRED` 失效后重定位；`TIMELINE_ITEM_NOT_FOUND` 走有界邻居回退；正常不透明 cursor 路径不应出现的 `INVALID_FRAGMENT_OFFSET` 从起点重验一次，仍失败则局部协议错误；网络/读取错误保留内容、待下一次用户重试。已结束消息每次失败操作最多自动重定位一次。只有成功页无后继才确认为历史边界。

运行中的 preview 单独处理：`preview_status:"running"` 每次 delta 都可能改变 revision，已有总计 32,768 UTF-16 单元上限。合并失效通知后用 around limit=1 只读受影响条目，不每 100 ms 读取 50 条展开历史。从零开始生成有界一致快照，后续片段必须仍匹配 generation/revision；运行中 cursor 过期属于正常替代，丢弃未完成新拼接、保留上次一致显示，等下次合并通知重读，不显示伪错误、阻塞重试或自动滚动。部分可读 preview 显示继续读取提示。结束后按普通需求分页读取完整持久正文并恢复逻辑锚点。覆盖超过一片的中文流式正文/展开推理、preview 过期及转持久场景。

**删除 R1 的 content-offset API 扩展。** 现有 cursor 链可用恒定驻留前缀内存到达可读取位置，也能重建 Markdown 上下文。R2 不计划新增字段/端点或生成合同变更。若实际测量发现无法满足要求，记录复现并重新提议最小只读变更，不悄悄新增 API 或缩减历史/Markdown 行为。

## 5. CoT 与局部错误

向既有注册、解析、补全、帮助加入 `/cotvisible` 和 `/cotv`，不分大小写、无参数。精确 `/cotv` 应一次提交，不能被补成 `/cotvisible`；Task 补全隐藏两者。仅 Main 普通态有效，Task 局部报错、不发模型。提供统一状态给后续 Task；启动默认**收起**，`thinking=false`，使用 Core 既有 `thinking_preview`，只作终端安全过滤。Core 已提供去除 redacted 块、≤20 grapheme、≤4096 字节的预览，不额外读隐藏推理、不再次截断省略号。展开按需 `thinking=true`；浅灰分行，不制造推理/摘要，不要求跨启动偏好。

可用性只映射实际字段：`thinking`/`thinking_preview` 表示可显示内容；`thinking_preview.truncated` 仅指摘要缩短，不代表正文丢失；`persistence`、`preview_availability`、`preview_status`、`truncated`、`incomplete` 按真实返回表示持久/临时/过期/部分。无内容即无可显示 CoT，不强行区分 provider 没有与已脱敏。曾显示临时条目后来消失，要经查询确认后提示不可取得，不生成 CoT 记录。

即使正文 revision 未变，CoT 切换也失效模式相关 cursor。异步响应检查 generation/模式/revision，后续新消息和补读页采用同一设置。不持久化显示操作，不补写推理。读取错误显示在较早/较新/正文对应加载边界；下次主动编辑、合法命令或导航开始时清除，后台重绘/SSE/状态轮询不清除。持久 UNKNOWN/恢复事实与普通临时错误分开处理。

## 6. 粘贴适配、命令识别与草稿生命周期

继续以 Pi Editor 为编辑器，复用 **ProcessTerminal/StdinBuffer** 的 bracketed-paste 拼包和 Pi 公共原子插入。DraftEditor 在 Pi `handlePaste` **之前**截获完整帧；Pi 私有 paste Map 始终空。Secretary 维护随机 ID 的小型富块 registry 和有主属的 token 出现范围。通过复核的提案是所有粘贴包括单行均 token 化；**此可见行为扩展须按第 11 节由 Master 明确选择，尚非已定要求**，用于避免无法证明的 inline paste 来源。通过公共 `insertTextAtCursor` 一次插入显示 token，而非 payload，一次 undo；保持 `<pasted N lines short-id.txt>` 风格，一行用 `1 line` 单数，不改无空格标签。不修改 node_modules、不升级包、不换编辑器。

局部兼容桥在启动/测试断言固定包版本及必要运行时方法/状态形状，不兼容则启用输入前明确报错。覆盖/桥接 `segment`、`moveWordBackwards`、`moveWordForwards`（Pi word-delete 委托后两者），包装 undo push/pop 与 kill/yank，使 registry/主属范围随编辑状态同行。分段覆盖 word/grapheme；测试左右/上下、Backspace/Delete、双向词移动/删除、整行 kill、yank/yank-pop、undo、启用时的 cursor jump/鼠标定位、宽于编辑器的 token。无法归因的变更在提交前局部阻止，不能破坏相邻手写内容。此为明确可行性门槛，不宣称原版 Pi 支持自定义 marker。

结构化草稿保存编辑文字、有主属 token 出现范围、不可变 ID→payload、光标和 generation。各长度粘贴走同一块机制，注册范围外手写相似标记为字面文字；文件名不导入文件。行数按规范化正文 split 换行计数，包括末尾空行。CRLF/CR→LF，保留 payload 的 tab 和前后空格。用 Pi 既有终端序列清理器去除完整 escape 序列，再移除 LF/TAB 以外的 C0/C1 控制字符，不能只去 ESC 留 `[31m` 残渣；不加路径空格。登记规范化，对照 Core/provider 字节。StdinBuffer 负责分包拼接，同时测完整帧 Editor 边界；粘贴不触发提交/补全。

按有主属出现范围顺序展开一次，不全局字符串替换；payload 内 marker 不递归。块原子化，改内容通过替换/删除再粘贴，不新增隐藏块内编辑模式。kill/yank 带富块信息，两次 yank 可形成两个引用同一不可变 payload 的主属范围，按位置展开两次；手打同标签不取得主属。Pi undo push/pop 同步富 registry/范围，不能靠含糊的全局文字匹配恢复结构。payload 缺失、主属范围损坏、恢复首 slash 来源不明时局部阻止提交并提示修复/重输，既不发命令也不发模型。覆盖 undo 后提交、重复 yank、字面标签、整块删除、换行和查看→编辑交接。

明确提交前捕获原始结构/来源、完整 payload、可恢复快照/generation。开头为主属粘贴 token 则普通正文；已知普通手写 slash 走既有单命令语法；来源不明（如迁移旧稿首 slash）先局部报错，须重输或明确 `/rawmessage` 包裹，不能猜。分类前不 trim、不展开；send/rawmessage 参数 token 分类后展开；未知手写 slash 仍局部错误，rawmessage 仅一次，补全只编辑，完整无参命令一次提交，Task 仍只留稿。

保持 `disableSubmit=true`，绕过 trim/clear 回调，异步前深拷贝。pending/recovery 同时保留快照和不可变正文。v1→v2 在原私密目录原子迁移，提升前留带时间戳的 v1 备份，保留 ID/接收状态。旧 raw 为普通文本、首 slash 来源未知；已有 pending 的 body/ID 才是重放权威，不再解析为命令。recovery 保持 `created_at/id/raw/body` 并加 snapshot；collect 识别 v1/v2 自有临时/恢复文件，保护活跃引用和未知/损坏材料。

restore 与接收交接边界清理 Pi undo/kill，只释放该提交 generation 的引用。有新稿时保留其独立富 undo/块，只滤除已接收旧稿专属引用，不能清空新稿。内存 undo 不作为无界历史持久化；重开恢复当前完整草稿/pending 即可；无 payload 的复活 token 局部阻止。回退步骤：停 TUI、保全 v2 材料，先把当前 Main/Task 及 pending 的 raw/body/身份导出为校验通过的私密 v1 兼容快照，再用 #82；只有迁移后无新编辑/发送时才能直接用原 v1 备份。不能让 #82 对着 v2 无限重试，或旧备份覆盖新 pending。

保留既有 durable pending→POST、单未决槽、同 ID 明确重试、迟到接收、新稿 generation 保护及只读对账。无回执仍 UNKNOWN，不换 ID、不自动 POST。失败/重开恢复完整块/光标；接收 checkpoint 完成后释放旧稿专属 undo/kill/payload，保护活跃新稿/pending/recovery。孤立/临时/未交接材料遵守三个日历年，不删 Core/Task；paste 内联私密状态即可。

对 R1 澄清 R6 的范围异议：**不新增任意的粘贴/Task 草稿配额**。#82 明确删除新存储配额，#91 未授权新的产品内容上限。Main 仍按既有 1 MiB wire 在发送时拒绝并保留稿，Task 不 POST。观察 paste/快照耗时，沿用异步 debounce/coalescing；H/4 MiB 仅针对历史，不承诺任意草稿或三年磁盘材料有界。若复现大粘贴问题确需新的拒绝上限，带测量和具体限制交 Master 决定，不悄悄采纳。真实读取/落盘错误保留旧材料并阻止不安全交接。

## 7. 批准后实施顺序

1. 登记环境、精确基线及参数，先验证 adapter 与源范围映射可行性，不升级依赖。
2. 复用既有不透明读取接口，完成有界时间线/正文控制器与真实 Core 集成测试；R2 不新增 offset API。
3. 接入源锚点、Main 边界补读、不跟随/返回、模式恢复、加载位置错误，再接 CoT 命令和呈现。
4. 接入结构化粘贴、原始输入解析、既有交接和状态迁移，回归 #82 导航、精确命令补全、流式期间输入和 UNKNOWN。
5. 定向测试、类型/文档检查，再以正确隔离 PostgreSQL DSN 跑完整 `npm run verify`。macOS CI 增加 #91，保留 Linux 全量检查。更新运行/测试说明和 API 台账，区分继承与本次实际验证。
6. 真机操作与下述真实模型验证；记录首次失败及修复。发布实现 PR/CI，把准确 HEAD 与证据交同一 Claude 会话往返复核，达到条件后交 Master 终审；不自动合并。

## 8. 操作验收与真实模型门槛

全部初始 NOT_TESTED。登记测试 SHA、Node/macOS/Terminal/pi-tui、字体、locale/输入法、尺寸（拟最小 80×24，较大 120×40）和实际粘贴键。继承 Enter 换行、Shift+Enter 明确提交、Ctrl+C 退出客户端、编辑器首个可视行 Up 进入查看、Up/Down 滚动、Escape 回编辑；补全首个确认键不提交。目前原生支持限 Apple Terminal，不宣称 SSH/tmux/其他终端。过小窗口须仍可操作并提示。

| 验收 | 必要操作/证据 |
| --- | --- |
| AC07 | 超 N、多 B、超 H 的 Core 历史双向遍历；重读淘汰消息和超过片段预算的长正文；无缺漏/重复/截断，缓存有界，切页恢复锚点。播种 fixture 标明来源，不改生产历史。 |
| AC05 Main / AC03 推理 | 大小写及两个命令；有/无 CoT、摘要回退、灰色分行；已显示/新到/补读一致。Task 继承归 #83，仍未执行。 |
| AC06 | 两页后记录 ID/区域/源块/块内行；展开收起后各跨页，正文位置保持，推理收起规则有效，无旧模式游标重放和写入。 |
| AC08 | 停历史中段、离开至 Task、手动到最新后三种场景接收回复，均不强制滚动或覆盖草稿/光标。 |
| AC09 | 已读页且有稿时注入一次读取失败，编辑清错再恢复；一次受控 Core 重启/过期响应后原位重读，无需重开客户端，不伪报末尾。模式/正文版本另有合同与单元覆盖。 |
| AC27 | 实际 macOS 剪贴板/终端：手写 A→中文/代码段（含 /T）→手写 B→另一段（含 /send）→编辑→发送；Core 正文及模型请求精确匹配规范化全文/顺序，各段 Hermes 摘要正确。 |
| 输入/恢复 | 前导空格 /T、rawmessage 后正常命令、纯粘贴 /T、字面 marker、分包 paste、delete/undo、超 1 MiB 拒绝；两段失败/丢回执同 ID 恢复且仅一次 Core 输入；新稿竞态；退出重开 Main/Task 完整恢复。 |
| AC24/31 分支 | Task CoT/send 错页、帮助/补全/大小写；安静 Main 滚动/切换/局部错误前后无用户消息、推理记录和 provider 调用增加。#92 处理态命令阻断留给后续接入，不认领本批通过。 |

虚拟终端注明固定 Pi 源 helper 来源，不能证明系统 IME、剪贴板和原生颜色；真实 Core + fixture 只证明路由，不能证明模型。需人工的系统输入法确认仍单列。

**实施后真实模型必须验证：**新建隔离 live Core/数据域，使用已有授权 provider 凭据，不输出凭据、不发送私密历史。记录实际配置及 provider 网络证据中的 provider/model/API 模式、请求 ID、时间、物理请求数及可取得用量。模型不可用不能悄悄换 fixture/其他模型。首轮最多 12 次实际 provider HTTP（含重试）、总计 15 分钟、单请求 90 秒、每次输出 4096 token；凭据/能力/预算受阻则停止并说明。

实走已实现的 TUI→Core→真实 provider→Core 时间线→TUI：(L1) 两段真实中文/代码 paste + 手写标记，核对 Core 输入和发给模型的正文，独立校验确定性提取结果而非泛泛回显；(L2) 真实流式回复时编辑/导航并验证三种不跟随；(L3) 用历史/正文接口及 CoT 切换重读该真实回复；(L4) 真发送周边受控丢回执，同 ID 重试/查询，只一条权威输入，不因客户端重放触发第二次推理。provider 内部重试单独计数。缓存大数据可由隔离 Core 合成历史承担，不为超过 H 消耗数百次模型调用。

操作者与顺序：L1 和 L2 三种位置由 Codex 用原生 computer-use 的剪贴板/按键操作实际 Apple Terminal，留截图及 Core/transport 证据；需要时由 Master 确认主观感受/系统 IME。L1 一次发送、L2 最多三次短合成请求、L3 只读上述回复、L4 一次新请求：共计划五条 Main 输入，包含重试和工具续轮仍不得超过 12 次 provider HTTP。每次新发送前检查剩余预算，不足则停并保留首次失败，未做行仍 NOT_TESTED。

L4 由定向 online harness 通过固定 Pi VirtualTerminal/StdinBuffer 驱动真实 `TerminalApp`→Core→provider，明确标注**脚本驱动真实接入**，不算原生剪贴板。测试专用 CoreClient wrapper 让首次 POST 确实到 Core 并接收，再丢弃回执；临时有界屏蔽状态回执以保持 UNKNOWN。原模型工作静止后，UI 明确同 payload/原 ID 重试一次，放行去重回执/状态并恢复正常读取；比较该 request ID 的权威 Input 数及重试前后 provider attempt 台账，须一条输入且无重放引起的新推理。复用 `api-v1-online-worker.ts` fetch 拦截方式，只记录配置的 provider 目标、payload/次数/用量，不记录凭据；不往生产 runtime 加拦截器或新采集服务。

CoT 只验 provider 实际提供且 Core 已持久化或标明临时的内容，不从答案臆测内部推理、不要求隐含思维、不造摘要。若所选 provider 不提供可显示推理，真实链路登记无 CoT 行为，正向显示用明确 fixture；**正向 live-CoT 保留 NOT_TESTED**并交 Master 查看，不能只凭 fixture 宣称整体真实接入通过。

Claude 最终收到精确 SHA/diff、定向/全量测试与 CI、真机操作和脱敏真实请求/响应来源、未通过项目。记录其独立读源码/执行内容与依据 Codex 证据的部分。计划通过不代表实现、真机、真实模型通过。

## 9. 留证与批准交接

英文原始请求/回复/截图/时间存 Git 忽略 `.demo-data/issue91/review/`；仓库只保留 `docs/fix/evidence/issue91-main-history/` 中脱敏结论与验收表。保留首次失败；公开证据不含凭据、私密正文或机器秘密。

API 台账逐项写 timeline limit/direction/cursor/thinking/streaming、around limit=1 locator、现有 content cursor、继承的 POST messages 和 request/sync GET，绑定真实路径与失败处理。#83 Task、#92 决策、#93 失败、#94 图像产物及非 CoT 日志未用须写原因，不自动补菜单。

本轮仅交付经过复核的中英文计划和处置。Claude 判断可执行后，交 Master 批准再实施；本阶段不改产品代码、不调用业务模型、不建实现 PR、不合并。

## 10. 第一轮意见处置

采纳 B1/B2/B3：绕过默认 paste 转换、所有 paste 用 Secretary token、明确词操作及富 undo/kill/yank/主属范围、重复/孤立 token 和来源处理。采纳 B4/B5：实例内 revision、运行中正常替代、limit=1 重定位、持久邻居回退及重启后重建顺序。采纳 R1–R5/R7、可选 O1/O2：默认收起/Core preview、真实可实现的源块锚点与 resize 边界、取消 offset API、正文独立淘汰/过滤页推进、指定 live 驱动/故障注入、迁移留存回退以及精确 cotv。O3 不采用另一 marker 风格；R6 配额异议按第 6 节带理由交回，非默默接受。

Claude 报告独立读取固定 Secretary/Pi 源码并执行两个 Linux headless Editor 探针；未运行仓库类型/测试、Core/provider 或 macOS。其 GitHub issue API 不可用，依据我们提供的实时原文；R1 未独立审阅中文。Codex 另行读取相关源码，但未在本地执行其探针，不能把 reviewer 的描述写成本地运行证据。

## 11. R2 PASS 交接修订与 Master 决定

Claude 阅读双语版本并补充固定源码/组件探针后给出 **PASS，无剩余阻塞项**，撤回配额要求；明确允许下述表述/测试修订直接纳入交接，无须新增复核轮次。Codex 全部采纳。此结论仅为计划可执行。

**单行粘贴须 Master 明确选择，不能由多行要求推定：**A 是当前通过复核的实施提案：所有粘贴都变成摘要块，单词、URL、路径也显示 `<pasted 1 line short-id.txt>`，修改内容通过替换块，不在块内直接编辑；实现较简单，但短文本操作较不方便。B 保持单行粘贴原样可编辑，只折叠多行；须维护单行 pasted-text 范围在编辑/undo/yank 中的来源，明确首 slash 是否来自粘贴。若 Master 选择 B，先修改对应计划并交同一 Claude 会话复核，再实施变更设计。不得默选 A。两者都保留既定多行 Hermes 摘要。行数登记为 LF 分割的逻辑行，含末尾空行，例如 `a\nb\n` 显示 3 行；载荷不变。

1. **词移动/undo/kill 门槛：**适配器自行扫描真实空白并在 token 边界停下，只把普通词区间交给 Pi，并限制不得越过 token；不能只判断光标旁 token 再直接调用原词方法。固定向量：`abc <tok>  ` 向后删词后为 `abc `，再次删除该词；`  <tok> abc` 向前删词后为 ` abc`；`xy<tok>` 向后删词后保留 `xy`；向前词移动准确停在词/token 边界。仅 Pi 确实 pop 时富 undo 才同步 pop；富 kill-ring 同步 accumulate/prepend 合并。
2. **流式发现：**解析 SSE transient 的 `previews[].id` 并映射 `message:<id>`。新 preview 尚无正文/预览时 NOT_FOUND 代表尚不可见，不走锚点丢失回退。处于尾部时从驻留尾 cursor 用 direction=after 发现新行，保留穿插 activity 顺序；around limit=1 只刷新已知行，不把孤立发现条目乱序附加，也不移动视口。
3. **L4 必须证明真正重发 POST：**状态请求以 transport 错误持续失败至重试前置对账结束，不能伪造 NOT_FOUND；确认第二次同 ID POST 已到 Core 后才恢复回执/状态。证据必须有两次同 ID POST、一条 Input、重放没有增加 provider attempt。若只发生迟到状态接收，该路径可单列通过，但 L4 重放仍未执行。
4. **live 覆盖边界：**4096-token 预算不保证产生跨片段流式回复；强制超长中文流式回归只由 fixture+真实 Core 集成证明。除非实际字节/片段证据达到，否则不能声称 L1–L4 覆盖此边界，也不自动提高预算。
5. **范围变更：**用编辑前后光标定位 delta，不能只做最长公共前缀 diff。固定测试 token 前紧贴输入 `<`、后紧贴输入 `>`、相邻 paste 和 IME 提交文字，不能误判现有 token 损坏；真实 IME 另列证据。
6. **识别拼接阈值：**没有总长度字段时沿 cursor 累加正文+推理 UTF-8 字节。下一片会超过 1 MiB，或达到预算仍有 next_cursor，就切换到锚点附近有界窗口并释放无关拼接；在途响应缓冲另计入有界请求范围，不能先把无限全文读完才判断大小。
7. **文案与测量：**两版第 2 节已改为删除 offset API。在隔离 Main/Task 草稿测量 1 MiB、16 MiB 合成 paste（不发送超限 POST），记录编辑时输入到可见更新、序列化/保存耗时；这是诊断而非新大小上限，不承诺草稿/磁盘有界，实际问题需有具体处置。

不采纳可选的纯标签身份 fallback：手写相似标记应保持字面意义，继续采用已复核的主属范围设计；可行性门槛失败则留证并修订后再推进。R2 reviewer 报告额外两个 Linux 探针验证 undo/kill hook 和完整空白扫描词移动，未运行仓库验证、Core/provider/macOS；不写成本地已复现。


## 12. Master 已批准的 B 修订（2026-10-30）

Master 已授权实施，完成后先由 Claude 复核，再交 Master 验收；覆盖前文“仅计划”阶段及选项 A。先清理终端控制序列、规范 CRLF/CR，再按扩展字素簇计数：不含 Tab 的单行且不超过 30 个可显示字符直接显示并可编辑；超过 30 字或含任一 LF 时显示独立 Hermes 摘要块。含 Tab 的粘贴强制摘要块，以避开 Pi 将行内 Tab 改为空格的规范化；块内保留 Tab 原始字节；组合字符和组合 emoji 各计一个。“30行以上或多行”结合前句字数阈值解释为“超过30字或多行”，已向 Master 明示该解释，仍可在最终验收前纠正。

短文本也在 v2 快照中保存粘贴来源区间（UTF-16 start/end，source=paste），不需要标记或 payload 表。按实际光标锚定的编辑区间切分来源：删除部分丢弃、残留字符保留来源、新键入字符保持 typed，即使插入粘贴区间内部；仅合并同来源相邻区间。撤销、kill/yank、重启恢复同步携带这些区间，不能根据正文或标签文字猜来源，也不能仅用全局最长公共前缀。

展开前按首个斜杠来源解析：粘贴的 / 是正文或 Task 草稿；键入的 / 是命令，即使命令名后续由粘贴输入。摘要块不得通过展开生成命令名。v1 来源未知的开头 / 保留本地错误，要求明确重键或加键入的 /rawmessage；补全不得把粘贴的 / 变成键入命令。键入 /send、/rawmessage 仅一次展开参数内已登记的块。旧 pending 正文保持不可变，不重新解析。

B 专项向量：0/1/29/30/31 个 ASCII/CJK 字素簇；30 个组合 emoji/组合字符；单个和尾随 LF；Tab/CRLF；粘贴 /help、/cotv 经保存恢复、撤销、yank 后仍为正文；键入 / 后粘贴 help 为命令；删除粘贴 / 再键入 / 后允许命令；粘贴区间内部新键入字符来源独立；短文本和块混合粘贴、续写保持来源顺序和独立撤销。R2 的原子块、快照迁移、pending/recovery 和大粘贴诊断不变，不扩大范围或模型预算。

### R3 修订已采纳

Master 已明确确认 30 字阈值。Claude 返回 CHANGES_REQUIRED，列出五项完整修正，并明确允许纳入计划后直接实施，无异议则无需再送一轮计划。全部采纳：LF 或 Tab 强制块；v1 全部文字（含恢复 pending raw）标记 unknown；绑定当前 pending 且未修改的草稿直接用不可变 pending body 同 ID 重试，不再解析；粘贴或 unknown 首斜杠禁用补全；无法归因的替换区间设 unknown；仅已登记 occurrence 区间享有块原子性和展开。撤销、富 yank/yank-pop、恢复、键入/换行、光标锚定删除、粘贴和 typed 命令补全各有明确归因。hello 加尾随 LF 显示 2 行块。不增加第二字节阈值；U+2028/U+2029 沿用 Pi 单行行为及原始字节。测试记录 Node/ICU。前文 §6/§10 的全部粘贴成块、§11 待选 A/B、§9 仅计划交付均为历史，现由本节覆盖。R3 只独立审阅英文修订，中文同步对应决定。

实施可行性调整：通过已登记光标边界及 backspace/delete/word 受控钩子实现原子性，不在 Pi 缺少位置上下文的 segment(text) 中按标签文字猜来源；另一行相同字面标签必须可逐字编辑。Markdown 继续由 Pi 整个区域渲染，以顶层 raw 块探测映射到权威输出；不能匹配的块（如私有 LaTeX 扩展）保守合并至前块，不改变格式。上述差异须由专项测试及最终准确 HEAD 复核确认。同宽 body/CoT 保持块/行锚点精度，改变宽度仍仅承诺块内近似位置。

## 13. R4 可行性修订——Master 已批准

Claude Opus 5.5 Extra 复现了任意八片段 Markdown 窗口的格式问题：表格、列表编号与嵌套、加粗、引用内代码围栏、Setext 标题以及字素截断。现有前缀推断方案不通过，不得交付或记作可行性通过。

批准方案：使用与固定版本 Pi 完全一致的词法配置，按完整顶层 Markdown 块分页，保留上游 MIT 来源与格式对照测试。窗口以八片段为目标，但允许**每个区域最多 1 MiB 原文**，仍受**合计 4 MiB 正文及上下文驻留预算**约束。沿现有不透明游标重读并保存有限检查点，不新增接口或本地原始历史库。分块识别必须与 Pi 整篇解析对照通过，不能用未经验证的启发式推断代替。

**已批准的行为变化：**若单个非代码块超过 1 MiB，或引用定义上下文无法装入预算，则按行及字素边界继续分窗，仍通过 Pi 渲染全部原文，并明确显示**“格式上下文边界”**提示；该极端路径不再承诺与整篇渲染完全同格式。普通块保持 Pi 格式，超大代码块使用按行对齐的代码窗口。不截断文字，不新增草稿或输入限额；不超过 1 MiB 的整条消息路径不变。

电脑控制工具已拒绝自动操作 Apple Terminal；POSIX PTY/ProcessTerminal 覆盖单独记录，实体剪贴板、物理快捷键及输入法验收仍为 NOT_TESTED。

Master 于 2026-10-30 明确批准 §13 方案变更，继续实施与验证。


## 14. R7 复核后的严格格式一致性修正

R7（`2c32bfb`）发现两个边界问题：后续 setext 下划线可把公式前的非空行并入标题；Pi/marked 的公式扩展会根据区域后文改变前面相邻段落的合并方式。独立重新解析原文块还可能丢失 Pi 对段落内缩进代码的规范化。

继续遵守已批准的 §13。先前提出的空行例外已撤回，未将 Master 的未答复视为批准。实现保留完整块经 Pi 配置解析得到的 token；未结束的公式所在非空行段保持待定，不提前切分。EOF 索引只额外保存最后一个公式开头的原文位置，恢复 Pi 的前向段落合并行为。显示时按完整区域引用定义重建行内 token，通过固定 Pi 0.87.0 的受检查 `renderToken` 接口渲染已解析块，避免重新解释独立块。没有合成公式、辅助可见文字或新网络请求。

解析树仅随当前驻留窗口保留，检查点不保留 token；4 MiB 仍是原文及引用上下文的逻辑预算，不是 V8 堆总量承诺。普通路径新增固定种子逐分割与渲染比较、缩进/空行反例、跨窗引用和窄屏回归；极端块的既有 §13 例外范围不变。最终结果、测试数量及精确提交见 PR #96 和实施复核记录；产品验收和合并授权仍由 Master 单独决定。

R9 只将连续、完整覆盖原文片段的 token 位置作为显示依据；混合窗口不保留不完整的 token 列表。无法可靠定位时重新解析整个驻留窗口，再用相同 Pi 块渲染器显示，并在最后一个公式开头位于窗口之后时恢复全局段落合并。没有辅助公式或文字丢失；此兜底使用窗口起点锚点，不声称能精确定位每个原文块。纯空白窗口不输出行，与 Pi 一致。

还需披露一个已有极端路径触发条件：早期出现无法定位原文的 Pi token（如重复引用定义或 `$$$$`），可能使安全边界无法前进，直至触发已有 1 MiB 格式上下文边界机制。此后提示及保守格式可持续到该区结束，原文仍可读。Master 对极端格式限制的验收确认应包含这一情况，不能将其描述成普通路径严格格式一致；不因此获得合并权限。
