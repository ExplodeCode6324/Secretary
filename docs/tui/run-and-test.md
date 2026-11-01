# 原生终端运行与验证

#92 新增 Main 事项和定向处理，验收状态见 [#92 账本](../fix/evidence/issue92-attention/acceptance.md)。

Main 编辑器上方按发起时间倒序展示待批准、待回答、失败和 UNKNOWN，分页可达全部记录。失败明确区分拒绝授权、撤销授权、执行失败、初始化失败及原因未分类；原因证据不一致另有标记。历史 FAILED 不因后续成功执行消失，精确处置和移除留给 #93。

编辑器首行 ↑ 进入事项选择，↑/↓ 跨页；最新项再 ↑ 进入 Main 历史，最旧项再 ↓ 或 Esc 回编辑器。Enter 打开完整详情，查看不会延长留存。Task 普通输入支持 `/show <完整事项ID>`，只补全命令名，ID 原样保留。

问题处理中 Enter 换行，Shift+Enter 原样回答当前事项，所有命令和补全停用。Tab/Shift+Tab 切换编辑器、详情和真实选项；选项焦点 ↑/↓ 选择，Enter 只复制选项原文。授权初始为中立详情，Tab 明确选择批准或拒绝，Enter 不执行，Shift+Enter 才确认。详情支持 ↑/↓、PageUp/PageDown。已结束执行的待批准授权仍可决定，但批准不能恢复该执行。

普通草稿继续由原送达控制器管理，返回时保留后台更新。请求接收不等于事项完成，客户端核对实际业务状态和请求身份。断线后当前进程保留冻结提交，明确重试才沿用同 ID 和载荷；未发回答和事项提交不跨进程持久化，不自动重放。

离线回归：`npx tsx --test --test-concurrency=1 test_case/offline/issue92/*.test.ts`。真实模型验收：`npx tsx test_case/online/test-issue92-live.ts .demo-data/issue92/live-<新目录>`；重跑可传上一轮 `report.json` 为第三个参数，累计预算不重置。Main/Task 各至多 48 次调用、150 次工具、每请求 90 秒、每响应 8192 tokens、总时限 20 分钟。真实 provider、虚拟终端和物理 Terminal/IME 验收分别记账。

当前分支交付 #82 基础终端及 #91 Main 历史、CoT 和文本粘贴；代码/CI 与 Master 的产品验收分别记录。入口使用固定 Pi 0.87.0，不是浏览器界面。结果见 [#91 验收记录](../fix/evidence/issue91-main-history/acceptance.md)。

## 运行

先按 [Core 运行手册](../operations.md) 启动独立 Core，再在真实终端执行：

```sh
npm ci
SECRETARY_DATA=/absolute/path/to/core-data npm run tui
```

默认数据目录是仓库 `.demo-data`。TUI 只连接 Core；Ctrl+C 仅退出客户端。推荐至少 80×24；物理终端、字体、中文输入法和 120×40 的人工验收仍待 Master 完成。客户端草稿位于 `~/Library/Application Support/Secretary/tui/v1/<domain>/<mode>/`，目录名保留 v1，文件格式为 v2。首次迁移保留原 v1 备份；不要用旧代码直接覆盖 v2 文件。需要旧版导出时，先退出该状态目录的 TUI，再运行：

```sh
npx tsx src/pi_secretary/scripts/tui-export-v1.ts /absolute/path/to/state-directory /absolute/path/to/new-export.json
```

导出不覆盖现有文件，保留待确认请求的原身份和正文；不自动回滚或修改 Core。

## 阅读与输入

- Enter 换行，Shift+Enter 明确提交；补全先于提交。输入首行按 ↑ 进入阅读，↑/↓ 跨边界补读；Esc 或输入返回编辑。
- Main 首次显示近期 50 项，按每页最多 50 项补读，驻留元数据最多 200 项；这些是缓存限制，不是历史总量限制。明确提交 Main 消息后跳到最新并持续跟随回复（含同ID重试）；主动上翻/下翻阅读、PageUp/PageDown、滚轮/滚动条、选择文字或切Task会停止。手动回到底部或返回Main不重新开启跟随；被动消息也不会开启。resize、重连、CoT切换保留已开启的跟随，明确输入拒绝会停止。
- `/m`、`/t` 在空草稿导航，默认提示与补全使用小写，命令名仍不区分大小写。Task 普通文本只保留 Task 草稿，不发送。Main 的 `/cotvisible`、`/cotv` 不区分命令名大小写，只改变显示，不调用模型；Task 调用会局部报错。
- 单行、无 TAB、最多 30 个字素的粘贴直接显示；更长、多行或含 TAB 的粘贴显示 `<pasted N lines ...txt>`。摘要保留对应原文，发送时按出现顺序展开一次；粘贴里的 `/t` 等不会作为命令执行。
- 同一次发送结果未知时保留草稿和原 request_id；明确重试不会另建业务身份。超出既有 Main 序列化请求上限时保留草稿，不截断或发送临时路径。
- 正文/CoT 的驻留文字与上下文共用 4 MiB 预算。合计 ≤1 MiB 的消息整篇渲染；更大消息按完整 Markdown 块分页，目标约八个 Core 片段、每区最多 1 MiB 原文。超大代码块按行分页；单个非代码块或引用上下文超过预算时明确显示“格式上下文边界”，原文仍可连续读完，此例外不保证整篇格式一致。为避免误判松散列表或未闭合公式的结束位置，超大非代码块触发后，该区后续窗口也保守地使用此提示和局部格式；这不是只影响一个块。 若 Pi 改写 token 原文（如早期重复引用定义或 `$$$$`）而无法定位安全块边界，也可能进入该提示路径。较小窗口会完整重新解析，使用保守的窗口起点锚点，确保正文可见。
- 预算优先保留可见正文，先淘汰离锚点最远的屏幕外正文；若可见正文自身超过 4 MiB，保留锚点并将部分内容显示为可补读占位，移动锚点或明确导航后重新读取，不在每次排版时反复重载。
- Core 接受提交时会清空 Main 的撤销和剪切历史；发送过程中输入的新草稿正文不会丢失，但其已有撤销步骤也会清空。这项限制仍待 Master 验收确认。
- 首次读取超长消息需要走完整游标链以收集引用定义，可能明显等待。2/4 MiB 合成样本实测约 9.9/25.5 秒，随后翻页约 0.38–0.51 秒；不承诺所有数据/机器具有相同性能。

本地 macOS 可以鼠标拖选，松开后复制到系统剪贴板。复制的是屏幕显示文本，软换行保留为换行，不是 Markdown 源码或粘贴摘要隐藏原文；选择期间同宽度文档保持稳定。Ctrl+C仍为退出，终端的复制快捷键不持有应用选择。剪贴板写入失败会明确提示；SSH及其他平台暂不支持此复制路径。

## 开发验证

完整检查需要隔离 PostgreSQL 测试管理员 DSN，详见 [Core 开发检查](../operations.md)。不使用生产数据库做测试：

```sh
npm run verify
npx tsx --test --test-concurrency=1 test_case/offline/issue82/*.test.ts test_case/offline/issue91/*.test.ts
```

手动启用的 `test_case/online/test-issue91-live.ts` 读取本地私有测试凭据并真实调用模型，不随 `npm test` 运行。单次服务周期限制为 12 次物理 HTTP 尝试、15 分钟、每请求 90 秒、每响应最多 4096 tokens；`--resume` 继续原账本和预算。输出只写隔离目录，禁止提交凭据、请求头及原始 provider 数据。

`issue91-navigation.ts <isolated-directory>` 用 Pi VirtualTerminal 驱动实际 Core/provider，覆盖不跟随、Task 往返、粘贴展开和 CoT 的只读性；它不是物理剪贴板/IME 验收。`issue91-body-benchmark.ts <output-json>` 用真实 Core 和合成消息测量 2/4 MiB 正文读取，不调用 provider。人工验收、测试替身、真实 Core、真实 provider 和 Claude 源码复核的结论不得混写。


## #83 Task 浏览

`/t` 进入按 Scope 分组的当前集合；页首 Scope 数不包含逻辑 Shared，已归档 Scope 只显示数量。`/search_task <完整或唯一前缀ID>` 在根列表定位，历史任务显示在独立临时区。`/taskdetail <完整ID>` 打开详情；`/back` 恢复根列表阅读位置。详情连续显示最近三轮实际 Agent 对话，每轮内部按事件顺序排列，没有第四轮入口。

仍只有 Main、Task 两份草稿。Task 普通文本不会发送；Tab/Enter 补全只编辑文本，Shift+Enter 才执行命令。只有 Main 的 `/cotvisible` 或 `/cotv` 能修改共同 CoT 显示状态。查看模式 ↑/↓ 到正文或消息窗口边界继续读取，Esc 返回编辑。归档、最近三轮替换和断线恢复通过任务/消息 ID 重新定位，并显示位置变化提示。

离线回归：`npx tsx --test --test-concurrency=1 test_case/offline/issue83/*.test.ts`。付费真实模型验收需现有私有凭证，并显式运行 `npx tsx test_case/online/test-issue83-live.ts .demo-data/issue83/live-<独立名称>`；目录必须全新，固定请求/工具/时间/输出预算，在 Core 冻结预算之前配置，保留首次失败。此脚本不由 npm test 执行，不代表原生 IME 或 Master 人工验收。
