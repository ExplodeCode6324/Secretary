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

## 2026-10-25 R4 恢复准备（待复核）

Master 新授权由协调传达：Claude 独立云端视觉验收，环境不可用可延期并继续实现/获批合并；首次与后续查看均五分钟；Linux 前置纳入。旧 R3/G0 记录保持原貌，现行门禁以 R4 为准。当前准备从 `37f6ae3547dfe166ff747c9719461d89d61670bf` 开始，新增平台条件、Linux 无剪贴板明确 UNSUPPORTED、跨平台有限测试与实际探针 ANSI→headless terminal SVG 工具；[独立英文运行说明](g0-cloud-run.en.md)。原有 FAIL_PROTOCOL_PROVENANCE 不作为视觉项豁免，R4 给出 P1/P2 待裁决方案；当前未实施产品输入来源门禁。

本机 macOS：8项有限测试、PTY生命周期、10尺寸帧渲染、类型检查通过；SVG生成不等于Claude视觉验收，Linux/Claude结果待其独立执行。协调明确允许本准备正常push现有分支供准确SHA获取，不创建PR、不合并。真实Mac仍NOT_TESTED，未再解锁/轮询。

## R4 独立复核结果与 R5 处置

- 精确提交 `d6d47fdbde9067ba6a312236e125f952440b6120`；2026-10-25 12:35:42 HKT 发送，12:40:59、12:46:04、12:51:15、12:56:29 读取，全部间隔至少五分钟；最终 **CHANGES_REQUIRED（计划）**。模型保持同一 Claude Opus 5.5 Extra。
- 原始请求、四次 page/AX/screenshot、时间记录和下载包在 Git ignored `.demo-data/issue82-tui/r4/`。下载包 `claude-independent-evidence.tgz` SHA256 `41860de029d6e28bf611f417846e75e32a32369790f8da7ed35d77ddb3f41430`；安全检查后解压72项、3,862,829字节。原始首次失败与成功均保留，没有发布原始沙盒文件。
- Claude 独立 fresh clone exact SHA / Pi gitlink，Linux Ubuntu24.04.5、Node22.22.0、Python3.13.17/fcntl；有限测试8/8、PTY正常/hangup/parent-kill/lock重开、10帧生成并经Chromium153实际查看。registry失败后使用替代tsx/marked、源码编译pi-tui/headless；不是锁文件环境证据。typecheck exit2 因缺依赖及非固定compiler，为 INVALID_ENV，未宣称通过。
- Claude 独立真实探针PTY反例：split paste end 后 Ctrl+S，以及无bracket的文本+Ctrl+S，均计数一次提交。FAIL_PROTOCOL_PROVENANCE 被独立确认；这些是synthetic PTY，不是GUI clipboard。headless emoji Unicode6宽度导致行/滚动条几何偏差，不能代表native结果；footerPresent仅DRAFT子串搜索。
- 四项功能修订全部写入R5：完整动作表/本地退出、frozen producer metadata/未验证会话禁止全部POST、launcher-owned非TTY认证及精确paste control表、Mac只读编辑不是#82最终交付。R5另明确Reset后普通slash/tab来源仍需解决，并提出有界本地浏览器structured adapter的P2候选交协调裁决；没有产品代码。
- Claude报告外部configure scripts被其沙盒策略阻止；协调确认一次无特权、固定公开源码、临时目录、Xvfb/Xlib/XTEST且禁用unsafe SendEvent的范围，只能走Claude正常授权机制，不冒充人工批准或绕过限制。若仍拒绝，真实Linux terminal标NOT_TESTED/DEFERRED并继续source/plan review。真实Mac/IME与Linux IME仍NOT_TESTED，未再尝试解锁Mac。
- R5继续同一Claude，完整英文计划+准确push SHA，首次/后续五分钟；产品实现及准确HEAD合并仍需分别批准。

## R5 独立复核结果与 R6 选定范围

- 精确提交 `e645e6b06c317c4822258d391b279632f359f411`；2026-10-25 13:11:59.531 HKT发送，13:17:12.801首次读、13:22:26.064第二读，均超过五分钟。最终CHANGES_REQUIRED，R4四项全部关闭，R5六项窄文本修订。原始请求/时间/page/AX/screenshots在ignored `.demo-data/issue82-tui/r5/`。
- Claude独立fetch、英文完整plan/runbook字节一致、R4/R3后缀不变、31relative links有效、中文新增机制抽查（非逐句）；docs-only未重跑R4代码测试。建议P2作为Mac/Linux主动作路径。
- 独立source-model PTY只证明模拟过滤后的paste无自动动作、Reset后slash/tab来源丢失；不是实际xterm。自写headed Chromium153/Xvfb原型使用真实X11clipboard及CDP输入，paste零动作、paste /quit+明确submit为message、typed /quit为command、控制/C1数据保留。首轮key大小写0submit失败保留；次轮code匹配但源码未检查Shift，不能称完整modifier已验证。未验证完整layout、undo/reload、WS/Node持久化；CDP composition commit untrusted且未入nodes，不是真实IME。
- 包 `claude-independent-evidence.tgz` SHA256 `45d75b8bb2e3141f4620c6320235c237c8500062c9035834f8dc25d767f42304`，17项/44,460解包字节；原始日志/原型/截图留ignored，未当产品实现复制。
- 单次xterm build在执行前再次被automatic classifier以Code from External拒绝，原始记录已取回；没有重试、变形命令或换通道。真实Linux terminal=NOT_TESTED/DEFERRED，真实Mac/OS IME仍未测试。不再尝试该build。
- 协调已选定R6 surface/依赖范围：本地browser承载命令式界面、plain DOM/textContent、固定ws8.21.3、NodeHTTP/plainJS；不新增browser xterm、不复活GUI、不另开发完整raw客户端。G0研究证据保留，raw安全降级不是Main交付。正式产品实施仍等R6精确计划PASS和协调后续批准。
- R6采纳code+exact modifier/浏览器copy及保留键/IME确认/inputType矩阵/single-use bootstrap+per-tab轮换secret/明确P2选择与textContent；补ACK/断连/恢复授权及验证限制。历史R5/R4/R3原文不改，同Claude继续五分钟规则。

## R6 独立复核结果与 R7 合同收敛

- 精确 `60d166f8cc77f990ae7b7861523cf08265996297`；2026-10-25 13:29:15.625 HKT发送，13:34:27.505首次读（311.880秒），最终CHANGES_REQUIRED四项小文本歧义；认可选定设计及R5全部六修订，不要求新的环境证据。原始数据ignored `.demo-data/issue82-tui/r6/`。
- Claude独立fetch/英文附件/runbook/历史字节一致，没有xterm重试。自写Chromium153/Xvfb原型v2补Shift排除/repeat/模拟非Latin physical code、ShiftInsert/middle-click/drop事件；保留layout-overlap首败。CapsLock实际未开启、CDP绕开browser快捷键本身，不能当native保留键拦截；真实IME/Mac/Chrome155/WS/durable/undo/reload/reconnect均未测试。
- 原始包SHA256 `b9bd3e312c3fc14a3e4b06acc93daf7a74f757319e96340f4ada022244169190`，16项/48,378解包字节。协调发现最终文字“ShiftInsert丢U+009B”与原始日志矛盾，Codex再从driver CLIP逐码点核实source/event相等、CR归一化source/node相等，155/NUL保留，newActions0；不据此禁用路径/改测试。R7交Claude撤回或明确另一个真实失败run，保留原始报告与更正审计。
- 协调选定R7：textarea只作caret定位input/IME sink，canonical chips/caret/selection/undo属于应用；restart-only fresh bootstrap、不读launch stdin、不加控制socket；new submit持久排FIFO尾且waiting Resume；attempt-marker ACK后HTTP前重新验证generation；删除专用browser profile功能。重复tab接管、未知Ctrl组合、初次60秒无人认证退出也明确。仅文档，无产品实现/PR/合并。
