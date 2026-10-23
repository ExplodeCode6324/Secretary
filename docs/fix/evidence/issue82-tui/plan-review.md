# Issue #82 计划复核记录

- 基线：`f2f3c1929bfb3e2f40e67868861f41f7e94e781a`，范围仅计划；继承393个untracked全部保留。
- 本机只读核实：Terminal.app 2.14、Node 22.22.0、npm pi-tui 0.87.0。真实终端/IME NOT_TESTED；native CUA报告Mac locked，Chrome扩展可用。
- 复核会话：https://claude.ai/chat/087625f1-6bf5-4e37-bcfb-56187ea74dc9 ，界面模型 Opus 5.5 Extra。

## R1

- 精确提交 `78f9aa00fd3e8ef9a3982f4027a9daaa355ecc76`，只改4项docs。完整英文正文作为Claude文本附件发送。
- 发送2026-10-24 02:47:43 HKT；首次02:57:52读取仍进行；第二次03:03:05读取最终CHANGES_REQUIRED，符合首次10分钟/后续5分钟。
- 原始证据（Git ignored）：`.demo-data/issue82-tui/review/r1-request.txt`、`r1-timing.json`、`r1-second-read-ax.txt`、`r1-second-read-page.txt`、`r1-second-read.png`，模型截图`r1-model-before.png`。
- Claude独立fetch精确计划和基线，确认英文附文与提交一致，读取Core/client/sync/timeline/DTO/约束、Pi固定提交、历史Rust测试；独立核对24个相对链接无缺失、API86项、双语limits/keys抽查。未完整逐句核对双语。
- Claude未跑check/test/verify/format、Core/terminal/IME/provider；docs:check受其sandbox权限阻断。本机docs:check/localization通过是Codex提供的证据，不是reviewer测试。
- 九项必改：启动/attach、typed transport/error表、outbox attempted/FIFO/quota/frozen bytes、LF/恶意paste、导航选择复制、flock/signals、具体sync checkpoint与timeline错误/watchdog、IN-01可见状态、G0真实IME/native输入验证。
- R2全部采纳，详见双语计划第9节；另补exact-byte POST确认丢回执指纹、草稿supersession生命周期、Input/Receipt/Message分离。保留fs方案与C1范围，无业务实施。

## R2

待发送精确提交并完成同会话复核。计划PASS仍需协调批准实施；G0真实终端/IME未通过不能越过；合并另需准确HEAD授权。
