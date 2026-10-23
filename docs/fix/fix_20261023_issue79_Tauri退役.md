# Issue 79：直接退役 Tauri 客户端

版本：R2，2026-10-23。状态：PLAN_PASS_WAITING_COORDINATOR；尚未批准实施。

仓库：https://github.com/ExplodeCode6324/Secretary
Issue：https://github.com/ExplodeCode6324/Secretary/issues/79
基线：最新 main `1e450d4f4c32d2376cd0d4451078048549bc5c58`。当前 checkout 分支：`codex/issue79-retire-tauri`。 [English](fix_20261023_issue79_Tauri退役.en.md)。

复核结果及非阻塞执行澄清见[复核记录](evidence/issue79-retirement/review.md)；已受审 R2 实施范围不变。

## 1. 授权与交付

Master 已授权协调会话「协调领取并修复 Issue 79–84」代行本批任务决策、计划审批和监督。本会话仅负责 #79，当前独占仓库写入与 Claude 浏览器操作；按 #79→#84 串行，不领取后续项。发现其他写入或操作，停止冲突动作并报告；Master 宣布接管后恢复其决策。

本阶段只交付研究、中英文计划、Claude 复核和文档校验。计划 PASS 后等待协调会话明确批准实施。之后的实现、PR/CI、当前 HEAD 复核和 MERGE_READY 分开记录，合并仍需针对准确 HEAD 另行授权。

复核使用 Master 已打开的 Claude，核实 Opus 5.5 + Extra，以英文发送完整英文计划和仓库/Issue URL，保持 #79 同一会话。首次等十分钟、后续五分钟再查；账号/模型异常立即报告，不自行切换 Hermes。原始请求、回复、截图保存于 Git 忽略的 `.demo-data/issue79-review/`，仓库只留 `docs/fix/evidence/issue79-retirement/` 脱敏记录。

## 2. 事实与边界

本地原 main 为 `12e028a049122035f86d5cbf930516157c9bb72b`，已安全 fast-forward 至 `1e450d4`，纳入 TUI 需求和 82 项 API 清单。开分支前 tracked 文件干净；既有未跟踪报告和日志全部保留。

旧客户端共 143 个 tracked 文件：Svelte/PhaseUI、字体/图标、Rust IPC/桥接/存储、契约副本、package/Cargo 清单锁文件、原生与浏览器测试和测量脚本。向外引用检查发现 desktop workflow、docs checker、localizer 和 issue20 文档 fixture 耦合；反向检查另发现 `test_case/offline/issue59/seed-artifact.ts` 唯一源码调用者是 `reliability.rs:535`，desktop workflow 路径过滤也包含其目录。该文件是桌面 fixture，应删除；根 package 依赖与脚本服务 Core。

checker 强制要求桌面 README 和六份 frontend 文档/导航；localizer 输入整个 frontend Markdown 集及桌面 README，并生成多语言输出与 manifest。它不会主动删除已退出来源集的旧输出，实施时须显式清理。

`test_case/offline/issue63/timeline.test.ts` 测 Core 内容和 outcome；`runtime/native-retirement.test.ts` 测 API 业务流程。二者及既有 Web/TUI 退役路由回归均保留，不能按 FE/Issue 编号删测试。

## 3. 批准后的实施内容

### A. 直接删除专属实现与入口

删除 `src/secretary_desktop/` 全部 143 个 tracked 文件、`.github/workflows/desktop.yml` 和已证实专属的 `test_case/offline/issue59/seed-artifact.ts`。不建立 legacy/retired 副本、不留旧二进制兜底、不加旧客户端启动器；Git 历史承担源码追溯。核查脚本、workspace/构建配置、发布说明和测试发现中的耦合，仅删除证实专属的入口。根 package/lock、TypeScript 配置和 Pi 子模块保留；若发现实际专属耦合，列明证据后处理。

先清点旧树内 ignored/untracked 内容，只清理证实为桌面生成物的 node_modules、target、dist、bundle 和缓存。未知/无关文件保留并报告；不执行全局 git clean，不清理其他目录的既有测试报告。

### B. 保留 Core/API/权威数据

保留 `src/pi_secretary/` 的 ApplicationService、api-v1/backend/core-client/core-cli、独立后台生命周期、timeline/sync、notifications/push、Host/Scheduler/Store；保留 `src/contracts/`、`docs/api/v1/` 公共 DTO、契约与生成器。Rust 桥是旧客户端专属，可直接删除；后续 TUI 通过 Core API 重建可靠性要求。

旧 ClientRegistration 和通知 presented/read 也是 Core 权威记录，继续保留；新 TUI 注册不代表继承旧客户端身份。不改 API method/path、schema、权威数据格式；Core 已接收消息、任务、回执、journal、CAS、PostgreSQL、任务工作目录继续保留。不实现新 TUI、附件协议、终端框架或新业务界面。

### C. 本地旧客户端状态

未发送草稿/outbox/cache 直接弃置，不备份、不迁移、不导入、不写兼容读取器。源码依据：生产 identifier `dev.secretary.study`、native-test identifier `dev.secretary.study.test`（tauri.native-test.conf.json）；生产 IPC 使用 `app_data_dir()`，native-test 可用 `SECRETARY_DESKTOP_TEST_DATA`；Bridge 读取 `profiles.json` 和独立 profile 存储；Storage 创建 `client.sqlite`、WAL/SHM 和 `delivery.lock`（storage.rs:228）；Svelte 还用 WebView localStorage 保存 thinking/theme/motion 偏好。profile 的 `data_dir` 指向 Core，不是删除目标。

批准后检查并报告两个准确 identifier 对应的 `~/Library/Application Support/`、`~/Library/WebKit/`、`~/Library/Caches/`、`~/Library/HTTPStorages/`、`~/Library/Saved Application State/<identifier>.savedState/`、`~/Library/Preferences/<identifier>.plist`，以及明确桌面测试根和构建产物。这些只是从源码/平台推导的候选，不声称存在；核实 identifier 专属的 WebKit/cache/state/preferences 按弃置缓存裁定删除，共用或含糊项保留。直接枚举各候选根，包含 profiles.json 未列出的孤立 profile。删除 profiles.json 前私下记录 Core data_dir 映射（只记配置元数据，不记草稿/outbox 内容），便于识别 detached fixture Core。记录路径类型和归属，不公开私有内容；核对 realpath、拒绝 symlink 穿透、比对 Core/工作区目录、检查旧客户端进程。必要时只关闭明确识别的旧客户端，不停止独立 Core。SQLite 归属须同时核对 `<root>/<profile-id>/client.sqlite` 路径、SQLite header、user_version=1、domains/drafts/anchors/cache/outbox 表名签名；仅只读元数据，不 dump 正文、不备份、不 checkpoint WAL、不改 schema，异常/损坏项待裁定。按显式 allowlist 删除确认专属的 SQLite/sidecar、delivery.lock、profile 配置及缓存，再删除空专属目录；lock 仅在确认旧客户端停止后删除。identifier 专属 WebKit/cache 目录先不跟随 symlink 清点，再删除专属内容；不递归删除共用根。未知文件、可能 Core 数据或归属不明项保留待裁定，不复制数据库作证据。目录不存在可如实记录。明确 `.demo-data/issue58`、`issue59-native`、`issue60`、`issue62`、`issue63` 为可能混存历史证据和 Core 的根，默认保留并报告，不能整体清理；issue59-native/core 属 fixture Core，历史 raw 证据保留。识别 detached fixture Core 后仅记录，不停止。用户下载目录及邻接 `.secretary-download-<uuid>`、构建树外 app 副本、rustup/toolchain 不在范围，不扫描个人目录。本阶段不删除状态。

### D. 文档、翻译与历史

1. 中文根 README、docs 入口、运行手册及其他现行导航改指 TUI 需求和 Core 使用方式，明确新 TUI 尚未实现。通过既有 catalog/localizer 再生英日法输出，顺序保持 English、日本語、Français、中文。
2. `docs/frontend/README.md` 缩为退役说明，链接 TUI 和固定提交历史。删除其余五份旧规范（architecture-and-flows、phaseui-design、components-and-states、acceptance、source-migration）及对应英日法输出；删除三种语言的 desktop README。短退役入口保留本地化，以承接历史链接，不保留现行桌面规范。
3. localizer 去掉桌面来源及死 destination 分支，仅剩 frontend 退役入口参与本地化；更新 catalog、再生 manifest，显式清理孤立输出。核对删除的来源/输出不再入 manifest；不泛改历史翻译或无关手册。
4. checker 的桌面强制项改为 TUI 需求/API 清单和当前根/docs 导航；保留 tracked Markdown、migration destination、offline 凭据检查。同步 issue20 fixture/断言：纯 TUI/Core checkout 通过，缺少 TUI 页面/导航失败，tracked 坏链失败，未跟踪日志忽略，特殊文件名正确处理；不保留旧文件计数作为业务语义。
5. 保留相关历史 fix/脱敏验收证据，必要处加退役说明。指向被删本地文件或 GitHub main 路径的链接改为真实固定提交 URL。当前快照用 `1e450d4f4c32d2376cd0d4451078048549bc5c58`，原证据已有明确提交则沿用其版本；用 Git 核验目标存在，仅保留有效锚点。不批量替换无关 main 链接，同时检查 migration-map 和历史 native 文档入口。
6. TUI 需求首部和 §10.3 增加带日期的实施状态说明，保留原基线观察、写清 #79 实际变化；旧 native 设计的 current-spec 指针同步修正。
7. 原 NOT_TESTED、NOT_ACCEPTED、待人工 GUI 验收状态保持；历史命令标明历史，不当现行运行指南。文档不夹带旧实现、字体资源或可运行 fixture。

### E. 颜色来源与 API 清单

颜色来自 Master 2026-10-23 本任务委派中的明确要求，是已发布 Issue 之外的补充。新增简短 `docs/tui/color-provenance.md`，仅保留设计参数。基线 `tokens.css` 第 44–46 行：蓝 `#285ea6`、浅蓝 `#8bbde0`、故障红 `#b84550`；第 78–80 行深色主题覆盖：`#79acd9`、`#b1d5ec`、`#ed8791`。两组分别记录，selector 为 `.phaseui` 和 `.phaseui[data-theme="dark"]`，避免把蓝色角色和 dark theme 混淆。green/wash 有意不保留，因为只要求三种颜色角色，不复制整套设计系统。链接准确源码提交及独立设计仓库的 `8cdb9219bed9493147ba10f7d47423df56cbcc44` 来源。不保留 PhaseUI 实现，也不提前决定终端调色映射。后续 TUI 可用简洁排版、命令导航、简单加载动效，#79 不实现。

本次计划交付和后续实施交付都更新 `docs/tui/api-coverage.md`。按当前 operations.json 核对每个 method/path（基线 82 项），要求集合相等且无重复。新 TUI 已用 0、未用 82，原因均为尚未构建；本项不新增/修改 API。测试调用不算 TUI 消费，未用接口不自动产生菜单要求或阻塞。

### F. 反向依赖与旧 Issue 接管

| 旧客户端引用的树外对象 | 处置 |
| --- | --- |
| src/pi_secretary/src 导入和 docs/api/v1 来源 | 保留，共用 Core/公共契约 |
| test_case/offline/issue59/seed-artifact.ts | 删除，唯一执行调用来自将删除的 reliability.rs:535 |
| .demo-data/issue58、issue59-native、issue60、issue62、issue63 | 默认保留并报告，混存历史证据/Core，不整体清理 |
| 根 Node 工具和 Pi 子模块 | 保留，Core 所有 |

最终差异前再次检查双向依赖。给 #82 留 reliability.rs 用例名称和 REL-01～REL-06 的固定提交链接索引，重点标出 stop 不重放、已受理但响应无效先对账；只传行为要求，不留可执行旧测试、不当新 TUI 覆盖。提醒 #82 现有 retired-entrypoints 测试禁止旧 tui.ts/client-tui.ts 路径，新入口应明确选择。

需求 §10.4 的旧 FE Issue 说明是协调审批后的 GitHub 写入，不自动发表。本项在 evidence 中准备六份具体评论草案，交协调批准/发表，作为 #79 完整交付门禁：#62 冻结旧视觉系统，保留视觉/资源/IME/VoiceOver 缺口；#63 共享终态问题交 #80，新客户端可靠性/阅读交 #82/#84，原真实模型 NOT_ACCEPTED 和人工缺口保留；#64 Task/Scope/审批按实际范围映射 #83；#65 Memory/World/Settings API 保留，不承诺完整菜单；#66 必需产物/生命周期交 #82/#83，桌面通知/Portable 延期；#67 真实终端验收由 #84 接替，不写成已通过。链接 #57 和相应新 Issue，保留原证据及 Issue 状态，不因停止 GUI 工作而关闭。协调须发表/明确授权这些具体说明，或记录重新分工/豁免；未完成则报告为交付待办。本计划阶段不发评论。

## 4. 验证与证据

计划阶段：仅将本任务文档纳入 Git，使 checker 可见；运行 `npm run docs:check`、API 清单集合核对、路径/提交来源核对、`git diff --check`，确认无业务实现/删除差异。本阶段不跑业务测试。

批准后：

- 审阅删除/保留清单，查无旧实现副本、bundle 或当前桌面入口；保留 Core 测试，公共 API/schema/DTO 对比基线。逐项区分剩余 secretary_desktop/Tauri/PhaseUI 引用属于历史还是执行耦合。
- 跑 issue20 文档回归、issue63 timeline、native-retirement、retired-entrypoints、process-lifecycle；全部使用隔离 fixture，验证 API/CLI 行为，不连接/停止个人 Core。
- 运行 `npm run docs:generate`、`npm run types:generate`、`npm run api:generate`，审阅生成差异并要求公共契约无不明漂移。纳入新增/删除再跑 `npm run docs:check` 和 `npm run verify`。数据库用已有隔离测试 helper；skip 明确报告，不能算通过，CI 应补齐权威覆盖。
- 审计本地 Markdown 链接和 checker 不覆盖的 GitHub blob/tree main 已删路径，人工检查多语言导航/manifest，再核对 API 清单。
- 原始日志保留首败、归因、修复和重跑；仓库记脱敏结果及实际源码/状态清理清单。PR HEAD 的 Core (Linux)、Core (macOS)、verify 必须通过；若保护规则仍要求已删除 desktop job，报告配置阻塞，不绕过。
- 同一 Claude 会话发送完整英文计划、准确 PR HEAD/diff、测试/CI 与限制；区分 reviewer 自查源码和 Codex 执行证据。源码变化需相应重验和同 HEAD 复核；达到 MERGE_READY 后等待准确 HEAD 合并授权。

旧 GUI 不重验或改称通过。Linux TUI、新 TUI 运行、真实模型/附件流程和产品视觉验收均不属 #79。源码删除、本地状态删除、CI 分别报告。源码可通过 Git 恢复，旧草稿按裁定不备份、不可恢复。

## 5. 复核与审批

R1 为 CHANGES_REQUIRED。R2 采纳 B1（双 identifier、完整状态候选/签名/锁/孤立 profile）、B2（反向依赖与 seed fixture）、B3（协调审批的旧 Issue 接管说明）。其余建议已补混合证据/Core 根、detached Core、范围外残留、权威客户端记录、文档状态、颜色授权来源和可靠性索引。颜色单独短文档按 Master 要求保留，便于后续 TUI 查找；通用导航配置和新增永久 API 清单校验机制暂不扩展，当前使用既有 checker 适配与显式集合核对。本阶段未跑业务测试。所有实施门禁 NOT_TESTED。复核通过后请协调会话批准上述源码/文档清理及已证实专属的本地状态弃置；共用/含糊目标排除并另行裁定。本文件本身不构成实施、push、PR、merge 或后续 Issue 授权。
