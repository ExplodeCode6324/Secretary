# 原生终端运行与验证

组合验收与手工操作见 [macOS 终端验收](acceptance.md)、[分项标准](acceptance-criteria.md)与[来源交叉表](source-map.md)。

#92 新增 Main 事项和定向处理，验收状态见 [#92 账本](../fix/evidence/issue92-attention/acceptance.md)。

Main 编辑器上方按发起时间倒序展示待批准、待回答、失败和 UNKNOWN，分页可达全部记录。失败明确区分拒绝授权、撤销授权、执行失败、初始化失败及原因未分类；原因证据不一致另有标记。历史 FAILED 保留；提醒仅因 Main 明确移除或该失败直接关联的重做成功而退出，无关成功不能清除旧失败。

#93 失败详情默认中立，Tab 选择按原要求重做或移除提醒，Shift+Enter 通过结构化 Main Input 提交。请求接收、Main 处理、排队、执行及最终处置分别显示。旧执行不可继续时报告真实原因，不创建替代任务；初始化失败不能重做，移除提醒仍保留后台初始化重试。UNKNOWN 只读。原 Main 富文本草稿不成为动作载荷，返回时保留。

Task 普通输入支持 `/cancel --request <完整 task_request_id>` 或 `/cancel --execution <完整 execution_id>`，二选一；命令大小写不敏感，ID 原样保留。Main 和事项处理中不可用。手动输入开头 `/` 才解释命令，整行粘贴只保留草稿。取消只针对所选请求/执行，不停止周期计划的未来调度。接收回执不证明取消完成；CANCEL_REQUESTED 和 RESULT_UNKNOWN 不得显示已完成。断线保留同 ID 原提交，进程重启不自动重放。

编辑器首行 ↑ 进入事项选择，↑/↓ 跨页并首尾循环；Esc 回编辑器。在普通编辑器按 PageUp 进入历史。Enter 打开完整详情，详情 Esc 返回原事项选择，再 Esc 回编辑器；若原事项已失效，则显示提示并回编辑器，不转选其他事项。查看不会延长留存。Task 普通输入支持 `/show <完整事项ID>`，只补全命令名，ID 原样保留。整行粘贴的 `/show` 按普通草稿保留，不执行；运行命令可先手动输入 `/`，再粘贴 `show <完整ID>`（在 60 字素内直接显示）；最后 Shift+Enter。

进入事项选择会停止 Main 的自动跟随，与主动阅读历史一致。授权、问题详情、选项焦点提示和事项预览会把 Unicode 格式字符（如双向控制、零宽字符）及 U+2028/U+2029 显示为 `\u{XXXX}` 标记；这是显示转换，不修改授权参数、版本哈希或提交的原文字节。

问题处理中 Enter 换行，Shift+Enter 原样回答当前事项，所有命令和补全停用。Tab/Shift+Tab 切换编辑器、详情和真实选项；选项焦点 ↑/↓ 选择，Enter 只复制选项原文。授权初始为中立详情，Tab 明确选择批准或拒绝，Enter 不执行，Shift+Enter 才确认；批准焦点用黄色背景、粗体及确认文字强调，拒绝焦点用红色及确认文字标明。详情支持 ↑/↓、PageUp/PageDown。已结束执行的待批准授权仍可决定，但批准不能恢复该执行。

普通草稿继续由原送达控制器管理，返回时保留后台更新。请求接收不等于事项完成，客户端核对实际业务状态和请求身份。断线后当前进程保留冻结提交，明确重试才沿用同 ID 和载荷；未发回答和事项提交不跨进程持久化，不自动重放。

离线回归：`npx tsx --test --test-concurrency=1 test_case/offline/issue92/*.test.ts`。真实模型验收：`npx tsx test_case/online/test-issue92-live.ts .demo-data/issue92/live-<新目录>`；重跑可传上一轮 `report.json` 为第三个参数，累计预算不重置。Main/Task 各至多 48 次调用、150 次工具、该历史脚本的每请求上限 90 秒、每响应 8192 tokens、总时限 20 分钟。真实 provider、虚拟终端和物理 Terminal/IME 验收分别记账。

当前分支交付 #82 基础终端及 #91 Main 历史、CoT 和文本粘贴；代码/CI 与 Master 的产品验收分别记录。入口使用固定 Pi 0.87.0，不是浏览器界面。结果见 [#91 验收记录](../fix/evidence/issue91-main-history/acceptance.md)。

## 运行

先按 [Core 运行手册](../operations.md) 启动独立 Core，再在真实终端执行：

```sh
npm ci
SECRETARY_DATA=/absolute/path/to/core-data npm run tui
```

默认数据目录是仓库 `.demo-data`。TUI 只连接 Core；Ctrl+C 在当前可编辑输入框有内容时一次清空全部文字，可用 Ctrl+- 撤销；空框或无可编辑回答框时才退出客户端，不停止 Core。Main/Task 草稿和问题临时回答分别处理，授权/异常详情不清空隐藏的普通草稿。清空不撤销已经提交的消息或事项操作，待确认请求仍保留原 ID 和载荷。推荐至少 80×24；本轮组合验收登记物理终端、字体、中文输入法和 120×40 的实际结果。客户端草稿位于 `~/Library/Application Support/Secretary/tui/v1/<domain>/<mode>/`，目录名保留 v1，文件格式为 v3。首次从 v1/v2 迁移保留原版本备份；不要用旧代码直接覆盖 v3 文件。包含图片草稿、待发送图片或图片恢复引用时拒绝旧版导出。仅纯文字状态需要旧版导出时，先退出该状态目录的 TUI，再运行：

```sh
npx tsx src/pi_secretary/scripts/tui-export-v1.ts /absolute/path/to/state-directory /absolute/path/to/new-export.json
```

导出不覆盖现有文件，保留待确认请求的原身份和正文；不自动回滚或修改 Core。

## 阅读与输入

- Enter 换行，Shift+Enter 明确提交；补全先于提交。输入首行按 ↑ 进入阅读，↑/↓ 跨边界补读；Esc 或输入返回编辑。
- Main 首次显示近期 50 项，按每页最多 50 项补读，驻留元数据最多 200 项；这些是缓存限制，不是历史总量限制。明确提交 Main 消息后跳到最新并持续跟随回复（含同ID重试）；主动上翻/下翻阅读、PageUp/PageDown、滚轮/滚动条、选择文字或切Task会停止。手动回到底部或返回Main不重新开启跟随；被动消息也不会开启。resize、重连、CoT切换保留已开启的跟随，明确输入拒绝会停止。
- `/m`、`/t` 在空草稿导航，默认提示与补全使用小写，命令名仍不区分大小写。Task 普通文本只保留 Task 草稿，不发送。Main 的 `/cotvisible`、`/cotv` 不区分命令名大小写，只改变显示，不调用模型；Task 调用会局部报错。
- 单行、无 TAB、最多 60 个字素的粘贴直接显示；更长、多行或含 TAB 的粘贴显示 `<pasted N lines ...txt>`。摘要保留对应原文，发送时按出现顺序展开一次；粘贴里的 `/t` 等不会作为命令执行。
- 同一次发送结果未知时保留草稿和原 request_id；明确重试不会另建业务身份。超出既有 Main 序列化请求上限时保留草稿，不截断或发送临时路径。
- 正文/CoT 的驻留文字与上下文共用 4 MiB 预算。合计 ≤1 MiB 的消息整篇渲染；更大消息按完整 Markdown 块分页，目标约八个 Core 片段、每区最多 1 MiB 原文。超大代码块按行分页；单个非代码块或引用上下文超过预算时明确显示“格式上下文边界”，原文仍可连续读完，此例外不保证整篇格式一致。为避免误判松散列表或未闭合公式的结束位置，超大非代码块触发后，该区后续窗口也保守地使用此提示和局部格式；这不是只影响一个块。 若 Pi 改写 token 原文（如早期重复引用定义或 `$$$$`）而无法定位安全块边界，也可能进入该提示路径。较小窗口会完整重新解析，使用保守的窗口起点锚点，确保正文可见。
- 预算优先保留可见正文，先淘汰离锚点最远的屏幕外正文；若可见正文自身超过 4 MiB，保留锚点并将部分内容显示为可补读占位，移动锚点或明确导航后重新读取，不在每次排版时反复重载。
- Core 接受提交时会清空 Main 的撤销和剪切历史；发送过程中输入的新草稿正文不会丢失，但其已有撤销步骤也会清空。#91 已记录该限制，组合验收按已接受行为核对。
- 首次读取超长消息需要走完整游标链以收集引用定义，可能明显等待。2/4 MiB 合成样本实测约 9.9/25.5 秒，随后翻页约 0.38–0.51 秒；不承诺所有数据/机器具有相同性能。

本地 macOS 可以鼠标拖选，松开后复制到系统剪贴板。复制的是屏幕显示文本，软换行保留为换行，不是 Markdown 源码或粘贴摘要隐藏原文；选择期间同宽度文档保持稳定。Ctrl+C按上述有内容清空/空框退出规则处理，终端的复制快捷键不持有应用选择。剪贴板写入失败会明确提示；SSH及其他平台暂不支持此复制路径。

## 开发验证

完整检查需要隔离 PostgreSQL 测试管理员 DSN，详见 [Core 开发检查](../operations.md)。不使用生产数据库做测试：

```sh
npm run verify
npx tsx --test --test-concurrency=1 test_case/offline/issue82/*.test.ts test_case/offline/issue91/*.test.ts
```

手动启用的 `test_case/online/test-issue91-live.ts` 读取本地私有测试凭据并真实调用模型，不随 `npm test` 运行。单次服务周期限制为 12 次物理 HTTP 尝试、15 分钟、该历史脚本的每请求上限 90 秒、每响应最多 4096 tokens；`--resume` 继续原账本和预算。输出只写隔离目录，禁止提交凭据、请求头及原始 provider 数据。

`issue91-navigation.ts <isolated-directory>` 用 Pi VirtualTerminal 驱动实际 Core/provider，覆盖不跟随、Task 往返、粘贴展开和 CoT 的只读性；它不是物理剪贴板/IME 验收。`issue91-body-benchmark.ts <output-json>` 用真实 Core 和合成消息测量 2/4 MiB 正文读取，不调用 provider。人工验收、测试替身、真实 Core、真实 provider 和 Claude 源码复核的结论不得混写。


## #83 Task 浏览

`/t` 进入按 Scope 分组的当前集合；页首 Scope 数不包含逻辑 Shared，已归档 Scope 只显示数量。`/search_task <完整或唯一前缀ID>` 在根列表定位，历史任务显示在独立临时区。`/taskdetail <完整ID>` 打开详情；`/back` 恢复根列表阅读位置。详情连续显示最近三轮实际 Agent 对话，每轮内部按事件顺序排列，没有第四轮入口。

仍只有 Main、Task 两份草稿。Task 普通文本不会发送；Tab/Enter 补全只编辑文本，Shift+Enter 才执行命令。只有 Main 的 `/cotvisible` 或 `/cotv` 能修改共同 CoT 显示状态。查看模式 ↑/↓ 到正文或消息窗口边界继续读取，Esc 返回编辑。归档、最近三轮替换和断线恢复通过任务/消息 ID 重新定位，并显示位置变化提示。

离线回归：`npx tsx --test --test-concurrency=1 test_case/offline/issue83/*.test.ts`。付费真实模型验收需现有私有凭证，并显式运行 `npx tsx test_case/online/test-issue83-live.ts .demo-data/issue83/live-<独立名称>`；目录必须全新，固定请求/工具/时间/输出预算，在 Core 冻结预算之前配置，保留首次失败。此脚本不由 npm test 执行，不代表原生 IME 或 Master 人工验收。

### Scope 归档边界

Scope 归档关闭新工作入口、阻止尚未开始的执行；不等于关闭所属 TaskPlan。Core 入口 `POST /api/v1/scopes/{id}/archive` 使用 `request_id` 和 `expected_revision`，将 Scope 从 ACTIVE 改为 ARCHIVED 并记录 `scope.archived`，不遍历删除 Task、目录、产物或历史。

| 对象或动作 | 当前行为 |
| --- | --- |
| 新建或继续 Task | 新请求返回 `SCOPE_ARCHIVED`；已可靠接收请求的同 ID 重放仍返回原结果，不算新工作 |
| 已开始的执行 | 归档本身不取消；沿已绑定目录收尾。等待授权者仍可批准；等待回答者仍可按原 Decision ID 回答并完成同一 Execution |
| 尚未开始的执行 | 分派进入 WAIT_PRECONDITION，原因为 `SCOPE_ARCHIVED`，不调用模型开始工作 |
| TaskPlan 与周期调度 | 不级联关闭计划，也不清空请求或发生队列。已登记的周期计划到期仍可创建受阻执行；有未终结执行时，后续发生点按 QUEUE 累积，不能称作已取消计划 |
| 对象与文件 | 不删除 Task、工作目录、产物或历史；Execution 留存/退役独立，归档不触发退役 |
| 公开 Core 查询与 TUI 浏览 | 既有 Task 的公开查询仍可读，但继续能力不可用；TUI 的列表、短 ID 查找和详情统一排除归档 Scope 任务，仅显示归档 Scope 数量 |
| 活跃授权、问题和异常 | 不因浏览排除而抹除。Main 事项及已知 ID 处理入口仍按真实状态/作用域校验，不自动批准、回答、取消或新增归档浏览页 |
| 恢复归档 Scope | 没有公开 restore/unarchive；普通更新不接受 state，已归档 Scope 拒绝保存修改 |

这些边界来自现有 Core 合同，未新增级联归档。自动验证包括 [Scope/工作目录测试](../../test_case/offline/issue16/workspace.test.ts)、[归档请求幂等](../../test_case/offline/issue16/review-contract.test.ts)、[TUI 浏览排除](../../test_case/offline/issue83/api.test.ts)及[归档后回答/周期发生测试](../../test_case/offline/issue83/archive-boundaries.test.ts)。归档后回答及周期队列这两条原先仅为源码推断，现通过独立 Core App、实际领域转换及脚本化 provider 验证；不是付费模型或物理终端验收。历史设计出处仍保留在 `implementation-reference.md`。

## Issue #94 delivery and image paste

Main replies display registered artifacts at their actual body tail, in cyan, with full current paths, Task/Execution identities and Task-model explanations marked NOT_VERIFIED. In history, ordinary Up/Down crosses the artifact block's previous/next-page boundaries; no OS-reserved paging shortcut is required. A CAS snapshot and current file can differ; unavailable current paths never fall back to snapshot bytes.

Type `/open <absolute path>` or `/open <registered relative path>` in ordinary Main. For ambiguous names, use the full path or `/open --execution <full UUID> <relative path>`. One ASCII space separates the command from the literal path; internal spaces and case are preserved. No shell expansion or quote removal. Local macOS only, no SSH; regular non-executable documents in the approved suffix list only. Symlinks and launchers are rejected. OS handoff success does not prove content was viewed. Errors expire after five seconds or the next action.

Ctrl+V explicitly reads genuine native clipboard image pixels into Main draft material rows. `/paste` is a whole-command fallback: genuine images win, text-only content retains paste provenance, Finder file references are rejected even when they expose an icon. Cmd+V/bracketed paste retains its text behavior. The fixed AppKit JXA probe checks types/changeCount before and after native reads; permission refusal, timeout or clipboard changes cause an explicit error. Native gesture/provider acceptance is recorded separately in the [ledger](../fix/evidence/issue94-delivery/acceptance.md).

Tab selects image rows when command completion is inactive; arrows select, Delete/Backspace removes an unsent draft reference, Enter/Esc returns to editing. Failed/importing images block sending until explicitly discarded or READY. Shift+Enter explicitly sends text plus ordered ready images; empty text and `/send` support image-only submission. Ctrl+C clears text only. Task, history selection and active matters cannot initiate image reads. No paste auto-sends.

Local state is now v3 (the existing directory still ends in `tui/v1`). Both v1 and v2 upgrade with a backup. Image attempts, staging source hashes and exact import/message request bodies survive restart; uncertain requests retain their IDs. Legacy export refuses any image materials, including recovery references. Owned staging sources remain protected by active draft/outbox/recovery references and three-calendar-year retention.

Focused checks: `npx tsx --test --test-concurrency=1 test_case/offline/issue94/*.test.ts`. Paid tests are explicit online harnesses, never part of npm test. Master acceptance uses an isolated instance and its exact command, provided with the implementation handoff.
