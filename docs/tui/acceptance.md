# macOS 终端组合验收

> Issue #84 最新策略：[取消额度与用量观测修订](../fix/fix_20261105_issue84_unlimited.md)。Master 已取消累计费用、token、调用/工具/提案次数及时间额度。下文旧两小时、reserve、维护余量条款仅保留为 bounded 历史；新 live 使用 observe。90K Main、8192 输出和 100K 出站护栏仍是验收配置，不能将其消耗当作产品默认配置下的日常消耗。

observe 的 `next` 要求请求、Main 输入与 Task 静止；它记录尚未到期或失败的维护，不强制 compact，也不宣称维护已收敛。`retry-maintenance` 允许有理由且记日志的一次操作者恢复，不需要旧 reserve；工具策略拒绝仍先停止。`native-vision` 是 redo 后的一次人工阶段，无两小时过期限制。自动流程完成后停止自动发送，等待 Master 操作。

新真实域必须使用新的空目录和数据库；`ISSUE84_HISTORY` / `ISSUE84_HISTORY_SHA256` 指向冻结的历史证据清单，启动和续接校验散列。凭据从项目忽略的 `.env.local` 私下读取。当前候选的 observe dry、calibration、preflight 和 CI 必须匹配。`TOKEN-USAGE.md` / `token-usage.json` 区分本轮、历史与累计，包含缓存、推理、物理请求、逻辑调用、流和未知用量。估算金额不是账单。具体目录及原生步骤以交接材料为准。

验收按同一候选提交记录三类证据：真实终端操作、真实模型与 Core 状态，以及无凭据的故障或历史彩排。记录 macOS、Terminal、Node、pi-tui、字体、行列、实际键位、Core/TUI SHA 和数据域。建议先记录 80×24，再调整到 120×40。无法捕获按键字节时登记 NOT_CAPTURED。结果填入 [AC01–AC34 账本](../fix/evidence/issue84-combined/acceptance.md)。

## 当前行为和来源

| 范围 | 当前规范 | 裁定来源 |
| --- | --- | --- |
| C01–C03 | 原生 Main/Task 两入口，进入同页及根 /back 无副作用。Enter 换行，Shift+Enter 发送，颜色沿用 xterm 117/218 | [#82](../fix/fix_20261030_issue82_terminal.md) |
| C04–C05、U03 | Main 初始和分页各 50 条，最多驻留 200 条元数据和 4 MiB 正文/CoT。显式发送与同 ID 重试启动跟随，缩放、重连和 CoT 切换保持。主动阅读、事项、鼠标选择或切 Task 停止跟随。被动消息不启动跟随。鼠标松开复制显示内容及软换行 | [#91](../fix/evidence/issue91-main-history/acceptance.md) |
| C06–C08、U06–U09 | 活跃 Scope 按活跃时间，其他普通 Scope 按创建时间，组内按执行时间。Shared 独立计数及工作区，空组和归档不计；普通纯暂停不占当前集合，有运行或等待事项的任务仍显示。详情显示最近三轮 Agent；归档不参与补全、搜索或详情 | [#83](../fix/evidence/issue83-task-browser/acceptance.md) |
| C09–C10、U02 | 有事项时首行 Up 先进入事项，PageUp 仍可进入历史。Enter 只开详情，Shift+Enter 确认。批准后移除，取消、目标失效和详情返回保留普通草稿。/show 在 Task 内按完整事项 ID 打开 | [#92](../fix/evidence/issue92-attention/acceptance.md) |
| C11、U04 | 交付末尾只列登记产物。/open 支持精确相对路径与可选完整执行 ID，也支持绝对路径。打开当前文件，五秒提示，允许类型与本机安全检查生效 | [#94](../fix/evidence/issue94-delivery/acceptance.md) |
| C12–C16、U01 | 单行无 Tab 不超过 60 字素可编辑。长段保存原文。手敲首字符斜杠才进入命令，整条粘贴按文字处理。Ctrl+C 清空、Ctrl+- 撤销、空 Ctrl+C 退出。Ctrl+V 从系统剪贴板取真实像素，Cmd+V 走普通文本粘贴 | [#92](../fix/fix_20261102_issue92_attention.md) · [#94 最终记录](https://github.com/ExplodeCode6324/Secretary/pull/101#issuecomment-6652193797) |
| U05 | Tab 选择 Main 结构化重做或移除提醒。旧执行重做不可用时显示原因，INIT_FAILED 无重做，UNKNOWN 只读，后续工作需 Main 新指示。Task 取消精确关联请求或执行，接收和终态分开 | [#93](../fix/evidence/issue93-failure-handling/acceptance.md) |

[v1.7 的详细操作与失败判据](implementation-reference.md) 保留供逐项交叉复核，直到组合验收确认全部分支和引用落点。#70–#73 按原顺序等 #84 完成及 Master 终验，#74 以 #70 数据为准。

## 手工清单

先完成无凭据彩排。使用独立 TUI 数据域的 Core，打开同一候选的 Terminal。记录每项的实际输出、对象 ID、异常及步骤编号。

1. **启动与草稿（AC01–04、AC24–26、AC28、AC30–31）。** 启动见 Main。中文输入法选词后继续输入，Enter 换行，Shift+Enter 才发送。空输入下切 /T、/M，重复同页和根 /back。Task 普通正文只存草稿。Ctrl+C 清空、Ctrl+- 撤销，清空后 Ctrl+C 退出并重开；Core 仍运行。核对对象补全、混合大小写、完整参数、整条粘贴与手敲斜杠后粘贴、一次性纯文本。试鼠标复制已渲染的正文及代码，核对软换行和中文字符。
2. **历史（AC03–09、AC27、AC31）。** 无事项时首行 Up 进入阅读。有事项时用 PageUp。彩排历史有 216 条。滚到最早再回到近期，切 CoT、切 Task 再返回、调整窗口。核对锚点和顺序。显式发送后跟随，主动阅读后停住，观察随后到达的消息。手写一段、粘贴一段、再手写和粘贴，检查实际提交字节。失效游标用无凭据故障测试核对稳定 ID 恢复。
3. **Task（AC05、AC10–15、AC28、AC33）。** 从真实 Main 提议产生 Task，核对 Core 分组、计数、目录和计划/执行状态。用 /search_task 定位完整或唯一短 ID，再 /taskdetail 看最近三轮。对照归档、歧义、纯暂停和仍等待案例。按 /back 验证列表锚点。前驱的相同 Task 争用和长历史边界另列证据。
4. **事项（AC16–20、AC31、AC34）。** 用真实提问和写入授权分别完成定向操作。先留普通草稿，Up/Enter 只读，明确确认后才提交。Task 用 /show 打开目标，先 Esc 验证返回，再完成。核对精确对象、过期提示、原草稿、无 viewed 写入。观察批准和执行消耗两个状态。命令样式文本仍按回答处理。
5. **失败与取消（AC21、AC29–31）。** 缺失 source.txt 时核对 read 错误和 FAILED。随后在该执行的隔离工作区加入预先登记的字节，用 Main 的失败行选择精确重做。核对唯一新执行及直接关联，验算产物和散列。重开后原 FAILED 仍可查。受控样例再验结束提醒、新失败、旧失败拒绝、UNKNOWN 和精确取消；保留实际终态证据。
6. **产物与原生图文（AC22–23、AC32–33）。** 两个 Shared Task 创建同名不同内容的 report.txt，另留未登记中间文件。检查两条交付对应独立目录。用 /open 打开当前文件，编辑后再打开，核对不变的登记散列。删除一份测试产物后核对缺文件提示、消失时长及 TUI 仍可用。先打说明，用 Preview 打开 vision.png，选取实际像素并复制，切回 Terminal 按 Ctrl+V。确认 READY 后发送，并比对真实模型回报与随机标记。检查失败保留草稿，区分 Finder 文件引用及 /paste。

## 启动彩排

使用仓库根目录执行。首次启动需有 Issue #84 专用的两个空 PostgreSQL 数据库，监听本机 55484，数据库名为 `secretary84_rehearsal` 与 `secretary84_live`。启动脚本会创建对应数据域，后续用 `--resume` 并核对候选指纹。

首次运行（仅在新目录及空库时）：

```sh
createdb -h 127.0.0.1 -p 55484 -U secretary84 -T template0 secretary84_rehearsal
npx tsx test_case/online/serve-issue84.ts rehearsal
```

已有验收域恢复用 `npx tsx test_case/online/serve-issue84.ts rehearsal --resume`。勿重建或清空旧库；当前旧域已含 Master 验收记录，仅能在其原候选恢复。新候选可用 `ISSUE84_RUN=<label>` 建立独立 `.demo-data/issue84/runs/<label>/<mode>`，数据库同步命名为 `secretary84_<label>_<mode>`；首次必须为空。

另开实际 macOS Terminal，在仓库根目录执行：

```sh
SECRETARY_MODE=live SECRETARY_DATA="$PWD/.demo-data/issue84/rehearsal/core" npm run tui
```

本验收服务的 Core API 模式为 `live`，TUI 必须显式设置 `SECRETARY_MODE=live`，否则默认 `fixture` 会触发 `CORE_MODE_MISMATCH`。是否请求真实模型由服务启动参数 `rehearsal` 或 `live` 决定；上述 `rehearsal` 仍使用无凭据的脚本化模型。

彩排输入 `84 shared`、`84 question`、`84 approval`、`84 failure`。授权前在 Core 窗口输入 `approval-scope`。彩排使用脚本化模型，可重复检查界面及 Core 状态。原生真实模型阶段按 Main、vision、Shared、事项、失败重做的顺序，在 Core 空闲时用 `next vision`、`next shared`、`next matters`、`next redo` 切换预算。请求预算耗尽时暂停并保留当时状态，只有 Master 可以在服务窗口释放预留。

实际路径、验收启动和证据采集细节见 [#84 计划](../fix/fix_20261105_issue84_combined.md)。

## 真实模型预检与固定输入

仅验收工具读取项目私有 `.env.local` 的 `DEEPSEEK_API_KEY`；该文件权限 600、Git 忽略，不粘贴到终端命令或证据。固定输入见 [issue84-prompts.ts](../../test_case/online/issue84-prompts.ts)。源文件预置值为 13 字节 `ISSUE84-REDO\n`，SHA-256 为 `b4a69797d1c4a0de5428c053d8d40289d097967f2e46fd30a66aad79bbb4f82f`。

无付费技术预检使用 `npx tsx test_case/online/rehearse-issue84.ts <新标签> dry` 和 `npx tsx test_case/online/rehearse-issue84.ts <新标签> calibration`，分别创建隔离库并保留 observations、usage、scenarios 和日志。前者复用真实准入适配器，以脚本响应覆盖并发、429、预算拒绝、模拟操作者释放 reserve、同输入恢复、图片、Shared、事项、失败重做和重启；后者覆盖增长、裁剪、摘要及提取。它们不构成原生或真实 provider 通过。

`preflight-issue84.ts` 接收 dry 目录、calibration 目录、带日期官方价格/vision 假设 JSON 三个参数，检查当前候选及全部证据后才生成 `.demo-data/issue84/preflight.json`。真实服务 `serve-issue84.ts live` 拒绝没有匹配 PASS 的启动。真实 reserve 只能由 Master 明确释放；没有通过时保留失败记录，不手工写 PASS，不跨候选改 manifest。

手工清单第 2–5 项的归档/歧义/纯暂停、UNKNOWN、旧失败拒绝、精确取消、4 MiB、overflow、四轮 Agent 及带命令样式选项样例尚未全部建立；只对实际存在的对象验收，缺少前置的子步骤保持 NOT_RUN。自动化边界证据与本次原生观察分开登记。

服务窗口的操作者命令不属于 TUI：`next <phase>` 仅在工作及维护全部收敛后按原顺序切换；`release-reserve` 需要引用 Master 对当前阶段的明确指示，且无活跃请求、Main 恢复阻塞或其余工作已静止；`retry-maintenance` 仅在当前阶段 reserve 已释放且无活跃工作时调用既有 `session/compact`。后两者在 dry 中由模拟操作者执行并标记，不能视作真实授权。

自动路径完成后，`native-vision` 只允许从空闲 redo 单次返回原 vision 剩余额度；不清零费用、次数或两小时起点，不允许再次循环路径。普通 Main 仍保留两次维护余量，故自动 vision 最多用三次才可保证留出一次原生发送；若不足或过期，登记 NOT_RUN 等 Master 决定。真实 reserve 仍只能由 Master 明确释放。原生图片 caption 同时采用「手敲/粘贴/手敲/粘贴」，发送后在回复到达前上滚，核对跟随停止及实际提交字节。交接必须给出剩余次数和截止时间。
