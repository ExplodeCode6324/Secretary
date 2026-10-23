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

- 精确提交`7330c920d2d1ad1963969a9c38e2df9df7aa3e18`；03:10:59 HKT发送，03:21:15首次读取，最终CHANGES_REQUIRED（窄修订）。原始时间见r2-timing.json。
- 原始证据：`.demo-data/issue82-tui/review/r2-request.txt`、`r2-first-read-page.txt`、`r2-first-read-ax.txt`、`r2-first-read.png`。
- Claude确认九项R1已解决，独立fetch精确R2、英文附件逐字节一致，源码复核了lock、幂等重入/RequestStatus、preserveScreen、键位；24个相对链接无缺失。未跑仓库测试/文档检查/终端/IME/Core/provider，双语是关键机制抽查。
- R3采纳四项阻塞：不碰Core锁、helper抗终端组信号、checkpoint独立合并/输入优先/响应限额、选区copy入口。非阻塞的UTF-8 locale、键位冲突、真实字段分片大小、配置路径、解释器、Terminal Reset均纳入。
- Claude明确真实G0是实施硬门槛而非计划阻塞；attach-only与durable checkpoint取舍交协调，不能伪写已测。

## R3

- 精确计划提交`937f3031ed2e83953d65b4a3cf196cedd3488ad9`；发送2026-10-24 03:25:31 HKT，首次读取2026-10-24 03:35:40 HKT，最终 **PASS for plan readiness**。
- 原始证据：`.demo-data/issue82-tui/review/r3-request.txt`、`r3-timing.json`、`r3-first-read-page.txt`、`r3-first-read-ax.txt`、`r3-pass.png`；本地文件清单/hash在`review-evidence-manifest.json`。截图同时显示精确提交、PASS与G0/实施/合并边界。
- Claude独立fetch精确R3并核对英文附件逐字节一致，检查中英文R3关键机制（非逐句双语审查），复查Pi固定提交的copyActiveSelectionToClipboard及callback无OSC52 fallback，独立相对链接24项均存在。
- Claude未跑check/test/verify/docs:check、Core/terminal/IME/provider；Terminal2.14、Python3.9.6为Codex本机只读盘点，非reviewer验证。
- R2四项阻塞全部关闭，无新增阻塞。PASS只覆盖计划；G0全部仍NOT_TESTED，协调未批准实施，未授权合并。

## 最终交付与协调待决

1. 建议批准R3后先执行G0；Mac此前锁屏，需真实可操作终端/中文IME后才可通过。无法执行或实际失败交协调裁决，不进入产品铺开、不以PTY/fixture/截图替代。
2. 明确请协调接受C1 fixture/live都attach-only的RUN-01范围取舍，产品落地时同步requirements状态。理由：避免现有catch-all attach失败触发错误profile/mode启动；独立Core生命周期命令仍在。
3. 明确请协调接受独立持久view checkpoint；它满足本issue持久cursor与冷启动一致性要求，已规定合并/低优先级/有界队列及响应验证。没有启动#70–74优化。
4. 接受R3非阻塞实施注记：Ctrl+O标为“可见文字复制”（软折行变硬换行/尾空白被去除），精确正文用/copy；Apple CLT先做不会触发安装的存在检查并限时检查解释器，不自动安装；helper stdio只用pipes/ignore，不接tty，父退出后的BrokenPipe在原子操作完成/失败后处理；帮助明确Ctrl+C退出、Ctrl+O复制。这些为G0/实现注意事项，未改已PASS的R3计划正文。
5. 本机docs:check/localization与git diff --check通过；无业务实现、依赖安装或Core/终端/provider测试。相对基线仅4个文档，393继承untracked保留。准确HEAD实现复核/CI/合并授权均属后续阶段。

本记录提交仅追加审查结果与交付状态；中英文R3计划正文保持精确PASS提交原样。

