# Secretary macOS

Issue #10 的原生连接、聊天与日常管理客户端。任务、审批／决定／未知结果、记忆、Settings/World、Scope、规则与产物均通过公开 API v1 接入。界面使用简单原生控件，后续再做美学设计；PR3b 完成旧能力迁移与入口退役，完整系统联合验收归 PR3c。

## 构建与运行

需要 Xcode 16.4 (16F6)、macOS 14 或更新版本。Swift 6 语言模式；本地运行签名，不要求开发者团队。工程位于 `Secretary.xcodeproj`，共享 scheme 为 `Secretary`。首次运行由系统决定是否允许通知；不会自动启动 Core 或请求通知权限。

```sh
# 在仓库根目录
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
npm ci
src/secretary_macos/verify.sh
open .build/native/Build/Products/Debug/Secretary.app
```

选择已有 Core 的数据目录并附着。首次启动时展开配置，选择 **Node 可执行文件**及安装过依赖的 **Core 仓库目录**，再点击“启动本机 Core”。参数以 Process 数组传递，不执行 shell 字符串。fixture/live 必须与 Core 一致。数据目录包含私有 `core-endpoint.json`；凭据只在内存中用于本机 HTTP，不进客户端数据库、日志或 UI。退出/断开 app 不停止 Core。

全应用共用唯一窗口，关窗会退出客户端；Core 仍独立运行。启动后没有可见窗口时，点击 Dock 图标，或选择 Window → 打开主窗口（⌘0）恢复；已有窗口只激活。客户端数据位于当前用户 Application Support 下 `Secretary/client.sqlite`（目录 0700，文件 0600），不与 Core Store 混用。WAL/FULL 同步；schema 不兼容时停止，不自动删除 outbox。数据库和日志属于本地私有数据，不应提交仓库。

本机窗口测试：先运行 `verify.sh` 构建，再在已解锁图形会话运行 `node test_case/native/ui-fixture.mjs`。脚本创建独立 fixture Core 和 Debug 客户端数据库，测试结束只停止自己创建的 Core；失败保留私有数据及日志。冷启动回归隔离恢复状态，菜单和 Dock 测试使用 `-ApplePersistenceIgnoreState NO`，通过 Debug 专用钩子让关闭最后一个真实窗口后进程仍存活，直接断言 0 个窗口，再经恢复入口断言 1 个可用窗口。该钩子不进入 Release，正常关窗退出行为保持不变。CI 编译 UI test target，不以编译替代本机 XCUITest。

## 聊天与导航

名称按钮返回对话；设置区分连接配置、本地显示与 Core 业务设置。任务、记忆、产物和跨页待处理入口可用，设备仍冻结。宽窗提供 180–220 pt 关联旁栏，对话可用宽度不足 800 pt 时收起；正文支持 13–20 pt 本地字号。保持简洁，后续再做美学设计。

- 输入没有可见占位文字，带“消息输入”可访问标签。Return 换行，⌘Return 发送；输入法组合态不发送。已提交的编辑同步保存；本地 outbox 与草稿删除事务成功后才清空输入。最近 30 条发送记录区分受理、失败和待确认，受理不代表助手回复已完成。发送区域独立显示 messages 不可用的 state/reason，离线或未提供能力也有明确说明。
- 最新页、较早/较新页、消息或事件 ID 定位、正文续读均使用公开 API 与 opaque cursor。单页请求 30 条，客户端上限 200 条/16 MiB 正文，单条续读最多 4 MiB；到上限保留已读内容并提示。最近页受持久投影预算保护，历史分页按需读取，不复制全部历史。
- 阅读位置按消息 ID 和局部偏移保存。最新模式追加回复保持贴底；用户阅读历史、选择文字或展开正文时保留视口，新数据提示“有更新”，由“回到最新”恢复。续读相同 revision 不被首页片段覆盖；revision 变化重新取新正文。偏好切换清除隐藏正文，使旧请求失效；预览按 call_id 对齐最终消息，不推进 durable cursor。
- GFM 解析为原生文字、列表、引用、代码与表格；代码可复制，代码/表格各自横向滚动。超过 256 KiB 的单条正文在 240 pt 局部滚动区域使用只读 NSTextView/TextKit 2，既不解析 Markdown，也不让整个正文参与 SwiftUI 高度计算。HTML 块使用 Text(verbatim:) 原样展示，只允许打开经过 scheme、主机、凭据和控制字符检查的 http/https 或无查询参数的 mailto 链接，无 WebView/脚本执行。
- 关联只使用 Core 明确返回的 session/message 关系，每类最多 5 项，可进入任务／产物详情。活动行暂不提供关联按钮：其 activity ID 不是公开 event locator，不能猜测映射。后台查询不提交 viewed，只有显式打开执行详情才续留。待处理入口提供审批、工作决定、未知操作及通知；已读由明确动作提交。

## 日常管理

- 任务默认显示全部，可按 Scope 筛选。Scope 选项每次保留 30 项，可翻页及返回首批，已选项不会因翻页丢失。创建或基于最新执行接续，材料、约束、验收及时间参数使用独立字段；空白可选项交由 Core 默认处理。执行详情展示条件、结果、局限、等待请求和未知操作。
- 审批展示完整实际参数、有效期、revision/display hash；批准一次、拒绝、适用的撤销，以及按服务端 token／目录前缀“批准并记住”都有确认。规则页显示内建策略、用户规则范围、期限和匹配次数，可禁用用户规则。
- 工作决定与权限审批分开。未知结果支持四种裁定及备注；证据按 opaque cursor 续读，每部分最多保留 4 MiB，源截断与不可用原因独立显示。受理不等于所有阻塞解除。
- 记忆包含摘要、承诺、维护诊断、自动重试时间与恢复入口。来源仅使用公开 event ID，不可定位时明确显示。人工处理承诺须填写备注。
- Settings 分开有效说明、Core 共享草稿和本地编辑。World 实体／事实通过领域表单加入本地草稿，保存再应用；目录、当前／历史事实与精确 Slot 可查询。版本变化不会覆盖编辑；原请求对账后显式开始新意图，再采用新版本号。失败应用可重试或恢复为共享草稿。
- 名称独立保存。Scope 支持系统目录选择、默认写策略、编辑和归档。产物按任务过滤与分页，认证下载可取消／重试；同名产物保持独立标识，系统仅打开校验过的受管理缓存。
- 编辑与原请求 ID 在同一事务保存，切页／重启保持输入。UNKNOWN 不允许新建替代意图。API 明确未受理的 400/404/409/410/422 保留拒绝原因及原字节，停止重投，不阻塞其他命令。写盘失败保留当前进程的编辑并提示保留应用；这不承诺磁盘不可写时安全退出。

管理 GUI 使用受控 Core 夹具，合成审批、决定、未知操作和产物，客户端仍只使用真实 HTTP：

```sh
# 先完成 verify.sh 构建
node --import tsx test_case/native/management-fixture.ts --ui
```

原 `ui-fixture.mjs` 继续执行原有 7 项聊天／窗口回归；管理 GUI 为独立 3 项。设置 `SECRETARY_TEST_DATABASE_URL` 可使管理探针额外覆盖真实 PostgreSQL World 新增／更正／撤回、冲突、重试及恢复；helper 只新建、销毁自己的 `secretary_test_` 数据库。macOS CI 不提供 PostgreSQL 时不将该覆盖记为通过，本机数据库证据单列。

## 连接与持久化

- 公共通用 DTO 在 `Contract.swift`，管理 DTO 按领域拆分。revision、sequence、bytes 保留十进制精度；opaque cursor 不解析。未知状态保留原值且不授权未知操作。
- `ClientEngine` actor 持有同步 SQLite 连接；`ChatLocalState` 和 `ManagementLocalState` 在 MainActor 各持有同一 WAL 数据库的连接，让编辑/入队在 UI 返回前完成。各连接不跨 actor 使用，写事务由 SQLite 串行化。网络 await 后校验 generation，校验到写入之间不让出 actor。数据按 owner/domain/session 隔离；实例变化重新查询所需首页，保留同域 durable cursor 和 outbox。
- 草稿删除与完整 outbox 入队同事务；联网只能发生在入队提交后。入队必须携带编辑时的目标 Identity，防止旧窗口向新域提交。对账先 GET requests/id，只有此前未受理且确认为 NOT_FOUND 的 404 才重发原 ID、原路径、原字节。已知 UNKNOWN 不重建命令，旧 session 未受理命令保留。注册及以明确通知 ID 为目标的 presented/read 是域级命令，允许同域换会话后续传。
- `client_id` 由 Core 注册回执中的 ClientRegistration 分配。客户端生成并持久化的是注册 request_id；回执、分配 ID 与 outbox 状态同事务保存。重启沿用原请求，不能把本地 UUID 当作已注册 client_id。
- bootstrap 取 S → 所需投影 → changes → SSE。每次事务先置 stale，再刷新已观察查询，最后投影/失效标记/cursor 原子提交。刷新失败保留旧水位。同一查询仅最新请求可写入，最新失败不允许旧成功解除 stale。RESYNC 仅重建可恢复数据。保留最近 1024 个已应用 cursor 抑制重复，未见过的事务顺序遵循 Core 有序流合同，不解析 opaque cursor。
- 可重建投影磁盘预算 256 MiB，按最后确认时间淘汰；protected 表不淘汰。单响应 8 MiB、同时读取最多两个、最多 16 个等待读取、事务暂存 8 MiB、变更页 8 MiB，原始响应工作集至多 32 MiB；解析器/SQLite/系统库额外内存不包含在此数字中。SSE 单帧 4 MiB，逐帧 await 消费，EOF 半帧丢弃、重连从已提交 cursor 重放。outbox 逐行对账，不把整个队列加载进内存；通用检查接口返回前 8 行，编辑器按自己的原请求 ID 对账。
- 独立产物磁盘预算 1 GiB。下载使用独立 ephemeral URLSession，等待新数据的超时为 30 秒，资源总时限保留系统默认，不继承普通请求的 60 秒限制。系统将数据落到临时文件；传输层检查长度/ETag、权限和取消后移动文件，不遍历内容。缓存接纳时按 64 KiB 分块做一次完整 SHA-256，缓存命中仍校验，校验中和正式接纳前响应取消。仅完成校验的 URL 可以系统打开；下载中禁用重复提交，缓存层另有 busy 兜底，不新建队列。重复点击不会取消原下载，完成、失败或取消后可重试。
- 产物文件以 owner/domain、artifact ID 和版本散列命名，服务端绝对路径不会成为本地打开目标；不把二进制放入 JSON 内存，中断临时文件不会成为可打开文件。进度按下载代次隔离，旧传输回调不能污染新下载；同页刷新发现 ID、版本或长度变化时取消旧下载并清除旧打开入口；重连从首页重建不复用旧实例的分页游标。缓存容量不等于临时磁盘峰值；跨卷移动可能由文件系统复制，不承诺所有路径均为零复制。
- HTTP 不跟随重定向、不用 cookie/cache，超预算即取消传输。可恢复断线退避重试（1–30 秒），认证/协议/存储问题停下并显示原因；唤醒重新发现。URLSession 连接定期结束时也走持久水位恢复。

## 能力迁移清单

| 范围 | 当前状态 | 后续 |
| --- | --- | --- |
| Core / Capability / Receipt / RequestStatus / ResourceID | 已解码，RequestStatus 只消费 receipt；业务结果保持 Core 权威 | 资源详情承担业务结果呈现 |
| SyncCursor / SyncChange / SyncTransaction / SyncPage | 已解码，事务应用与恢复 | 页面订阅使用同一 engine |
| Notification / Content / Presentation | 通知列表和明确已读动作 | 系统通知联合验收仍属 PR3 |
| assistant / session / notifications 首页 | 名称编辑、会话及通知 | 使用共享连接与身份隔离 |
| Message / Timeline / Activity / Related / text continuation | 分页、锚点、预览、正文续读、Markdown 和关联详情 | 不猜 activity/event 映射 |
| Task / Execution / Decision / Authorization / Operation / Artifact | 分页、详情、领域表单、持久命令及二进制下载 | 仅使用公开投影，不旁读 Store |
| Memory / Settings / World / Scope / rules | 维护、领域表单、查询与恢复入口 | 程序登记仍属管理 API |

所有路由与字段以 `docs/api/v1/operations.json`、`schema.json` 为准。测试复制官方合成 `examples.json`；verify 比对副本，合同更新不能悄悄落后。

## 通知证据

通知按稳定分页逐页处理，不能把只含历史的第一页当作完整列表。初次 S 之前的通知不弹出。调度成功只记 SCHEDULED；一次延迟确认、应用激活时检查 delivered 集合，命中才 enqueue presented。用户打开和 dismiss 都能证明曾展示，只有打开才允许 read；willPresent 不是展示证据。系统权限拒绝不会删除 Core 通知。通知列表保留未读状态，明确“标记已读”才提交 read；进入跨页待处理入口不构成已读。

稳定系统 identifier 包含已注册 client_id 和通知 ID。冷启动/离线用户响应先存入受保护表，附着匹配域之后才确认，不会丢弃或串域。展示/本地持久化/系统通知不构成跨系统原子事务；SCHEDULED 在重启后抑制不确定重复，无法证明展示则等后续实际可见证据，不宣称 exactly-once。Core presented 请求先持久入队再写本地证明，崩溃后最多重复幂等确认。

## 验证边界

`verify.sh`：锁工具链与依赖、Swift 故障测试，真实 fixture Core 的 launch/discovery/HTTP/SSE/reopen/redirect、聊天持久发送与定位，以及管理探针的任务、审批、决定、裁定、设置冲突、Scope 同步、记忆命令和认证产物下载；最后编译 app + UI test target。提供专用 DSN 时另验 World 应用和失败恢复。Core 集成只使用临时目录，脚本结束停止自己创建的 Core；不会使用真实模型或修改既有数据域。

真正运行 UI 测试另用 `node test_case/native/ui-fixture.mjs`；Debug 配置显式定义 DEBUG；测试断言临时 client.sqlite 确实建立。测试数据目录与保留零窗口进程钩子只对 UI 测试进程注入，不进入 Release。测试用合成文本粘贴保证不依赖当前输入法，实际执行 Return、⌘Return、退出与重启；Package 另测原生文本控件 marked text 禁止发送。

需要已解锁桌面及系统允许测试 runner。聊天验收会拖动被测窗口到屏幕左侧避开桌面悬浮层；不操作其他应用或关闭系统保护。构建成功不等于 UI 测试通过，也不等于真实通知、VoiceOver 或睡眠验收。CI 的 `verify` 汇总 Linux Core 与 macOS 两项，任意失败/跳过即失败；仓库保护规则由维护者另行管理。

## 依赖

PR3c 连贯 GUI、近 1 GiB 下载、投影淘汰和独立小卷磁盘满测试见 [测试说明](../../docs/operations.md#开发验证)。普通 verify 运行小样本资源回归；真实磁盘满测试须显式提供专用卷。完整系统验收状态以 [PR3 计划](../../docs/fix/archive/fix_20261014_issue10_PR3原生联合验收与旧入口退役.md) 为准。

swift-markdown **0.6.0**，传递 swift-cmark **0.9.0**（0.6.0 清单允许的解析结果，Xcode 16.4 实际构建验证）。SwiftPM 与 Xcode 两份 Package.resolved 的 pins 必须一致。Markdown 已在 PR2b 接入。许可原文在 `Licenses/`，打包 app 同时携带这些许可；不拉取远程渲染脚本。

PR3b 补充：过深嵌套、带不安全链接/图片的段落和畸形表格保留原文，避免丢失内容或进入不安全解析路径。活动耗时按持久结束时间冻结；缺少结束时间的终态使用最后进度时间。通知页只在活动窗口实际绘制可见行后提交展示证据，已读仍由明确按钮触发；获取数据和创建视图不算展示。
