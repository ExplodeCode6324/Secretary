# Issue #82 G0 探针与门禁交接

2026-10-24。基于 R3 计划提交 `937f3031ed2e83953d65b4a3cf196cedd3488ad9` 的 **G0-only** 授权。当前 **G0 未通过，不进入产品实现**。

## 结果与边界

| 项目 | 结果 | 证据与含义 |
| --- | --- | --- |
| 固定依赖与公共 API | PASS | `@earendil-works/pi-tui@0.87.0`，`npm install --save-exact --ignore-scripts`；锁文件 integrity 与 R3 相同；公共 renderer/layout/input 导出可用 |
| 原生模块与输出 | PASS，限合成检查 | 导入、渲染/输入检查未要求 native addon；自有 Terminal adapter 不调用 ProcessTerminal；空 OSC 8 关闭序列精确滤除，其余 OSC 8/52 拒绝输出 |
| CLT/Python | PASS | 先只读确认 Xcode developer 路径和实际 Python 存在，再限时调用固定 `/usr/bin/python3`；Python 3.9.6、stdlib fcntl 可用，无安装动作 |
| 输入分块与文字 | PASS，限合成检查 | 分块 paste 标记、连续粘贴、中文/emoji、保留 tab，CRLF/CR 仅转 LF；嵌套标记作为文字保留 |
| 恶意 paste 来源 | **FAIL_PROTOCOL_PROVENANCE** | 同块尾部 Ctrl+S/G/C 被隔离；嵌入结束标记后，另一 raw chunk 的 Ctrl+S/G/C 被识别为 keys。反例成功复现不等于安全通过 |
| helper 生命周期 | PASS，限合成检查 | 单写者/竞争锁、合并队列、EOF、SIGHUP/SIGINT/SIGTERM/SIGTSTP、BrokenPipe 在当前原子操作后结束、helper SIGKILL 后重开 |
| PTY | PASS，非真实终端/IME证据 | 80×24、120×40、40×12、30×10 resize；低于最小尺寸不计提交，恢复尺寸后 Ctrl+S 计一次；正常退出恢复模式；PTY hangup 与父进程 SIGKILL 后 helper 完成在途操作并释放锁 |
| 剪贴板 | PASS，限显式子进程往返 | 固定 pbcopy/pbpaste、UTF-8 locale、无 shell；中文/emoji/组合字符/tab/CRLF 36 字节精确往返；未证明 Terminal 粘贴交付 |
| 原生 UI | **BLOCKED** | CUA 原生应用查询报告 Mac 锁定且自动解锁失败，未执行原生输入；浏览器可用不代表 Terminal 可操作 |
| Terminal/IME/Reset/视觉 | **NOT_TESTED** | 真实中文候选窗、确认键、候选期间快捷键、鼠标选择、Ctrl+O 复制、布局/对比度、Reset 后交付、窗口关闭均未验收 |

这里的协议反例证明应用不能只凭同一字节流区分“伪造的 paste 结束标记+控制键”与“真正结束后按键”。它**尚未证明 Terminal.app 会交付恶意剪贴板中的这些字节**。不得通过延时、依赖一次分块偶然性、换 renderer 或把 PTY 当作 IME 来放行。先取得真实交付与 Reset 证据，再由协调决定是否窄修订并送同 Claude 复核。

## 已交付内容

- `npm run tui:g0`：独立合成输入/布局探针。无 Core imports、请求、产品命令、outbox、CoreClient 或同步修改；本地 submit 仅计数。
- 最小自有 Terminal adapter、可见文字复制 callback、独立命令缓冲区和 literal 状态。输入区 6 行、最小 40×12；输入内容上限 8 KiB，raw trace 上限 8 MiB。截断/超限会显示状态，探针不是产品编辑器。
- helper 仅写本次新建私有 `run-*/state/` 的 `g0.lock` 与合成 `snapshot.json`，管道 stdio，无 TTY。Node 仅写该运行的证据日志，不绕过 helper 写 snapshot。
- 主屏 `--main-screen` 只比较原生滚动/复制；不是产品 renderer 切换，主屏固定底栏未验收。`--light`、`--no-color` 可作后续视觉检查；256/16 色映射尚未实现/验收。
- Probe 支持左右箭头、Home/End；完整编辑/undo/redo、纵向光标、产品 `/help` 与命令解析均未实现。`--help` 明示 Ctrl+C 退出、Ctrl+O 复制可见渲染文字。

代码入口：[探针](../../../../src/pi_secretary/scripts/issue82-g0.ts)、[剪贴板夹具](../../../../src/pi_secretary/scripts/issue82-g0-clipboard.ts)、[输入分帧](../../../../src/pi_secretary/scripts/issue82-g0/input.ts)、[Terminal adapter](../../../../src/pi_secretary/scripts/issue82-g0/terminal.ts)、[helper](../../../../src/pi_secretary/scripts/issue82-g0/writer.py)、[有限测试](../../../../test_case/offline/issue82/g0.test.ts)、[PTY 检查](../../../../test_case/offline/issue82/g0-pty.py)。

## 证据索引

本地 git-ignored `.demo-data/issue82-tui/g0/`；全部为合成输入，真实运行时也只使用合成内容。

- `prerequisites.json`：版本、公共导出、lock integrity、native load guard。
- `focused-first.txt`：首次测试语法错误；`focused-second.txt`：CLT 检查错误地假定 clang 位置；`focused-third.txt`：renderer 默认空 OSC 8 reset 输出；均保留原始失败。对应代码已修正，最终有限测试见 `focused-final.txt`。
- `checks-*/paste-split-first-failure.json`：各次独立保留的来源歧义反例；用文件时间识别首次，不能据最终测试全绿改写该失败。
- `pty-first.txt`、`pty-latest.json` 和各 `run-*/trace.jsonl`、`pty-output.bin`、`state/snapshot.json`：正常退出/hangup/parent-kill 的输入、保存 ACK 和锁重开。
- `clipboard-*.json`：固定 UTF-8 剪贴板往返。
- `native-blocker.json`：原生 UI 锁屏阻塞。完整 inventory 原始记录仅本地保存，不发布无关浏览器信息。
- `typecheck-final.txt`、`docs-final.txt`、`delivery-audit.json`：最终检查及继承未跟踪文件核对。没有运行全量 Core verify、真实 provider 或新 Core 实例。

## 就绪启动命令

由协调安排解锁后的真实 Terminal.app 操作者执行。当前不要求 Master 在探针未就绪时接手。

```sh
cd /Users/muy/Desktop/Codex_Work/secretary-core
npm run tui:g0 -- --help
npm run tui:g0
```

退出后显示本次 `.demo-data/issue82-tui/g0/run-*/` 证据目录。运行中也可按该目录创建时间识别本次 `metadata.json`。不要把已完成汉字的程序插入当作 IME；禁止往探针输入私人文本。每次独立场景使用新运行，保留原始目录，不覆盖失败。

## 必须由真实 UI 完成的动作

1. 记录 macOS、Terminal 版本/配置文件/字体、中文输入源名称、窗口行列；将带 UTC 时间的动作记录写入本次 `actions.md`，关键截图放在同一目录。`metadata.json` 自动记录已知系统/环境/行列，但不会猜测字体或输入源。
2. 用实际拼音按键依次输入 `n i h a o`，拍到候选 UI，分别用 Enter、Space 确认。检查 `trace.jsonl` 的 raw/key/local-submit 与画面计数；确认时不得增加计数。另开候选态分别按 Ctrl+S、Ctrl+G、Ctrl+C，逐项记录是否被 IME 消费、提交/命令/退出副作用。Ctrl+C 场景单独运行。退出候选态后明确按一次 Ctrl+S，必须仅计一次本地提交。
3. 编辑期间保留 200ms 合成输出；分别检查宽 80/120/40、高 24/40/12 的组合、低于最小尺寸后恢复，中文/emoji/组合字符宽度、输入光标/候选窗位置、Enter/tab、半页和整页滚动。真实像素/布局结果不能由 PTY 通过推断。
4. 鼠标滚轮、跨行选择、Ctrl+O：仅按复制键后变更剪贴板，无选择时不得改变；文案明确“可见渲染文字”，软换行和尾部空白处理不等同原文。另用 `npm run tui:g0 -- --main-screen` 比较原生选择/复制。检查默认深色、`--light`、`--no-color`；未实现的 256/16 色映射仍保持未验收。
5. 第二个 Terminal 窗口运行以下夹具命令，回到探针按 Cmd+V。先 benign 两次，再分别用新探针运行测试 end-controls/nested/duplicate/large。夹具只写剪贴板，不粘贴、不带 shell 命令；恶意尾部包含 Ctrl+C，可能导致探针退出。按实际 trace 逐字节判定，记录零 local-submit、零命令切换、零意外退出是否成立。

```sh
node --import tsx src/pi_secretary/scripts/issue82-g0-clipboard.ts benign
# 将 benign 替换为 end-controls、nested、duplicate、large，逐项独立运行
```

6. 使用 Terminal 自身 Reset 菜单项，紧接普通输入与夹具粘贴，记录时间与实际 raw framing。adapter 在 focus/redraw 重申模式，但这不构成 Reset 安全证明。只要控制字节可触发动作或来源丢失，保存首个失败并停止，不靠重试成功覆盖。
7. 独立 `npm run tui:g0 -- --slow-save`，输入合成文字后关闭 Terminal 窗口；检查本次 snapshot/trace 的真实窗口关闭结果。PTY hangup 通过不替代此项。

出现真实恶意交付/Reset/IME失败即交协调；不继续产品实现，不自行换终端/框架，不引入新产品确认流程。若只是设备继续锁定，则保留 NOT_TESTED，由协调安排真实操作者。Core 与其他项目的进程、数据、锁文件均不属于本探针操作范围。

## 有限复核命令

```sh
npm run check
node --import tsx --test --test-concurrency=1 test_case/offline/issue82/g0.test.ts
/usr/bin/python3 test_case/offline/issue82/g0-pty.py "$(command -v node)"
```

测试中的分块攻击是**预期复现缺陷的 witness**：该测试通过只说明缺陷仍被如实记录，G0 安全状态继续为 FAIL_PROTOCOL_PROVENANCE。
