# Issue #94：产物交付、当前文件打开与原生图片粘贴

状态：PASS_PLAN_ONLY，Claude R4 已通过；实施尚未批准。中英文计划复核后，须经 Master 批准才实施；合并另行授权。

- Issue：https://github.com/ExplodeCode6324/Secretary/issues/94
- 仓库：https://github.com/ExplodeCode6324/Secretary
- 已检查基线：`578bcc2e9d70726e305ededc4e0fa1a68bef3623`，2026-11-05 香港时间获取的最新 main；分支 `codex/issue94-delivery-plan`。
- Reviewer：浏览器 Claude Opus 5.5 Extra，全程英文，建立本 issue 独立会话并复用于实施复核。
- Master 特别要求实施后真实接入模型复核。原生终端验收、真实 provider 证据、源码复核、CI、Master 决定分别登记。

## 1. 结果与边界

在对应 Main 模型回复末尾显示登记产物，专色、完整当前路径、Task/Execution 身份、逐项绑定的模型解释齐全。`/open` 打开工作区当前文件，不用 CAS 快照替代。真实 macOS 剪贴板图片进入 Main 草稿，显式发送图文，复用 #81 的身份和恢复合同。

固定 Pi TUI 0.87.0 / 上游 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`，沿用 Node/TypeScript、#91 粘贴来源、#83 独立 Shared 目录、#81 存储与 vision 合同。当前 main 已有 #92/#93，回归组合行为，不重写其功能、不为 #94 新设依赖。保留无关未跟踪证据。

不做独立产物页/存储/菜单、新图片格式、模型/预算 UI、`/attach`、独立 `/retry`、Main `/cancel`、直接建任务、UNKNOWN 裁定、语音、目录迁移/清理、Shared 组锁或浏览器替代终端。不强迫任务制造文件。仅交付明确登记的产物，保留结果状态、摘要、限制和来源身份。

## 2. 已检查代码与缺口

| 所属代码 | 事实与计划 |
| --- | --- |
| `executor-tools.ts`、`execution-runner.ts` | submit_result.artifacts 只有路径数组；finish 生成产物 ID、名称、CAS、workspace_path，无逐项解释。增加向后兼容的结构化绑定。 |
| `scopes.ts`、`effects.ts`、`task-triggers.ts` | Execution.workspace_binding 已冻结 DIRECTORY/NONE root_path，Shared 使用 Task 的实际独立目录。复用它，不让 TUI 推导目录。 |
| `artifact-path.ts`、`application-service.ts`、`task-planning.ts` | 公开元数据只有 relative_path/path_base/scope_id；task_query 能读真实结果。增加来源根、当前路径与独立当前文件状态，保留快照状态。 |
| `main-loop.ts`、`timeline.ts`、消息正文/显示投影 | main.message 有模型输出及 display_call_id，无产物交付关系。将交付元数据持久绑定到最终 Main 回复并覆盖恢复。 |
| `tui/input.ts`、`app.ts`、`view.ts`、`remote.ts`、`clipboard.ts` | 尚未注册 /open、/paste；已有 Main 呈现、按键和页面门控。增加本地命令与同一回复的尾部组件。 |
| `tui/state.ts`、`delivery.ts`、`draft.ts`、`editor-bridge.ts` | Draft/Pending 仅文本。扩充有序附件和未完成导入的持久归属、相等比较、代次、恢复与清理。 |
| `attachments.ts`、API 路由、附件正式文档 | 导入 202 只是预留；requests/{id} COMPLETED 才返回附件 ID。消息使用有序 ID、原身份重试。复用现有系统。 |
| 已安装 Pi native-platform | getImage/getText 区分 undefined 不可用、null 无内容、Promise 拒绝为失败。读图方法存在不等于终端手势已验收。 |

## 3. 登记产物与 Main 回复绑定（R4）

1. 保留路径数组 `artifacts`，增加 `artifact_descriptions: {path: string, description: string}[]`。**新的 submit_result 调用有产物时，必须每项恰有一个非空解释**；工具 schema/运行时在任何快照/finish 前强制校验，不只靠提示词。仅零产物调用可省略。已存旧路径数组 TaskResult、持久工具结果重放不重新校验、不改历史。这是数据向后兼容；新的无解释路径调用明确报错。Task 模型生成解释，Host 在同一结果绑定到真实 Artifact ID。标注“Task 模型解释 / NOT_VERIFIED”，不冒称独立验证。旧缺失如实不可用。
2. 显式新增词法路径规范化，不声称 relativePath 已有此功能。拒绝绝对/穿越/空/控制字符输入，验证/快照前规整 `.` 段，存 canonical workspace_path，拒绝重复；解释路径使用同一函数。新调用最多 32 产物/结果，每解释 2,000 Unicode 字符、解释编码总量 64 KiB。历史安全 `.` 路径可只读规范化而不改存储。NFC 只能作比较别名，**不能改写文件系统路径**；规范化碰撞但实际不同的路径仍判歧义。打开保留实际 Unicode/大小写。
3. 既有产物/task_query 视图增加 result_id、description 与计算出的 source_root/current_path/current_state/observed_at/不可用原因。不把当前可用性或解析路径存入 Artifact/TaskResult/交付事件。只从来源 Execution 不可变 workspace_binding.root_path 和登记路径纯计算，不调用会建目录的 Scopes.binding()，不调用 rootFor()/directoryRoot()；无修改地检查路径组件符号链接和普通文件。旧 binding 缺失不可用。快照 state/content_version 分开，并在正式文档明确：快照可用不能证明当前文件可用。
4. 自动交付**仅来自本轮 Main 实际 CLAIMED 的 RESULT Feedback**，去掉 task_query 来源，状态查询不重复交付。真实登记项按 Feedback/结果/登记顺序去重。新增 `main.delivery` 伴随事件，只保存有序 `{task_id,execution_id,result_id,artifact_id}` 引用及 main.message event ID、display_call_id、loop ID。与原样 main.message 在**同一 store.commit** 写入。不改 messageIdentityHash，不把 UI 元数据放入 provider Context/摘要/设置内容。
5. 绑定本轮无工具调用的终结助手回复：`stop` 或 `length`。length **仍明确显示截断**，其真实登记结果条目可以显示，不宣称正文完成、不新启模型重试；固定上游会正常结束 length 轮，若不显示尾部将丢失已 HANDLED 反馈。error/aborted 不附交付，Input 仍 CLAIMED、恢复重新构造候选。工具续轮/预览不附。用消息 event/call/loop 身份识别已提交 sidecar，防重。覆盖成对提交前崩溃、成对提交后 finish 前、已有正常终结回复重放、失败/截断/空正文。**#94 不改既有仅 stop 的重放策略。** 当前 Context 指针、main.message、适用的 sidecar 同一提交，交付独立持久，业务恢复不依赖显示数据。测试提交后 finish 前崩溃：stop 正常恢复；length 保留 #80 已知 RECOVERY_BLOCKED，但持久产物仅显示一次，不新增重复交付事件、不虚报批次完成。另测无交付的 length，保留相同基线恢复结果。“持久 length 后 finish 前崩溃”的通用修复明确不在本批，交 Master 另行协调；#94 验收不以该修复为前提。带交付的空正文消息也显示。main.delivery 接入同步的 timeline 失效；成对保存失败不得宣称交付完成。
6. 消息/timeline DTO 提供有界交付摘要/数量与游标。最小新增只读投影 `GET /api/v1/messages/{id}/artifacts`，校验归属，稳定游标，每页最多 20 条且编码不超过 128 KiB；按字节减少条数，不截断解释/ID。用不可变引用解析解释和当前路径观察，不读 CAS 内容。无事件的旧记录不伪造交付；多结果/跨页不能遗漏。既有 /artifacts/{id} 继续作为产物元数据权威。
7. 青色且带文字标签的分页产物区放在**同一 Main 回复实际末尾**；正文窗口到尾后才显示，截断/空正文仍保留状态标记。路径/解释用 safeText/visibleMatterText，显示不可见/双向字符，存储/打开字节不变；控制字符路径拒绝打开。产物文本/元数据计入既有 4 MiB 驻留及 API 响应预算，按锚点淘汰/补读，不静默丢项或反复渲染加载。测试响应上限、大清单、跟随/选择、重连及记忆/设置消息身份不变。

## 4. `/open` 语法与当前文件（R4）

- 仅 Main 普通态，命令名不区分大小写、参数保留。一个 ASCII 空格后整体为字面路径，保留内部空格/中文。不解释 shell 引号/波浪号/环境变量/通配符/URL，不剥引号。拒绝空/NUL/控制字符/换行/超长。示例：`/OpEn /absolute/中文 目录/Report.txt`。
- 绝对路径直接定位本机普通文件，no-links 检查且拒绝目录。防止 LaunchServices 执行 Task 写的启动文件：有任何 execute 位就拒绝，仅允许文档后缀 `.txt .md .csv .tsv .json .yaml .yml .log .pdf .png .jpg .jpeg .gif .webp .docx .xlsx .pptx .odt .ods .odp`，不区分大小写。其他类型包括 .command/.tool/.terminal/.webloc/.inetloc/.fileloc/.jar/.py 局部失败，不自动改成 Finder reveal 或其他文件。该保守类型策略纳入 Master 计划批准。它不是任意系统文件关联的沙箱：单文件“打开方式”（包括 resource-fork 元数据）可能让允许后缀也交给启动器，此情形尚未本机实测，该具体 LaunchServices 剩余风险列入 Master 批准说明。它也不能消除 OS 检查/打开竞争，结果必须如实说明。
- 固定 `spawn('/usr/bin/open', [absolutePath], {shell:false})`，5 秒超时，处理启动/退出错误，分发前再检查存在性/类型/权限。退出码零只代表系统接受，实机验收确认内容。增加原生负例：登记 run.command 及带 execute 位文件，各只提示一次、不启动进程。
- 裸相对路径使用 GET artifacts 的**Core 精确元数据筛选**：`relative_path=<规范路径>`，可选 `execution_id=<完整UUID>`，按当前 session 归属过滤。增量元数据索引先筛选再做快照 lstat，不让客户端扫全域，只分页匹配结果。唯一来源根/路径才能定位，不同根报歧义要求完整路径。不使用页面/选中项/cwd。历史同根同路径可共用当前目标，缺 binding 不猜。
- 支持 `/open --execution <完整执行UUID> <相对路径>`：校验可访问 Execution 和登记路径，按冻结根解析。这是来源限定，不实现 artifact-ID 打开。
- /open 和剪贴板共用 `tui/clipboard.ts` 门控：darwin 且 SSH_CONNECTION、SSH_TTY 都不存在。CoreClient 已核对本地 endpoint 身份和 loopback；不声称支持转发的远端文件系统。不支持环境明确报错。
- 异步解析/打开不阻塞编辑；失败提示一次，**5 秒或下一次用户动作，先到即清**，token 防旧 timer 清新提示。不写 Main 消息/Input/业务 UI 审计。只消费未变化的提交命令快照，保护后续编辑和全部材料。TUI/Core 继续。

## 5. 剪贴板入口与草稿归属

### 登记行为（R4）

- 每次读剪贴板都先核对本机 macOS/非 SSH，再探测类型。**只有实际图像数据存在时**，才在读取图像字节前核对 Core capabilities.attachments（allowed、formats、limits、import_allowed），发送图片前再检查。纯文本 `/paste` 为本地操作，没有 vision profile 或 Core 断线也可用；图像能力未知/断线明确报错，不可授权导入。记录 macOS 剪贴板授权提示，不绕过。
- 直接粘贴候选键：**Ctrl+V**。仅 Main 普通态，由 Secretary 在 Editor 之前处理；先在实际目标 Terminal 验证收到的键值。未验证前只是候选，不能声称所有终端可用。用 matchesKey 识别 legacy/modifyOtherKeys/CSI-u。只允许普通 Main 编辑器/草稿附件行；历史阅读或事项行焦点须先返回编辑器，不读剪贴板。显式手势调用 getNativeClipboard().getImage()，只导入图片、不发送。无图、读取失败、能力不可用分别提示。
- Cmd+V/终端 bracketed 文本粘贴保持 #91 行为，图片路径仍是文本；不在每次文本粘贴时嗅探剪贴板或替换成图片。`/paste` 为明确辅助命令：先区分 pasteboard 类型，再读图；有实际图像则导入；getImage 返回 null 才读文本，经 PasteDocument 在位置 0 替换未变化的整个 `/paste` 命令，标记 paste 来源；异步读取期间若用户改了快照，保留新草稿和捕获文本为可恢复材料，不覆盖新草稿。普通路径/URI 文本仍为文本、不解引用；实际 pasteboard 文件引用明确拒绝为“文件引用，不是图像内容”，不导入图标、不退回文字。图像能力不可用或读图失败就报错，不偷偷降级；没有文件引用、确为图像与文本共存时图优先，不额外导入文件名文本。
- 使用系统自带 `/usr/bin/osascript -l JavaScript`，运行仓库固定 JXA 脚本，经 Objective-C/AppKit bridge 读取类型/changeCount。固定 argv、shell:false、3 秒超时、stdout/stderr 各有界 64 KiB；严格解析仅 types/changeCount 的 JSON。不插入剪贴板文本/用户路径/脚本，不解引用文件，不替换 Pi 转图。getImage 前检查 public.file-url/旧文件名类型，之后再次比对 changeCount；文件引用、探针未知、剪贴板变化均局部拒绝、零导入。类型探针失败时整个 `/paste`（含文本）失败，因为无法排除文件引用；这不同于成功识别的纯文本，后者不需要 Core/vision。不新增编译原生 helper、构建依赖、分发/签名流程。脚本缺失、系统拒绝权限、超时、无效/超大输出、bridge 失败均明确能力/读取失败、零导入。macOS CI 验证固定参数与结果/错误处理；真实权限/类型行为仍由实机验收。原生验收包含 Finder 复制图片/非图片文件、Preview 复制实际像素、PNG/TIFF、图文共存；Finder 图标行为目前未实测。
- `/paste` 无参数且必须整个命令草稿（允许尾部水平空白，不允许额外文字/行）；补全只编辑。Task 的 /open、/paste、/send 局部报错，Task 直接图像手势不能读取/导入/发送 Main 材料。授权、问题、失败详情、加载态拒绝图片入口及命令分发，不能跨事项。保留 /rawmessage、手写/粘贴斜杠规则、双草稿、Enter 换行、Shift+Enter 发送、Ctrl+C 清空/退出与撤销。
- Main 草稿内最小附件行显示名称、就绪/导入中/失败、本地 ID、错误，不另建页面或管理菜单。有材料、Main 普通态、无补全菜单、无手写开头斜杠命令时 Tab 才可聚焦附件行，否则补全优先；方向键选行，Enter 回编辑器，Backspace 或前向 Delete 明确从未发送草稿移除所选行，Escape 不改动返回。普通打字返回编辑器并传递该键；附件行 Ctrl+V 使用相同 Main 草稿及门控。显示按键提示。冻结的 pending-send 绑定不可移除，只提示送达未确认。失败尝试需要明确移除；有未解决/失败图像时阻止发送，不能默默只发文字。移除只解除草稿引用，不删除保留材料/附件对象。Ctrl+C 只清文本、不暗中丢图；退出前落盘。

### 导入与发送状态机

1. 捕获 Main 草稿/数据域并分配持久本地图像尝试 ID。读取真实图像字节，按现有限制预检，在 TUI 数据域自有 0700 目录内排他创建 0600 PNG 暂存文件。fsync，先保存路径、大小、SHA256、导入 request ID 和完整请求，再发出请求。计划阶段不读取当前私人剪贴板。
2. POST attachments/import 返回 202 只标 IMPORTING。GET requests/{id} 对账，PENDING/QUEUED/网络不确定期间保留源文件；只有 COMPLETED 且附件结果/元数据验证后才 READY。导入重试维持原 ID/body；FAILED 不等于已导入副本。直接同步准入 INVALID_REQUEST、ATTACHMENT_TOO_LARGE、ATTACHMENT_CAPACITY_FULL 在预留/回执前失败，标记本地尝试 FAILED 并保留源，不一直显示 IMPORTING。超时/网络错误仍为 UNKNOWN，以原身份 requests/{id} 对账。确认拒绝后的显式重试，仅在告知前次未受理后才新建尝试身份，不自动循环；不确定时不换身份。断线/重启仍保留 Core 可读源材料。
3. 串行导入准入，防多次粘贴超出数量/字节限制。异步边界复查数据域、目标草稿归属、事项/页面。文字编辑期间完成导入，追加到原 Main 草稿而不替换正文。若发送或草稿替换已转移归属，新图保存在独立可恢复草稿材料记录，不附加到冻结请求、不丢弃、不转入 Task/问题。可以切页，但 Task 手势不能变成 Main 导入。
4. LocalState 升至 v3，loader/saver/不可变复制/collector 识别 v3、保留升级前备份并拒绝不安全降级；v1/v2 文本草稿迁移为空材料列表。失败/未解决尝试与 READY 有序附件 ID 分开保存；重启复原，未完成导入用原身份对账。编辑/相等/代次/复制/恢复均纳入材料身份，异步保存使用不可变快照。明确替换 Delivery.reconcile/check、持久写后清空、acceptCheckpoint、release 的仅文本判空/相等；READY/导入状态变化增加 generation，纯图草稿不算空。tui-export-v1 在 draft/pending/recovery 含图或未完成尝试时拒绝导出，不能丢图；collector 识别暂存图片文件名并保护全部活跃引用，含恢复/outbox。
5. 有图时 Pending.body 冻结 `{request_id,text,attachment_ids}`，纯文本保留旧形状；发送前可靠保存有序 ID 和完整富文本快照。允许纯图 text=""，带图但仅空白正文在本地拒绝。真正空文字加 READY 图时 Shift+Enter 明确发送纯图；`/send` 和 `/send `（单个尾部分隔空格、载荷为空）均发送纯图，更多空白载荷拒绝。无正文 `/send` 发送当前就绪纯图草稿；`/send <正文>`、`/rawmessage <正文>` 保留现有字面正文语义并带同一草稿附件。粘贴/选择行/补全均不隐式发送。
6. 重试比较整个规范载荷，不只比较文本。超时/断线/未知结果维持原 request ID 和顺序，新文字/新图留在新草稿。先对账回执；按已核实的权威错误码而非 HTTP 类别分准入错误：ATTACHMENT_BUDGET_UNCONFIGURED、ATTACHMENT_MODEL_UNSUPPORTED、ATTACHMENT_TOO_LARGE、ATTACHMENT_NOT_READY、ATTACHMENT_UNAVAILABLE、ATTACHMENT_BUDGET_CONFIG_INVALID、ATTACHMENT_INVALID_IMAGE_BLOCK、同步消息准入的 CAPACITY_BLOCKED 及既有明确输入错误，只有核对其源码路径不创建回执时，直接响应才恢复完整草稿并释放 pending。不能把任意 500/503/代理响应当明确拒绝；未知网络/其他暂态保留 pending，REQUEST_CONFLICT 冻结。实施时从准确 HEAD 的 host.accept 及 attachment/vision/budget 调用路径导出完整准入分类表，不将此处列举当穷尽。对全部已识别同步错误做表驱动负例，新出现未分类准入码使覆盖检查失败；网络或受理边界不明错误保持未知/暂态。API schema 验证在回执查找之前，业务准入在查找之后；冻结请求 schema 必须保持可重放。恢复文件包含有序附件 ID/材料引用。恢复请求已有 accepted 回执时优先于后来的验证错误，先对账、不改原身份。已接受仅清对应已提交代次/材料，保护后续编辑。Editor 清空不是 Core 接受；保留既有持久 outbox 交接语义。
7. 导入失败保留手写、文本块、原 READY 附件并指出失败图片；读图失败不声称已有副本。业务发送失败保留所有已导入附件及原请求。崩溃覆盖：源写完未 POST、202 未完成、完成未标 READY、本地 outbox 已写未收到回执、接受后未清理。
8. 仅成功持久导入后可释放对应暂存文件；失败/未交接材料沿用默认三个日历年及活跃引用保护。可靠接受的文本副本按既有规则及时清理。不批量清 temp、不新建 CAS 清理器、不删 Task 工作目录；Shared 文件和未登记中间文件保留。

## 6. 获批后的实施顺序

1. 刷新 main 并冻结实际 SHA/计划差异，登记环境和验收前提。安全检查现有模型配置/能力，不输出凭据。规划预检未发现仓库 .env 或导出的 SECRETARY_VISION_BUDGET_PROFILES；本地注册表显示既有 opencode-go 默认 Main deepseek-v4.1-flash、Task gpt-5.6-luna 支持 image，但不等于 provider 执行证据。批准须明确涵盖沿用这些现有模型选择，并仅在隔离验收进程准备有依据的 vision budget profile；获批后根据 provider 文档/能力证据确定，若无法得到可信上限，停止 vision 工作并报告具体阻塞，不编造数值、不改生产设置。核对实际模型 vision 及精确预算 profile；不可用则报告具体阻塞，请 Master 决定必要模型/profile，不臆造预算、不做设置 UI。
2. 实现合同/元数据/结果绑定和持久 Main 尾部，补针对性测试；同步 canonical `src/contracts/contracts.schema.json`、生成类型、`docs/api/v1/schema.json`、生成 API 类型及正式契约。
3. 实现当前文件解析、/open、提示生命周期和作用域测试。
4. 实现剪贴板、暂存导入、持久材料/outbox，再接直接手势、/paste、附件行与发送恢复。复用现有 Core 导入/消息 API。
5. 增加聚焦离线测试及 macOS CI 测试选择；运行完整 `npm run verify`、生成文档及 diff 检查。默认 npm test/CI 不运行付费模型。
6. 完成有界真实模型/原生验收，保存失败与修复证据；在**同一 Claude 会话**对准确 PR HEAD、CI、证据进行实施复核。复核后代码变化须补对应验证并交回 reviewer。交 Master 终审，不自动合并或关 issue。

## 7. 验证与真实模型验收（全部未执行）

| Gate | 必需证据与失败判据 |
| --- | --- |
| A：结构交付 | 精确 Task/Execution/result/artifact ID、模型逐项解释、Main 最终回复尾部/颜色、分页/重连/重放，无合成消息。旧缺失如实显示；只做摘要或提示词不通过。 |
| B：当前文件 AC22/23 | 实际 Terminal（另测启动器/execute 位拒绝及 SSH 不读剪贴板）：两个不同根 Task 生成不同 report.txt，含中文/空格/大小写路径，至少一轮多产物。修改已交付文件，证明 CAS 摘要未变，/open 实际看到修改后的内容。两个绝对路径及限定来源的相对路径都打开。删除一份验收文件，观察一次 5 秒错误后 /help，Core/TUI 继续。另记外部程序失败/路径歧义。 |
| C：Shared AC33 | 两个真实 Shared Task 各登记不同 report.txt 并留下未登记中间文件；只交付登记文件，分别打开正确路径，完成后目录/文件仍在。合并 #83 分组/独立目录证据后才标全项 AC33。DIRECTORY 另做聚焦测试及一个真实任务。 |
| D：原生图片 AC32 | 实际 macOS Terminal 先写文字，用非敏感合成 PNG/TIFF 作真实系统剪贴板来源，不先输入导入命令，直接手势、真实导入完成、明确发送。关联 import_request_id→attachment_id/digest→消息 request_id→Input→实际 vision adapter 图像块/provider 回复。仅图标/文件名、仅 /paste、浏览器、HTTP fixture 均不能通过。 |
| E：失败保留 AC32 | 合法剪贴板捕获后，在隔离验收 harness 中注入暂存源摘要不匹配以触发真实 Core 导入拒绝；另测本地超限/格式拒绝；另在成功导入后制造消息响应丢失/失败。保留手写/文本块/READY 图，区别失败尝试，原不确定 request ID 恢复，只接受一次业务 Input。补断线/离线/重启/编辑竞争，不得丢图只发文。 |
| F：作用域 AC24/31 | /OpEn、/PaStE、Task 错页/直接图像、事项/加载态、/send/rawmessage、帮助/补全、Ctrl+C/撤销/发送/换行。安静 session 前后时间线对照，本地打开/错误不进入业务历史。 |
| G：真实模型复核 | 真实 Main 创建验收 Task；真实 Task 模型写入/登记产物和解释；真实 Main 根据结果回复。支持 vision 的真实 Main 接收粘贴图片，回答文本中未泄露的新视觉特征。代码/fixture 不替代。Claude 核查准确 HEAD 及脱敏关联证据，分别说明 Claude 阅读与 Codex 实际执行。 |

执行前登记：被测 SHA、Pi/Node/macOS/build/终端版本、字体、列行/窗口尺寸、本机或 SSH、键值与动作、图片来源/摘要/尺寸/格式、Finder 文件引用负例/剪贴板权限提示、真实 provider/API/model/baseURL 身份（无凭据）、vision 能力与精确 profile 依据/版本/上限。规划机器已观察 Node v22.22.0、macOS 15.8.2 build 24H225；终端/字体/尺寸/模型就绪仍未验收。

Live 只做一次可复现正常链路与要求的失败，使用 `.demo-data/issue94/` 下全新独立数据域，不用 Master 原数据域。两个 Shared 加一个 DIRECTORY Task 足够，不允许自行替代/多建任务。文件操作限验收根，不涉及公网暴露。复用 checkedStream/boundedTools/modelLifetime 关闭方式。拟定跨尝试总硬上限：**48 Main 调用、32 Task 调用、160 工具执行、25 分钟活跃 provider 工作、每次最多 8192 输出 token**；provider 重试纳入账本。先中止 model lifetime 再等待关闭。触顶即停，保留首败及精确调用记录；追加付费预算须 Master 批准。上限不是调用目标。不压低图像估算或修改生产设置凑通过，开始前核对模型真实输出/上下文设置。

若真实目标终端与可用本机适配确实不能产生直接图片手势，记录环境、尝试与现象，继续独立工作，此时才问 Master 替代。标 BLOCKED/NOT_TESTED，不能用 /paste 或浏览器变 PASS。没有已配置 vision 模型/profile 时真实图像验收同样阻塞，不能关闭 #94，也不能把缺失的图片/路径功能转交 #84。#94 正文及 Master 明确真实模型要求优先于旧 #81 文档延期到 #84 的说明；#84 保留组合最终验收。

额外验收限制：默认 4,194,304 像素/单边 4096 可能拒绝全屏 Retina 截图，错误须说明实际限制并保留其他材料，不自动缩图。验收 Task 不留后台进程；既有 finish()→RESULT_UNKNOWN 路径可能丢弃提交结果、后续 FAILED 且无产物，记录边界，不在 #94 修改进程生命周期。

## 8. 证据、文档与批准含义

英文请求/原始回复/截图和运行日志保存在 Git 忽略的 `.demo-data/issue94/review/`、`.demo-data/issue94/acceptance/`；脱敏记录放 `docs/fix/evidence/issue94-delivery/`。保留首败及成功复跑、哈希/ID，不放凭据或私人图片。

同步 `docs/tui/api-coverage.md`、共用键位表、运行测试说明、正式产物/消息/附件文档及本地化生成页。逐项登记实际 route/参数/来源对象/UI/失败/证据：Task/Execution/result/artifact 元数据及精确路径筛选、messages/{id}/artifacts 分页，messages/timeline/content，attachments/import、requests/{id}、attachments/{id}、消息提交、同步与重连。产物 content/快照下载明确不用于 /open；附件 content 下载无实际独立 UI 需求就登记未用。系统打开为客户端能力。保持 #92/#93 API 职责，不为未用管理接口补菜单。有 #94 真实证据后修正文档中将 vision 全部推迟到 #84 的旧说明。

批准不包含 #80 已知持久 length 崩溃恢复修复。批准范围包括新增结果/消息元数据、本地状态迁移、精确打开/剪贴板语义、草稿附件行操作、实施后有界付费 live 验证。本轮不实施、不调用模型。源码复核 PASS 仅代表计划可执行。实施完成需针对性/完整检查、准确 HEAD 的 Linux/macOS/aggregate CI、真实模型及原生验收、同会话 Claude 复核与 Master 最终判断。合并仍另授权。
