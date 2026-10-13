# Issue #10：macOS 原生客户端与旧入口退役

状态：**PR2c 已合并 / PR3 计划待确认**。PR #40、#41、#42、#43 已合并；最新主线 merge `89710d2ae3c5cca005e2c58c7683ea897bc674ac`，合并后三项 CI 均通过。Issue #10 保持开放。连接、聊天及日常管理见 [PR2a](fix_20261013_issue10_PR2a原生连接底座.md)、[PR2b](fix_20261013_issue10_PR2b聊天与导航.md)、[PR2c](fix_20261013_issue10_PR2c日常管理.md)；下一阶段见 [PR3 原生联合验收与旧入口退役](fix_20261014_issue10_PR3原生联合验收与旧入口退役.md)。下文保留各阶段最初规划与历史记录，当前基线、剩余验收和实施授权以 PR3 计划为准。

关联：[Issue #10](https://github.com/ExplodeCode6324/Secretary/issues/10)。计划日期：2026-10-13；当前进度更新于 2026-10-14。执行者：Codex；GitHub assignee 为维护账号 ExplodeCode6324。当前计划分支：`codex/issue10-native-retirement`，在 secretary-core 原工作目录编写计划，不创建独立工作区。

## 1. 目标、授权与基线

交付可日常使用的 macOS SwiftUI 客户端，通过 Core API v1 完成聊天、任务、审批与决定、记忆、Settings/World、Scope、授权规则、通知及产物流程；原生替代验收后完成旧 WebUI/TUI 入口退役。

**Master 本轮设计要求：涉及 UI 时尽可能简洁，后续会在此基础上进一步做美学设计。首版以功能完整、信息清楚、操作可靠和可访问性为验收重点；使用朴素原生控件、文字导航与紧凑列表，不引入装饰性大卡片、复杂动效或独立品牌视觉。简洁不削减审批详情、失败说明、恢复入口和必要状态。后续修改设计规格、README 和操作文档时同步注明这一阶段定位。**

最初规划阶段只领取 issue、核查现状和编写文档；Master 已确认实施并于 2026-10-13 批准合并 PR #40、PR #41，继续 PR2b；UI 保持简洁，补充 Dock/菜单无窗口恢复兜底。发布、合并、部署的状态分别记录。

基线为 `main@108de834c1b8c298c546e06508c59cb052d43c43`，已核对与远端 main 一致。#9、#16、#17、#18、#19、#21、#28 均已关闭，其实现已在当前主线。#8 仍开放，正文尚保留未合并描述，但 PR #15 已于 2026-10-10 合并，合并提交 `9623095a34f01933feeb74995dbb4d49edc8300e` 是当前 HEAD 祖先；不把 issue 状态误当作 API 缺失，也不在本任务顺手关闭 #8。开工时复核公共合同及基线变化。

## 2. 已核查的源码现状与差异

| 位置 | 当前事实与计划影响 |
| --- | --- |
| `src/pi_secretary/src/api/contracts.ts`、`api/routes.ts`、`application-service.ts`、`api-v1.ts` | 已有结构化 API、能力状态、命令回执、Scope、remember、未知结果裁定等；Swift 仅使用公开投影，不读取 Store/PostgreSQL |
| `core-client.ts`、`core-cli.ts`、`backend.ts` | 已有本机发现、安全文件检查、独立后台启动和附着；原生端复用其生命周期，退出客户端不停止 Core |
| `sync-service.ts`、`sync-stream.ts`、`notification-service.ts` | #9 的事务变更流、聚合失效、presented/read 已实现；客户端需落实持久应用水位与实际展示证据 |
| `docs/api/v1/schema.json`、`operations.json`、`examples.json`、`decode-examples.swift` | 合同与 Swift 解码样例已有；仓库尚无 SwiftUI 工程。样例不等于完整 SDK 或原生验收 |
| `docs/native-client-design-v0.3.md` | 布局可沿用；审批仍写“批准／拒绝／撤销”、设备页仍描述 #14 模拟展示，需按 #10 更新为批准一次/记住、设备禁用占位；撤销已有授权仍保留在适用详情 |
| `README.md`、`docs/api/v1/README.md` | 部分进度和操作数量陈旧，实施时按实际生成合同更新，不复制旧数字 |
| `src/pi_secretary/web/`、`web.ts`、`client-tui.ts`、`ui-client.ts`、`tui.ts`、`stop-ui.ts`、`activity-terminal.ts` | 旧静态资产、启动和控制器仍存在。当前新版 backend 只提供 API v1，npm 的旧 Web 入口已拒绝运行；本 issue 是完成残留清理，不重开旧服务 |
| `test_case/offline/issue3/commitment.test.ts`、`runtime/review.test.ts`、`runtime/tui.test.ts` 等 | 仍有 TerminalController 依赖；Web 渲染/时间线测试引用旧 JS，删除前须区分领域断言与旧渲染专属断言 |
| `.github/workflows/verify.yml` | 当前为 Linux Node/PostgreSQL 验证，无 macOS job；需增加 Swift 编译与合同测试门禁 |

规划环境实查为 macOS 15.7.4 arm64、Swift 6.0.3；`xcode-select -p` 指向 Command Line Tools。尚未验证完整 Xcode 或 UI 测试能力，不将工具版本查询写成构建通过。仓库已有未跟踪历史报告，本任务不改动、不纳入提交。

## 3. 范围与工程选择

- 新建 `src/secretary_macos/`，使用一个 macOS SwiftUI app 工程，配套本地 Swift Package 承载协议、同步、缓存与非 UI 测试。最低部署目标 macOS 14；固定开发/CI 基线 Xcode 16.4（Swift 6.1，Swift 6 语言模式）。Master 负责下载安装完整 Xcode，Codex 不安装工具、不切换全局开发目录。采用 Xcode app target + 本地 Package，不采用纯 SwiftPM 手工组装 app 的降级方案。
- 采用 Foundation/URLSession、SwiftUI，必要时用 AppKit 处理 NSTextView 输入法组合态、系统目录选择器和系统打开；系统通知用 UserNotifications。DTO、业务投影和页面分层，不移植 Host/Scheduler 到 Swift。
- 本地数据库使用系统 SQLite，缓存数据与已应用 cursor 事务提交；outbox、草稿、阅读位置与可淘汰缓存分表管理。避免为了首版引入完整前端框架或持久状态机副本。
- 不新增 iOS、设备模拟/真实接入、附件上传、语音、手机推送、新版 TUI 或服务端远程开放。#14 与 Portable 保持冻结，#22/#23 后续自行补客户端增量，不反列为本次结项前置。
- 已知 Operation 参数/输出与 Artifact 相对路径缺口在 §7 A0 单列实现，先完成 Core 合同 PR；其余页面在阶段 A 做完整字段核对。不从内部记录旁路取值，不扩写领域语义。

### 工具链准备与构建约定（B1）

Master 从 [Apple Developer Downloads](https://developer.apple.com/download/all/?q=Xcode%2016.4) 下载 Xcode 16.4，解压到 Applications，打开一次并完成许可与必要组件安装；本期只需 macOS，不需下载 iOS/watchOS/visionOS 模拟器。Apple 的 [Xcode 16.4 发布说明](https://developer.apple.com/documentation/xcode-release-notes/xcode-16_4-release-notes)列出的宿主范围包含本机 macOS 15.7.4。工具准备完成后再验证原生构建；这不替代 Master 对业务实施的确认。

本地使用进程级 `DEVELOPER_DIR`，不要求全局 `xcode-select --switch`。以下为工程入口；PR2a 已完成 app 与 Package 构建，UI runner 实测受系统认证阻挡，详细验证见 PR2a 说明。路径按 Master 实际安装名称调整：

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -version
xcrun swift --version
xcodebuild -project src/secretary_macos/Secretary.xcodeproj -scheme Secretary -configuration Debug -destination 'platform=macOS' -derivedDataPath .build/native build
swift test --package-path src/secretary_macos/Packages/SecretaryKit
xcodebuild -project src/secretary_macos/Secretary.xcodeproj -scheme Secretary -destination 'platform=macOS' -derivedDataPath .build/native test
```

app target 配置固定 bundle identifier、本机开发签名和共享 scheme；本期不要求商店分发或公证。CI 使用 `macos-15`，显式 `DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer` 并检查 `xcodebuild -version`；当前 [runner 软件清单](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md)含此版本。runner 更新导致缺失时明确失败，不能偷偷换默认工具链。编译/Package 合同测试为 CI 必需门禁；真实窗口、通知与可访问性在本机单独验收。

B1 对工具链准备的要求成立，但“VoiceOver/窗口验收都依赖 Xcode”表述过宽：这些系统能力并非只能由 Xcode 提供。本项目选 Xcode 是为了确定 app target、签名、SDK 和 XCUITest 的统一交付方式，不以工具缺失为由降低验收。

## 4. 简洁界面与页面行为

以 [v0.3 设计](../native-client-design-v0.3.md) 的布局、交互和可访问性为底线；本轮最新要求与 Issue #10 优先于其中尚未更新的文字。

顶部仅普通文字助手名称和“任务、记忆、设备、产物、设置”；名称来自 assistant/profile，空白回退 secretary，点击返回对话。无头像、徽标、品牌副标题或“主会话”标题。顶部不够宽时收进“更多”，跨页待审批/待回答短入口始终可达。设备禁用并说明冻结原因，不能进入可点击空白页。

默认正文/输入 13 pt，导航/按钮/旁栏 12 pt，元信息 11 pt，名称 16 pt；保持足够点击区域和键盘焦点。初次 1280×860 pt，最小 720×520 pt；恢复用户窗口大小。对话占剩余空间，右栏默认 200 pt、180–220 pt 可调；默认字体下对话不足约 800 pt 自动收起，保留手动偏好。右栏只有明确关联的任务、产物、设备，每节最多 5 条，关联范围由明确选择改变，滚动不改变。

普通列表、分区与详情代替大字号卡片。沿用 v0.3 的基础色彩和细线（装饰线 #303336、输入边界从 #69737B 起步），样式集中为少量字体/间距/色彩常量，便于后续美学设计；本轮不建设通用主题编辑器。未知状态显示原值及短解释，不能只靠颜色区分身份与状态。

每页分别表达：客户端是否实现、服务端是否支持/配置、操作权限、连接情况，以及未加载/加载/空/成功/失败和缓存陈旧程度。World 未配置时明确不可用，仍可查看其他记忆内容；离线保留最后确认时间，不能把缓存“运行中”伪装成实时状态。

## 5. 连接、身份、DTO 与命令可靠性

1. 首次连接提供“附着已有 Core”和明确的“启动本机 Core”。仅读取用户选定目录的发现文件，复核常规文件、owner、0600 权限、loopback URL、API version、mode、instance/data_domain；不读取或展示模型密钥。启动通过明确配置的 Node/Core 管理入口及参数数组执行，不拼 shell 命令，不依赖登录 shell 的 PATH。
2. endpoint 配置、凭据、业务缓存分离。本机沿用已确认的发现机制；外部凭据存 Keychain，不写日志/缓存。连接层接受可配置 endpoint，为后续复用保留协议边界；本期只验收本机，不修改 Core 监听或网络暴露，也不假设远端能读取服务端凭据文件。
3. 数据按 owner/data_domain、session 隔离；instance 变化只使实例分页游标与活动请求失效，不误删同数据域的持久同步水位/outbox。切换域时取消旧请求、增加连接代次，迟到响应不能跨域应用；未知命令留在原域等待对账，不能重投到新域。
4. 请求/响应以 schema 和 operations 为准。十进制 revision/sequence/bytes 保留精度，不能经 Double 比较；未知字段忽略，未知枚举显示为未知且禁用不明写操作。认证失效、不支持版本、超时和冲突分别显示，不用持续重试掩盖。
5. 所有用户写入先持久化完整路径、参数、原 request_id 和目标域。outbox 成功提交后才清空唯一编辑副本；落盘失败保留输入。连接恢复/超时后先 GET requests/{id}，按合同同 ID 同参重投；改参是新的明确意图。ACCEPTED 表示受理，业务完成看资源状态，UNKNOWN 不自动另建作用。
6. 客户端关窗/退出仅终止自身连接。停止 Core 放在独立管理操作，不绑定窗口生命周期。唤醒后重新发现、对账和同步；同机系统睡眠可能暂停 Core，不承诺整机睡眠时持续执行。

## 6. 同步、缓存和通知

先获取同步 S，再加载所需资源和稳定分页，随后追赶 changes 并保持 SSE。新资源按需加载；未缓存资源也须保存失效标记。所有事务依赖的刷新完成、投影或失效标记与应用水位原子落盘后才推进 cursor。任何相关刷新失败保留待刷新与旧水位，重连从已应用 cursor 补发。内存队列超预算断开流并从该水位恢复，不无限积压。

record 按 revision 合并；invalidate 无条件使相应聚合/集合失效，不能用根 revision 抑制刷新。同一查询最后发出的请求有效，最新失败时不能用较早成功清掉陈旧状态。RESYNC_REQUIRED 重建缓存投影与水位，保留草稿、未确认 outbox、展示记录并对账。普通分页游标、持久同步 cursor、消息内容 cursor 分别管理，不互换。

首版仅强持久化 outbox、草稿、阅读锚点、展示记录、同步 cursor、最近会话窗口，以及最近访问的必要详情/状态和附件 metadata；其余列表与投影启动后按需重建，不建设全资源离线镜像。未持久化资源保存失效标记，重启后首次访问强制查询，不能凭恢复的 cursor 推断未保存的资源已存在；加载时继续按“取 S→查询→追赶”收敛。

对外保留两个磁盘预算：可重建投影/正文 256 MiB、产物 1 GiB；只对这些可重建内容按最后访问时间清理。草稿、未确认命令和已展示记录不淘汰；磁盘不足拒绝新提交并保留编辑文字。内部仍保留正文/预览工作集 32 MiB、SSE 待处理 4 MiB 的硬上限，使用分页/背压，不做另一套内存 LRU 或用户设置。减少持久层复杂度不等于删除长文本、异常流量的内存边界。缓存升级失败可备份后重建投影，不清 outbox；记录实际峰值后如需调预算说明依据。

通知使用稳定 client_id 注册：首次 S 之前创建的条目只入列表，历史 read/presented 更新不当成新通知。系统权限拒绝时保留应用内提醒。presented 表示已展示，read 表示 Master 明确阅读，两者不混同：

- 前台 `willPresent` 仅表示收到待展示通知，不能在回调入口直接上报；应用内内容在活动窗口实际可见后上报 presented。
- 后台使用稳定通知 identifier。提交完成不报 presented；调度后一次延迟核对及应用激活时核对 `getDeliveredNotifications`，命中仍在通知中心的条目可作为系统展示证据。这不是已读证据，不进行常驻高频轮询。
- `didReceive response` 是用户响应，不是后台送达回调。可确认该条曾展示；read 仅在用户打开内容或选择明确已读动作时提交，dismiss 不上报 read。
- 无法确认展示则暂不报，之后应用内实际展示再补报。持久记录抑制重启重复；保留展示/落盘间崩溃窗口测试，不宣称跨系统原子 exactly-once。

上述语义依据 Apple 的 [deliveredNotifications](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/getdeliverednotifications(completionhandler:)) 与 [通知处理说明](https://developer.apple.com/documentation/usernotifications/handling-notifications-and-notification-related-actions)。截断通知显示说明，截断 JSON 按文本处理，本次不扩通知内容端点。

## 7. 功能与公共合同映射

| 功能 | 方案与不可丢失的行为 |
| --- | --- |
| 聊天与时间线 | messages、timeline、timeline/around、messages/{id}/content；Return 换行、⌘Return 发送，IME 组合态不发送，无可见占位但有可访问标签。恢复草稿与消息 ID/局部偏移阅读锚点；历史阅读/选中/展开时不强制滚到底 |
| Markdown 与长文本 | 支持代码、列表、引用、表格、复制；宽代码/表格局部横向滚动，不执行 HTML/脚本。固定使用 swiftlang/swift-markdown 0.6.0 解析 GFM、SwiftUI/AppKit 原生渲染，提交 Package.resolved 锁定传递依赖；不跟随 main。内容按 opaque cursor 顺序读取，不用 Swift String.count 复现 JS UTF-16 偏移 |
| 预览与最终消息 | 以服务端稳定 message ID/call_id 合并，transient 不推进持久水位；正常/失败/中断后只保留正确逻辑记录。显示偏好变更增加代次，取消旧请求并清理相关预览/思考缓存，迟到结果不可恢复隐藏内容 |
| 任务 | tasks、task-requests、executions；默认全部，可按 scope 筛选；创建/补充/接续/取消执行/取消待执行请求。显示本轮目标、条件、结果、验收、局限、产物；continuation 和 SCOPE_BUSY 等原因由后端决定 |
| 查看与留存 | 显式打开执行详情时提交 viewed；自动刷新、旁栏展示、预取和普通恢复缓存不续留；避免视图重复 mount 产生虚假访问 |
| 审批与规则 | 完整展示实际操作/参数、期限和原因；拒绝、批准一次、批准并记住。使用 remember_context 中服务端 token/根/路径，选择前缀和可选有效期，提交前展示规则范围；原 revision/display_hash 提交，冲突后重新加载，不自动批准新版。已有可撤销授权提供撤销且说明持久规则需另行禁用 |
| 工作决定 | 独立于权限审批，显示 question/options/impact/deadline，提交结构化回答并对账；普通聊天同意不能转换为审批 |
| 未知结果 | executions 的 unknown_operation_ids 定位 operations；展示操作参数、已有输出及原因。APPLIED/NOT_APPLIED/PARTIAL/UNVERIFIED 加备注和二次确认；显示等待进程停止/其他未知项状态，不把提交裁定等同于即时解除所有阻塞；保留适用的 verify-write |
| 记忆与恢复 | `GET memory` 的状态投影为正常/自动重试中（下次时间）/已停止（原因），保留后端诊断；summary、commitments 与来源按 ID 定位。session/compact、memory/extraction/retry；必要 session/resume 和承诺人工 resolve 提供明确入口，不重建已删除的 recovery binding UI |
| Settings 与 World | 分开有效说明、编辑草稿、已保存、apply 进度/失败；expected_revision 冲突保留本地内容，retry/restore-draft 可操作。World 目录、当前/历史事实和精确 slot 查询，新增/更正/撤回走共享 Settings 草稿及后端版本规则；不在 Swift 合并事实 |
| Scope | 新建/编辑/归档，展示名称/说明/根/默认写策略/状态；本机根用系统目录选择器，最终存在性与冲突由 Core 校验，不把远端路径当本机目录选择结果 |
| 授权规则设置 | 展示内建政策、用户规则、范围/时效/匹配时间和次数；支持禁用。此页不新建宽泛规则，创建只通过“批准并记住” |
| 名称与本地偏好 | assistant/profile 独立保存同步，不触发模型/记忆重建；字号/旁栏/流式与思考偏好和连接参数留在本地分组 |
| 产物与关联 | artifacts 独立分页和 task 筛选，related 使用明确范围；重名显示任务/时间，按 ID+content_version 缓存。受认证下载、进度/重试、检查长度/内容版本后原子落盘，再通过系统打开；不能打开 Core 绝对路径。显示相对 scope/任务路径，缺失就显示可用名称而非伪造路径 |

Markdown 选择采用 [swift-markdown 0.6.0](https://github.com/swiftlang/swift-markdown/tree/0.6.0)，其 Package 声明 Swift tools 5.7，许可证为 Apache-2.0 with Runtime Library Exception。它提供解析树，不提供完整 UI；原生渲染、长代码块/表格、选择复制与有界分页仍须验收。固定这一已发布版本是为了匹配工具链和控制依赖，不表示它是最新版本。

### A0：Core 公开投影补齐（B2，独立 PR1）

已核实 `operationView()` 只投影 Operation 与 receipt 元信息，未解引用实际参数及 stdout/stderr；`artifactView()` 未公开内部 Artifact.workspace_path。下列为 A0 合同范围，实施与验证结果见 §15。新增为 API v1 只读字段/路由，不修改裁定、审批或执行领域语义。

| 字段/路由 | 数据来源和语义 | 边界 |
| --- | --- | --- |
| Operation `display.parameters` | 从 `action.parameters_ref` 按已登记 action 的业务参数形状生成可读 JSON 文本；shell 命令/cwd/timeout、write 路径/内容、program ID/输入、world 修改参数等保持实际值 | 只在 `GET operations/{id}` 展开；列表保持轻量。不公开执行器环境、进程控制 token、CAS 文件路径或配置凭据 |
| Operation `display.stdout` / `display.stderr` | 读取已有持久 receipt 中对应文本；人工裁定后的 receipt.original_receipt 回溯至原作用回执，避免裁定覆盖已有输出 | 无回执或未落盘输出显示 unavailable，空字符串与 unavailable 分开；不得从“进程停止”推断成功或补造输出 |
| Operation `display.reason` | Operation.error，加 receipt 的 timed_out/truncated/signal/exit_code/not_started 等白名单证据生成原因文字 | 使用证据可支持的原因；保留 effect/process_state。未知/缺失显示明确短说明，不返回整个任意 receipt |
| 文本 envelope | 上述各段 `{state: available|unavailable, text, bytes, content_version, truncated, next_cursor}`；bytes 是完整公开文本的 UTF-8 十进制长度，version 是其内容指纹 | parameters 首片 16 KiB、stdout/stderr 各 32 KiB、reason 4 KiB；完整 JSON 响应含转义/外层最多 256 KiB，超预算继续缩片；不切断 Unicode，截断参数按文本显示，不解析残缺 JSON |
| `GET operations/{id}/content?part=parameters|stdout|stderr|reason&cursor=...` | 按需读取同一公开文本剩余分片，供核对实际长命令/参数与已有输出；仅接受该 operation 的已固定部件 | 每片文本最多 32 KiB；opaque cursor 绑定数据域、operation、part、content_version/编码位置，错域/错部件拒绝、内容变化要求重载；沿用认证/操作 scope 查询检查。不增加任意 CAS/文件读取接口 |
| `display.source_truncated` | 原执行回执的 truncated 标志；`null` 表示来源完整性未知 | 与分页产生的 truncated 区分，读完分片也不能将源头已丢失输出标为完整 |
| Artifact `relative_path`、`path_base`、`scope_id` | relative_path 取已存 workspace_path；path_base 为 scope/task/unknown，依据所属 Execution 的固定 workspace_binding，旧记录无 binding 时仅用确证的任务根来源 | DIRECTORY 为 scope，NONE 为 task；无可靠来源返回 null/unknown，不能按 basename 猜完整路径。拒绝绝对路径、越界 ..、NUL；超过 4096 UTF-8 bytes 返回 null 并附 `path_unavailable_reason`，不截成错误路径。仅作展示，下载仍按 ID+version |

参数/输出是已认证 owner 核对作用的证据，不能凭字段名或正则盲目脱敏、改变真实业务参数（现有 `api/protocol.ts` 也明确保留 parameters 原值）。采用白名单公开业务字段、排除内部凭据和进程环境；任意用户文本中可能本来含敏感值，不声称自动清洗万能。完整内容只在受认证详情按需读取，不放列表/SSE/系统横幅/普通日志；公开测试与报告使用合成内容。此处采纳敏感信息边界要求，不采纳会破坏实际证据的通用脱敏。

源码涉及 `application-service.ts` 的 operationView/artifactView、`api-v1.ts` 的只读路由与现有 cursor 工具、`docs/api/v1/schema.json` / `operations.json`；通过 `api:generate` 同步 TS/OpenAPI，并更新 examples/Swift 样例和 API 手册。API v1 加字段不重写历史 Store 或 World；缺失旧字段按 null/unavailable 展示。解引用校验内容散列；只读不修改 receipt、留存或作用状态。来源解析有上限，超大参数/回执采用有界读取/解析，不为截出小前缀先无限读入整个对象；来源损坏与不可用要可区分。

A0 独立验收：shell/write/program/world 参数与现有真实作用一致；RESULT_UNKNOWN 的已有输出/原因、裁定后原回执仍可见、崩溃未留输出显示 unavailable；首片/续片含 Unicode 与 JSON 转义预算，source_truncated 不被分页覆盖；cursor 串域/串操作/串部件拒绝；公开字段不泄露执行环境/token/CAS 路径，GET 不写 journal/不续留；scope/独立任务产物及旧记录缺失路径、恶意路径/超长路径/重名与内容版本分别覆盖。合同生成、Swift 样例解码与 Core 回归通过后才能由后续客户端 PR 消费。

A0 核对的页面 DTO 使用清单如下。已确认 remember_context/display_hash、next_attempt_at 存在；这里只确认合同入口，原生交互和字段组合在后续 PR 验收。

| 页面/底座 | 已有 DTO 与命令 |
| --- | --- |
| 发现、连接与可靠命令 | Core、ClientRegistration、RequestStatus、Receipt；ClientCommand、EmptyCommand |
| 同步与通知 | SyncCursor、SyncPage、SyncTransaction、NotificationPage/Notification；PresentedCommand |
| 会话与导航 | Assistant、Session、Timeline、Message、Activity、RelatedPage、Attention；MessageCommand、ProfileCommand、session compact/resume |
| 任务与范围 | TaskPage/TaskDetail、PendingRequestPage、TaskRequestStatus、ExecutionPage/Execution、ScopePage/Scope；TaskCommand、ScopeCreateCommand/ScopeUpdateCommand、cancel/viewed/archive |
| 审批、决定、未知结果 | AuthorizationPage/Authorization、DecisionPage/Decision、OperationPage/OperationDetail/OperationText、RulePage；ApprovalCommand、AnswerCommand、OperationResolveCommand、RuleCommand、verify-write/disable |
| 记忆与 Settings/World | MemoryStatus、MemoryPage、CommitmentPage、Settings、WorldPage/WorldSlot；ResolveCommand、DraftCommand、RevisionCommand、apply/retry/restore-draft/extraction retry |
| 产物与管理 | ArtifactPage/Artifact、固定版本二进制下载、ProgramPage；ProgramCommand、World migrate/Core stop |

设备仍按 capability 禁用。字符串修订号、未知状态、缺失来源、能力/权限/连接/加载状态由客户端分别处理。

## 8. 用户能力迁移与退役门槛

2026-10-14 计划复审修订：退役与 Issue #10 关闭使用两级门槛，具体以 [PR3 §4](fix_20261014_issue10_PR3原生联合验收与旧入口退役.md#4-用户能力迁移与删除门槛) 为准。退役须证明原有日常能力在原生端可操作、低频管理有新版入口且旧领域断言全部迁移；系统通知、VoiceOver、睡眠、真实模型及大文件等完整质量验收仍是关闭 Issue 的要求，不单独阻塞能力对等已通过的旧链删除。以下保留原能力清单，不再将全部联合实机验收合并为删除前置。

下表是实施前迁移清单；“原生”表示目标位置，当前均未验收。实施时逐行补证据和状态，不提前写“已替代”。

| 现有能力 | 目标入口 | 删除旧入口前必须证明 |
| --- | --- | --- |
| 对话、历史、活动、预览/可见思考 | 原生对话 | 发送对账、分片、阅读保持与重启恢复 |
| 创建/查询/接续任务、取消/反馈 | 原生任务 | 含 scope 的完整任务流程与取消待请求 |
| 审批、工作决定、规则、未知结果 | 原生详情 + 设置 | 三种审批操作、冲突、规则生效/禁用、四种裁定 |
| 说明与 World 修改、失败恢复 | 原生设置/记忆 | 草稿→应用、版本冲突、retry/restore、World 修改 |
| 整理、补提、会话恢复、承诺裁定 | 原生记忆/状态入口 | 正常/退避/停止和必要恢复均可操作 |
| 通知、来源定位、附件/产物 | 原生时间线/记忆/产物 | 真实 presented/read、ID 定位、下载打开 |
| Core 启动/附着、状态/停止、排障 | 原生连接 + Core 管理命令 | 无 UI Core 独立工作，退出 UI 不停任务 |
| World 迁移、程序登记等低频运维 | 新版管理 API/Core 操作文档 | 可按文档执行，不依赖 TUI 文本命令 |
| 设备、手机推送、定时唤醒、新 TUI、上传/语音 | 明确后续扩展 | 说明边界，设备禁用，不制造空白功能页 |

会话恢复来源为旧 `tui.ts` 的 `/resume`（调用 Host.resume）及既有 API `session/resume`；承诺裁定来源为 `/memory-resolve` 与 `memory/commitments/{id}/resolve`。保留这两项是 Issue #10 §7“日常流程与必要恢复必须有可用入口”的迁移要求，不新增后端能力；放在对应异常状态或承诺详情，不给记忆主页额外堆按钮。

PR3 的 G-retire 通过后才删除 Web 静态资产、旧浏览器启动代码和仅服务旧客户端的 TerminalController 链、旧 npm 脚本及死协议代码。旧客户端独占源码直接删除，以 Git 历史作参考，不保留无入口的死代码；共享投影先用依赖扫描确认新版使用情况。领域测试迁移到 ApplicationService/Core API 后保持等价断言，旧渲染专用测试以 Swift 对应覆盖替换，历史记录保留版本含义。处理 `docs/migration-map.json` 与当前文档链接，避免删除代码后留下坏链接；不批量改写历史报告冒充新验收。

README 默认介绍 SwiftUI 日常入口并保留无 UI Core 管理；新版 TUI 仅列未来路线，要求复用 API v1。退役不删除 Store、World、历史附件或任何作用证据。必要回退为回退客户端/代码及匹配备份，未知作用继续原 ID 对账，不通过恢复旧协议规避迁移。

## 9. 实施顺序、文件与估算

| 阶段 | PR 单元 | 交付与主要文件 | 估算 |
| --- | --- | --- | --- |
| A0：Core 合同 | PR1 | §7 字段/有界内容读取、生成合同、样例和独立回归，不夹带 Swift UI 或旧代码删除 | 1–2 人日 |
| A：工程与 DTO | PR2a | Xcode app + Package、DTO 清单、固定 Markdown 依赖、macOS CI 与构建手册 | 1–2 人日 |
| B：可靠连接底座 | PR2a | URLSession、发现/启动、SQLite/outbox、身份隔离、SSE/失效/恢复、通知适配与故障注入 | 2–3 人日 |
| C：聊天和导航 | PR2b | 简洁壳层、输入/阅读锚点、Markdown/长文本、预览和关联旁栏 | 1.5–2.5 人日 |
| D：日常管理流程 | PR2c | 任务/审批/决定/未知结果、记忆、Settings/World、Scope/规则、产物 | 3–4 人日 |
| E：验收和退役 | PR3a / PR3b / PR3c | a：下载与拒绝合同；b：能力对等、断言迁移与退役；c：完整联合验收和结项证据 | 6–10 人日，详见 PR3 修订计划 |

最初估算合计 10.5–16.5 人日为历史规划；剩余 E 阶段按 2026-10-14 的 PR3 分项粗估更新，不能用历史总数作当前承诺。工具安装由 Master 完成，不计实现工期。PR1→PR2a→PR2b→PR2c 已完成；PR3a/PR3b 功能独立，PR3c 依赖两者合入。每个 PR 保持可构建和自身验证通过，未完成页面禁用并说明，全部使用 Refs #10。可先准备后继分支，不能将未合入合同当 main 已有能力。

PR2c 验收完成是 PR3 的前置；PR3b 删除独占旧测试前保留等价领域断言并通过 G-retire，PR3c 补齐完整原生联合验收。Core 合同、客户端和退役可分别回退；代码回退不恢复受支持的旧协议。只有三个 PR 经 Master 复核合并、全部必需验收完成且最终 main CI 通过后才单独关闭 #10，不使用合并时自动关闭。PR 切分是计划，不代表本轮已获推送/合并授权。

文档涉及：`README.md`、`docs/native-client-design-v0.3.md`、`docs/operations.md`、`docs/testing.md`、`docs/repository-layout.md`、`docs/README.md`、`docs/api/v1/README.md`，以及新增原生构建/使用手册与能力迁移记录。涉及合同则从源 schema 同步生成类型/OpenAPI/样例。根 `package.json` 增加原生命令并清理旧入口，`.github/workflows/verify.yml` 增加 macOS 构建/Swift 测试 job，保留 Linux Core/PostgreSQL 门禁。

## 10. 验证与完成标准

批准开工后先保存提交/工具链指纹与首次失败，再作修改。业务验证使用 fixture Core、独立数据目录和 `secretary_test_` PostgreSQL 数据库，不能附着生产目录做故障注入。

| 层级 | 必验场景与证据 |
| --- | --- |
| Swift 合同/单元 | 全部页面使用的 DTO；未知字段/枚举、版本/认证错误、超大十进制序号、中文/emoji/组合字符；shell token 原样展示与 remember 请求；维护状态映射 |
| 持久恢复 | 发送响应丢失、落盘失败、客户端退出、原 ID 对账/同参重投/改参冲突；两个域切换、同域 Core 重启；缓存升级不丢 outbox |
| 同步 | 半个 SSE frame 断线、重复事务、空变化事务、分页并发修改、聚合根 revision 不变、乱序成功/失败、RESYNC_REQUIRED、重建时写入、超预算断线；结果与 Core 收敛且水位不越过未落盘内容 |
| 双客户端 | 同时发消息、编辑共享草稿、处理审批/决定、修改 scope/禁用规则；无重复作用或静默覆盖，失效查询能看到他端变化 |
| 通知 | 首次历史不弹、后台接收不伪报、系统权限拒绝回退、系统已送达/应用内可见才 presented、明确阅读才 read、重启去重与崩溃窗口 |
| 任务与日常流程 | 启动/附着→聊天→带 scope 任务→默认自动放行→批准并记住→再次同类操作自动放行→结果/产物；人工未知场景四种裁定及阻塞收束；详情刷新不续留、明确访问才 viewed |
| 记忆/设置/World | 三种维护状态、立即整理/重试补提、来源 ID 定位、草稿冲突保留输入、apply/retry/restore、World 当前/历史/修改与未配置状态 |
| 产物与资源预算 | 分页/同名/版本变化/归档/中断下载、长度与内容版本核对、系统打开受管理本地文件；长会话/长代码块分片正确，记录缓存峰值与淘汰后恢复 |
| 真实 macOS UI | 1280×860、1440×900、1024×768、720×520、分屏和放大字号；名称空白/超长、更多菜单/右栏、跨页待处理、焦点/键盘/VoiceOver、中文 IME、文本选择、草稿/阅读恢复 |
| 生命周期 | 关窗/退出不停止已受理工作；断网、Core 重启和 Mac 睡眠/唤醒后恢复相同数据域/session 并对账。整机睡眠实测安排在可中断窗口，不影响其他工作；未实测就保留 NOT_TESTED |
| 退役与全仓回归 | 迁移表逐项验收；旧协议/静态路径不能执行或返回旧页面；新版 Core 无 UI 回归、Swift 构建/测试、`npm run verify` 与 PostgreSQL 验证通过，CI 对应提交通过 |

真实 macOS 构建、窗口操作和通知证据分别记录，不能用静态检查或截图替代交互验证。真实模型最小联调在隔离环境验证聊天与一条任务结果链，记录实际调用、失败与限制；未具备凭据/工具链则明确阻塞，不能用 fixture 冒充真实模型通过。

Issue #10 完成条件：原生必需流程和上表验收完成、能力迁移逐项有证据、旧入口退役、文档描述实际行为、对应 CI 通过。功能实现、本地验收、提交/推送、PR/CI、合并与部署分别记录；不将后续美学设计作为功能结项前置。

## 11. 风险与处理

- 简洁 UI 不能隐藏长审批参数或恢复操作：详情按需展开，但所有实际操作与范围提交前完整可读。
- Xcode 16.4 由 Master 准备：Codex 在工具就绪后核验固定版本、scheme、app bundle 与通知条件，不安装工具、不更改全局开发目录；缺口未解决时不启动原生构建验收，也不降级验收范围。
- 旧客户端测试混有业务断言：逐项映射迁移后再删旧链，不能靠删失败测试得到绿色。
- 缓存与系统通知跨进程窗口无法天然原子：保留请求身份、实际展示证据与可重放同步，不夸大成功/已读/去重保证。
- 计划范围较大：按 A0 与 A–E 分段交付和验证；若发现需改变领域语义或新增服务端能力，先明确差异及影响，不隐藏在 UI 实现中。

## 12. 执行记录

- 2026-10-13：读取当前 issue/依赖、核对 main 与源码，完成领取和计划分支；记录简洁 UI 与后续美学设计要求。
- 本轮只新增本计划与计划索引。未修改业务代码、运行 Swift/Core 业务测试、启动服务、删除旧入口或部署。
- 静态检查：`npm run docs:check` 通过（215 份 Markdown、3243 个本地链接、0 错误）；`git diff --cached --check` 通过。定向敏感信息检查仅命中公开 Git 提交指纹，未纳入本地历史报告或运行数据。实施和全部功能验收均待 Master 确认。

## 13. 2026-10-13 审核意见评估

审核对象为计划提交 `91b8601`；报告 `review_20261013_fix-plan_issue10_native_client.md`，审核人 Ayanami Rei。本轮只修订计划，未开始业务实现。

| 意见 | 决定与理由 | 落点 |
| --- | --- | --- |
| B1 工具链 | 采纳固定工程/工具链要求；Master 已承担安装，采用 Xcode 16.4 + app target/Package，非手工 bundle 降级；纠正 VoiceOver 必须依赖 Xcode 的过强表述 | §3 |
| B2 已知合同缺口 | 采纳；已从源码确认参数/回执来源与 workspace_path，新增字段级清单、大小上限、证据边界和独立验收 | §7 A0 |
| B3 PR 粒度 | 采纳并进一步将客户端分为底座、聊天、管理三 PR；最终退役独立，全部验收与 PR3 合并后才关闭 | §9 |
| 建议 1 缓存简化 | 部分采纳：只保留最近窗口与必要详情，其他重建；对外两项磁盘预算。保留内部内存/SSE 硬上限，避免无界流量，不引入额外 LRU 层 | §6 |
| 建议 2 Markdown | 采纳，选 swift-markdown 0.6.0 并锁传递依赖；许可证准确记为 Apache-2.0 with Runtime Library Exception | §7 |
| 建议 3 通知 | 不按原回调方案采纳：willPresent 在展示前，didReceive 为用户响应。保留系统通知中心存在性或实际应用内可见证据；改为有限次数核对，仍不把 presented 当 read | §6 |
| 建议 4 恢复范围 | 采纳标明来源的要求，保留现有 resume/承诺裁定以满足迁移门槛；不增加新的领域能力或主页控制台 | §8 |
| 建议 5 旧源码 | 采纳，独占死代码删除，Git 历史保留参考；共享领域代码与业务断言必须保留/迁移 | §8 |
| 建议 6 架构认可 | 保持 endpoint/数据域隔离、三类 cursor 和 request_id 对账；本轮不扩远端部署 | §5–6 |

复审状态：B1 的工程与工具链方案已明确，环境安装仍待 Master；B2/B3 及非阻断建议已在计划落实。文档修订不等于环境已安装或实现已通过验收，整体仍为 PLAN_ONLY / WAITING_FOR_MASTER_APPROVAL。

本轮复审修订的静态检查：`npm run docs:check` 通过（215 份 Markdown、3243 个本地链接、0 错误），`git diff --check` 通过；仅改本计划，未运行业务测试或操作 Xcode 环境。

## 14. 实施授权与工具准备

2026-10-13，Master 授权子代理跟踪 Safari 中的 Xcode 下载，下载完成后配置工具链，然后开始开发。此授权覆盖 Xcode 配置和本计划的业务实施，替代先前“由 Master 配置/等待实施确认”的安排；仍不更改全局开发目录、不合并或部署。子代理负责下载与工具配置，Codex 主任务在工具就绪前只做源码预检与实施准备。需要系统管理员交互时由 Master 完成。

当前已确认下载目标 Xcode 16.4，来自 Apple Developer；尚在下载，未启动业务代码修改或测试。就绪后按 A0 / PR1 先补 Core 公开合同，再推进客户端工程与各项验收。

工具进度：下载已完成，安装包与应用均通过 Apple 签名检查，已展开至 `/Applications/Xcode.app`，版本 16.4（16F6）。首次启动检查返回 69，原因是尚未接受 Xcode and Apple SDKs Agreement；已打开协议窗口，按电脑操作工具要求等待 Master 当场确认，未代为接受。Swift/macOS SDK/首启可用性尚未完成验证，不视作工具链就绪；未修改业务代码或运行业务测试。

只读预检补充：`GET tasks` 已返回 scope_id，但查询参数白名单未接受 scope 筛选。A0 增加 `GET tasks?scope_id=<UUID|none>`，省略表示全部、none 表示未关联 scope；筛选先于稳定分页，cursor 绑定筛选值，覆盖跨 scope 游标拒绝、空结果和并发变化收敛。该改动落实本 issue 已批准的任务筛选要求，不修改任务/Scope 领域语义。已保存改动前源码指纹，原始证据留在忽略目录，不进入公开提交。

Master 随后当场同意 Xcode and Apple SDKs Agreement，子代理接受许可并完成初始化：Xcode 16.4（16F6）、Swift 6.1.2、macOS SDK 15.5，checkFirstLaunchStatus 退出 0。Xcode 首启自动选为系统开发目录；普通权限恢复尝试被系统拒绝，未提权，保留自动选择结果。本项目显式使用 DEVELOPER_DIR 固定工具链。

A0 在 `codex/issue10-core-projections` 分支实施。原 API 基线 32 项：30 通过、2 项因未提供测试 DSN 跳过、0 失败；后续完整验证提供已确认可用的 PostgreSQL 18 专用测试连接，覆盖这两项。源码指纹和首次日志已保存。

## 15. A0 实施记录

已增加 OperationDetail/OperationText：白名单参数、原始输出、原因及长裁定说明可分段续读，列表不内联长文本。新增 Artifact 相对路径定位和 tasks.scope_id 筛选；schema/operations 为源，同步生成 TypeScript/OpenAPI，更新中文 API 说明和 Swift 样例。

Core 新增固定运行依赖 stream-json 3.7.0（BSD-3-Clause），只用于逐 token 解析 CAS JSON，16 KiB 输入缓冲、深度 64、所选嵌套键最多 8192 字符。保留本页文本与摘要，校验完整源字节散列；不通过 Store.read/bytes 把整份输出载入内存。裁定摘要是实际 note 前缀，note_truncated 明示，完整 note 由 reason 续读。大型源仍需扫描以校验完整性，未声称常数时间读取。

首次类型检查发现分页泛型丢失，已修复；新增测试首轮在合同定义加入前失败，并发现流关闭掩盖来源错误，改用 FileHandle 生命周期。带数据库的定向回归首次 35 通过、1 失败，发现列表损坏回执被静默吞掉；已恢复当前页报错语义，保留原断言。所有首次日志和基线哈希留在忽略目录，后续通过不覆盖首次失败。

本阶段不包含 SwiftUI 窗口、原生同步/命令持久层或旧入口删除；后续继续按 PR2a–PR3 和简洁 UI 约束推进。

本地验证结果（2026-10-13）：

- `npm run verify` 提供 PostgreSQL 18 专用测试连接，退出 0；574 项中 573 通过、0 失败、0 跳过，保留原有 AUD14 TODO 1 项，约 736 秒。数据库场景使用 helper 新建/销毁的 secretary_test_ 数据库。
- 最后补充响应转义预算、错数据域游标、缺失来源、Scope 产物与长路径断言后，Issue10 + Issue18 裁定定向回归 20/20 通过；最终类型检查通过。此定向结果包含全量运行启动后新增的 1 个用例，不将其算入上项 574。
- Xcode 16.4 下 Swift 公开 DTO 样例解码通过；API 重复生成无差异。文档检查 215 份 Markdown、3243 个本地链接、0 错误；改动文件格式检查、diff 检查通过。
- 改动前指纹、首次失败和后续日志保留在本地忽略目录；暂存仅含 17 个本批源码/测试/合同/文档文件，没有原始报告或私有路径。未运行原生窗口或真实模型验收。

交付范围为本地 A0 分支，尚未推送、创建 PR、合并或部署。Issue #10 保持进行中，下一交付单元为 PR2a 原生工程及可靠连接底座。

## 16. A0 审计处置与 PR1

Master 已授权按 `review_20261013_pr_issue10_A0_core_projections.md` 评估修复、推送、创建 PR 并等待 CI 后通知复核；不合并或推进 PR2a。审计基线为 1fdea9e，结论无代码阻断。独立审计的 40 个 PostgreSQL skip 不能当作数据库通过，本轮本地与 CI 均提供专用 DSN。

| 审计项 | 处置与原因 |
| --- | --- |
| 1：完整续读反复扫描、补 4 MiB 计时 | 已修复常见范围：Core 实例持有已校验公开文本缓存，上限 16 MiB / 64 项、单段最多 8 MiB；源状态检查失败立即失效。4 MiB 的 128 页续读只读源两次（metadata + 目标文本），通过内容散列核对全量结果。大于单段上限、缓存淘汰或实例重启仍流式重读，保留可读性且限制缓存，不宣称所有尺寸/并发访问都为线性。 |
| 1 的替代方案：扩大页面到 256 KiB | 未采用。32 KiB 文本可在最坏 JSON 转义下保持完整响应 256 KiB 上限；256 KiB 原文不能保证现有响应预算。采用缓存改善重复读取，不改变已确定的客户端合同。 |
| 2：详情 divisor 循环重复扫描 | 已修复。各首片只生成一次，复用同一次 original 回溯；缩片只处理首片并重新签发正确偏移游标，不重读源。保留各字段流式抽取，不要求同时把所有来源载入内存。最坏转义测试确认整个详情仅 7 次来源读取，与缩片轮数无关。 |
| 3：移除 stream-json，改成限长 Store.read | 本轮不采用。4 MiB 约束来自 shell 输出，不能外推至 file/program/world 参数、历史回执或裁定说明；固定总源文件阈值会把此前可续读的合法证据变成不可用。继续使用现有流式校验和结构上限，新增缓存独立受限，不依赖完整源 JSON 解析。 |
| 4：tasks.scope_id 计划增补 | 保留，无需再次修改。它落实已批准的范围筛选，已有筛选先于分页、cursor 绑定和 none/all 测试，不改变任务领域行为。 |
| 5：reason 不分页 | 未采用。reason 包含实际错误和完整人工裁定说明；省略分页需要截断并失去完整核对入口，或破坏响应预算。继续统一分片合同，UI 显示摘要并按需续读，不额外增加页面复杂度。 |

性能实测：同机 Node 22.22.0，隔离 fixture，stdout/stderr 各 4 MiB Unicode 内容，32 KiB 首页与续页共 128 页，逐页拼接 SHA-256 与原文一致。修改前 15,942 ms，修改后 259 ms，约 61.5 倍；紧随续读的详情查询从 488 ms 到 350 ms。这是同一探针的单次对比，不是跨机器性能保证；原始计时与首次失败日志保留在本地忽略目录。测试使用固定读取次数断言，而非易受 CI 机器影响的耗时门槛。

定向回归 24/24 通过，包含 4 MiB 全续读、缓存字节/条数淘汰、暖缓存后源损坏/删除/symlink 拒绝、详情缩片读取次数、既有 Unicode/游标/人工裁定语义。首次修订检查发现 nullable receipt 守卫与 reason 闭合遗漏，已修复，保留首次记录。最终类型检查通过；本轮提供 PostgreSQL DSN 的完整回归及 PR CI 以 PR 验证记录为准。

PR1 使用 `Refs #10`，不关闭 Issue；CI 必须为最终 head、fail=0、skip=0 后才通知 Master 复核。PR1 经复核合并后，PR2a 再从更新的 main 创建，重新核对 Xcode 16.4 指纹。UI 仍按简洁功能界面实施，后续单独做美学设计。

## 17. PR2c 日常管理本地验收

日常管理实现与本机验收已完成：31 项 Swift 测试、真实 Core HTTP／隔离 PostgreSQL World 探针、3 项管理 GUI 和原 7 项聊天／窗口 GUI 全部通过。能力迁移与使用说明见 [原生手册](../../src/secretary_macos/README.md)，首次失败、最终日志与源码指纹见 [PR2c 证据](evidence/issue10-pr2c-20261013.txt)。最终 PR head 的三项 CI 与 Master 复核仍是独立发布门槛；本阶段不合并、不关闭 Issue #10、不删除旧入口或部署，PR3 保留完整替代联合验收。
