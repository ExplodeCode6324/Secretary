# Issue #105 — Task 稳定标题、固定执行轮次与导航

Master 已批准本版实施（2026-11-07）。继续同一 Claude 会话复核、测试和 CI，交 Master 终审；未经授权不合并。

状态：**R2 PASS（仅计划就绪）**，2026-11-07 00:46 HKT 读取；下文已纳入 reviewer 的非阻塞细化意见。Master 已于 2026-11-07 批准实施，后文规划阶段的边界作为历史记录保留。终审及合并仍需单独授权；未迁移真实数据、未额外调用模型。

- 仓库：https://github.com/ExplodeCode6324/Secretary
- 目标：https://github.com/ExplodeCode6324/Secretary/issues/105
- 衔接推演：https://github.com/ExplodeCode6324/Secretary/issues/106
- 基线：`main@5aa5753a940e38164582fdc3368e8e307e6f5c2f`，包含 #103 / PR #107、#104 / PR #108。实施前重新核对最新 main，整合后续成果，不重置其他工作。
- 分支：`codex/issue105-identity-plan`。Reviewer 为 Master 已打开浏览器会话中的 Claude Opus 5.5 Extra。全英文复核；请求、原始回复及截图放 Git 忽略目录 `.demo-data/issue105/review/`，仓库只存脱敏结论。每次提交后首次等十分钟，之后每五分钟查看。
- [English plan](fix_20261107_issue105_identity.en.md) · [复核记录](evidence/issue105-identity/plan-review.md)

## 1. 用户结果与范围

Master 使用可读 Task 标题加永久执行轮次定位工作。名为 `整理 本周报告` 的任务在续接、重启和归档后保留原名；最近三轮如果是第 5、6、7 次，就一直显示这些编号。列表卡片提供一个明确的小型详情点击入口，普通正文仍可拖选。普通 Task 详情中按 Esc 返回列表，保留列表锚点和唯一一份 Task 普通草稿。

#105 实现持久身份、精确解析与既有查询/导航入口，不实现 `/guide` 发送、回执及待确认提交记录。保留固定 Pi 版本、#103 引导证据与权限、#104 预览/跟随的真实目标 ID、Scope 可见性、最近三轮历史边界，以及 Main/Task 两份普通草稿。不增加命名模型调用、每 Task 长期草稿、框架变更或 #70–#74 隐含前置。

## 2. 已核查源码与接点

| 源码 | 当前行为与计划接点 |
| --- | --- |
| `task-planning.ts`、`main-tools.ts`、`application-service.ts` | 新建和续接已有 receipt/fingerprint，没有独立标题。task_propose/API/Proposal 增加可选建议 `title_candidate`；TaskPlan 持久保存不可改的 `title`。 |
| `task-triggers.ts` | 创建 Execution 与消费排队请求已在同步事务中完成。轮次分配及 TaskPlan 计数推进放同一事务；恢复旧 Execution 不重新分配。 |
| `store.ts`、`store-lock.ts` | flock 单写者、同步确认日志写入、版本检查、多记录原子提交；`firstSequence` 和帧内 mutation 位置提供已提交创建顺序。不确定 ACK 会使当前 owner 失效，重开后以 replay 为准。复用这些保证，不另建数据库/锁/身份账本。 |
| `retention.ts`、`scopes.ts` | 退役保留 Execution，Scope 归档不删除 TaskPlan。名称和轮次高水位不随可见性释放，本项不增加物理删除。 |
| `task-browser.ts` | 已有 ID 前缀查询和稳定 ID；最近三轮按调用/创建时间排序。增加身份字段和类型明确的解析，显示排序不作为身份。 |
| `tui/input.ts`、`tui/task-browser.ts`、`tui/task-presentation.ts` | 参数只接受 ID 形状、补全返回字符串；卡片显示 goal 摘要，执行标题显示窗口位置。只扩展相关 Task 定位/补全；`/show` 和破坏性命令沿用原合同。 |
| `tui/view.ts`、`tui/app.ts`、Pi `tui-alt-screen.ts` | DocumentView 有显示行→条目 ID 映射；Pi 会向消费 press 的组件发送 release/click，但文本选择 fallback 同样会向松开位置的组件发送 click。必须证明同一热点有尚未消费的已处理 press，不能仅凭收到 click 激活。 |

## 3. 持久名称与轮次分配

### 3.1 标题规则

最终 `TaskPlan.title` 在整个 Store 数据域唯一，包括其他 session、历史 Task 和已归档 Scope。内部 UUID 继续作为真实身份及工作目录名称；标题不改 goal、路径、父执行关联和 execution_id。本项不提供改名。

拟采用统一纯函数实现并在正式文档说明 normalization v1：

1. Main 在既有 task_propose 中给出简短 `title_candidate`。缺省/null/规范化后为空时，使用原 goal 的有界前缀；仍为空则用 `Task`。fallback 最多查看 goal 的 4,096 UTF-16 单元，不额外请求模型。显式候选输入最多 1,024 UTF-8 字节，超过时在受理前拒绝。
2. NFC 规范化；Unicode White_Space 和 C0/C1 控制字符转 ASCII 空格；移除 Unicode 格式控制字符，但保留 emoji 连接使用的 U+200D ZWJ；合并空格并去掉首尾空格。拒绝不成对 surrogate。保留中文、大小写、标点、下划线、双引号与反斜杠。使用大小写敏感 NFC 相等，不使用大小写折叠、NFKC、模糊匹配或视觉近似判定；显示仍经过 safeText。
3. 最终标题含后缀不超过 64 个 Unicode scalar、256 UTF-8 字节；在同时满足两限的 grapheme 边界截断。异常首个 grapheme 本身超限时改用 `Task`。不对 goal/正文应用标题规范化。
4. 依次尝试有界 base、`_1`、`_2` 等。每次按完整后缀长度缩短 base，然后检查实际最终字符串是否已占用。自然输入的 `_1` 结尾按普通标题保留，不解析成分配器计数。确定性选择最低可用后缀，永不释放旧名，并显式防止计数溢出。

候选及最终有界 base 必须至少含一个可显示基字符（非空白、mark、格式/控制或 Unicode default-ignorable 字符）。只有 joiner、variation selector 或 combining mark 时按空候选 fallback。ZWJ/variation selector 可伴随可见 emoji/正文保留，不能独自成为看似空白的标题。持久标题在 replay 校验时不重新执行规范化。

R2 分配阶段细化：规范化候选恰为 UUID 形状时改用 goal fallback，规范化 fallback 也为 UUID 则用 `Task`；截断后也检查，避免截断生成 UUID 形状标题。这样新分配标题不会与完整内部 ID 相撞。读取 goal 有界前缀时不能切断 surrogate pair。依赖 Unicode 表的规范化、grapheme 边界和可显示基字符判定仅在分配时运行；replay/stage 只校验不随引擎表变化的 UTF-16 合法性、scalar/UTF-8 字节上限、无 C0/C1、字符串精确唯一性和不可变性，避免 Node/ICU 升级把旧标题重新判为非法导致无法启动。不为重新应用分配策略而改掉已保存标题。

Proposal 保存候选，TaskPlan 保存最终标题。`title_candidate` 仅用于新建：普通 reuse 传非 null 值时，在受理前报 `TITLE_ON_REUSE_NOT_ALLOWED`；REDO 保持现有可纠正的 `FAILURE_REQUIREMENTS_CHANGED:title_candidate` 拒绝。缺省/null 均忽略，必须从 Scheduler.propose options 中省略，不能传入 null 键：v2 会过滤 null，但旧 v1 hash 会序列化整个 options。这样续接/REDO 保持原名，不放宽要求保护。新建时显式非 null 候选计入指纹；同 request/同输入返回原 Task/标题，改输入则冲突，即使规范化等价也按请求指纹处理，不隐式改名。Main 工具 schema/帮助注明仅新建可用，单独测 absent/null 旧回执兼容。

同步选名、创建 TaskPlan、既有 task receipt/admission 在一个受理事务中完成，中间无 await。标题索引从已提交 TaskPlan 重建，只随已提交帧推进；校验提交前和同事务内的唯一性。写入失败不能形成成功受理的虚假占位；ACK 不确定时重开 replay 后才重试。同 Core 并发调用在此边界串行；第二个 Store owner 由现有 flock 拒绝。

### 3.2 固定 Execution 轮次

新增 `Execution.execution_round`（安全正整数）和 `TaskPlan.execution_round_high_water`（安全非负整数）。只有真正创建新 Execution 时取 high_water + 1；Execution、推进后的高水位、排队请求/occurrence 消费、原有父执行关联更新在同事务提交。`plan_revision` 继续引用本次执行实际使用的历史计划，不为新计数伪造或改写旧快照。

排队请求不占号，创建前拒绝/移除不增号。已有 `(task_id, occurrence_key)` 或请求重试保持原 Execution/轮次；重启、WAIT_AUTH、WAIT_DECISION、模型重试、重派发与恢复均不增号。真正的新续接/周期执行才增号，失败、取消、退役不会回收编号；不按 UI 位置编号。高水位达到 `Number.MAX_SAFE_INTEGER` 时明确报告容量错误，保留排队请求和计数，不回绕。

提交校验禁止修改已分配标题/轮次、降低高水位、重复 `(task_id, execution_round)` 或超过有效 TaskPlan 高水位的轮次。同事务中的 TaskPlan/Execution 一起校验；正常新执行路径必须恰好推进一次，迁移使用单独且限定的路径。旧日志没有新字段仍能 replay，不给所有历史帧追加强制字段要求；旧内存版本不能抹掉已完成的身份分配。

**可重放校验规则（R1 B1）：** `Store.stage(txn)` 同时用于 append 和每次启动的全部历史 replay。所有身份校验必须仅依赖帧前已提交状态与该帧，不能依赖内存 migration flag 或当前程序日期。使用 Task 的 `identity_version`，以及所有迁移单元完成后在既有 journal 中只写一次的 `task.identity.activated`（version 1）事件，区分旧格式历史创建和新受理。该事件只标记格式边界，不是第二份身份权威或业务通知。

- activation 前，首次创建且完全不含身份字段的 TaskPlan，以及完全未迁移 Task 下首次创建的无轮次 Execution，按旧格式接受。首次创建 v1 TaskPlan 始终须有 title、version 1、high_water=0。activation 后拒绝不完整的新 Task/Execution。只有所有有效 Task/Execution 都完整时才能提交 activation，禁止重复/未知版本。空 Store 也在 App 就绪前只激活一次；该事件不产生 Input/Feedback，不污染业务历史/通知。
- 标题只允许 absent→value 一次，之后不改不删。按持久字符串精确比较已提交索引和同帧 Task，不重新规范化。
- Task 在**帧前**已有 identity_version=1 时，每帧该 Task 最多新建一个 Execution：round=旧 high_water+1，且同帧 Task 高水位恰好加一。没有新建就不改计数，旧轮次不改。禁止同帧创建 Task 和首个 Execution；现有生产路径本来就是两次提交。
- 已存在 Task 在**帧前**尚无 version 1 时，只有迁移能引入身份字段：title/high_water 只预留一次；仅给已经存在的无轮次 Execution 按确定创建顺序填预留范围内编号；预留开始后不再创建 Execution。完成 marker 要求恰好覆盖 1..high_water，无漏项/重复。末批赋号可和 version 1 同帧，因为按帧前状态分类。完成后禁止给旧 Execution 补一个此前缺失的轮次。
- replay/install 建立已提交创建排名、标题和轮次索引，校验整帧 staged 集合，包含写完成标记时同帧末批赋号。避免每批重读全部历史。真实 close/reopen 测试必须重放旧帧、部分/完成迁移帧、activation 和升级后的新建执行；只 mock 当前快照不够。

TaskPlan 本身保存名称占位与高水位。现有 retention 不删除 TaskPlan/Execution，不需要第二份权威身份账本。将来回收执行 payload/history 仍须保留身份元数据；未来若增加物理删除 TaskPlan，必须先明确保留名称占位，本项不实施该删除能力。

## 4. 旧数据补齐与启动门槛

存储 schema 新字段为可选以兼容历史 replay，但新建和升级后公开 DTO 要求身份完整。在 `App.open` 中，`await Store.open` 后立即执行版本化 `ensureTaskIdentities(store)`，早于构造 Authorization/调用 auth.recover()、World、Scheduler/scheduler.recover()、Host 或开放 API/model。恢复函数会提交，所以迁移必须先完成。Store.open 保留通用 replay 职责，生产代码唯一调用者为 App.open。迁移自身不调用模型、不生成 Input/Feedback、不初始化工作目录、不执行任务。

确定顺序为首次已提交创建帧 sequence 升序、同帧 mutation 位置、最后 UUID 防御性定序。不使用 updated_at、started_at、locale 排序、目录顺序或本次启动顺序。旧 Task 按 Task 创建顺序由原始 Proposal.goal 分配标题；先保留已有标题占位。包括归档/关闭 Task 和 RETIRED Execution。每个旧 Task 对真实保留的已提交 Execution 创建记录按该顺序分配 1..N，不为推测的缺失历史补造 Execution，也不修改历史不可变 journal snapshot/proposal_ref。

迁移有界且可续跑：先持久保存 Task 的标题和计划高水位，再每事务最多更新 128 个 Execution，全部完成后才给 Task 写 `identity_version=1`。该标记之前，重启从完整创建顺序重建同一映射，核对已填部分；不能从暂存高水位之后重新编号。所有 Task 完成且全域 activation 事件提交前不受理业务。如果有效记录均完整，最后一批可连同 Task 完成标记和全域 activation 同帧提交。完成的 Task 永不重排；再次干净启动没有身份写入。新 Task 创建时即 identity_version=1、high_water=0。所有 Task marker 已写但 activation 未写时崩溃，重开只补缺少的 activation，不重新分配身份。

每个迁移单元修改前检查必要引用和完整映射。已有身份冲突、必要创建/Proposal 证据缺失、部分迁移不一致时明确诊断并使 Core 保持未就绪，不猜测、不静默重分配。先前已完成单元保留，修复后确定性续跑。记录迁移数量/耗时；查询和每次按键不扫描全部历史。故障测试涵盖标题预留后、Execution 分批中、完成标记前后、fsync/ACK 不确定。升级验证使用隔离复制数据根，本计划阶段不触碰真实用户数据。

这是单向数据格式升级：旧 schema 的 additionalProperties=false 会使旧程序无法 replay 首次新字段写入后的数据根。第一次在真实数据根启动新版前，须干净停止写者，完整一致备份 journal/objects 及相关根状态，并验证隔离副本可重开。保留备份，不把旧程序直接指向升级后的根，也不自动以旧快照覆盖后续工作。测试证明旧格式→迁移→新格式重开，不承诺旧二进制向后读取新数据。

## 5. 公开解析、补全与展示

从 `src/contracts/contracts.schema.json`、API 源 `docs/api/v1/schema.json` / `operations.json` 修改，按仓库脚本生成 contracts、API DTO/OpenAPI、生成及本地化文档。在任务受理/状态、task_query、Task/Execution API 列表详情、TaskBrowser 卡片/执行 DTO、跟随标签中补 title/round。日志、诊断、协议仍保留内部 ID；新增字段影响显示时同步补投影 cache signature/generation。

定位语法明确如下：

- API selector 区分 `{kind: title | id | auto, value}`，也可采用语义相同的互斥 query 参数。title 只匹配完整规范名称；id 为完整 UUID 或唯一前缀；auto 计算两类结果并集，若命中不同 Task 则报歧义，不能让标题静默覆盖另一个 Task 的 ID。原 `task_id`/`match` 查询仍仅表示 ID，保持响应兼容。
- `/search_task <selector>`、`/taskdetail <selector>` 接受无空白的完整标题、双引号标题、ID/前缀。双引号强制标题语义；`--id <ID-or-prefix>` 强制 ID 语义；无引号 token 使用上述安全 auto。`/show` 仍是精确事项 ID。`/follow` 保留 #104 的 ID/锚点行为，仅给显示/补全加永久轮次，不在 #105 增加第二套目标语法。
- 双引号内只允许 `\"` 和 `\\`，不做 shell 插值、单引号语法或变量展开。换行、引号不闭合、非法转义、多余参数和原始控制字符拒绝。查找只做 NFC，不执行候选截断、后缀分配或模糊匹配，名称空格须与持久标题一致。命令名保持原大小写规则，名称保留大小写。帮助/补全插入正确转义的双引号标题，特别是类似 ID 或包含空格/引号/反斜杠的名称。
- 类型化建议返回 title、Task ID、状态及可定位 execution ID/round/状态；旧 ID 查询客户端仍可取得字符串建议。最多 20 条且遵守既有响应字节上限。补全仅改输入，不提交；保留手动首 `/` 来源规则；编辑器、页面、导航 generation 改变后丢弃迟到结果。同步修复完整命令判定，避免双引号补全后 Shift+Enter 无法明确提交。

补全始终插入带引号标题。保留既有短 ID 前缀兼容，不额外设置 auto 模式最短长度；`cafe`、`2024` 如果同时命中另一 Task ID，明确报歧义，提示双引号标题和 `--id` 两种写法。这是对 R1 可选建议的明确取舍，不设置隐含 ID 优先级。

提供一个只读精确目标 resolver，并进入生成 API，例如 `/task-browser/resolve`，输入 selector、execution_round 和 purpose（`browse` / `guidance`）。输出固定 task_id、title、execution_id、execution_round、当前状态及相关 version/fingerprint，不产生业务请求。轮次先匹配 ASCII `[1-9][0-9]*` 再检查安全整数，拒绝前导零（`07`）、全角数字、0、负数、小数、科学计数、溢出和附加文本并给提示。从已提交身份索引解析 `(task_id, round)`，不把窗口位置当编号，不回退 latest。

先应用现有 session/Scope 可浏览边界，再暴露身份。browse 可读最近三轮内的终态执行；窗口外、归档和不可定位目标明确失败，不换成相邻执行。guidance 还要求 AGENT，且非终态、非取消中、非 RETIRED、非 RESULT_UNKNOWN。复用/抽取 #103 的公共归属/可操作校验，同时保持 TaskBrowser 可见性限制独立；已受理请求 replay 必须先返回原 receipt，不能因后来结束而错误拒绝。不给 Main 新权限、不另建授权路线。不可用、结束、取消中、不支持、歧义返回明确错误，同时不泄露隐藏任务。解析成功不预留存活状态，最终 #103 受理仍复核冻结的真实 ID/归属；#106 在网络不确定期间保留该 ID，不把名称重新解释成下一轮。

**明确的 #103 行为增量及 R2 范围修正：** 当前 GuidanceService.target 检查归属、终态/取消和 AGENT 类型，但没有拒绝 RESULT_UNKNOWN。#105 通过共享只读可操作校验，对 Main task_control 和 Master API 的**新**引导拒绝这一不可恢复状态。RETIRED 已经通过终态被拒绝，保持该行为即可，显式防御检查也可接受。不向 #103 内部 ID 受理增加 Scope 归档拒绝：Scope.archive 允许已开始工作继续运行，应保留原有引导能力。归档排除和最近三轮仅属 TaskBrowser 定位/浏览规则；解析后才归档也不静默剥夺 #103 既有精确 ID 能力。测试覆盖两种来源及状态竞态、不可操作拒绝时零新增 Guidance/Input、结束/归档后旧 receipt replay，以及已开始执行归档后仍可按准确 ID 接受合法引导，而标题定位拒绝。不取消或改写已受理 Guidance。按 reviewer 建议，明确撤回 R2 中较宽的归档受理限制，保留基线能力。

## 6. 最小点击与 Esc 导航

根列表每张 Task 卡片显示独立 `[详情]` 热点，与标题/goal 可选文字区分；元数据携带稳定 Task UUID。渲染时根据 Pi 终端 cell 宽度和实际换行映射生成热点矩形，不能按 UTF-16 长度算列，也不能从标题反解析 Task。只有根列表卡片有导航动作，Main DocumentView 行为保持。

无修饰左键 press 落入热点时记录 `{task_id, entry_id, 页面/导航 generation, 渲染布局 generation, scrollTop, screen/cell 几何}`，只消费这个小热点，使 Pi 路由 release/click。每次新 press 先清除旧手势，普通正文 press 不消费。只有仍有记录证明本组件消费了本次 press，且按下位置/热点/Task、布局 generation/scrollTop/目标行均未变，左键、无修饰、`clickCount === 1` 时才激活。没有该记录的 click，包括 Pi 选择路径送来的 click，都返回 unhandled。拖动、滚轮、修饰键、页面/输入所有权变化、resize、程序滚动/重排或目标替换取消记录。滚轮取消记录后仍返回 unhandled，保留滚动。即使 Pi 提供旧的按下相对坐标，也复核当前布局和 scrollTop。宁可取消，不可误开。有效记录跨 release 保留到随后 click；无效 release 取消。成功 click 只消费一次，取消/下次 press 清空。不捕获全页、不另建鼠标协议、不改 Pi。测试须包含普通未消费 press 后内容移至指针下，fallback click 仍不能激活，而不只测热点捕获路径。

复用 `open(id)` 的先查询/授权后替换页面和 epoch 防迟到机制。离开前保存 root anchor、停止 Task follow、按确切 UUID 打开，保留共享 Task 草稿。目标已不可用则留在当前页面，草稿不变并显示原因。导航不创建 Input、Guidance、回答、授权或取消请求。

Esc 优先级：既有事项/授权处理优先；其次关闭活动编辑器补全菜单并消费 Esc；其次普通 Task 详情返回根列表，即使正处于阅读焦点；Task 根页仅在需要时退出阅读/调整焦点，否则不操作。Main 阅读 Esc 不变。`/back` 与点击共用导航/锚点恢复机制；原锚点行消失时沿用真实的邻近回退并提示。草稿、undo、粘贴来源不清，不退出进程、不提交命令、不取消业务。事项、补全 overlay、页面切换、退出过程占用输入时禁用鼠标导航，维持高优先级处理。

草稿细化：鼠标/Esc 直接调用导航，绕过当前会清编辑区的命令提交分支。显式提交 `/back` 等本地命令仍沿用消费命令自身的行为，不恢复每 Task 隐藏草稿，也不抹掉随后新增编辑。定位失败保留当前页面并说明原因；这不等于承诺显式提交过的命令仍作为未发送内容留在编辑区。

## 7. 批准后的实施顺序与验证

1. 合同源、规范化/selector 纯逻辑、持久索引及不变量，生成派生产物。
2. 版本化启动补齐、原子新建/轮次分配，保留 receipt hash、REDO 和续接规则。
3. 查询/投影/resolver DTO、精确可操作状态及有界补全，更新 API 覆盖。
4. 标题/轮次展示、既有定位命令引号语法、列表热点/Esc；保留 #104 流式阅读/跟随 ID 和草稿 generation。
5. 针对性回归、生成一致性、仓库完整 verify/CI、同一 Claude 会话准确 HEAD 实施复核；Master 另行产品验收及批准合并。

必需证据：

| 范围 | 确定性用例 |
| --- | --- |
| 标题 | 并发同名、自然 `_1` 冲突、NFC/大小写/中文/emoji、空格/引号/反斜杠/控制字符、截断/后缀上限、缺省/空候选 fallback；goal 和 UUID 目录不变。 |
| 原子性 | 同请求并发/重试、改候选冲突、回执丢失、append 前后失败、ACK 不确定/重开、第二 owner 拒绝；无重复受理或虚假占位。 |
| 轮次 | 排队/移除不增号；新建/周期/续接增号；失败/取消/退役/窗口变化不重排；WAIT_AUTH/WAIT_DECISION/READY 恢复、模型重试保号；同 occurrence、计数耗尽。 |
| 补齐 | 旧 fixture 含归档 Scope、关闭 Task、RETIRED Execution、同时间戳和同帧多创建；全部迁移崩溃点；二次启动无写入；证据不一致明确失败；原引用/父关联/goal/目录/旧日志字节保持。 |
| 解析 | 标题与 ID 名字空间碰撞、前缀歧义、引号、`_1`；显示 5/6/7 时精确定位 5；非法/缺失/不存在/终态/不可操作/归档/窗口外；resolve 到 admit 间结束/取消、结束后已受理请求 replay；不回退 latest。 |
| TUI | 补全只编辑不发送；手动/粘贴首 `/`、既有定位命令拒绝多行、迟到补全；普通草稿/undo/粘贴保留；事项/补全/详情/根页及 Main 阅读 Esc。 |
| 鼠标 | 使用实际固定 Pi dispatch harness 的 press/release/click；宽字符/emoji 换行、滚动、resize、按下时刷新重排/移除、迟到打开；正文拖选/复制/滚轮、修饰键/右键/多击；正确目标或不导航，零业务写入。 |
| 回归/成本 | #83 浏览/归档/窗口、#91 锚点、#92 事项/草稿、#93 REDO、#103 精确引导、#104 跟随/流式；工具 schema 变化后的 A06/A15 续接预算；增加无关历史时固定可见工作量，验证索引查询/补全有界，完整扫描只在迁移。 |

复用真实 Store/App/HTTP 及现有 headless/Pi harness，不写只复述 helper 的测试。先针对性验证，再有 PostgreSQL 的 `npm run verify`、生成一致性、Linux 完整 CI、含 #105 的 macOS 相关套件。同步更新 `docs/api/v1/README.md`、`docs/tui/api-coverage.md`、`docs/tui/run-and-test.md` 及相关验收/参考文档源，保留原证据编号和 NOT_TESTED 边界。

更新 activation 后手工创建 Execution 的 fixture，尤其 `test_case/offline/issue18/helpers.ts`，改走带 TaskPlan 计数事务的真实分配路径；不能为测试放宽产品校验。真正旧格式 fixture 应构造成 activation 前的历史 journal，再走真实迁移/reopen。

单独做真实 macOS 终端验证：点击命名 Task 热点；中文/emoji 卡片滚动和 resize；正文拖选复制；从阅读/详情及补全/事项状态按 Esc；核对目标、列表锚点和草稿。记录终端/版本/输入环境、首次失败；PTY/headless/源码检查不等于原生验收。真实模型生成候选标题可在授权后做隔离 smoke，但不是名称正确性的前置，也不为命名单独加调用。#106 的真实模型中途引导联调属后续。计划阶段产品测试/迁移/模型/原生终端/CI：**NOT_RUN**。

## 8. 顺推 #106，供 Master 判断路线

三个上游分工保持清楚：#103 保存可靠投递/采用证据，#104 让运行中的准确执行可读，#105 让人能用名称/轮次定位该执行。#106 预计只在这些成果上增加命令、待确认提交和回执交互。

例：`整理 本周报告` 第 7 次执行正在运行。Master 打开详情、跟随实时内容，然后明确提交 `/guide "整理 本周报告" 7 先给我前十条样例，保留原始数据。`。客户端只解析命令、标题、轮次，轮次后第一个 ASCII 空格作为语法分隔，其余展开后正文完整保留，包括额外空格、换行、引号、反斜杠、美元符号。只在 Task 普通列表/详情输入执行，Main/事项态不执行；#106 只放宽 guide 正文多行，不放宽其他命令。

轮次后的首个分隔符必须是一个 ASCII 空格，不能直接换行；再后面的空格/换行都属于正文并完整保留。空正文或全空白正文拒绝，trim 只用于判断，不改发送内容。这沿用 #106 当前 issue 合同，并解决 R1 推演提问。

由于 Enter 插入换行，#106 的错误/帮助须明确提示：不能紧跟轮次直接在下一行开始正文，应先输入必需空格。冻结的是本地提交格式版本和准确请求指纹；不向现有仅 request_id/task_id/text 的 GuidanceCommand 增加易变 Execution expected_revision 要求，避免普通流式/checkpoint 更新错误拒绝已经冻结的正确目标。

只解析一次，发送前在必要的持久待确认提交记录中冻结真实 task/execution ID、轮次、完整原文、请求身份/version/fingerprint。调用 #103 既有端点，并说明其单条 16,384 字节、每执行 64 条/65,536 字节限额。本地“请求是否到达未知”与 Core SENT 区分；重连/重启按同一身份查账，需要时明确重试该冻结请求。不能因响应丢失重新解释当前页面/latest 或换新请求 ID。成功只清对应提交 generation，发送期间新写的草稿保留。

SENT/RECEIVED/GUIDED 与未处理/冲突/结束原因取自持久后端证据，不以 HTTP 成功或可见文字推断已采用。受理时或采用前 Task 结束，仍保留真实回执，不默默改投第 8 轮、不续接、不复活取消工作。普通预览/阶段刷新不多发 Main 输入；原始 Master 引导仍按 #103 一次知情，异常控制沿 #104 分流。

#106 最后串联名称+固定轮次 → 完成前可见文本 → 中途引导 → 持久三阶段 → 后续行为改变 → 断线/重开/对账，同时检查多 Task 不串流、超过 50 条、锚点、点击/Esc 及相关授权/问题/取消/失败/产物路径。复用上游有效证据，真实模型、真实终端与 Master 产品验收分别记账。之后进入实际使用驱动的 TUI 迭代；#70–#73 仍等 Master 明确 UI 稳定，#74 仍以后续数据决定。

## 复核结论

R1 CHANGES_REQUIRED 指出日志重放规则分类和 Pi fallback-click 来源两项问题；R2 PASS 确认已解决，#106 路线无偏移。最终文本已纳入明确非阻塞意见：Unicode 无关重放、保留归档后运行工作的原有引导能力、更新分配 fixture、UUID 形状标题 fallback、空格/换行帮助。提交版本语义另按现有 GuidanceCommand schema 澄清。不宣称第三轮独立复核或产品验证；时间及证据边界见复核记录。实施已获 Master 批准，最终验收仍待 Master 确认。

## Master 原生验收后的补全修复

Master 在 `664c3df4` 的真实 Terminal 验收报告 A04（标题参数补全/方向键）和 A11（follow 参数补全）失败，其余项目通过。范围仍为既定 #105 交互修复，未获合并授权。

根因：DraftEditor 每次按键后以“命令语法可提交”为由关闭菜单，连方向键选项也受影响；Pi 的空格插入及命令名补全不会可靠触发参数查询，且原测试一次性输入整条命令，漏掉逐字输入时序。

修复：移除按语法完整性关闭菜单的通用逻辑；在参数文本变化、命令名补全后及明确 Tab 时刷新受作用域限制的参数菜单。方向键只移动选项，接受参数后关闭菜单，Esc 不自动重开。通过现有固定 Pi 0.87.0 EditorBridge 的版本/方法检查接入常规异步查询，不启用文件补全或自动接受单项。保留手打斜杠来源、错误页面限制及过期结果过滤；不改 Shift+Enter 的明确提交语义。

验证补充：逐字输入、单个中文字符、一次中文提交、多选项 ↑/↓、Tab/Enter 接受、Esc、follow 尾空格/命令名补全，以及真实 TerminalApp→Core/API 链路；补充粘贴斜杠、错误页面与延迟结果负例。原生 A04/A11 修复后仍须 Master 复验。完整测试、CI 和同一 Claude 会话的新 HEAD 结论记录到 PR。

## R6：原生复验后的粘贴参数范围修复

Master 在 d905c5c8 通过 A04；A11 仍报 INVALID_DRAFT_RANGES，之后非粘贴输入、撤销重输、选择任意任务也报错。根因是补全回调提供“替换长度”，EditorBridge 却作为 splice 的“结束偏移”；修正为 start + oldLength。保持草稿校验，不猜测丢失的来源、不丢弃粘贴正文。新增真实编辑器回归覆盖粘贴参数前缀和尾随空格、空/非空替换、三个定位/跟随命令、Tab/Enter、撤销/恢复、清空后多行粘贴展开，并覆盖实际 TerminalApp/Core 路径。同步更正 R5 提醒的 Shift+Enter 注释，执行规则不变。

已经损坏的验收草稿保留原目录及证据备份，复验改用新的独立 TUI 草稿目录，仍连接原 Core 实例和任务/ID。不宣称自动修复已有非法快照，也不处理生产草稿。最终精确 HEAD 的完整检查、CI、同一 Claude 复核结果写入 PR；原生验收和合并仍由 Master 决定。
