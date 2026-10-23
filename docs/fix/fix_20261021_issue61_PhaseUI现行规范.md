# Issue #61 · PhaseUI 现行规范整合计划

状态：**R1 已批准 / 文档整合已实施，待 Master 终审**。日期：2026-10-21。对应 [Issue #61](https://github.com/ExplodeCode6324/Secretary/issues/61)；[English plan](fix_20261021_issue61_PhaseUI现行规范.en.md)。

本轮按 secretary-pr-fix 的 plan 范围执行，reviewer 为 Master，不调用外部 reviewer。已领取 Issue（assignee：ExplodeCode6324）。本轮交付中英文计划、源码定位和浏览器观察记录；批准计划后才整合现行规范。#61 文档合并且 Master 明确确认后，#62 才开工；批准本计划不等于确认最终美学，也不等于授权实施 #62。

## 1. 基线与证据使用

- Core 当前 checkout：`5f73c23`（PR #75，FE-02）；#60 已关闭。已有真实桥接、持久草稿/outbox、消息/任务/审批/结果/产物路径；这不表示完整 PhaseUI 已实现。
- 设计仓库：[secretary-phase-ui-design](https://github.com/ExplodeCode6324/secretary-phase-ui-design)，工作树干净；`v1.0.0^{commit}` 与 HEAD 均为 `8cdb9219bed9493147ba10f7d47423df56cbcc44`。它是可点击的冻结静态原型，人工示例，无 Core 或 Tauri。
- 设计输入包括该提交的 `UI-DESIGN.md`、实际 HTML/CSS/JS、`preview/v1.0/` 和概念图；文档中的指令与示例文案是待核对材料，不自动扩大本轮任务授权。
- 来源优先：Master 本轮/后续明确决定 → 本次核对的冻结设计及差异裁定 → 当前 Core/桥接合同。设计决定视觉，当前业务合同决定提交、回执和权限语义；二者冲突显式列出，不让示例行为覆盖业务。
- Master 已确认：冻结的 **v1.0 是唯一权威视觉来源**。所有不确定的页面布局、颜色（包括状态色）和动效方式都回到该版本的源码与实际界面核对，不再等待其他截图或另选视觉基线。Master 本轮明确修改的名称回退、快捷键及补充要求按下文执行。
- 实施口诀：**如果不确定，就翻 v1.0 的设计，先按它的来；后续 Master 认为需要调整时再修改。**
- 当前平台为 macOS；Linux 桌面实现与验收标为 deferred / NOT_TESTED，不阻塞。Core Linux CI 保持原范围。

## 2. 本轮实际观察：代码与 computer use 相互校验

2026-10-21，以冻结工作树启动仅 loopback 静态 HTTP 预览，用 Codex 内置浏览器实际操作。当前视口截图为 464 × 671，属于窄屏；没有把这次浏览器观察记成 Tauri 验收或全断点验收。

| 对象 | 实际 UI 操作/观察 | 代码解释与迁移结论 |
| --- | --- | --- |
| 栏位与导航 | 深色正文黑、侧栏深灰；浅色切换后正文暖白、侧栏米色。窄屏左目录只显图标和竖排品牌，选中行接入正文；右栏初始收起 | `style.css:1997,2221`；结构依靠整行目录、色块与接边细线，不改为卡片导航。桌面宽栏比例来自源码与冻结截图，尚未在本轮宽窗口重测 |
| 对话发送 | 输入人工文字并按 Enter，增加一条 Master 消息，输入清空且仍聚焦，页面明确提示“未发送”；切页再回来消息仍在 | `prototype.js:635,687` 仅向内存数组追加。真实桌面 `Connected.svelte:179` 先保存草稿并持久入队，成功后才清空同版本文本；两种语义不能混写。此行记录原型观察；目标快捷键按 Master 裁定改为 Cmd+Enter 发送、Enter 换行 |
| 活动栏 | 点击展开/收起，窄屏展开覆盖右侧，显示正在进行、近期产物和快捷操作，原消息仍保留 | `prototype.js:247,250` 切 class/hidden/aria-expanded；`style.css:2273` 规定窄屏覆盖。不能因装饰重建输入或消息 |
| 任务行 | 点击首行“展开”，详情插入表格内，按钮变为“收起”，aria-expanded 更新 | `prototype.js:271` 及 actions；详情是行内展开，状态、时间和操作列独立，不把整行变为大卡片 |
| 产物 | 产物页“查看”打开本地说明 dialog；Escape 关闭并返回原“查看”按钮焦点 | `prototype.js:280,355`；文件入口、类型、来源优先，原生弹层焦点行为保留；示例预览不等于真实下载 |
| 图标三帧 | 动效页选 A 同色分带，开启冻结，依次检查第 1/2/3 帧铃铛：同一原轮廓不同横带移位/缺口；关闭冻结后重新触发可回到完整图 | `signal-motion.js:55,204,223,242` 真正 mask 源路径并重构三帧。冻结截图只验证形态；毫秒时序来自实现，不宣称本轮测量了帧率或延迟 |
| 文字与反馈 | 常规文字、输入和点击区域保持原位；三帧是局部显示，不是整页滤镜 | controller 在 `signal-motion.js:312` 集中取消；生命周期/禁用/reduced-motion 的完整矩阵留给实施阶段验证，不凭此次几个点击宣告全覆盖 |

本轮截图：[窄屏浅色对话](evidence/issue61-phaseui/narrow-light.png)。宽屏及深色冻结参考见设计仓库 [发布验证](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/preview/v1.0/VALIDATION.md)，这是原仓库证据，不是本轮新验收。

## 3. 文档迁移盘点与去向

本轮已检索仓库 Markdown 中 SwiftUI、PhaseUI、native-client-design、secretary_macos、FE-00～07，并检查首页、文档入口、桌面源码和历史规格。实施阶段对全部命中逐条分类，包含历史计划/验收与翻译来源；最终输出 `docs/frontend/source-migration.md`，每行有源路径/版本、实际状态、保留条款、废弃条款、新归属和验证依据。

| 源 | 实际状态 | 保留 | 废弃/修订 | 新归属 |
| --- | --- | --- | --- | --- |
| `README.zh-CN.md`、生成的 README/en/ja/fr、`docs/README.md` | 仍以 #58 spike 描述桌面 | Core 独立、macOS 优先、设备冻结 | 过时进度及缺少现行前端入口 | 指向唯一 frontend 入口；源码改动后按本地化流程生成 |
| `src/secretary_desktop/README.md` 及 `docs/{en,ja,fr}/desktop/README.md` | 标题/首段仍 FE-00/01，源码已 FE-02 | 运行、桥接、原生测试和实际边界 | 不再让 study 或旧标题代表完整产品/现行视觉 | 运行说明保留；架构及规范由 frontend 统一索引 |
| `docs/old/native-client-design-v0.3.md` | 已在 old；正文仍有旧路线实施口吻 | 草稿、持久回执、ID 关联、通知 presented/read、视口 | SwiftUI/Xcode、旧色板/pt、旧导航、设备占位与旧快捷键不直接继承 | 添加明确 historical/superseded 导航；原正文与版本保留，提取条款写入新文档 |
| `docs/old/README.md`、`docs/old/demo_design/`、BrainStorm | 历史或概念输入 | 思路和出处 | 不升格为当前设计 | historical 索引与迁移表 |
| `docs/api/v1/verification.md`、`issue9-verification.md`、`docs/fix/` 与 archive/evidence | 各版本验收/计划 | 原结论、失败和 NOT_TESTED | 不能用历史通过代替新 UI 验收；局部 PENDING 不覆盖 GitHub 后续合并状态 | 保留证据；现行状态另据 commit/PR 记录 |
| `docs/operations.md` 及翻译 | Core 操作手册 | 有效 Core CLI/API 与生命周期 | 发现过时前端入口时仅改导航/状态 | frontend architecture 关联 |
| PhaseUI v1.0 规范、源码、截图、API-UI-Mapping | 冻结视觉与示例交互 | 几何、布局、反馈与来源 | 人工状态/固定品牌/本地假发送不能当业务 | phaseui / components；API 映射逐项对照当前合同 |
| #57、#62～#66 的现行说明 | 路线与分期要求 | 串行门槛、各阶段责任 | 正文仍含 Linux 双平台旧描述、旧引用时统一解释 | 规范合入后更新现行链接及 scope；保留原历史讨论 |

## 4. 批准后的文档交付

唯一现行入口为 `docs/frontend/README.md`，写明版本、来源、Master 确认状态及适用平台；翻译是同一规范的语言视图，不建立第二套基线。

1. `architecture-and-flows.md`：Tauri 2 / Svelte / Rust bridge / Core 职责；启动、关闭窗口、显式停止 Core；导航与页面责任；快照/增量/瞬态、持久发送和错误恢复；已实现与下一阶段能力分列。
2. `phaseui-design.md`：布局、颜色、字形、密度、边线、头像、品牌；三层显示与三逻辑帧分别解释；从最终生效 CSS/JS 提取数值而非只抄文件头 token。附版本固定代码链接与静态/分镜来源，并落实第 6.1 节的固定侧栏、中央伸缩、色块融合及顶格分隔线原则。
3. `components-and-states.md`：布局壳、目录项、图标、按钮、输入、分隔线、任务行、产物行、弹层和状态提示。每项写结构、触发、视觉、业务反馈、取消/清理、键盘/IME 和降级行为；三帧动效覆盖与左栏文字/分隔线试验按第 6.2 节登记。
4. `acceptance.md`：macOS 原生窗口、宽/窄、100/125/150/200% 缩放、文字选择、系统 IME、焦点/辅助技术、动画中断、深浅色、offline/stale、pending/成功/失败矩阵。每行分清本轮浏览器观察、原仓库证据、FE-02 既有证据、后续 NOT_TESTED 与 Master 待验；Linux 独立列 deferred；加入第 6.3 节的三帧动效性能评估交接矩阵。
5. `source-migration.md`：完整迁移表、能力归属表和 Master 差异决策记录。首页、docs、桌面 README、历史入口与 #62～#66 全部导向上述唯一入口。

能力归属按四类逐项登记：① FE-02 已实现路径；② Core API 已有、UI 尚未覆盖（如记忆/World/完整设置/通知，逐接口核对）；③ 冻结设备 #6/#11～#14；④ 纯视觉示例（动效诊断、人工任务和概念图）。#61 不补业务 UI，不改 Core 合同，不新增组件库。

## 5. 给 #62 的精确源码导航

所有外部链接固定到设计提交 `8cdb9219bed9493147ba10f7d47423df56cbcc44`。行号用于定位，符号/选择器用于后续版本迁移；不是要求复制整个原型或叠加式 CSS。

| 要实现的部分 | 冻结代码入口 | 应提取的约束 |
| --- | --- | --- |
| 页面外壳/导航 | [index.html](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/index.html)、[render](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L215) | 原生链接语义、选中状态、焦点；真实前端不照搬 main.innerHTML 重建 |
| 色板/三栏/接边 | [style.css:1](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L1)、[1997](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L1997)、[2221](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L2221)、[2308](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L2308) | 网页版基准196/270，窗口宽度变化由中央吸收；同一布局档位侧栏固定。v1.0窄屏档位：1100下166/230、右栏48、850覆盖、600左栏64；按第6.1节核对 |
| 图标几何 | [geometry](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L1) | 源路径与辅助路径分离，采样区来自每个图标本体 |
| 三帧重构 | [plan / mountFaultFrame](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L5)、[secondFrame / thirdFrame / mountFault](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L204) | 原位置真缺口；0/26.67/53.33% 三态，80%复位；第二帧反向换区，第三帧收窄减量 |
| 取消与事件 | [createController](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L312)、[事件入口](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L822)、[生命周期测试](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/tests/signal-motion.test.cjs) | 每控件一个效果；同次接触合并；退出/失焦/禁用/卸载清理；reduced-motion 不补播 |
| 品牌与头像 | [identity](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L537)、[品牌样式](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L2350) | 品牌字形蓝色硬边、无容器框；头像保留边框；动态显示名需重新验证宽度与分片 |
| 输入/发送 | [conversation](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L268)、[submit / keydown](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L635)、[发送显示层](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L2122) | 输入边140ms、方块160ms、箭头420ms指定例外；文字/光标不切片，动作不等待动画 |
| 活动/任务/产物/弹层 | [activityContent / updateActivityRail](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L247)、[页面模板](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L271)、[openDialog](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L355) | 活动栏完整模块、行内展开、文件名元信息、原生焦点恢复 |
| 分隔线/复核画廊 | [分隔线探测](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L694)、[motionView](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L334) | 150ms、单段≤18px、接近7px、同线700ms冷却、全页最多一处；依 Master 要求增加随机触发判定，不是每次接近都播放；冻结只检几何 |

真实实现对照：[Connected.svelte](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src/Connected.svelte)、[bridge.ts](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src/bridge.ts)、[workflow.ts](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src/workflow.ts)、[Work.svelte](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src/Work.svelte)、[Results.svelte](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src/Results.svelte)。#62 应抽取组件并复用现有数据/发送路径；`App.svelte` study 与 `Phase.svelte` 技术样本不是最终设计规范。

## 6. 状态模型与 Master 已裁定事项（R1）

将交互显示与业务状态分成两个维度：stable/hover/pressed/focus/disabled 与 idle/pending/succeeded/failed/offline/stale；不是所有组件都拥有全部业务状态。pending 不能禁用所有阅读和导航，disabled 不触发动效。成功/失败以真实回执和文案表达，装饰与几何复位不承载结果。取消动画不会取消已提交业务；业务取消另走明确操作和回执。颜色及状态色一律以 v1.0 为准。

| 差异 | Master 裁定及落实方式 | 状态 |
| --- | --- | --- |
| 视觉来源 | 冻结 v1.0 为唯一权威视觉来源；不确定的布局、颜色、动效先按它实现 | 已确认 |
| PERRI 固定品牌 vs #62 显示名 | 沿用字形效果，文本来自助手显示名，空白回退 **Secretary**（大写 S）；长名截断并可获取全文。后续同步 #62 的旧小写回退要求 | 已确认 |
| 快捷键 | **Cmd+Enter 发送，单 Enter 换行**；IME 候选确认不发送。原型 Enter 发送仅为源行为记录，不是目标绑定；提示文案、实现和测试同步 | 已确认 |
| 跨页重建/内存消息 vs 草稿和阅读位置 | 保留真实域隔离草稿、ID 锚点和持久 outbox；导航不清空未提交内容，保持阅读位置 | 已确认 |
| 右栏示例 vs 未实现功能 | 按 v1.0 留好栏目和占位位置；暂未实现的功能先空着，不填示例业务数据，不为填满栏目提前接功能。已有能力显示真实数据；设备范围继续冻结 | 已确认 |
| 状态色 | 直接采用 v1.0 的状态色及搭配，不另拟色板；仍保留明确状态文字 | 已确认 |

### 6.1 窗口、色块与分隔线

- 窗口比例以 v1.0 网页版为基准。调整宽度时，**中间对话主体扩张或收缩，左右侧栏在同一布局档位保持固定宽度**，不按窗口百分比一起拉伸。窄窗口允许按 v1.0 已有断点切换固定宽度、收起或覆盖；断点适配与连续拉伸分开描述。
- 两侧栏通过背景色块与主体分隔，不用卡片包装。左栏任意选项选中后变成与中央主体相同的颜色，边界衔接形成融入主体的效果。
- 分隔线尽量顶格到所属栏目/模块的边缘；文字内边距不应把结构线一起缩短。少用两端内缩的装饰短线，避免“现代应用”卡片感；顶格不等于跨过无关栏目。
- 验收同时检查宽度连续调整和断点切换：中央吸收宽度差、侧栏稳定、选中行与主体同色接边、结构线对齐；具体尺寸与颜色回看 v1.0 最终 CSS 和实际界面。

### 6.2 三帧动效覆盖与左栏扩展试验

- 三帧动效覆盖所有可交互按钮、文本输入框、Master 与助手头像，以及 UI 已有结构分隔线。按 v1.0 对象类型使用相应效果，不把所有控件都变成同一种图标切片。输入框动边界/显示层，正文、输入文字、光标和 IME 候选位置保持稳定；头像保持图像语义。
- 按钮按接触、按下/释放、焦点触发并合并同次接触；保留禁用、reduced-motion、关闭动效和清理规则。动作不等待三帧播放完成。
- **分隔线随机触发，不要求每次接近或交互都播放。** 在 v1.0 的事件触发机制上增加是否播放的随机判定，同时保留随机片段、冷却及全页最多一处的约束；不增加后台自动循环。原实现的随机片段选择不等于随机决定是否触发，规范和实现需明确这一区别。概率先在试验中调节并记录，不在计划中虚构已定数值。
- #62 的组件画廊中尝试给**左侧栏文字**及**各按钮之间已有的分隔线**加入同源三帧效果；左栏文字仅改变临时显示层，不改变排版、点击范围或可访问名称。分隔线仍遵守顶格与随机触发原则，不为展示动效额外堆叠横线。
- 对比 v1.0 基础覆盖与左栏扩展方案的视觉效果、阅读干扰和性能，再交 Master 查看。此扩展是明确提出的试验，不改写冻结 v1.0 标签，也不把试验效果预先当作已验收标准。本次只修计划；#61 写入规范及交接，实际组件试验随 #62 实施。

### 6.3 三帧动效对整体前端性能的评估

目标是量化完整三帧覆盖及左栏扩展带来的实际成本，保留三帧设计。复用现有桌面测量入口；设计仓库的 [开销说明](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/TAURI-MOTION-COST.md) 仅为实现分析，节点数量不能换算为 CPU/GPU 或功耗百分比。

| 对照/场景 | #62 实施时记录 | 判断依据 |
| --- | --- | --- |
| 同一构建：关闭装饰 / v1.0 三帧覆盖 / 三帧覆盖加左栏文字与分隔线 | 相同设备、窗口、缩放、主题、数据和操作序列，每组至少 3 次；记录版本与条件，固定随机种子用于可比测量，再用自然随机验证观感 | 分离三帧基础成本和扩展增量；两帧不作为替代设计 |
| 空闲、单控件、快速跨控件/导航、连续输入与滚动、消息流更新并触发动效 | 主线程构建/更新耗时，输入到下一次绘制及点击反馈延迟 p50/p95，帧间隔/长帧、长任务、可获得的绘制/合成信息 | 对比现有 FE-00/02 响应证据和同场景无装饰基线，报告绝对值与差值；不凭浏览器预览宣布原生性能通过 |
| 多次触发/取消、切页、缩放、reduced-motion、关闭动效 | 活跃效果/临时节点/计时器恢复情况；整应用相关进程（含 WebView）的 CPU、内存峰值与回落；工具可得时记录 GPU/能耗 | 无持续堆积或闲置动画循环；无法测量的项目标 NOT_TESTED，不用主进程代替整应用 |
| macOS Tauri 真实窗口复核 | 保持字号、DPR/缩放和记录规模一致，检查三帧可辨、侧栏文字可读、光标/选择稳定、快速操作可打断 | Master 评估美学与可感知卡顿；测量发现瓶颈先优化构造、复用与清理，保留三逻辑帧 |

#61 交付测量方法和待测矩阵；#62 执行测量并报告原始数据、变化和限制。本轮不宣称已测性能，也不为这项评估启动真实模型付费请求；可复用固定消息流 fixture。

## 7. 执行顺序、验证与交付门槛

1. Master 再次复核 R1 中英文计划；第 6 节六项裁定已落实，不重复请求这些决定。记录后续意见与处理，整体计划通过状态仍待 Master 确认。
2. 获准后补齐全仓迁移表、逐项 API/页面能力映射；复查最新 main 与设计 SHA。
3. 编写五份现行规范；继续以代码、浏览器实际操作、冻结源截图三者核对。宽窗口、键盘/IME、关闭/减弱动效、快速中断等没有新执行的项明确列待验；需要真实 Tauri 外观的项目归 #62，不在 #61 假造通过。
4. 更新导航、历史提示及本地化输入/目录。现有生成翻译从源文档和 `docs/i18n/translations.json` 更新；新规范按现有本地化机制登记，历史 fix 计划保持独立中英文，不手工修改生成译文造成漂移。
5. 执行 `npm run docs:check` 和 `git diff --check`；检查全部新相对链接、固定 SHA/符号/行号、来源图片和中英文计划一致性。必要时只补文档检查入口；无业务测试或真实模型调用需求。
6. 整合文档形成可审 PR，交 Master 亲自复核完整规范与差异裁定；完成所需 CI 后仍由 Master 决定合并。#61 合入与最终确认均具备才交接 #62。

本轮验证：`npm run docs:check` PASS（578 个 Markdown、8044 个本地链接，0 错误；113 个本地化源、339 个译文页面、556 个翻译单元均 current）；`git diff --check` PASS。未运行业务测试或真实模型调用。审阅记录：R0 完成源码与 UI 观察及初稿。R1：Master 裁定六项差异，并补充中央伸缩/固定侧栏、色块融合、顶格分隔线、三帧覆盖及左栏扩展/性能评估；已全部同步两版计划。**R1 整体计划待 Master 再次复核，未开始实施。**

## 实施交接 · 2026-10-21

Master 已批准 R1 并要求实施；随后明确撤回真实部署要求，本次只写文档。已交付六份现行规范、来源盘点、历史提示、导航及英/日/法生成版本；没有改 UI、部署或提前实施 #62。复核仍由 Master 亲自进行。见[现行入口](../frontend/README.md)与[交付证据](evidence/issue61-phaseui/delivery.md)。
