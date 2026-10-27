# Secretary TUI 需求书与现有后端改造评估

版本：v1.0（2026-10-23 Master 裁定版）  
日期：2026-10-23  
代码基线：ExplodeCode6324/Secretary，main@12e028a049122035f86d5cbf930516157c9bb72b  
发布范围：确定 TUI 需求、复用评估和分阶段实施 Issue。  
原发布边界：需求发布时未执行 Tauri 删除或 TUI/Core 实现；按下列 Issue 顺序领取。

实施更新（2026-10-23，#79（PR #85））：已删除旧客户端和专属设施，并调整文档检查与多语言入口；新 TUI 尚未实现。实际验证与本地状态处置见 [#79 实施记录](../fix/evidence/issue79-retirement/implementation.md)。

实施纠偏（2026-10-28，#82 有限回滚）：Master 明确要求真实终端 TUI；浏览器入口、服务器和网页输入层退出正式路径，当前终端候选见[运行指南](terminal-guide.md)。保留 #79 退役、#80/#81 Core 能力及 #82 编辑/持久化/发送/同步主体；旧浏览器草稿和发送记录须原样兼容，尤其 UNKNOWN 不得清空。历史 R7 浏览器选择不能覆盖本次裁定；原生验收仍 NOT_TESTED，见[验收步骤](terminal-acceptance.md)和[修复计划](../fix/fix_20261028_issue82_terminal_rollback.md)。下文“旧客户端数据弃置”仅指 Tauri，不能用于 #82 记录。


总路线：[#57](https://github.com/ExplodeCode6324/Secretary/issues/57)。

本文件以 Master 在 2026-10-23 的七项裁定为当前规范，替代 v0.1 中对应的待定项；具体框架、键位和容量数值由实施者在此边界内确定并记录。源码结论均针对上述固定提交；没有运行应用、自动化测试或真实模型调用，因此“已有实现”不等于“新 TUI 已验收”。

## 1. 结论与迁移方向

1. 从零实现 TUI 客户端，复用现有本机 HTTP/SSE 接口和独立后台 Core。现有 Host、Scheduler、Store、公共契约和同步机制继续使用。
2. 全局底部输入区的外观固定，消息路由按当前视图决定。Main 普通文本发往主会话；功能页只有允许的命令能够提交，向 Main 发消息必须显式使用 /send。
3. 多行粘贴的折叠和文本交换文件可以主要在 TUI 实现。Core 已有可靠接收与持久化机制，取得原请求的可靠接收回执后即可清理临时文本副本。
4. 结构化用户引用明确延期。首版粘贴展开为现有 text 正文；图片所需附件契约单独实现，不扩成通用引用系统。
5. 图片附件是当前真正缺失的后端能力，需要补齐导入、登记、消息关联、模型内容转换和恢复链路。单有本地图片路径不能完成模型输入。
6. 取消命令必须显式指定目标：`/cancel --request <task_request_id>` 或 `/cancel --execution <execution_id>`；两者必填且互斥。首版复用现有取消接口，不新增整个 TaskPlan 的聚合取消。
7. 新 TUI 继承可靠发送、重连和阅读恢复要求；旧客户端代码直接删除，未发送数据直接弃置，不做数据迁移。
8. 顺序保持为：需求与 Issue 对齐 → 冻结及清理 Tauri → 后端必要适配与缺失功能 → TUI 构建及真实可用验收 → 原定性能优化。

本轮不把界面替换扩展为 Core 重写、存储选型迁移或远程客户端工程。

## 2. 已确定范围与首版裁定

### 2.1 Master 的七项裁定

| 裁定 | 实施规则 |
| --- | --- |
| 取消必须带参数 | 首版固定显式对象类型和稳定 ID；`/cancel --request <task_request_id>` 或 `/cancel --execution <execution_id>`，不允许无参、隐含当前选择或猜测目标 |
| 结构化引用延期 | 多行文本仍使用 text；不实现 reply_to、引用消息跳转、自动视图引用或通用 references 系统 |
| 不要求完整菜单 | 按日常 Main/Task 闭环建设；每个 Issue 完成时说明本次使用/新增 API，以及当时仍未被 TUI 使用的 API |
| 默认简略 CoT，/cotvisible 展开 | 首版采用非脱敏可显示 CoT 的前 20 个用户可见字符；若已有直接可用摘要可复用，不额外调用模型生成摘要；/cotvisible 切换完整展开/收起 |
| macOS 优先，Linux 延后 | 首版 TUI 只以 macOS 主用终端验收；Linux TUI 记为 deferred/NOT_TESTED；Core Linux CI 保持必需 |
| 默认保存期限三年 | 新 TUI 临时/孤立记录默认保留三个日历年，明确起算和活跃引用保护；已可靠接收文本副本仍及时清理 |
| 旧客户端未发送数据不保留 | 旧 Tauri 草稿/outbox/cache 可直接弃置，不备份、不迁移、不导入，不为其保留旧客户端 |

取消语法是根据“参数必填”裁定选取的首版确定性规范；task_request_id 是被操作的任务请求 ID，与这次取消命令自身的幂等 request_id 不同。未来增加任务级操作须另立需求。

### 2.2 保留的产品要求

| 编号 | 要求 | 首版边界 |
| --- | --- | --- |
| R01 | 固定底部输入区，默认 Main | 外观固定，路由随当前视图改变 |
| R02 | 功能页显式 /send 才向 Main 发送 | 普通文字保留草稿；不自动附带浏览上下文 |
| R03 | 大写命令导航，小写命令操作 | 全局与页面作用域明确登记 |
| R04 | 确定性解析、稳定 ID、参数和补全 | 不调用模型猜测命令或目标 |
| R05 | 独立提交命令、强制纯文本 | 不扫描消息/粘贴/输出中的命令样式 |
| R06 | 多行粘贴折叠 | 保留完整正文和顺序 |
| R07 | 有界临时区 | 可靠交接后清理文本；其余临时/孤立记录默认三年 |
| R08 | 图片/本地路径与剪贴板附件 | 正式非文本附件先保留；不做内嵌批注或媒体编辑 |
| R09 | 外部打开产物 | 复用 VS Code 或系统查看器 |
| R10 | 可选语音模块同步草稿 | 不自动提交；缺席不影响文本使用 |
| R11 | 信息减法、简单布局 | 不继承 PhaseUI 复杂动效 |
| R12 | 同机 TUI + 后台 Core | Ubuntu 只提供模型 API/fallback |
| R13 | 不做一次性业务 CLI | 未来只读/Task 入口不授予 Master 消息写入能力 |
| R14 | Portable 独立 | 本次不交付 Portable 或桌面系统提醒 |
| R15 | 直接退役 Tauri | 旧代码依 Git 历史追溯，仅保留 Core 与必要适配层 |
| R16 | 性能优化后置 | TUI 真实可用验收后按 #70→#71→#72→#73；#74 依数据决定 |

### 2.3 允许在实施时决定的细节

TUI 框架、主用 macOS 终端与具体提交/换行键、容量上限和读取批量，由实施者做小范围验证并记录。优先评估复用 TypeScript CoreClient/生成 DTO 的路线，不预先承诺未测的终端能力。无需为了框架选型建立新的客户端平台工程。

每项实施 Issue 的 API 使用报告和 [累计清单](api-coverage.md) 必须以当时的 docs/api/v1/operations.json 为依据：列出已使用/新增的操作、仍未被 TUI 使用的操作及原因。未使用是范围记录，不自动生成菜单需求，也不是结项失败。尚无 TUI 时可明确写“当前无 TUI 消费者”，并链接完整操作表。

### 2.4 首版排除范围

结构化用户引用、自动视图上下文注入、一次性业务 CLI、整个 TaskPlan 聚合取消、远程 TUI、Linux TUI 验收、内嵌媒体编辑/批注、精确网页/PPT 审阅、图形拖动、复杂动效、桌面提醒、Portable 软件均延后。

全历史全文搜索、任意记忆编辑、模型热切换、Main 停止生成也不由此次换界面自动引入。已有 API 不要求一对一建设完整菜单。

## 3. 输入、路由与命令契约

### 3.1 路由规则

| 当前视图与输入 | 提交结果 | 是否进入 Main |
| --- | --- | --- |
| Main：普通正文 | 按现有消息接口提交 | 是 |
| Main：独立且合法的斜杠命令 | 执行该命令 | 仅命令明确要求发送时 |
| Main：强制纯文本模式的 / 开头内容 | 原样作为正文提交 | 是 |
| Task 等功能页：普通正文 | 保留草稿并给出本地说明 | 否 |
| 功能页：当前页或全局合法命令 | 按命令表执行 | 仅 /send |
| 功能页：/send 的明确草稿载荷 | 提交正文、展开的文本片段及显式加入的附件 | 是 |
| 功能页：强制纯文本 | 保留为文本草稿；仍需显式发送动作 | 否，不因纯文本模式绕过路由 |
| 任意页：未知命令、错误参数或错误作用域 | 显示本地错误，保留输入 | 否 |
| 任意页：语音、粘贴、工具输出或模型输出到达 | 更新相应显示/草稿 | 否，不自动提交 |

**IN-01**：输入区始终显示当前视图、当前输入方式和显式发送目标，避免同样的位置掩盖不同作用域。

**IN-02**：/send 是全局的显式发送入口，提交此次明确选择的草稿载荷，包括正文、展开后的文本粘贴块及已显式加入该草稿的附件。仅浏览或选中的 Task、日志、文件和页面内容不会自动附入 Main。

**IN-03**：/send 的全部文本片段只作为内容处理一次。其中的 /T、/cancel 或代码示例不能递归触发解析。建议仅附件草稿允许独立 /send 提交；无正文且无附件时本地报错。普通文本草稿可显式加 /send 前缀，不能因“已有草稿”而自动发送。

**IN-04**：切页、改变选中项、补全和展开内容都不是提交动作。建议按视图保存草稿与阅读位置。

**IN-05**：发送、取消等动作的本地 pending、Core 接收、业务执行结束分别显示。发送按钮反馈或 TUI 动画不能当作业务成功。

### 3.2 确定性命令规则

**CMD-01**：使用一个声明式命令表，记录名称、别名、可用视图、参数类型、是否需要对象 ID、执行处理器、补全器和简短帮助。解析与补全共用这份表。

**CMD-02**：命令名区分大小写。只接受登记的名称/别名，不做模糊执行、不自动纠错成另一条命令。短命令可以配置为固定别名，但不能扩大原命令的作用域和权限。

**CMD-03**：一次提交最多执行一条命令。命令参数采用固定的引号/转义语法；不支持 shell 替换、管道或分号串联执行。多行正文可作为 /send 的字面载荷，不能解释成命令脚本。

**CMD-04**：只有整次提交被明确识别为命令时才解析。消息中间的斜杠、代码块以及折叠粘贴块不触发命令扫描。未知斜杠输入不自动改作消息发送；Master 可使用强制纯文本模式。

**CMD-05**：补全覆盖当前可用命令、参数枚举、对象 ID 及适用的本地路径。补全只编辑输入，不执行操作；候选必须显示足以辨认目标的简短信息。

**CMD-06**：修改状态的命令必须绑定稳定 ID。行号、列表顺序和刷新后变化的“第一个任务”不能作为最终目标。若允许短 ID，必须唯一匹配并显示解析结果；不唯一就报错。

**CMD-07**：命令执行前固定目标；执行时 Core 仍负责校验对象状态和 revision。不能因列表刷新把正在提交的操作转到另一个对象。

**CMD-08**：粘贴事件只写草稿，不触发提交。建议把多行粘贴保持为文本块；单行命令粘贴即使作为候选，也必须有明确提交与可见的命令状态。强制纯文本应有可发现的快捷入口。

### 3.3 最小命令草案

除 Master 已举例的命令外，下表名称是可调整的交互草案，不是已经存在的 API。

| 命令 | 作用域 | 行为 |
| --- | --- | --- |
| /M | 全局 | 切回 Main |
| /T | 全局 | 切到 Task |
| `/send [正文]` | 全局 | 显式向 Main 提交字面正文及本草稿附件；建议仅附件时可省略正文，空载荷报错 |
| /help | 全局 | 列出全局和当前页命令及参数 |
| /cotvisible（/cotv 可作别名） | Main/允许展示消息详情的视图 | 默认前 20 字符简略显示，显式展开/收起完整可显示 CoT |
| `/cancel --request <task_request_id>` | Task | 只取消指定任务请求，复用现有即时请求规则 |
| `/cancel --execution <execution_id>` | Task | 只取消指定执行；与 --request 必须且只能选一个 |
| `/open <artifact_id>` | 允许查看产物的视图 | 在外部查看器打开产物 |
| `/attach <path>` | 有发送草稿的视图，建议名称 | 把明确选择的文件加入草稿 |
| /paste | 有发送草稿的视图，建议名称 | 在终端未交付图片粘贴事件时，主动读取图片剪贴板 |
| /quit | 全局，建议名称 | 退出 TUI 并保留后台 Core |

任务创建、继续、必要的审批/决策命令映射现有 API；其余菜单按需要后补。无参 /cancel、同时指定两个目标、无效 ID 或未实现的 --task 都明确报错，不以当前选中行或最近执行代替目标。

## 4. 文本粘贴与交换区生命周期

### 4.1 展示与实际内容

**PASTE-01**：多行粘贴可以显示为 [pasted 20 lines]，至少可展开、复制、删除该片段。折叠标记绑定实际内容，不能靠用户可编辑的一串占位文字去猜文件。

**PASTE-02**：混合输入、多次粘贴、撤销及编辑后，提交正文的顺序和内容保持正确。行数是展示信息，不能替代实际字节长度检查。

**PASTE-03**：提交时读取完整文本并序列化为真实消息。模型不应收到一个无法访问的临时文件路径。折叠不会减少模型上下文的 token 消耗。

### 4.2 删除边界

文本交换副本采用以下可验证的清理边界：

> Core 已可靠接收完整正文，后续处理和恢复不再依赖交换文件；TUI 已记录这个接收事实后，删除该临时文本副本。

当前 accept 会将实际文本写入 CAS，再提交 Input、input.accepted 事件和持久请求回执；ApplicationService 将 API 接收记录与首次领域变更放在同一 journal frame。相同 request_id 与相同请求重入返回原结果，改参则冲突。[S02][S03]

因此，不必等模型开始运行，更不必等回答完成。保留的是现有会话记录中的正文，删除的是 TUI 的交换副本。本文不新增独立永久 paste archive，也不把清理临时文件解释成删除聊天历史。

### 4.3 状态与清理规则

| 状态 | 必须保留的内容 | 清理规则 |
| --- | --- | --- |
| 草稿未提交 | 草稿、粘贴正文、附件引用 | 仍被活跃草稿引用的内容不自动删除 |
| 明确放弃草稿/删除片段 | 其他草稿仍引用的内容 | 删除不再被任何草稿或发送队列引用的 TUI 临时文本 |
| 已写本地发送队列、请求在途 | 原 request_id、原始请求内容与必要正文 | 不能因已调用 HTTP 就删除唯一正文 |
| 超时/断线，接收状态不明 | 原请求及正文 | 查询 GET /requests/{request_id}；不换新 ID 盲发 |
| 原请求已可靠接收 | 接收回执与已交接状态 | 记录成功后删除交换文件；重试清理应幂等 |
| Core 已接收，但 TUI 在清理前崩溃 | 可恢复的原请求身份 | 启动时对账，再清理残留 |
| 校验失败/明确拒绝、未接收 | 可修改的原草稿 | 保留至修改或明确放弃；不截断后自动重发 |
| 无草稿/发送队列引用的孤立残留 | 清理所需的最小元数据 | 按默认三年保存期限到期回收；不得为配额静默提前删除 |

**PASTE-04**：新 TUI 临时/孤立记录默认保存三个日历年，以持久暂存记录的 created_at 起算；活跃草稿或未确认交接引用期间不自动删除。已可靠接收的文本仍按成功交接规则及时删除；三年不延迟成功路径清理。容量上限可配置，实施时给出默认值与理由；达到上限时拒绝新入库并提示显式清理，不提前删除仍受保留期或引用保护的内容。用可控时钟验证到期，不引入 Core 全局历史 GC。

**PASTE-05**：临时文本只清理 TUI 自己创建的文件。Master 原有的 .txt、代码或其他源文件即使被引用，也不得按交换文件删除。

**PASTE-06**：已经可靠交给 Core 的内容，不再需要由本地 outbox 永久保存完整副本；它只需保留恢复或展示所需的最小记录。

**PASTE-07**：正常会话历史的增长继续服从既有持久化策略，不在本次引入 Core 历史 GC。临时区治理与 #74 的历史内存/启动治理是两个问题。

**PASTE-08**：草稿、待发送请求和清理凭据绑定原 Core 的 data_domain_id，并记录 API 版本与运行模式；不能仅凭某个端口或一个 request_id 跨数据域对账。连接到另一份 profile/store 时保留原草稿并隔离发送队列，不自动重投或据此清理原交换文件。不能把连接失败、鉴权失败或数据域变化当作原域的 NOT_FOUND。Core 重启导致 instance_id 改变，与 data_domain_id 改变是不同事件。[S03][S08]

### 4.4 当前输入长度限制

| 层级 | 当前实现 |
| --- | --- |
| MessageCommand schema | text 的 minLength 为 1，maxLength 为 1,048,576 |
| Main accept | 拒绝全空白，正文 UTF-8 字节数不得超过 1,048,576 |
| HTTP 请求 | 整个 JSON 请求体不得超过 1,048,576 字节 |

实际可用正文空间受整个请求体限制，还包含 request_id、字段名及 JSON 转义。因此不能称为“支持一百万字”或“正文恰好 1 MiB”。TUI 应检查实际序列化后的字节数，超限时保留草稿并提示，不静默截断或改为发送路径。[S02][S04][S05]

首版不因折叠显示而无限放宽上下文输入。若未来确需大文件检索/分片，是独立能力。

## 5. 结构化引用明确延期

首版多行粘贴按原顺序展开为规范正文，沿用 MessageCommand.text、持久化和幂等机制。先规范化并冻结完整载荷，再以稳定 request_id 提交与重试；正文哈希和请求 ID 各自承担已有职责。

因此首版能够折叠展示、完整接收、删除交换副本和恢复历史，无需新增 reply_to/references 协议。图片所需 attachment ID 属于本轮必需的附件输入契约，不因此建设通用用户引用系统。

当前 Input.payload 是正文不可变对象引用，Context Message.source_event_ids 也不是现成的用户引用协议。未来真正实现结构化引用时，需要同时处理 API/内部 schema、输入身份哈希、上下文投影、历史与恢复，而不能在 provider 请求顶层临时追加字段。[S05][S06][S07]

本轮不实施上述引用扩展，也不让 Main 自动感知当前浏览视图。

## 6. 附件、外部打开与语音入口

### 6.1 图片和本地路径

**ATT-01**：区分剪贴板文字、剪贴板文件引用、剪贴板图片二进制。普通文本中的路径不自动变成上传附件；由明确的附件动作或可辨识的粘贴类型触发。

**ATT-02**：本地路径支持空格和中文；使用确定性路径解析，不通过 shell 求值。相对路径的基准在输入区可查，不能随选中 Task 悄悄改变。

**ATT-03**：剪贴板图片可先生成 TUI 管理的暂存文件，再由 Core 导入。若当前终端不能把图片粘贴交给应用，提供 /paste 或等价显式动作作为降级入口；目标终端上实测后记录支持程度。

**ATT-04**：Core 必须读取真实内容、校验类型/大小、复制到自有持久存储并返回稳定附件身份。消息引用该身份，不以稍后会消失的临时路径作为唯一依赖。

**ATT-05**：模型适配层把图片变成实际支持的图像内容块。Ubuntu 只提供模型 API，不假定它能访问桌面机器的文件系统。

**ATT-06**：模型不支持该输入、导入失败或文件丢失时，应清楚报错并保留草稿。不能默默丢掉图片，只发送剩余文本。

**ATT-07**：非文本附件的正式持久副本首版先保留，绑定关系必须可追溯。源文件不因导入而删除；已完成交接的 TUI 提取临时副本可以清理。“先保留”不等于本轮承诺永久保留政策。

**ATT-08**：必须决定是否允许仅附件、无文字的消息。建议支持图片单独提交；现有 accept 拒绝空白正文，因此这需要随附件契约一起改，不能由 TUI 偷填一段伪造用户文字。

目前 GET /core 明确报告 attachments 为 not_supported，reason 为 UPLOAD_NOT_IMPLEMENTED。已有 CAS 的二进制能力和产物下载能力，并不等于用户附件已接通。[S03][S04]

### 6.2 最小后端附件链路

建议优先评估同机本地导入接口，路由名称在 Issue 中定稿。核心步骤如下：

1. TUI 明确选择文件，固定待导入的字节快照或可校验内容身份，并保持草稿、暂存内容和导入请求可恢复。
2. Core 将内容导入自身存储，返回可重入的稳定 attachment_id 和基本元数据。
3. 消息接收时验证附件存在、状态可用，并记录关联。
4. 输入投影、上下文预算、模型适配和历史恢复都识别这种内容；不得仅在首次发送时临时读取文件。
5. timeline 可显示文件名、类型、状态及外部打开入口，不建设内嵌媒体编辑器。

附件导入与消息提交分别使用不同的稳定 request_id，并在草稿/outbox 中记录关联。当前请求身份在整个数据域内共享，指纹包含路由和正文；两个不同动作复用同一 ID 会冲突。同一导入请求重试时，不能因原路径的文件已经变化而静默导入另一份内容；应使用保留的快照，或校验失败后明确报错。未完成交接前保留所需暂存字节。[S03]

现有 HTTP JSON 总大小限制不适合把较大图片直接做 base64 后塞入原 messages 请求。采用本地路径导入或单独字节接收，都应让消息请求只携带已登记的引用。具体方案需核对 CAS 写入与崩溃恢复，保持原有可靠接收边界。

### 6.3 外部查看器

**ART-01**：复用 artifacts 列表、详情及 content 下载接口。TUI 将产物导出到自己的可管理缓存，再调用系统查看器或配置的 VS Code。

**ART-02**：历史产物可有受校验的不可变内容；打开工作区当前文件与打开历史产物快照应标明差异，不能仅凭同名路径互换。

**ART-03**：调用外部程序使用程序名与独立参数，不把文件名拼成 shell 命令。启动失败、缺少查看器或产物不可用时，显示原因和可用路径。

**ART-04**：首版不自动监视外部编辑或回写 Core。关闭外部查看器不影响任务生命周期。

现有 API 已提供带长度/哈希校验的产物下载。CoreClient 当前缺少便利的二进制下载方法，可补一个小型客户端方法，无需重建产物后端。[S04][S08]

### 6.4 可选语音模块

**VOICE-01**：提供独立的“更新指定草稿”接口，至少关联草稿身份、目标视图、版本和转写状态。具体 IPC 方式由模块接入时决定，不要求经过 Core。

**VOICE-02**：转写只能形成或更新草稿。不会自动发送、执行斜杠命令、切换页面或获得 Main 写入能力。功能页的转写草稿必须通过显式 /send 提交，强制纯文本模式也不改变该路由。

**VOICE-03**：切页或手动修改后，旧转写不能覆盖新的输入；使用草稿版本/目标校验处理迟到结果。

**VOICE-04**：语音模块未启动、断开或报错，文本输入和命令仍正常。TUI 首版提供并验证接入接口，独立语音引擎的建设不成为文本可用的前置。

## 7. 信息设计、会话可靠性与运行边界

### 7.1 最小显示字段

| 视图/对象 | 默认显示 | 按需展开 |
| --- | --- | --- |
| Main | 消息正文、发送/完成/失败状态、正在执行的关键活动 | 已有可显示的推理内容、工具详情、引用与产物 |
| Task 列表 | 稳定短 ID、目标摘要、状态、是否需要 Master 处理 | scope、时间、请求/执行历史 |
| Task 详情 | 完整目标、当前执行/等待状态、最新结果、可用操作 | 约束、验收、计划、执行明细 |
| 审批/决策 | 稳定 ID、真实问题或行为、影响范围、当前状态 | 完整参数、理由、相关任务 |
| 产物 | 名称、类型、所属任务、可用状态 | 路径、大小、历史版本信息 |
| 输入区状态 | 当前视图、命令/文本方式、发送目标、附件/粘贴数量 | 补全说明、草稿恢复信息 |

**VIEW-01**：不把所有后端字段同时显示成仪表盘。更多细节通过命令和展开读取。

**VIEW-02**：默认只显示已有可用摘要，或非脱敏可显示 CoT 的前 20 个用户可见字符；首版固定采用前 20 字符即可满足要求，不新增模型摘要调用。/cotvisible 显式展开/收起完整可显示内容，/cotv 可作别名。无内容/脱敏内容不得虚构摘要；此命令不改变模型思考开关、预算或调用策略。

**VIEW-03**：首版主体为 Main 与 Task，按日常任务链路接入必要的审批/决策及产物入口。完整 Memory、Scopes、World、Settings 菜单不作为首版要求。每项 Issue 完成时列出尚未被 TUI 使用的 API，说明原因和已知边界；不能为消除“未用 API”清单而扩展界面。

### 7.2 新 TUI 必须继承的可靠性保证

**REL-01**：草稿转 outbox 的交接可恢复；网络重试使用相同 request_id 和相同内容。已经发生或状态不确定的外部效果不能通过换 ID 自动重做。

**REL-02**：Core 接收成功与业务完成分开。TUI 展示权威对象状态，不能把本地“请求发出”写成已取消、已批准或已完成。

**REL-03**：SSE transient 只是预览；持久 timeline/changes 才是权威记录。预览转正式消息时按稳定身份替换和对账，不能拼成重复消息。

**REL-04**：持久 sync cursor 只在相关本地状态已经应用后推进。遇到 RESYNC_REQUIRED 按协议重建快照，不靠猜测跳过缺失事件。

冷启动或重建时，应先取得起始水位，再读取所需视图快照，并从起始水位追赶期间的变化；将已应用的本地状态和水位一致保存。不能先读完快照，再把后取的最新 cursor 当作已消费水位，否则会漏掉两者之间的更新。追赶与快照重叠时，按稳定身份和版本对账。[S24]

若某些客户端视图只保留内存状态，重启后必须重建对应快照，不能只从旧的持久 cursor 继续并假设原缓存仍在。其他初始化顺序只有提供同等无遗漏保证时才可替代。

**REL-05**：保存稳定 message_id/event_id 与阅读锚点。timeline/content 分页 cursor 可能绑定服务实例、内容版本和 thinking/streaming 选项，不能把它当作跨 Core 重启的永久书签。

**REL-06**：长正文分页、自动补读和驻留缓存有界。切换推理可见性或恢复消息不能自动串行补读数百片而阻塞输入；更大范围由显式操作继续。

**REL-07**：CJK 输入、中文标点、emoji、宽字符、换行、终端缩放/resize、流中继续编辑、选择复制及阅读位置必须在目标终端实测。输入法候选确认不得误发送。

**REL-08**：提交/换行键应选目标终端可以可靠区分的组合并可配置；不机械照搬 GUI 的 Cmd+Enter 事件假设。功能页路由和独立命令提交语义不随键位改变。

现有桌面桥已经实现大量草稿/outbox、恢复和有界阅读行为。TUI 可以重写实现，但不能因删除 Rust 桥而删除这些保证。[S09]

### 7.3 生命周期、子会话与同机边界

**RUN-01**：启动 TUI 优先 attach 现有 Core，必要时复用 startCore。退出 TUI 只关闭客户端连接，后台任务继续；显式停止 Core 必须是另一种明确操作。

**RUN-02**：保留既有本地接口和后台进程，TUI 不直接写 Store、绕开 ApplicationService，或启动第二套调度循环。

**RUN-03**：一次性业务 CLI 首版不做。已有 core-cli 的 start/attach/status/stop 是后台生命周期工具，不应与未来“向主会话发消息的脚本 CLI”混为一谈。[S08][S10]

**AUTH-01**：新增或封装的 task agent/执行器专用接口不提供 Master 消息发送操作，也不主动传递 owner 写入凭据。任务正常结果仍通过既有 Scheduler/反馈机制回到 Core，不能为了限制主会话写入而切断任务反馈。此项约束受支持的工具与凭据传递路径，不宣称已经阻止同账号任意 shell 代码绕过；实际边界见 AUTH-03。

**AUTH-02**：审查实际凭据传递和调用入口，不能只从 CLI 帮助中隐藏 send。当前 API 使用本地 owner 身份，复用 token 的调用会获得对应 owner 权限；客户端自报 producer/source 字段不能充当权限隔离。[S03][S04]

**AUTH-03**：现有执行器按本地用户运行，不能将同账号任意 shell 与文件访问声称为强隔离。首版要求收紧受支持的工具/凭据路径并如实记录边界；如果需要对同账号任意进程的强制隔离，应另行设计，不夹带为 TUI 工程。[S11]

## 8. 现有接口覆盖与复用矩阵

以下路由省略共同前缀 /api/v1。判断依据是当前操作清单、ApplicationService 与公共 DTO。[S01][S03][S05]

| 能力 | 当前接口/支撑 | 结论与适配范围 |
| --- | --- | --- |
| Main 文本发送、/send | POST /messages | 直接复用；页面路由留在 TUI |
| 接收对账/幂等 | GET /requests/{request_id}，ApiCommand | 直接复用；TUI 做 outbox 和恢复 |
| 会话列表/定位/长正文 | GET /timeline、/timeline/around、/messages/{id}/content | 直接复用；无公开全历史全文搜索 |
| 正文流预览 | GET /sync/stream，transient.previews | 复用；TUI 实现 framing、断线恢复与预览对账 |
| 工具/维护活动 | transient.activities、GET /activities/{id} | 复用关键字段；不是无限永久日志 |
| 推理内容显示 | timeline/content 的 thinking=true；读取时可用 streaming=true | 展开复用；需补默认 20 字符的只读预览及一致 SSE 元数据 |
| Task 列表与详情 | /tasks、/tasks/{id}、requests/executions 子资源 | 直接复用 |
| 创建任务 | POST /task-requests | 直接复用；现有参数较多，前端分批暴露 |
| 取消请求/执行 | POST /task-requests/{id}/cancel、/executions/{id}/cancel | 首版直接复用；显式 --request/--execution，不提供 task 聚合取消 |
| Task 继续 | POST /task-requests，reuse_task_id 与 parent_execution_id | 有条件复用，遵守 continuation.allowed/reason |
| Main 错误恢复/压缩 | POST /session/resume、/session/compact | 现有能力；resume 不等于停止生成 |
| 审批 | /authorizations、/{id}/decision | 复用；必须携带 expected_revision 和 display_hash |
| 决策 | /decisions、/{id}/answer | 直接复用 |
| 产物下载 | /artifacts、/{id}、/{id}/content | 后端已有；CoreClient 补二进制方法 |
| Scopes | 列表、详情、创建、更新、归档 | 复用；具体首版管理入口另定 |
| Memory | /memory、summary、commitments、resolve、extraction retry | 复用现有范围；不代表支持任意编辑所有记忆 |
| Settings | draft/apply/application retry/restore-draft | 复用 instructions/world edits；模型/密钥热切不是现有该接口能力 |
| 附件输入 | capability=UPLOAD_NOT_IMPLEMENTED | 缺少完整接入链路，必须新增 |
| 持久用户引用 | 无 reply_to/references 输入契约 | 明确延期，不阻塞文本折叠 |
| 语音草稿 | TUI 与可选模块之间 | 无需为此先改 Core |
| Portable/推送 | 保留已有 notification/push 服务 | 本次不交付设备 API 或 Portable UI |

现有 CoreClient.stream 只返回响应 body。可复用后端并不意味着客户端同步层已经完成。[S08]

### 8.1 CoT 预览与展开的适配要求

当前 SSE 预览默认不带 thinking，默认 timeline 也不能直接满足“前 20 字符”。在只读展示投影提供短预览，默认查询与 transient 使用一致规则；完整内容继续由显式 thinking=true 的有界读取提供，流中可带 streaming=true。

预览应为独立展示元数据，不改变原内容、模型请求或输入身份。20 字符按用户可见字符截取，避免拆开 emoji/组合字符；省略号不计入 20 字符。不为预览生成独立永久摘要记录。

默认 thinking=false 不能因隐藏全文而产生全文 thinking 的 next_cursor，否则客户端会自动补读整段 CoT。默认简略预览与展开后的分段读取必须分离，纳入 B1 验收。[S03][S15]

Main 当前有 resume/compact，没有公开的停止生成接口；本轮不新增该功能。

## 9. 后端改造清单与复杂度

复杂度是相对范围，不是已承诺工期。B1/B2 两项构成后端阶段；直接复用的取消操作在 TUI 命令 Issue 验收。

| 工作 | 首版决定 | 相对复杂度 | 所属 |
| --- | --- | --- | --- |
| CoreClient 薄适配 | 复用 attach/start/query/command/stream；必要时补二进制读取等方法 | 低 | B1/C2 |
| 文本接收与清理 | 复用现有可靠接收；新 TUI 做 outbox、对账与清理 | 后端低、客户端中 | C1 |
| 持久结构化引用 | 延后 | 本轮不实施 | 范围外 |
| 图片/附件输入 | 新增导入、登记、消息绑定、模型转换和恢复 | 较高 | B2 |
| 取消操作 | 复用现有请求/执行取消，命令参数必填 | 后端不新增聚合动作 | C2 |
| 回复终态 | 修复旧 #63 的共享 Core 状态缺口 | 中 | B1 |
| CoT 默认预览 | 20 字符只读预览，显式展开复用原接口 | 中 | B1 |
| 支持的子会话入口 | 新增客户端接口不额外授予 Master 写入能力；记录既有同 UID 边界 | 随接入核查 | C1/C2 |
| 契约与文档 | 修改源 schema/operations，生成 DTO/OpenAPI并保持旧记录可读 | 随实际改动 | A/B/C |

### 9.1 首版取消的确定语义

命令只支持：

    /cancel --request <task_request_id>
    /cancel --execution <execution_id>

必须且只能选择一个目标参数。task_request_id 是业务对象 ID；每次取消动作另有稳定的幂等 request_id。参数错误、无参、两个参数并存或 --task 均报错，不使用选中行、最近执行或父任务替换目标。

对应现有 task-requests/{id}/cancel 与 executions/{id}/cancel。前者遵守现有即时请求规则；非即时请求错误如实展示。后者只取消指定执行，未来周期触发不因此停止。收到 ACCEPTED/QUEUED 仅代表取消动作已接收，完成状态以权威对象为准；未知外部效果仍保留。[S12][S13]

整体关闭 TaskPlan 和未来触发不在本轮后端 Issue 中实现；也不将单次取消包装成“整个 Task 已取消”。Task 继续仍遵守 continuation.allowed/reason，不把已终结执行直接复活。[S14]

### 9.2 图片链路的具体受影响层

至少涉及：

- 公共 schema/operations 与生成 DTO；
- 附件导入服务及稳定登记；
- MessageCommand 与内部 Input 对附件关联的表达；
- admission、请求指纹与持久化边界；
- input/context projection、模型内容转换、预算与模型能力校验；
- timeline/历史读取的最小附件投影；
- 重启恢复、重复导入与错误反馈；
- TUI 路径/剪贴板、草稿状态与外部打开。

可以复用 CAS、既有 content 校验和产物下载思路，但用户输入附件与执行产物不是同一业务对象，不应硬塞成一个 TaskResult 来绕过缺失契约。

### 9.3 旧 #63 的共享后端缺口

当前合并后交接明确保留以下源码问题：

1. timeline 跳过既无正文也无可显示 thinking 的助手输出，异常 length/error/aborted 空回复可能没有状态行。
2. transport 对 length 停止仍把模型活动标为 succeeded，可能与消息“输出截断”状态不一致。

应在 TUI 验收之前修复领域投影/状态语义，保留正常 tool-only 行为；不编造缺失正文。这些是正确性工作，不属于提前开展专项性能优化。[S15][S16]

旧 Svelte 长正文自动补读过多的实现可以退役，但 TUI 必须继承“自动补读有界”的验收要求。旧 UI 的 NOT_ACCEPTED/NOT_TESTED 结果不能自动变成新 TUI 的通过证据。

## 10. Tauri 冻结与代码清理方案

本节保留 A 阶段的实施要求：直接删除旧 Tauri 客户端及专属设施，依 Git 历史追溯；2026-10-23 #79（PR #85）已实施源码退役。

### 10.1 直接删除的主体

直接删除 src/secretary_desktop 整棵树和 .github/workflows/desktop.yml：包括 Svelte/PhaseUI、样式/图标、Tauri Rust 桥与窗口配置、专属依赖锁文件、Vite/Svelte/WDIO、客户端草稿/cache/outbox 实现、桌面专属测试和测量脚本。不要建立 retired/legacy 客户端副本或为了备份保留旧构建入口；Git 历史已经保存源码。

根 Node 工程与桌面子工程已分开。根 package.json 没有桌面 Svelte/Tauri/Vite/WDIO 依赖，根 TypeScript 编译边界也独立；没有理由为删除 Tauri 整体重建后端依赖。[S09][S17][S18]

### 10.2 必须保留或迁移的内容

| 类别 | 对象 | 后续动作 |
| --- | --- | --- |
| Core | src/pi_secretary 的业务/运行时 | 保留；按适配 Issue 小改 |
| 内部契约源 | src/contracts/contracts.schema.json | 保留，接口扩展从源修改 |
| 公共 API 源 | docs/api/v1/schema.json、operations.json | 保留并随真实契约变化更新 |
| API 生成产物 | docs/api/v1/openapi.json、src/pi_secretary/src/api/contracts.ts | 保留，从生成器产出，不手工改写 |
| API 生成器 | src/pi_secretary/scripts/generate-api.mjs | 保留 |
| 本地运行与客户端 | backend、api-v1、ApplicationService、CoreClient、core-cli | 保留 |
| 同步/投影/通知 | timeline、sync-service、sync-stream、notification/push | 保留，不能按“给桌面用”删除 |
| 桌面生成副本 | secretary_desktop 的 contracts.ts、src-tauri/contracts | 可随客户端退役，不误删生成源 |
| 客户端可靠行为 | 草稿、outbox、幂等、已应用水位、阅读锚点 | 迁移要求和必要测试，不强制搬原 Rust 实现 |
| 旧客户端运行数据 | client.sqlite 等草稿、cache、未解决 outbox | Master 已明确弃置；不备份、不迁移、不兼容读取。只删除已识别的客户端状态，不删除 Core journal/CAS/数据库 |
| Core 测试 | 包含 FE 编号但直接测 Core 的用例 | 保留，例如 issue63/timeline.test.ts |
| 历史证据 | docs/fix 与 evidence、旧失败/未验收记录 | 保留追溯；失效链接改固定提交链接 |

两个同名 contracts.ts 的归属必须分清。Core 内部与 API 的 TypeScript 契约为生成产物，未来变更应回到各自 schema 源，不直接手改生成文件。公共 OpenAPI 同样由 schema/operations 生成。[S05][S06][S23]

### 10.3 CI 与文档的实际耦合

以下描述需求发布基线。2026-10-23 #79 已将 checker/fixture 改为 TUI 需求和 API 清单入口，并删除桌面 workflow、旧规范和专属翻译输出；Core 三项 CI 定义保留。

桌面 macOS workflow 可随 Tauri 退役移除或替换为 TUI 验证；Core Linux、Core macOS 与 verify 汇总检查保留。[S19][S20]

目前 Core 的 npm run verify 会执行 check-docs.py，而该脚本硬性要求：

- src/secretary_desktop/README.md；
- docs/frontend/README.md 及其指定规范文件；
- 根中文 README、docs/README 和旧设计文档到现行前端入口的导航。

因此，直接删除桌面目录会破坏 Core 文档检查。清理必须同步更新现行导航、迁移映射、check-docs.py、对应 docs-check 测试。[S21]

localize-docs.py 与 docs/i18n/manifest.json 也包含桌面来源，多语言副本需要一起调整。可以把现行入口转为 TUI 规范、旧 PhaseUI 规范明确归档，而不是删除历史验收事实。[S22]

### 10.4 后续冻结与清理的交付条件

- 使用本文件固定提交和 Git 历史追溯旧 UI，不建立额外源码归档或旧客户端数据迁移工程。
- 给旧 FE Issue 标明被新路线承接的范围与尚未完成项，不把“停止继续做”写成“已验收”。
- 清理范围有保留/移除清单；确认未误删后端契约、Core 测试、已被 Core 接收的消息/任务/回执和数据库。旧客户端未发送状态按裁定直接弃置。
- Core 构建、生成检查、文档检查和既有 CI 保持成立。
- 新 TUI 代码入口与现行文档入口一致，不残留两套相互矛盾的“当前规范”。

## 11. 已有 Issue 状态与性能排期

下表为发布本路线前的审计状态。#57 作为新 TUI 总路线复用；#62—#67 未完成的旧 GUI 工作冻结，分别在原 Issue 标注承接关系，既往未验收项不被改写为已通过。领取时核对最新 main 和最新评论。

| Issue | 当前状态 | 与迁移的关系 |
| --- | --- | --- |
| #57 | OPEN | 改为 TUI 总路线，管理本文件的 A→B→C 依赖 |
| #58 FE-00 | CLOSED / COMPLETED | 可行性成果留档 |
| #59 FE-01 | CLOSED / COMPLETED | 可靠发送与同步语义应继承 |
| #60 FE-02 | CLOSED / COMPLETED | 真实业务链路成果可复用 |
| #61 FE-DOC | CLOSED / COMPLETED | 旧 PhaseUI 文档基线留档 |
| #62 FE-03 | OPEN，PR #77 已合入 | 不能按正文旧句“尚未启动”判断；视觉/验收缺口仍在 |
| #63 FE-04 | OPEN，PR #78 已合入当前基线 | 共享 Core 缺口提取；旧 UI 专用工作随迁移处理 |
| #64 FE-05 | OPEN | Task/Scope/审批等功能诉求逐项映射到 TUI |
| #65 FE-06 | OPEN | Memory/World/Settings 逐项定首版范围 |
| #66 FE-07 | OPEN | 产物/推送/生命周期按新范围承接 |
| #67 FE-08 | OPEN，旧路线冻结 | 原真实使用终验由新 C3 Issue 承接 |

#62/#63 “代码合入”和“产品验收结项”不是同一状态。最新交接优先于旧正文中的启动状态。[I62][I63]

### 11.1 性能优化继续排在 TUI 后

既有第一期顺序不变：

1. #70：历史热路径扫描、防回归、启动/内存观测。
2. #71：provider usage 优先的上下文计量。
3. #72：条件诊断区分 NOT_MET / UNKNOWN。
4. #73：Consciousness 身份、真实活跃时间与渐进遗忘。
5. #74：取得 #70 的真实数据后，再决定是否开展下一期历史常驻内存/启动治理；它不是第一期完成门槛。

性能 Issue 原有 #67 前置由新 C3（[#84](https://github.com/ExplodeCode6324/Secretary/issues/84)）的 macOS 真实可用验收承接，保持 #70→#71→#72→#73 和 #74 的数据前置。本次仅调整路线引用，不启动性能实现，不重复创建优化 Issue。[I70][I74]

能输入、不会丢消息、状态正确、历史读取有界是 TUI 基础质量。为满足这些修复已知缺陷，不等于提前领取 #70 的 Core 热路径专项治理。

## 12. 分阶段 Issue 与领取顺序

总路线复用 [#57](https://github.com/ExplodeCode6324/Secretary/issues/57)，建立六个可分别领取的实施 Issue。

| 阶段 | Issue | 交付 | 前置 |
| --- | --- | --- | --- |
| A | [#79](https://github.com/ExplodeCode6324/Secretary/issues/79) | 直接删除 Tauri 及专属构建/CI，调整文档和检查，弃置旧客户端未发送数据 | 本需求 |
| B1 | [#80](https://github.com/ExplodeCode6324/Secretary/issues/80) | Core 回复终态修复、默认 CoT 预览与展开契约、必要薄适配 | A |
| B2 | [#81](https://github.com/ExplodeCode6324/Secretary/issues/81) | 本地附件导入、持久消息绑定、多模态输入与恢复 | A |
| C1 | [#82](https://github.com/ExplodeCode6324/Secretary/issues/82) | macOS TUI 基础、确定性命令、Main、草稿/outbox、文本粘贴、同步和 CoT 展示 | B1、B2 |
| C2 | [#83](https://github.com/ExplodeCode6324/Secretary/issues/83) | Task 显式操作、必要审批/决策、图片粘贴、产物外部打开、可选语音草稿接口 | C1 |
| C3 | [#84](https://github.com/ExplodeCode6324/Secretary/issues/84) | macOS 实际终端与日常使用验收、最终 API 使用清单 | C2 |
| 后续 | #70 → #71 → #72 → #73 | 原定 Core 优化；#74 在 #70 数据后决定 | C3 经 Master 真实可用终验 |

A → B → C 的阶段顺序保持。B1、B2 没有彼此的业务硬前置，可独立领取；若并行需要协调公共 schema/DTO，禁止覆盖对方字段，C1 前必须统一基线。C1/C2/C3 顺序执行，不要求把三个阶段挤进一个 PR。

### 12.1 每项 Issue 的完成报告

每项 Issue 必须说明：

1. 本次实际完成的行为和对应提交。
2. 运行过的验证、结果，以及未测试边界；区分 fixture、系统终端与真实模型验证。
3. 本次使用、新增或修改的 Core API。
4. 截至本次仍未被 TUI 使用的 API，按当前 operations.json 列出 method/path（同类可分组），注明延期/当前不需要/尚未实现等原因。
5. 交给下一 Issue 的契约与必要限制。

API 未使用清单是可见性要求，不意味着必须补完整菜单。A/B 阶段尚无新 TUI 消费者时可以明确记录该事实；C3 汇总最终清单。不把“未调用真实模型 API”当成“哪些 Core API 没用上”的替代回答。

## 13. 验收矩阵

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC01 | Main 普通消息 | 完整正文只生成一个权威输入；接收与回答状态分开 |
| AC02 | Main 强制纯文本 | /T、/cancel 等样式原样发送，不执行命令 |
| AC03 | 功能页普通文字 | Main 没有新输入；任务不被操作；草稿保留并有本地说明 |
| AC04 | 功能页 /send | 仅提交明确草稿载荷（正文、展开的文本片段及显式附件），不附当前页面上下文；文本不递归解析 |
| AC05 | 大小写/作用域/未知命令 | 确定性报错，无模型猜测或错误路由 |
| AC06 | 参数与稳定对象 | 无效/不唯一 ID 不执行；列表刷新不改变目标 |
| AC07 | 补全 | 当前页候选正确，参数可补；选择候选不触发操作 |
| AC08 | 多行混合粘贴 | 折叠、展开、编辑与提交顺序一致；无丢行或自动命令执行 |
| AC09 | 输入超限 | 按真实请求字节数拒绝，草稿保留，不截断或只发路径 |
| AC10 | 可靠接收后清理 | 临时文本删除，Core 重启后仍能取得完整持久正文 |
| AC11 | HTTP 回执丢失/数据域变化 | 在原 data_domain_id 内沿原 request_id 对账/同参重投；换数据域不自动发送或清理，无重复输入、无提前删稿 |
| AC12 | 三年保存、崩溃残留与限额 | 可控时钟验证三个日历年；已接收文本及时清理；活跃/未知交接受保护；容量满拒收，不提前删受保护内容 |
| AC13 | 图片导入 | 文件/剪贴板来源得到稳定附件，真实内容进入支持图片的模型；导入/发送请求身份分开，重试不因原文件改变而替换内容 |
| AC14 | 图片失败/仅图消息 | 不支持或失败时保留草稿；仅图消息按定稿契约处理 |
| AC15 | 产物外部打开 | 历史产物内容正确，空格/中文路径可用，失败反馈清楚 |
| AC16 | 可选语音 | 无模块仍可用；有模块只更新指定草稿；迟到结果不覆盖新编辑 |
| AC17 | 冷启动与 SSE 重连 | 快照与变化追赶无缺口；change cursor 与本地应用一致；预览转持久不重复；RESYNC 可恢复 |
| AC18 | 长会话与 CoT | 默认摘要/前20可见字符；/cotvisible 展开/收起；默认不拉完整CoT或产生其分页；阅读锚点、复制、流中编辑和有界补读可用 |
| AC19 | 异常回复 | 空 length/error/aborted 有状态表达；截断不标完整成功 |
| AC20 | 带参取消 | --request/--execution 必填互斥，固定业务ID；无参/--task不执行；重复提交幂等，只取消指定对象，未来计划和 UNKNOWN 不被伪造处理 |
| AC21 | 任务继续与审批（提供相关操作时适用） | 遵守 continuation 限制；过期 revision/display_hash 不被盲目批准 |
| AC22 | TUI 退出/重开 | Core 和任务继续；重连获得实际状态，不依赖过期 UI 快照 |
| AC23 | macOS 目标终端 | 真实中文输入法、换行/提交、宽字符、resize、粘贴实测通过；Linux TUI 延后，Core Linux CI 仍通过 |
| AC24 | Main 写入入口 | 支持的 child/执行器工具不获得 Master 发送入口；实际同账号边界明确 |
| AC25 | Tauri 直接清理 | 旧代码/专属CI与未发送客户端状态弃置，无迁移工程；共享 API/契约/Core测试/权威数据保留；文档与CI有效 |
| AC26 | 范围与完工说明 | 每个Issue声明未被TUI使用的API；不要求完整菜单；结构化引用/业务CLI/自动视图引用延期；专项优化仍在TUI后 |

运行验证要区分确定性回归、系统终端实测与真实模型使用。旧 UI 的截图、原生回归或既往真实调用不能代替新 TUI 的证据。本轮只提供验收设计，没有宣称这些场景已经通过。

## 14. 实施边界与决策记录

本版已收敛 v0.1 的待定项：取消采用显式参数，结构化引用延期，菜单按需，CoT 默认简略且通过 /cotvisible 展开，macOS 优先、Linux 后置，临时/孤立默认三年，旧客户端未发送数据直接弃置。

原有本地 API 与后台 Core 继续使用。清理旧客户端不删除 Core 的消息、任务、回执、CAS 或 PostgreSQL 数据；同样不为旧草稿/outbox 增设迁移程序。已保存的历史故障与未验收事实继续可追溯。

真实使用验收完成前不领取 #70—#73 的专项优化，#74 继续依 #70 数据决定。必要正确性修复、响应式输入和有界读取属于本次基础质量。

上述内容和分阶段 Issue 是执行依据。框架、键位、容量等常规实现选择在对应计划中记录即可，不重新扩展已明确延期的产品范围。

## 15. 证据索引

所有 S 编号源码链接固定到评估提交，Issue 链接保存当时的状态依据。

- [S01：API 操作清单][S01]
- [S02：Main 输入接收与正文持久化][S02]
- [S03：ApplicationService，命令准入、能力与公共投影][S03]
- [S04：本地 HTTP/SSE 服务、输入限制与产物下载][S04]
- [S05：公共 API schema][S05]
- [S06：内部契约][S06]
- [S07：输入投影及身份校验][S07]
- [S08：CoreClient，附着、启动与流接口][S08]
- [S09：旧桌面实现与可靠行为说明][S09]
- [S10：Core 生命周期 CLI][S10]
- [S11：执行器工具与本地执行边界][S11]
- [S12：任务请求取消与未来触发][S12]
- [S13：执行取消及未知状态][S13]
- [S14：Task continuation 条件][S14]
- [S15：timeline 投影][S15]
- [S16：模型传输与终态][S16]
- [S17：根 package.json][S17]
- [S18：根 TypeScript 编译范围][S18]
- [S19：桌面 CI][S19]
- [S20：Core CI][S20]
- [S21：文档导航与存在性检查][S21]
- [S22：文档本地化来源][S22]
- [S23：公共 DTO 与 OpenAPI 生成关系][S23]
- [S24：持久同步水位与变化追赶][S24]
- [I62：#62 最新合入后交接][I62]
- [I63：#63 最新问题与验收缺口][I63]
- [I70：#70 与既定优化顺序][I70]
- [I74：#74 下一期候选与数据前置][I74]

[S01]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/docs/api/v1/operations.json
[S02]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/main-loop.ts
[S03]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/application-service.ts
[S04]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/api-v1.ts
[S05]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/docs/api/v1/schema.json
[S06]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/contracts.ts
[S07]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/input-projection.ts
[S08]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/core-client.ts
[S09]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/secretary_desktop/README.md
[S10]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/core-cli.ts
[S11]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/executor-tools.ts
[S12]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/task-triggers.ts
[S13]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/execution-recovery.ts
[S14]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/task-planning.ts
[S15]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/timeline.ts
[S16]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/transport.ts
[S17]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/package.json
[S18]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/tsconfig.json
[S19]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/.github/workflows/desktop.yml
[S20]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/.github/workflows/verify.yml
[S21]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/scripts/check-docs.py
[S22]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/scripts/localize-docs.py
[S23]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/scripts/generate-api.mjs
[S24]: https://github.com/ExplodeCode6324/Secretary/blob/12e028a049122035f86d5cbf930516157c9bb72b/src/pi_secretary/src/sync-service.ts
[I62]: https://github.com/ExplodeCode6324/Secretary/issues/62#issuecomment-6335587064
[I63]: https://github.com/ExplodeCode6324/Secretary/issues/63#issuecomment-6357543007
[I70]: https://github.com/ExplodeCode6324/Secretary/issues/70
[I74]: https://github.com/ExplodeCode6324/Secretary/issues/74

