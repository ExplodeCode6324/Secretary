# Secretary macOS · PR2a

Issue #10 的原生工程与连接底座。界面刻意使用简单原生控件，先保证可靠性，后续再做美学设计。聊天、Markdown 渲染、管理页和旧入口退役分别在 PR2b、PR2c、PR3 完成；此 app 尚不能作为完整日常客户端。

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

连接界面为唯一窗口，关窗会退出客户端；Core 仍独立运行。客户端数据位于当前用户 Application Support 下 `Secretary/client.sqlite`（目录 0700，文件 0600），不与 Core Store 混用。WAL/FULL 同步；schema 不兼容时停止，不自动删除 outbox。数据库和日志属于本地私有数据，不应提交仓库。

本机窗口测试：在已解锁的图形会话运行 `xcodebuild -project src/secretary_macos/Secretary.xcodeproj -scheme Secretary -destination 'platform=macOS' -derivedDataPath .build/native -disableAutomaticPackageResolution test`。XCUITest 使用 `-ApplePersistenceIgnoreState YES` 隔离历史窗口恢复状态，保留实际窗口和控件断言，并验证唯一窗口关窗退出及再次冷启动。CI 编译 UI test target，但不以编译替代本机窗口测试。

## 连接与持久化

- 公共 DTO 在 `Contract.swift`。revision、sequence、bytes 使用校验过的十进制字符串；opaque cursor 不解析。未知状态保留原值。业务详情的完整 DTO/界面随 PR2b/PR2c 加入，范围清单见下表。
- `ClientEngine` actor 独占同步 SQLite 连接。网络 await 后校验 generation，校验到写入之间不让出 actor。数据按 owner/domain/session 隔离；实例变化重新查询所需首页，保留同域 durable cursor 和 outbox。
- 草稿删除与完整 outbox 入队同事务；联网只能发生在入队提交后。入队必须携带编辑时的目标 Identity，防止旧窗口向新域提交。对账先 GET requests/id，只有此前未受理且确认为 NOT_FOUND 的 404 才重发原 ID、原路径、原字节。已知 UNKNOWN 不重建命令，旧 session 未受理命令保留。注册及以明确通知 ID 为目标的 presented/read 是域级命令，允许同域换会话后续传。
- `client_id` 由 Core 注册回执中的 ClientRegistration 分配。客户端生成并持久化的是注册 request_id；回执、分配 ID 与 outbox 状态同事务保存。重启沿用原请求，不能把本地 UUID 当作已注册 client_id。
- bootstrap 取 S → 所需投影 → changes → SSE。每次事务先置 stale，再刷新已观察查询，最后投影/失效标记/cursor 原子提交。刷新失败保留旧水位。同一查询仅最新请求可写入，最新失败不允许旧成功解除 stale。RESYNC 仅重建可恢复数据。保留最近 1024 个已应用 cursor 抑制重复，未见过的事务顺序遵循 Core 有序流合同，不解析 opaque cursor。
- 可重建投影磁盘预算 256 MiB，按最后确认时间淘汰；protected 表不淘汰。单响应 8 MiB、同时读取最多两个、事务暂存 8 MiB、变更页 8 MiB，原始响应工作集至多 32 MiB；解析器/SQLite/系统库额外内存不包含在此数字中。SSE 单帧 4 MiB，逐帧 await 消费，EOF 半帧丢弃、重连从已提交 cursor 重放。outbox 逐行对账，不把整个队列加载进内存；检查接口返回前 8 行。产物磁盘缓存留待 PR2c。
- HTTP 不跟随重定向、不用 cookie/cache，超预算即取消传输。可恢复断线退避重试（1–30 秒），认证/协议/存储问题停下并显示原因；唤醒重新发现。URLSession 连接定期结束时也走持久水位恢复。

## DTO 与后续接入清单

| 范围 | PR2a 状态 | 后续 |
| --- | --- | --- |
| Core / Capability / Receipt / RequestStatus / ResourceID | 已解码，RequestStatus 只消费 receipt；业务结果保持 Core 权威 | PR2b/2c 消费资源详情 |
| SyncCursor / SyncChange / SyncTransaction / SyncPage | 已解码，事务应用与恢复 | 页面订阅使用同一 engine |
| Notification / Content / Presentation | 已解码展示语义所需字段 | PR2c 完整通知列表与明确已读动作 |
| assistant / session / notifications 首页 | 按原始 API envelope 缓存，通知 items 另作 typed decode | PR2b 会话界面 |
| Message / Timeline / Activity / Related / text continuation | 此阶段不解码业务字段 | PR2b 分页、锚点、流式正文、Markdown |
| Task / Execution / Decision / Authorization / Operation / Artifact | 此阶段不解码业务字段 | PR2c，使用 A0 公开投影，不能旁读 Store |
| Memory / Settings / World / Scope / rules / programs | 此阶段不解码业务字段 | PR2c |

所有路由与字段以 `docs/api/v1/operations.json`、`schema.json` 为准。测试复制官方合成 `examples.json`；verify 比对副本，合同更新不能悄悄落后。

## 通知证据

通知按稳定分页逐页处理，不能把只含历史的第一页当作完整列表。初次 S 之前的通知不弹出。调度成功只记 SCHEDULED；一次延迟确认、应用激活时检查 delivered 集合，命中才 enqueue presented。用户打开和 dismiss 都能证明曾展示，只有打开才允许 read；willPresent 不是展示证据。系统权限拒绝不会删除 Core 通知。PR2a 的连接窗口不显示业务通知正文；应用内实际可见证明接口已留给后续页面。

稳定系统 identifier 包含已注册 client_id 和通知 ID。冷启动/离线用户响应先存入受保护表，附着匹配域之后才确认，不会丢弃或串域。展示/本地持久化/系统通知不构成跨系统原子事务；SCHEDULED 在重启后抑制不确定重复，无法证明展示则等后续实际可见证据，不宣称 exactly-once。Core presented 请求先持久入队再写本地证明，崩溃后最多重复幂等确认。

## 验证边界

`verify.sh`：锁工具链与依赖、Swift 故障测试、一次真实 fixture Core 的 launch/discovery/HTTP/SSE/reopen/redirect 验证、app + UI test target 编译。Core 集成只使用临时目录，脚本结束停止自己创建的 Core；不会使用真实模型或修改既有数据域。

真正运行 UI 测试另用：

```sh
xcodebuild -project src/secretary_macos/Secretary.xcodeproj -scheme Secretary \
  -destination 'platform=macOS' -derivedDataPath .build/native test
```

需要已解锁桌面及系统允许测试 runner。构建成功不等于 UI 测试通过，也不等于真实通知、VoiceOver 或睡眠验收。CI 的 `verify` 汇总 Linux Core 与 macOS 两项，任意失败/跳过即失败；仓库保护规则由维护者另行管理。

## 依赖

swift-markdown **0.6.0**，传递 swift-cmark **0.9.0**（0.6.0 清单允许的解析结果，Xcode 16.4 实际构建验证）。SwiftPM 与 Xcode 两份 Package.resolved 的 pins 必须一致。Markdown 功能在 PR2b 接入，此阶段只固定依赖与编译。许可原文在 `Licenses/`，打包 app 同时携带这些许可；不拉取远程渲染脚本。
