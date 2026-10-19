# Issue #58：Tauri 2 + Svelte / PhaseUI 可行性验证
> **2026-10-19 Master authorized implementation. Updated scope: macOS only for this and subsequent frontend issues. Linux remains NOT_TESTED and is no longer a GO, completion, or next-issue gate. Historical cross-platform gate statements below are superseded. Existing Core Linux CI is unchanged.**

## 范围与当前结论

目标：[FE-00 #58](https://github.com/ExplodeCode6324/Secretary/issues/58)，路线 [#57](https://github.com/ExplodeCode6324/Secretary/issues/57)。2026-10-19 已领取；远端 main 与本地 HEAD 均为 `069b734ca9beccb2ed1a5d9756d42f7b62440611`。本阶段先完成计划和 Hermes 复核，Master 授权后实施 spike；这是技术选型停止点，不是完整前端实现。

Master 本轮确定：**先完成 Mac，Linux 暂记 NOT_TESTED**。Mac 未完成必测项时为 `GO_PENDING_MAC_TESTS`，失败为 `MAC_NO_GO`；Mac 全通过、复核与 Master 终审完成后可给出 `MAC_GO` 并完成 #58。Linux 延后，不阻塞 #59 或后续前端 Issue。

复核 agent 使用默认本地 Hermes。Master 指定官方 `deepseek-flash` provider、最新 DeepSeek v4.1 Flash 1017、reasoning `max`；调用前核对实际 model/provider。已核实 Hermes 官方 provider 的 CLI 注册名为 `deepseek`、模型 ID 为 `deepseek-flash`；官方实时模型目录返回 `DeepSeek-V4.1-Flash`，支持 `max`，但没有提供 `1017` 日期字段。实际按 `--provider deepseek --model deepseek-flash --reasoning max` 调用，保持官方产品选择。复核缺少证据、只有泛泛结论或无法发现明显问题时，先给出具体依据，再申请 Opencode Kimi K3 fallback，不自动切换。

## 已核实的工程条件

- Core 的 `package.json` / `package-lock.json` 是独立 Node/TS 工程；根 `tsconfig.json` 只包含 Core 和现有测试。新增 desktop 自己持有 npm/Cargo 锁文件、构建和测试入口。
- 当前 `.github/workflows/verify.yml` 有 Linux Core 完整 verify、macOS Core 专项回归、汇总 verify；不把桌面依赖混入这两个 Core job。
- 本机 macOS 15.8.2 / arm64，Xcode 已选中。Rust 工具入口存在于用户 `.cargo/bin/`，但当前 shell PATH 无 `cargo` / `rustc`；已通过绝对路径确认 rustc/cargo 1.97.1，Node 22.22.0、npm 10.9.4；实施时修正本任务命令环境。
- 仓库有历史未跟踪测试报告，保持原状。仅登记本任务文件，原始 reviewer 日志放 Git 忽略目录。
- 现行 API 及 Core 进程不需要修改或启动。本 spike 使用合成内容；通信桥、真实业务、持久 outbox/cache 和在线模型验收归 #59/#60。

## 工程与权限方案

在 `src/secretary_desktop/` 建独立 Tauri 2 + Svelte + TypeScript + Vite 工程，包含 `src/`、`src-tauri/`、fixture、测试、README。实施时选择相互兼容的稳定版本，锁定 npm/Cargo 依赖和 Rust 工具链，并记录版本；不使用滚动 latest 作为复现要求。

Rust 仅创建桌面窗口。优先保留原生标题栏完成拖拽/缩放，不为 spike 增加通用文件、shell、HTTP、opener 插件。capability 限定唯一主窗口，逐项列出实际用到的权限及原因，未用权限不加入；不照搬宽泛默认集合。Release 只载入本地打包资源，配置 CSP，不开放远程页面或任意导航。Markdown 禁止原始 HTML，远程图片与外链不自动加载/打开。

可选 `@wdio/tauri-service` 的 embedded 驱动只编译到独立测试 feature/config；普通 Release 不包含驱动、测试服务、IPC mocking 或日志导出端点。验证 Release 依赖/feature 和运行时监听情况。原生复制采用系统选择/快捷键，不为测试增加通用剪贴板权限。

预计改动：新增 desktop 工程和专用 workflow；忽略 desktop 的 Cargo target、驱动日志及本地测量原始文件，保留 Cargo.lock；更新忽略项、文档入口与本计划。Core 业务代码、API、根 npm 依赖及 Pi 子模块保持独立。

## 可交互 spike

单窗口展示窄目录、左右分区/细线、文档式消息、Markdown、长代码、输入区、状态和产物行。只使用 CSS/SVG 和少量必要依赖，不引入大型视觉组件库。提供固定 fixture、重置、流式更新、动效重演及三个逻辑帧暂停入口；测试控制入口与普通页面操作分开。

1. **图标本体**：同一几何轮廓，通过至少三条横向 clip 分区分别位移。三个逻辑帧固定各切片的 x 偏移和持续时间，最终归零。保留中性状态帧和三张真实 WebView 错位帧，可辨认是同一个轮廓的条段断开/分层。不能用替换图案或静态本体外的彩色描边冒充。
2. **输入区**：发送后只对装饰层进行短暂、可复位的轻微错位；textarea、文字、光标、焦点和点击区域保持原位。装饰层不参与 pointer hit testing。Enter 发送、Shift+Enter 换行；组合输入过程中不发送，处理 compositionstart/end、isComposing 及平台实际事件顺序，不能靠固定延时猜测 IME 状态。
3. **边界**：边界竖线与左右色块按分区裁剪，选择文本或拖动窗口时不遮挡内容。动效期间记录 textarea/按钮边界矩形和焦点，确认交互区域稳定。
4. **减少动态效果**：尊重系统 prefers-reduced-motion，并可在 spike 内显式关闭；关闭或中途切换后取消动画并归零，状态变化仍有文字或静态图形反馈，不以闪烁传达唯一信息。
5. **长列表**：采用可变高度消息虚拟化原型，覆盖滚动定位、流式增长、缩放后的重测和跨段选择。选择中的节点不能被回收而截断选区；额外阅读模式不能替代正常模式通过。不把固定高度列表或仅保留全 DOM 的基线当作回收式虚拟化通过。

## 验收矩阵与证据

每项记录环境、构建 SHA、fixture、步骤、预期、实际、证据路径，状态只能是 PASS / FAIL / NOT_TESTED。首次失败保留，复测注明改动与结果。截图和录屏必须来自原生 Tauri 窗口；普通 Chrome 只作补充。

| 项目 | Mac 实测方法与通过条件 | Linux 本轮 |
| --- | --- | --- |
| 构建与窗口 | npm ci、前端检查、Cargo 检查、Release 构建；真实打开、关闭/重开、原生拖拽、缩放、最小化恢复可操作 | NOT_TESTED |
| 中文 IME | 系统拼音真实候选输入：Enter 确认候选、空格选词、Esc 取消、持续组合、随后独立 Enter 发送；候选确认零误发送，发送一次；鼠标发送和 Shift+Enter 同测 | NOT_TESTED |
| 焦点与文本 | Tab/Shift+Tab、鼠标点击、窗口切换后焦点；跨 Markdown 段落与代码选择，系统复制后粘贴核对合成原文 | NOT_TESTED |
| 排版与缩放 | 窄/宽窗口、100/125/150/200% 内容缩放，中文/英文混排、表格、链接、长行代码；可读、无控件丢失，代码可横滚 | NOT_TESTED |
| 图标/输入区/分栏 | 原生窗口录屏、正常帧+三个错位逻辑帧、切片坐标/代码对应；文本/光标/实际点击区不漂移 | NOT_TESTED |
| 长列表与流式 | 使用下述固定负载；滚动锚点、选区、焦点和发送保持可用，结束后队列排空、CPU 回落 | NOT_TESTED |
| 减少动态效果 | 系统开关、应用开关各测；不产生错位动画，状态仍可辨认 | NOT_TESTED |
| 权限与 Release | capability/CSP 清单、Release feature 与端口检查；无测试驱动服务和额外系统访问能力 | NOT_TESTED |
| Master 视觉终验 | Master 在实际 Tauri 窗口亲自评判图标/输入区/分栏；自动帧检查不代替认可 | NOT_TESTED |

IME 必须通过系统输入法操作。合成 composition 事件仅用于回归状态逻辑，WebDriver sendKeys 不作为原生 IME 通过证据。自动化无法操作系统 IME 时，提供可重演步骤交 Master/人工实测，明确保持 NOT_TESTED。

Linux 桌面实现与验收本轮及后续前端 Issue 均延后，不安排目标机器、不安装图形环境；现有 Core Linux CI 保持原状。

## 资源与性能基线

使用普通 Release（不含驱动）与确定的合成 fixture，记录 OS、硬件、显示缩放、构建版本及采样工具。默认负载：1,000 条可变高度中英消息、10,000 行代码、100 KB Markdown；流式场景每秒 20 次、每次 32 个字符、持续 60 秒，并同时做滚动/输入。另做 10,000 条消息压力档，单独报告可用边界，不混入默认档。

- 启动：由启动命令单调时钟到首帧可交互标记，首次启动单列、暖启动 10 次报中位数/最大值；不把暖启动标成冷启动。
- 空闲：稳定 30 秒后采样 60 秒；流式：完整 60 秒并记录停止后 30 秒。每秒采样应用及其 WebView/WebContent/GPU 相关进程 CPU/RSS；Mac 用系统进程工具和 Activity Monitor 交叉核对归属，共享进程/重复 RSS 计数单列，不能只报 Rust 主进程。CPU 使用相邻采样的累计用户态+内核态 CPU 时间差除以单调时钟间隔，100% 表示占用一个逻辑核；记录进程创建/退出，不能把 ps 的生命周期平均 %CPU 当作每秒区间值。
- UI：记录请求到 DOM 更新耗时、rAF 帧间隔分布与最大停顿、输入响应、滚动锚点偏移、DOM 节点数；同时录屏确认无明显持续卡顿。性能 API 不支持的指标注明，不用零值代替。
- 体积：分别报告二进制、完整 app、分发包，注明架构、调试符号和压缩方法。
- 不预设无依据的内存/体积目标。Mac 可行性至少要求默认负载无崩溃/误发送/选区破坏，交互可用、流式完成后无持续积压；如资源增长或操作卡顿，先定位复测，再由数据与 Master 体验决定通过。压力档失败如实列出边界和后续方案。

## 实施顺序与交付

1. 本计划经 Hermes review skill 往返复核，记录意见和处置，交 Master 授权实施。
2. 建独立 desktop 工程，固定依赖/权限，先证明 Mac Release 窗口能实际打开；失败先处理工具链或选型问题。
3. 实现页面、三帧切片、输入状态处理、长内容/虚拟化 fixture；提供测试/录屏复演入口。
4. 跑必要的前端逻辑测试（IME 发送状态和重置）、真实 WebView E2E、Mac 手工矩阵、普通 Release 资源基线。补 `README` 中的构建/运行/测试和证据读取命令。
5. 新增独立 desktop CI，Mac 检查/构建/逻辑测试为本 PR 人工必查项，驱动探索单列，Linux job 延后。路径过滤与 summary 按后文契约执行，现有 Core verify 保持独立；原生人工行为覆盖不能用 Chrome 代替。
6. 提交范围内代码、经脱敏的必要帧和测量报告；PR 使用 Refs #58，报告净增减、实际测试和未测项。代码复核沿用同一 Hermes 会话；路线要求的 PERRI 再审在交 Master 终审前安排，未获得报告则标为未完成，不用 Hermes 冒名替代。
7. Master 视觉验收后记录 Mac 结论与 Linux NOT_TESTED。只有 Mac 必测项通过、复核/CI 和 Master 终审完成，才可宣告本轮 GO；任何 FAIL 先修复或 NO-GO 回到选型。不自动合并。

计划阶段只做文档检查。实施后运行 desktop 检查/测试、Mac Release 和原生验收，再运行项目 `npm run verify`（数据库回归使用隔离测试库），核对现有 Core CI。此 spike 不需要真实模型/个人数据/设备。

## 资料依据（2026-10-19 查阅）

- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)：官方当前推荐 WDIO embedded 驱动，支持 macOS/Linux；直接 tauri-driver 的 macOS 限制不能套用到 embedded 路线。
- [系统依赖](https://v2.tauri.app/start/prerequisites/)：Mac Xcode/Rust，Linux WebKitGTK 4.1 等发行版依赖；实施 README 按实际使用版本列清单。
- [Capabilities](https://v2.tauri.app/security/capabilities/)：按窗口限制权限，测试配置与 Release 分离。

## 复核记录

R1：Hermes 使用 secretary-core-review 返回 CHANGES_REQUIRED，方向 PASS。实际调用官方 provider `deepseek`、model `deepseek-flash`、reasoning `max`；init 回报 model=deepseek-flash。会话为 `secretary-core-issue58-feasibility-20261019`。有实际代码及资料查验，无需 fallback；原始日志位于忽略目录 `.demo-data/issue58-review/`。

采纳八类意见：证据索引、IME 事件和逐字校验、正常模式跨虚拟化选择、三帧结构证据、性能采样定义、GO 规则、独立 CI 契约、reduced-motion 中途归零。下述细则优先于前文概述。

## R1 修订后的执行与证据契约

以下命令是实施交付要求，目前尚未实现。desktop README 将定义 `npm run check`、`npm test`、`npm run tauri -- build`、`npm run test:native`、`npm run evidence -- <case>`、`npm run measure` 的具体参数。每次运行在 `.demo-data/issue58/` 生成 index.json：case、命令或人工步骤、预期/实际、起止时间、fixture hash、构建 SHA、环境、状态、产物 hash。人工操作由人确认；事件、采样和哈希由脚本产生。必要小帧和汇总入库；原始大文件保留在忽略目录，报告用相对运行路径与 hash 定位，不公开含用户名的绝对路径。

| 入口（拟） | 采集时点与产物 | 核对内容 |
| --- | --- | --- |
| check / test / tauri build | 每个候选提交；build.log、versions.json | 检查/逻辑回归、普通 Release hash |
| test:native | 测试构建；e2e.json、失败帧 | 实际 WebView 行为、与 Release 的 feature 差异 |
| evidence -- window | 打开/重开/拖拽/缩放后；window.json、窗口帧 | owner PID、二进制 hash、UA、窗口 ID/尺寸，UA 只作辅助 |
| evidence -- ime | 各真实 IME 用例；ime-events.json、case-results.json | 事件序列、发送次数、文本逐字匹配 |
| evidence -- selection | 各选择/复制/滚动步骤后；selection.json、复制文本 hash | 正常模式复制与固定文本投影匹配，仅归一化换行 |
| evidence -- phase | 中性/三个暂停逻辑帧/归零；frame-N.png、phase.json | 共享轮廓、clip/transform、输入几何/焦点稳定 |
| evidence -- motion | 第 2 帧切换系统/应用开关；motion.json、归零帧 | 中途关闭复位，不冻结偏移 |
| evidence -- security | 普通 Release；capabilities.json、features.txt、listeners.txt | 权限与驱动缺席、CSP/Markdown 负向 fixture |
| measure | 启动/空闲/流式/恢复段；startup.json、samples.csv、ui.json | 全部原始值、p50/p95/max，测量时不录屏 |
| 人工终验 | 候选构建完成后；acceptance.md | Master 对真实窗口图标、输入区和分栏的评价 |

窗口帧记录 owner PID 和实际 Release 二进制对应关系。屏幕录制权限缺失时，交 Master 系统授权或人工采集，记录缺条件，不擅改系统隐私设置。

### IME、选区与动效

- IME 每例至少 3 次：Enter 确认候选、空格选词、Esc 取消、组合中鼠标发送、组合中切窗失焦、候选确认后快速独立第二次 Enter、组合中同时流式。固定合成中文/标点，逐字记录期望和实际发送文本/次数。候选确认、取消、失焦不发送；鼠标点击若仍组合则不发送，已提交则仅发送提交文本一次；独立第二次 Enter 可发送一次。
- test-only 日志包含单调时间、type/key/keyCode/isComposing、composition 状态、value、发送决策/原因。回归复放 compositionend 先于确认 Enter 且 isComposing=false/keyCode=229 的 WebKit 顺序，确认键不发送，随后普通 Enter 能发送。采用 isComposing、229 及实际 composition 事件关联保护；额外 post-composition 守卫由真实事件序列决定，不固定延时，也不硬定单 rAF 吞键。人工快速按键记录实际间隔，不声称能可靠制造 50ms 间隔。
- 正常模式从第 10 条到第 900 条双向跨视口选择（含长代码）各 3 次；系统复制粘贴与 fixture 已知文本投影逐字匹配。正文逻辑全选包含未挂载消息，不干扰 textarea 原生全选。选区存在时流式 5 秒、中部前插 200 条历史消息，选区完整且锚点稳定；向上滚动后流式不拉回底部，输入不失焦。静默截断为 FAIL。阅读模式只作额外路径，不能替代正常模式通过。
- 比较保留 DOM 的 content-visibility 基线与窗口化/回收式原型，按实测选择后续路线；只跑全 DOM 不等于验证了回收式虚拟化。
- WebView 缩放使用明确的 Tauri setZoom 入口，测试 1/1.25/1.5/2 倍；主窗口最小权限加入 `core:webview:allow-set-webview-zoom`。不以 CSS 字号变化替代。
- 图标原型取三个 band、同一 symbol/path，每个错位帧至少一条有非零 x 位移，三帧位移组合不同。保存 clip rect、transform、path/symbol、帧号/时长、基础层可见性 JSON；断言共享轮廓一致、不另叠完整基础图标、最终 identity；暂停帧与实际运动均由原生窗口取证。Master 视觉仍为门槛。
- 关闭或中途开启 reduced-motion 时，在下一次可绘制帧前取消动画并归零，不冻结当前偏移；第 2 帧中途切换系统和应用开关分别验证，布局/焦点稳定。

### 测量与 CI

启动 harness 在 spawn 前记 t0；首帧布局完成且交互 handler 就绪后 app 发 marker，harness 收到记 t1，明确包含通信开销。如测量构建不同于普通 Release，必须披露差异，不用驱动构建暗中替代。暖启动保留全部 10 次值，异常不删除。

WebKit XPC 可能由 launchd 托管，进程归属结合启动前后 PID 集合差、退出对照及系统检查，不仅追父子关系；不能唯一归属的共享进程单列。CPU 差分如前文，RSS 记录恢复段与复跑趋势，GC 波动不直接判泄漏。记录刷新率、供电/低电量状态、可取得的热状态（缺失则注明）、窗口尺寸和 zoom。测量与录屏/额外性能 GUI 分开；采样工具开销单列。只停止本 harness 创建且核实身份的进程，不按名称批量杀进程。

Markdown 走实际解析/排版路径，禁 raw HTML；代码用保留空白的 pre/code，不带语法高亮，后续高亮性能未验证。流式增量更新数据，重渲染当前增长消息的 Markdown，包括代码围栏打开/闭合，不每次重建整份历史；报告写明实际实现。默认负载无崩溃/误发送/选区破坏/持续积压；超过 500ms 的 rAF 或输入到绘制停顿必须定位复测，这是 spike 的可用性操作阈值，不是框架性能承诺。结束后队列归零。10k 压力档改可选 REPORT_ONLY。

独立 `desktop.yml` 路径过滤 desktop 和自身 workflow，支持手动触发；不修改 Core verify 汇总，不把路径过滤 workflow 设为全局 required。对 #58 PR，Mac 检查、Release 构建、逻辑测试是合并人工必查项，必须成功。embedded E2E 初期为独立探索 job，保留真实失败，不以 continue-on-error 冒充成功；基础设施不可用经复核确认后记 NOT_TESTED，用同构建真实窗口人工覆盖行为。产品断言失败不能按基础设施缺条件豁免。summary 分列 success/failure/skipped，未跑不是通过。Linux job 本轮延后，全部 NOT_TESTED。

运行证据使用 `.demo-data/issue58/runs/<UTC>-<case>/index.json` 分目录保存，顶层 index.json 仅汇总索引；复测新建 run，首次失败和已有运行不覆盖。入库汇总固定为 `docs/fix/evidence/issue58-feasibility/summary.md`，小帧与 CSV 摘要同目录保存，并引用对应 run ID/hash。

### GO 判定与异议

矩阵的功能、排版缩放、性能可用性、权限与 Master 视觉均为 GATE；资源绝对值、体积、可选压力档为 REPORT_ONLY。任何 GATE FAIL ⇒ MAC_NO_GO；任何 GATE NOT_TESTED ⇒ GO_PENDING_MAC_TESTS。MAC_GO 要求全部 Mac GATE PASS、Mac CI 必查项成功、Hermes 无阻断、路线再审和 Master 视觉完成。工具探索 E2E 的 NOT_TESTED 与行为门槛分开记；如对应行为没有原生人工覆盖，该 GATE 也为 NOT_TESTED。

判定优先级为 FAIL 高于 NOT_TESTED：同时存在两者时仍为 MAC_NO_GO；只有无 FAIL 且存在未测 GATE 时才给 GO_PENDING_MAC_TESTS。Mac 全通过后 Linux NOT_TESTED 不阻碍完成 #58 或推进 #59；这是 Master 2026-10-19 的明确范围调整。NO-GO 报告列失败行、根因、是否 Tauri 特有及下一步，不自动换框架。本轮证据全部 OFFLINE fixture + NATIVE/MANUAL，无 LIVE_MODEL/REAL_USE。

Codex 调整意见：不做三帧反向拼接逐像素相等，子像素抗锯齿易导致脆弱测试，结构断言+真实帧+Master 视觉覆盖本 issue 失败模式；不硬定 post-composition 单 rAF 守卫或人工 50ms 按键；不把全 DOM 基线当回收式原型；不添加与本轮授权无关的“二试即报”规则。保留单个 spike PR，按 Mac 窗口、交互/动效、证据三个内部检查点推进，出现需扩展范围的问题再交 Master 决定。

R2：八类意见已闭环，有据异议均被接受；剩余两处要求为 FAIL/NOT_TESTED 判定优先级，以及每次运行证据隔离保留。已补齐。

R3：同一 Hermes 会话确认两处 CLOSED，最终 **PASS，计划具备执行条件，无剩余阻断**。三轮复用 session `20261019_151715_df749f`，未 fallback。文档检查、新计划独立链接/空白检查通过。本 PASS 仅针对计划；尚未实施，Mac 未测、Linux NOT_TESTED，等待 Master 授权实施。


### R4 实现复核与处置（2026-10-19）

Hermes `deepseek` / `deepseek-flash` / `max` 返回 CHANGES_REQUIRED，发现正文单击可能黏住全量挂载、组合结束后的独立发送点击被误拦。两项均修正并补真实 WKWebView 回归；键盘全选与前插、实际 WebView 缩放加入覆盖，共 8 项通过。保留同手势 AX 点击拦截与独立 pointerdown 发送两个不同语义。

工具修订包括保留完整 native index、公开别名实际运行全套测试、PID 启动身份与出现/退出记录、显式遥测开关、取消空闲 rAF、带/不带遥测及 full-DOM 对照。Mac-only 范围已落实到 #57–#67；PERRI 再审经 Master 明确授权发送。实时验收状态统一见 [证据报告](evidence/issue58-feasibility/summary.md)，上面的初始矩阵不代表已实施结果。

真实系统 IME、物理跨视口复制、系统 reduced-motion 与 Master 视觉不能由合成事件或程序化 Range 代替，未完成项继续 NOT_TESTED。实现和自动回归完成不等于 MAC_GO，不自动合并或领取 #59。

### R5–R8 与 PERRI 复核

真实 IME 反例否定了 R5 对旧点击守卫的条件通过。R6/R7 对原始事件时间和派发顺序复核后，采纳严格较晚的 pointer/key 手势判定，拒绝内容分类启发式；R8 因 Master 搬迁网络暂停，无最终结论。实际21步拼音证据属于8d5f905，后续共享守卫需对应真实复测。

PERRI B1 指出增长正文替换选区 DOM，B2 指出最小窗口叠加缩放溢出以及侧栏反馈消失。已分别冻结选区期间显示投影（接收继续、解除追赶），以及增加窄视口单栏和输入区反馈。新增原生回归通过，合计13项；物理剪贴板与系统验收仍分列。恢复工作后由同Hermes会话及PERRI复核最终候选。

### 恢复后的 R9、系统验收与 M1

Hermes R9 CODE_PASS；PERRI 对b49287e关闭B1/B2，另指出总180秒截止可能允许不足30秒恢复却标成功（M1）。已加入独立completion contract与4项Python回归，保存完成时间、实际恢复时长并拒绝不足30秒；b492两次原始采样独立核验为30.76/30.27秒，不重写旧metadata。

应用构建冻结b49287e；1fb76ab只补测试/观测字段。clean native13项通过，补了完整追赶等式、四档最小窗口zoom和长IME反馈。实机新28步IME、真实系统ReduceMotion开关恢复、最小化/恢复、拖动缩放、普通Release关闭重开已记录。系统全选复制468913字符与DOM参考仅差两个末尾LF，严格比较仍false；10→900双向物理拖选与Master视觉仍待，不能由全选替代。最终证据与性能口径见关联summary，合并仍需Master明确授权。
