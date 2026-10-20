<!-- Master 已批准 R2，现进入实施与验证；终审与合并授权尚待。 -->
# Issue #62 · PhaseUI 正式设计系统实施计划

状态：Master 已批准 R2，实施与验证进行中；等待最终复核及 Master 终审，不合并。日期：2026-10-21。[English](fix_20261021_issue62_PhaseUI设计系统.en.md)。[Issue #62](https://github.com/ExplodeCode6324/Secretary/issues/62)。

### 供 Master 批准的要点

- 正式组件接入真实 Connected；默认对话，连接/停止操作放独立连接 dialog；其他已有业务按第10节映射迁移，完整页面仍归 #63～#66。
- 按 v1.0 构造实现三帧；有框按钮动真实边框，无框文字按钮动已有下划线，输入动 wrapper 边界；不增加矩形装饰。pending 使用静态文字/图标，双方头像最小接入真实对话。
- BASE 已覆盖既有分隔线。EXTENDED 增左栏文字，并试验同一 `.nav-separator` 的额外键盘/接触触发；不新增线。试验 p=0.25，生产默认仍 BASE，扩展须看过对照后选择。
- 为原生窄窗口检查，将 minWidth 从640改480；诊断/验收入口提供缩放和文字比例控制。资源测量使用普通 Release，同构建三组，明确页内压力流、桥节奏模拟和真实fixture测试的区别。
- 一处 Core 投影默认名由小写改为 `Secretary`，保留主动配置名；同步API测试/示例/文档。无schema或存储迁移。

批准本计划后才实施；后续真实原生美学、性能验收和合并仍分别交 Master 决定。

## 1. 依据、范围与基线

采用 secretary-pr-fix 的 plan 模式。reviewer 为浏览器 Claude，界面已核实 Opus 5.5 Extra；全程英文沟通，本任务复用同一复核会话。账号或模型异常时报告具体阻断，请 Master 决定是否 fallback 到本机 Hermes，不自动切换。原始请求、回复与截图存入 Git 忽略目录 `.demo-data/issue62/review/`，仓库只记脱敏结论。此次复核判断计划是否具备实施条件，不代表产品验收或授权合并。

Secretary 基线为 `4f1f052`（PR #76）；据 #62 现行说明，#61 已合并，Master 终审与 main CI 前置已满足。#61 文档保留的待终审文字属于当时发布阶段，不是新的阻断。#62 已分配给 ExplodeCode6324。实施前重新核对 upstream，若有实质漂移，先更新计划并复核。

权威依据为应用 Master R1 裁定后的 [docs/frontend](../frontend/README.md)，以及冻结设计 [v1.0.0 / 8cdb9219bed9493147ba10f7d47423df56cbcc44](https://github.com/ExplodeCode6324/secretary-phase-ui-design/tree/8cdb9219bed9493147ba10f7d47423df56cbcc44)。不确定的视觉细节回到最终 CSS、几何、controller 和截图核对，不修改冻结标签。当前 Core/bridge 合同决定业务语义，不能照搬原型人工数据和假发送。

本阶段仅 macOS 桌面；Linux 桌面 deferred / NOT_TESTED，Core Linux CI 保留。交付可复用组件、原生布局壳、画廊、扩展试验及性能测量。保留 FE-02 已有能力；完整对话、任务、记忆/设置、产物/通知页面仍归 #63～#66。不重构 Core、不接设备，不需要付费真实模型调用或生产部署。

## 2. 源码与 computer use 核对

已读六份现行前端规范、桌面入口、Connected/Phase/style、测量脚本，以及冻结 README、UI-DESIGN、TAURI-MOTION-COST、几何与动效控制器。本轮从冻结工作树启动 loopback 预览，实际检查宽屏浅色/深色对话、选中目录与正文接边、活动栏、固定 A 的第一/二/三帧并解除冻结。可见分片/缺口不同；截图不证明毫秒时序。通过 computer use 只读观察已打开的 FE-02 原生窗口，未发送或重连：仍是带缓存内容的纵向工具界面。本轮未重新确认该运行二进制的构建来源，因此只记 UI 观察，不记当前源码验收。

| 现有源码 | 发现与实施处置 |
| --- | --- |
| `src/secretary_desktop/src/main.ts` | 普通启动挂载 Connected，study 挂载 App。正式 PhaseUI 必须接入 Connected，不能只改 App。 |
| `Connected.svelte` | 持有草稿/版本、队列、generation、瞬态轮询和阅读锚点；导航期间保持业务 owner 存活。textarea 有 composition 处理但没有 Cmd+Enter；补批准的快捷键并回归。 |
| `Phase.svelte`、`study.ts`、`style.css` | FE-00 技术样本与旧绿色布局，不是正式视觉依据。旧 CSS 限定在 study，正式 PhaseUI 用唯一样式，避免全局选择器串扰；历史 study 测试仍明确其归属。 |
| `Conversation.svelte`、`Message.svelte`、`Work.svelte`、`Results.svelte`、`workflow.ts`、`bridge.ts` | 复用投影、安全、持久化、回执、产物保存和选择行为；逐步替换表现层。 |
| 冻结 `prototype.js`、`signal-motion.js`、最终 `style.css` | 提取稳定几何、源图真实缺口和 controller 语义为类型化模块，不复制整页 innerHTML 或累积覆盖式 CSS。 |
| `scripts/measure.py`、WDIO、native-test 配置 | 现有脚本测 FE-00 study；增加明确 PhaseUI 场景和模式元数据，不能把旧样本测量冒充正式组件结果。WDIO 二进制不用作资源基线。 |

本轮没有新增原生 IME、时序、性能、辅助技术或全断点验收结论。下述实施验收全部从 NOT_TESTED 开始。

## 3. 组件结构与真实接入

拟放置于 `src/secretary_desktop/src/phaseui/`：`tokens.css`、`geometry.ts`、`motion/{plan,renderer,controller,divider}.ts`、Svelte 组件及公开导出入口。库内不查业务数据；输入为视图数据、稳定 ID、语义状态和回调。业务回调立即且只执行一次，不能由动画结束事件提交。

| 组件族 | 交付与行为 |
| --- | --- |
| Shell、DirectoryItem、ActivityRail、Brand | 三栏、原生窗口控制、稳定页面区域、aria-current 目录链接；名称来自现有 assistant 投影，trim 后空白回退 Secretary，长名可获取全文，不显示“主会话”。 |
| Icon、Button、TextLink、Input/Composer、Tabs | 固定几何、原生语义、主次按钮状态；实际标签页支持方向键/Home/End，不把目录导航误做 tabs。textarea DOM、选择与 IME 稳定。 |
| Divider、ListRow/TaskRow、ArtifactRow | 接边结构线、紧凑行与行内展开、文件名和元信息；稳定行 key、展开状态与焦点。 |
| Dialog/Confirm、Status/NotificationBar、Activity/Progress | 打开聚焦、焦点约束、Escape/返回；明确结果文字，有真实数值才用确定进度，不伪造完成。NotificationBar 是基础组件，不提前实现 #66 投递。 |
| Avatar、画廊与四个消费示例 | Master/助手头像语义；分别给 #63 对话、#64 任务/决定、#65 设置表单、#66 产物/通知提供独立导入示例。人工数据只在明确标注的画廊使用。 |

只提取 v1.0 最终生效规则：浅色正文/侧栏 `#fffcf6/#f5f2ea`，深色 `#000000/#141414`；ink/muted/line/blue/light-blue/red/green 按现行视觉规范；系统字体、14px/1.65，品牌/时间等宽，品牌字形硬边而不套框。登记间距、密度、边线、状态、时长 token 和来源。后续仅通过集中 token 及明确设计复核调整，不允许页面各自配色。

三栏为196 / minmax(0,1fr) / 270；≤1100 两侧166/230；右栏收起48；≤850 默认收起、展开覆盖；≤600 左栏64及竖排品牌。选中行与正文同色并实际中断竖线。结构线到所属模块边缘；右栏“正在进行/近期产物/快捷操作”是一整块表面。未实现功能保留标明用途的空位，不填假计数或貌似可执行的操作。

将布局壳和组件接入现有 Connected，保留现有对话、任务/审批/结果及 Core 生命周期操作入口。提供六个导航位置及显式启用的开发画廊路由（不作为普通导航项）；通过表现层 adapter 将已有业务块放入相应区域，未支持页面留空。数据/session controller 常驻；按视图保存恢复滚动/ID 锚点，隐藏非活动阅读/输入区域时不复制 ID、不让隐藏控件进入焦点路径。不为占位扩大 bridge 白名单或新增页面请求；显示名复用 assistant 订阅和合同，不按名称猜实体关系。

## 4. 三逻辑帧与生命周期

固定源路径与辅助几何分离，每实例 mask/clip ID 唯一。片段移动时原位置必须从可见底层移除。三显示层不等于三时间帧：0%、26.67%、53.33% 开始三态，80%恢复；第二帧反向换区，第三帧缩窄减量。分段离散切换，不能用全程 steps(1) 吞掉中间帧。

时长：图标 A/B/C 160/180/200ms，小图标140ms，品牌及双方头像180ms，发送方块160ms，输入边界140ms，分隔线150ms。发送箭头保留420ms指定投射例外。边界/面板显影按冻结规则，不移动文字。

每控件一条效果记录，开始时只随机一次参数；同次接触合并 hover/focus/press，按下立即反馈、释放延续。新的独立交互替换旧效果，不排队补播。移出/拖离取消、pointercancel、失焦/窗口失焦、disabled、卸载、模式变化均恢复源显示并清理动画、timer、节点和监听器；分隔线另在滚动/resize 清理。临时层 aria-hidden、pointer-events:none，不逐帧 IPC，不空闲动画循环。

stable/hover/focus/pressed/disabled 与 idle/pending/succeeded/failed/offline/stale 正交，只覆盖适用组合。成功来自回执/对象，不来自归位；pending 不封锁阅读/导航。reduced-motion、减弱、关闭、线稿模式恢复完整显示且不补播，焦点/选中/禁用/错误仍清楚。头像不变成虚假按钮。

输入保留原生 textarea；Cmd+Enter 和发送按钮共用现有发送流程，Enter 换行。保护 composition/isComposing 及候选确认事件顺序，不以粗暴延迟吞掉随后独立的 Cmd+Enter。先持久保存草稿/outbox，再清空仍匹配版本；错误保留文本，取消动画不取消已提交命令。保持选择/光标与域/generation 防护。

## 5. 左栏文字与分隔线试验

同构建三组：OFF 关闭装饰；BASE 完整规范三帧，含品牌、双方头像、输入边界、既有结构分隔线；EXTENDED 在 BASE 上增加左目录文字及现有导航分组线的另一种触发处理。第10节明确共享目标的试验，不假装存在新分隔线；不为动效增加无用横线。

扩展文字仅用非语义临时裁片显示层，源位置有真实缺口；原排版、命中范围、可访问名称和全文访问保持。检查长中文、拉丁/混合标签及窄屏竖排品牌。Master 看过对照并选定前，正式默认 BASE。

分隔线：约7px接近、片段≤18px、约1px错位、150ms、同线700ms冷却、全局最多一处。另加是否播放的随机门控，不把随机片段当随机触发。初始可复现试验用 p=0.25，明确是待观感调整的试验参数，不是已批准美学常量。每次合格接近只判定一次，包括未命中；退出再进入且满足冷却才重新判定，避免 pointermove 频率迫使最终播放。测试/测量注入固定 seed，再核对自然随机观感。无后台轮询，保留选中行真缺口，不覆盖隐藏/遮挡线。

## 6. 画廊、回归与原生验收

画廊包含全部适用组件状态、深浅色、名称、源几何、A/B/C、第一/二/三帧冻结、自然播放、取消、动效模式、三组对照，以及四个独立消费公开导出的示例。冻结是几何诊断，不是时序证明。视觉样本固定 seed/视口/字体/缩放/数据，保存源图＋三帧＋恢复，以及选中/hover/focus/pressed/error；逐项对照固定设计来源并记录偏差，不静默重置截图基线。

单元/controller 测试验证真实风险：缺口/路径稳定、唯一 ID、不重复 action、接触合并、取消清理、确定性随机未命中/冷却/全局线限制、播放中状态改变、帧中关闭 reduced-motion。Svelte/原生集成检查隐藏页面不获焦点、跨页草稿与锚点连续、持久化失败保留文本、动画结束不能制造业务成功。复用现有合同、workflow、bridge、reading 与 native suites 回归。

真实 macOS Tauri 矩阵：深浅色；1100/850/600 精确断点及两侧±1；宽/窄可用；WebView 100/125/150/200%缩放及增大字号；中央伸缩/侧栏固定；真实窗口控制；Tab/Shift+Tab、Enter/Space及 dialog 焦点；可访问名称/状态，可用时以 VoiceOver 核验。检查双方头像、快速跨控件、pointer cancel、禁用/卸载、滚动/缩放、动效中途关闭。文字选择、光标、候选位置及布局稳定。

系统 IME：Enter/Space 确认候选、Escape取消、组合中鼠标发送、切窗、确认后独立 Cmd+Enter、fixture 流更新中组合输入。每项三次，零误发、有效提交一次且文本精确。合成 composition 测试单列，不替代系统输入法。Master 在真实 Tauri 窗口判断美学与可感知卡顿，不以浏览器截图代替。

## 7. 原生性能评估

扩展现有脚本，不从节点数推算资源。普通 Release、同 binary SHA、隔离人工数据、显式 PhaseUI 测量入口，不加载 native-test driver；正常产品模式没有周期采样/遥测。测量配置遵守现有受限 study IPC，不增加通用 shell/网络桥。功能 native 自动化和资源采样分开。

五类场景：空闲30s稳定＋60s采样；重复单控件；快速跨控件/导航；输入＋滚动；固定 fixture 消息流＋动效（名义20更新/s、1200次、等待实际排空、30s恢复、180s截止）。非流活跃场景固定60s操作＋30s恢复，适用时至少100次激活。回放明确标为合成，人工输入延迟另列。加入取消/卸载循环及静默后计数。每场景 OFF/BASE/EXTENDED 各至少三次，轮换顺序；设备、seed、视口、DPR、主题、缩放、数据、操作序列、电源/温度条件一致。主基准固定一个声明的主题/窗口，另一主题和窄屏补重点最坏场景，不冒充全矩阵。

记录构建、设备、macOS/WebKit 来源、视口/DPR/可得刷新率、设置、采样开销及每次有效性。记录构造/更新时长、事件处理到下次 rAF 的明确代理指标（不当作已呈现时间）、点击反馈代理 p50/p95、帧间隔分布及>1.5/2倍刷新预算次数。可得时用原生 timeline 工具记录绘制/合成/实际呈现；不支持的 PerformanceObserver/Long Tasks/GPU/能耗标 NOT_TESTED。rAF 间隔不称实际显示掉帧。报告各次原始值、median/range 与相对 OFF 的绝对差值，不只报百分比。

进程采样含 app/WebKit 候选，沿现有脚本区分已存在共享进程与 PID 生命周期；报告 CPU、峰值 RSS/回落，不把候选当独占归属，也不把 RSS 合计当真实总 RAM。效果/节点/timer/listener 在取消、导航循环和静默后回到基线，无单调增长或后台动画。增加 reporting-off 空闲对照衡量测量扰动；录像/截图与定时采样分开。

任何误发/重复操作、未清理、输入位移、可重复延迟/长帧回退均调查。拟定调查触发线（不是已批准产品 SLO）：BASE/EXTENDED p95反馈比 OFF 多一个实测刷新间隔，构造任务>50ms，或恢复后资源持续增长。与 FE-00/02 的可比证据对照并说明构建/负载差异。先优化构造、复用、清理，保留三逻辑帧，不默改为两帧。Master 决定观感和可接受代价；原生关键指标缺失或回退未解决，不能宣称性能已验收。

## 8. 执行、验证与门槛

1. 完成双语计划与 Claude 往返复核，将意见落实本计划，停在 Master 实施批准点。
2. 获准后复核基线、建立 codex 分支、清点精确 token/组件来源并隔离 study CSS；实现 token、布局壳及基础组件。
3. 移植类型化几何/controller，加入画廊和行为测试；接入 FE-02 表现层和 Cmd+Enter，保留业务 owner。
4. 实现扩展试验与确定性控制，做原生视觉/输入/生命周期验收，再做普通 Release 性能对照，保留失败及重测依据。
5. 更新 docs/frontend、组件用法与验收证据；更新本地化输入并通过既有流程生成支持语言视图，明确未验和 deferred；修正当前阶段过时文字，不重写历史证据。
6. 桌面执行 `npm run contracts:check`、`npm run check`、`npm test`、生产构建，及适用 Rust fmt/clippy/test；现有 native suites＋PhaseUI suite＋隔离 fixture 集成。执行仓库 docs/check/verify 要求和 Core Linux/macOS、desktop macOS CI。执行前核实现行命令，不为设计系统额外调用付费 live 模型。
7. 实现 PR 用同一 Claude 会话按精确 HEAD、diff 和证据复核，分清 reviewer 实查/实跑与 Codex 提供结果；Master 原生美学终审与明确合并授权是独立门槛，验收不齐不关闭 #62。

## 9. 纳入 R1 的补充源码核对

`application-service.ts:822` 已将存储中的空白助手名转换为小写 `secretary`；`test_case/offline/issue8/api.test.ts:125,148` 对此有断言。因此前端单做 `trim() || "Secretary"` 无法区分默认回退与主动设置的小写名称。拟在批准后做一处最小 Core 表现修正：现有 assistant 投影改为 `p.name.trim() || "Secretary"`，保留一切主动设置的非空名称（包括小写 `secretary`）。同步两处默认断言并补主动小写/空白测试，不改 schema、存储、endpoint、授权或状态机。明确记录默认返回文案变化，执行 API 和 Core 回归，不将其隐藏为 CSS 修改。前端仍对缺失/空白投影回退 Secretary，同时尊重主动名称。此修正纳入交 Master 批准的计划范围。

补充浏览器观察：临时599px视口下，右栏展开覆盖正文、收起恢复阅读空间；左栏只显示图标及竖排品牌。已恢复原视口。此项不代表全部断点或原生验收通过。

本轮计划检查与复核记录将在下方登记。未修改产品代码，也未宣称性能通过。

## 10. R1 复核处置与具体实施决定

Claude R0 读取两个固定版本仓库和冻结截图后给出 CHANGES_REQUIRED；未运行测试、预览服务或 Tauri。以下落实 B1～B5 和 N1～N11，作为待 Master 批准的具体方案，不是提前实施。

### B1 · 真实窗口与后续页面边界

默认进入对话，未连接时也如此。右活动栏只在对话页出现（冻结 `prototype.js:252`）；其他页面中央占据剩余空间。现有顶部工具区增加小型“连接”文字入口，打开使用 token 的原生 dialog，容纳既有连接/lifecycle 控件。这是明确标出的扩展，因为 v1.0 没有真实连接操作。状态条显示简明同步/错误及连接入口，完整诊断放 dialog，不提前实现设置页。应用 identifier 保持 `dev.secretary.study`，数据目录不变，不重命名或迁移 profiles/数据库。

| FE-02 区块 | #62 位置及处理 | 完整页面归属 |
| --- | --- | --- |
| profile、附着/启动、同步/错误 | 连接 dialog，复用回调；必要状态/错误仍在外部可见 | 共享布局壳 / #62 |
| 停止 Core 及确认 | 连接 dialog，独立明确确认并保留 instance 绑定 | 共享布局壳 / #62 |
| timeline/composer/history/latest | 对话中央；token/组件和最小角色头像；保留投影、草稿/outbox、锚点 | #63 |
| tasks/execution detail | 任务中央；保留当前选择/详情交互，换基础组件样式 | #64 |
| 执行结果/产物保存 | 当前任务执行详情中，保存流程不变 | #64详情；#66完整库 |
| approvals | 待处理中央；保留读取/确认/回执语义；抽取 Work 视图而不复制状态 owner | #64 |
| outbox/receipts | 待处理中央，与审批区分；保留现有命令列表/回执文案 | #64 |
| 记忆/设置/产物库 | 有名称的空页面位置；已有产物保存仍从任务可达 | #65 / #66 |
| 右栏分组 | 保留 v1.0 位置；只读展示已有且关系可靠的数据，否则留空 | 后续页面归属 |

Master 明确要求双方头像覆盖，所以 #62 在真实 timeline 接入简单角色头像；完整日期分组/timeline 重设计留给 #63。master/user 显示 Master，assistant 显示配置名称，system 显示 System 并保持系统身份区别。取非空名称首个 Unicode grapheme（可用时 Intl.Segmenter，否则安全 code-point 回退）为初始字形；提供稳定完整角色/名称，不接远程图片/API。完整任务表格交互重设计、排序/筛选/分页重设计、产物库、decision answer、搜索、通知投递不属于 #62；行/表格组件及状态仍在画廊完整交付。

画廊仅通过受限 `SECRETARY_PHASEUI_SCENARIO=gallery` 环境选择器，经 study_mode 返回后启用；同 Release 二进制可显式启动，普通导航不显示。画廊导入正式组件、标明人工内容、不能提交业务。正常启动仍为 Connected。

### B2 · 覆盖矩阵与明确的源实现调整

Master R1 覆盖要求优先于冻结代码的 CSS-only 空缺：有边框的纯文字按钮仅在真实边框做三帧；无边框文字按钮仅在原有下划线做三帧；输入focus使用真实有边框wrapper。均拟140ms，文字/命中范围不动，不虚构矩形。此具体视觉适配随本计划交 Master 批准，不退回已批准的按钮/输入全覆盖。普通文字链接保留v1.0静态下划线/括号；实际按钮按下表视觉构造处理，不按HTML标签统一画框。筛选组保留 aria-pressed；未来真正 tablist 才用 tab 键盘语义，不给当前筛选组虚构 tab 行为。

| 对象 | BASE机制 / 事件 / 时长 | 冻结来源与调整 | OFF / EXTENDED |
| --- | --- | --- | --- |
| 含图标控件 | 几何切片，hover/focus/接触按下释放；A/B/C160/180/200，小图标140 | prototype.js:1几何；signal-motion.js:822 | OFF无；EXT相同 |
| 有边框纯文字按钮（.button） | 仅替换真实边框；hover/focus/按下释放140；故障时停用装饰括号伪元素，结束/取消恢复 | style.css:461,1590～1680；边界renderer适配 | OFF无故障；EXT相同 |
| 无边框文字按钮（.text-button） | 仅在已有hover/focus下划线做三帧140，源线真缺口，无外围矩形；播放中替换装饰下划线扩展动画 | style.css:378下划线；三帧线renderer适配 | OFF静态语义下划线；EXT相同 |
| input/select | 仅真实有边框wrapper；focus/接触140、composer submit边界140；wrapper内独占空兄弟显示层，不向textarea/select插子节点；不逐键播放 | style.css:1565四步重绘替换为R1三帧边界 | OFF无；EXT相同 |
| 品牌/双方头像 | identity切片180；现有hover及有语义焦点对象的focus，不给头像增Tab点 | signal-motion.js:537 | OFF无；EXT相同 |
| 发送 | 方块160＋箭头420，同记录/接触；有效激活立即提交 | signal-motion.js sendEffect | OFF无；EXT相同 |
| 选中导航边界 | 实际导航触发；冻结边界时序；与图标记录合并 | signal-motion.js play/navigation | OFF无；EXT增文字切片 |
| 结构线含.nav-separator | 事件接近、门控150；冷却700、全局一处 | signal-motion.js:600～820＋R1是否触发门控 | OFF无；EXT见下方 |
| 左目录标签 | BASE无文字故障 | prototype.js:226的.nav-label；identity为来源 | OFF无；EXT跟随所属图标A/B/C时长 |
| 页面/行内面板显影 | 冻结短显影，无文字位移，状态立即改变 | style.css:1444 | OFF无动画；EXT相同 |
| 文字链接及语义焦点/选中 | 静态下划线/括号/焦点/选中 | style.css:1590～1680 | 三组保留；OFF无动态重绘 |

OFF 同时关闭 controller 装饰和 CSS animation/transition（含下划线增长、重绘/显影/scanning）；静态 focus/current/hover/pressed/status 保留。BASE/EXT 不使用冻结无限 scanning；pending 用明确静态文字/图标，空闲没有动画，同时仍展示真实处理状态。

明确适配：scroll 只清 divider，不清发送/控件动效（冻结L947清全部，而FE-02发送会滚到最新）；组件生命周期替代 body-wide MutationObserver（L954）。Svelte 组件各自持有空显示层容器，renderer 只改该容器内部，不插入 Svelte 管理的子节点或 textarea 邻域。一个 seeded RNG 覆盖 plan选择、identity方向、divider起点/方向和门控，测量路径不残留 Math.random；普通偏好用自然随机。主题/动效偏好保存在带版本及命名空间的 localStorage，不放内容/凭据；系统 reduced-motion 优先，不支持存储时用内存。

token 通过冻结页面深浅色代表元素的最终 computed style 核对，包含 paper/surface 别名反转及状态选择器。长名/截断名/竖排名字做冻结 overlay 对齐。mask-image 同时提供 -webkit-mask-image，在报告中的实际 macOS/WebKit 验证，不宣称未验旧系统支持；SVG特性失败恢复完整源图，不能空白。

### B3 · 有实质内容的既有分隔线试验

纠正R0：设置前 `.nav-separator` 已被冻结探测器覆盖。BASE 为完整覆盖必须保留，不能为了造出增量把它删掉。EXTENDED 复用**同一条已有线**，除接近外，增加相邻目录行（待处理/设置）的键盘聚焦/按下触发资格；比较触发处理与阅读干扰，不比较新增线数量。共用线记录、p=0.25试验门控、700ms冷却及全局限制。目录行一次contact epoch合并focus/press/pointer，未命中不在同轮重抽。不新建线、不随意重分类按钮边框。画廊允许文字扩展/线触发扩展独立开关以诊断，主要对照仍为OFF/BASE/EXTENDED；组合回退时报告label-only/separator-only诊断结果。

文字切片加入该目录项已有记录并跟随图标A/B/C时长，不新增独立effect/timer。链接保留稳定完整aria-label，临时副本aria-hidden；因此源显示隐藏不会丢失可访问名称。窄布局隐藏的标签不构造不可见切片。用具体视觉样例向 Master 说明扩展，再决定生产是否启用。

### B4 · 可执行的测量入口

study_mode 增加独立受限选择器 `SECRETARY_PHASEUI_SCENARIO=gallery|idle|single|navigation|input-scroll|stream-stress|bridge-cadence`，校验模式 `SECRETARY_PHASEUI_MOTION=off|base|extended` 和有界数字seed。它不冒充旧FE-00的study布尔值，main.ts显式选PhaseUI harness；没有选择器则普通Connected，旧study独立保留。非法值使测量失败，不能静默转旧study。harness挂载正式shell/表现层/controller及确定性**页内数据adapter**，不是画廊，也不接paid/live后端；通过同一公开状态/回调接口驱动。此延迟仅代表前端。

`stream-stress` 明确为页内20Hz/1200更新，绕过桥节流。独立 `bridge-cadence` 场景按源码1.5s持久快照/250ms瞬态节奏通过相同adapter模拟，明确不是网络延迟。另以原生fixture集成测试覆盖真实bridge，不能从资源测量推定其结果。三组同普通Release二进制，仅校验后的模式输入变化；原始结果放 `.demo-data/issue62/runs/<timestamp>-<scenario>-<mode>/`。

仪器开启时增加逐次逻辑态采样：rAF检查frame1/frame2/frame3/resolved的computed visibility，报告**未被中断的有效激活**四态均被采样到的比例，中断激活单列。这是逻辑可见性代理，不是物理屏幕证明；冻结截图及独立自然播放原生录像/人工核对补充。报告样本数及截断/无效激活；稳定缺中间帧阻断时序验收。OFF该项N/A；BASE/EXT诊断开销一致，并用reporting-off对照量化。

普通Release没有devtools feature，因此该SHA的Web Inspector绘制/合成NOT_TESTED；需要时另建带独立hash的诊断构建，不能与普通资源基线混用。计数只含controller自有effect/node/timer/listener registry，并断言dispose/unsubscribe，不声称全WebKit监听器数。validator要求scenario/mode/seed、ready、足量样本、操作序列完成、queue排空和恢复；缺字段/截断是INVALID/FAIL，不能算零成本。

### B5 · 可执行的原生几何与输入矩阵

拟将native minWidth由640降至480逻辑窗口单位，保留minHeight480，测量实际content innerWidth（CSS px）。通过resize/zoom达到599/600/601、849/850/851、1099/1100/1101的**内容CSS宽度**，不拿外框尺寸当断言；native-test窗口同宽度约束。PhaseUI诊断入口通过现有受限Tauri setZoom权限提供100/125/150/200%控件；资源测量固定声明缩放，测试后恢复100%。不新增通用IPC或改系统设置。

增大字号指诊断typography token从14→18px，同组件运行，与page zoom分开，明确是文字比例模拟，不是macOS Larger Text。测100%及重点最坏200%组合；控制不进入普通Settings，后者留#65。

IME增加候选窗打开时Cmd+Enter、组合中导航离开（各三次）。按isComposing/composition状态/keyCode229及实测WebKit顺序处理。离开安全失焦，通过现有chain保存最新已提交文本，复位陈旧composition标志但不发送；返回恢复有效文本/选择。分别测试候选确认与随后独立Cmd+Enter，不能误发也不能永久禁止发送。

CI的desktop npm test执行纯planner及fake-DOM生命周期（沿冻结测试方法），另跑Rust/API；WKWebView本地执行，当前CI不启动WDIO。现有native selector改到真实对话scroll owner，先显式导航再操作各页面，不以放松行为断言适应隐藏状态。隐藏对话前保存锚点，禁止隐藏页写锚点，返回布局完成后恢复，避免零尺寸bounds覆盖持久位置。既有cache/draft、request ID及应用identifier不变。

### 复核处置

采纳B1/B2/B4/B5并给出上述定义；接受B3空集合诊断，但不删除BASE覆盖或创造无用线，改为既有共享线的明确触发试验。真实timeline最小头像是对Master #62覆盖要求的落实，完整对话布局仍后置。11项非阻断意见均已纳入；第9节Core默认名小修也需本次修订计划批准。

## 11. R2 局部修正与收尾意见

Claude R1 已接受B1/B3/B4/B5、测量/ownership定义及Core名称小修，只剩一项阻断：区分有框/无框文字按钮。已在第10节原位替换文字和矩阵。三帧替换既有可见边框/下划线，不新增矩形；有框按钮重构边框时停用装饰括号伪元素，结束/取消恢复；无框按钮重构已有交互下划线；input/select只在现有有框wrapper内拥有空兄弟显示层，不给原生表单元素插子节点。静态focus outline始终保留。没有线就不虚构线：组件须在覆盖清单登记合适的既有视觉来源后才能声明覆盖。

同轮六项建议一并采纳：

1. 确定性fixture adapter放在可注入BridgePort后，覆盖现有snapshot/transient/query/submit/draft/anchor/subscription接口，使Connected/Work/workflow派生逻辑照常运行。默认真实bridge，仅受校验PhaseUI诊断选择器注入页内adapter；adapter实现不能转发Core。明显标记synthetic、隔离内存状态、保持人工draft/receipt一致性，测试此模式不得触发真实IPC；仍不证明网络/持久化。
2. 生产Connected缩放验收通过native-test在真实连接路由调用已有受限setZoom API，使用隔离fixture profile测100/125/150/200%；真实窗口人工跟进可用同验收构建。普通Release资源测量独立，因此不只测harness缩放。
3. 未连接/没有profile时，对话显示行内连接提示；由提示/顶部入口打开dialog。attach/start/draft/send测试ID留在对应语义控件。不自动启动或附着Core。
4. 同时设置旧study与PhaseUI选择器（包括旧scenario flags）时报配置无效，不静默排序或fallback。
5. 默认名修正同步docs/api/v1/examples.json及相关API文本/翻译，走现有生成流程；明确同endpoint的非桌面消费者也看到空白名大写回退，主动设置的小写名称不变。
6. 偏差表明确记录.scanning无限循环改静态pending文字/图标，以及连接UI、边框/下划线覆盖、scroll清理、lifecycle ownership、角色头像、快捷键及分隔线触发。Master批准本计划时审这些具体偏差；最终视觉验收仍在之后。

复核状态：R0 CHANGES_REQUIRED（五组）；R1 CHANGES_REQUIRED（仅剩视觉构造一项，其余通过）；R2已提交最终实施条件复核。所有实施与新原生测量仍待Master批准。

## 12. 最终复核与本轮验证

2026-10-21：Claude Opus 5.5 Extra 对R2给出 **PASS**，可交 Master 批准，此前通过结论继续成立。最后核对冻结text-button下划线、有框button及boundary-fault CSS，未运行测试；前面源码/图片复核与Codex computer-use观察分别记录，不混写。[复核会话](https://claude.ai/chat/3de6f59f-0769-44ee-adc9-d32114884c0d)。原始请求/回复及PASS截图保存在忽略目录 `.demo-data/issue62/review/`。

最后两条非阻断建议处置：采用reviewer给出的明确适配选项，无框文字按钮在**键盘focus/activation也显示同一条既有下划线**，让三帧有可见源；保留focus outline并登记偏差。OFF同时关闭CSS **transition和animation**，静态状态即时生效。这两项是reviewer提供选项的具体落实，仍随本计划交Master批准。

本轮验证：`npm run docs:check` PASS（610份Markdown、8,375个本地链接、零错误；119本地化源/357页面/638单元current）；`git diff --check`及新文件空白检查PASS。仓库只修改两份计划和fix索引，源码基线仍为4f1f052。未实施、未新增原生性能验收、未通过Secretary执行付费模型、未部署、未创建PR或合并。下一步：**Master批准或修订计划，再开始实施。**


R3 实现复核澄清：主资源测量关闭 computed-style 帧采样，另设可见性采样组；单控件/导航场景完整合格效果覆盖率低于 95% 时判为系统性缺帧。每轮轮换模式顺序，并强制同一二进制哈希。输入滚动回放每 500ms 替换全文，明确不等同真实逐键输入延迟。


校准修正：回放按时钟截止时间在既有测量 rAF 循环中派发，每帧最多一次计划 tick。检查固定 tick 总量、最大迟到≤250ms、活动期隐藏/失焦 tick 为零；不降低至少100次动作门槛。关闭报告的空闲对照仍不运行 rAF 循环。
