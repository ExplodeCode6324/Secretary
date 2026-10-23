# Issue 79 实施记录

2026-10-23 协调会话批准从 `4299bf027732b86cfdd68fb682a30895ccc22021` 实施中文/英文 R2 和 review.md 八项执行备注，备注澄清优先。批准源码/文档及已验证专属本地状态清理、验证、push/PR、CI 和同一 Claude 会话复核；未授权合并。

协调独立核实 #62–#67 正文已有冻结/承接说明，认定交付门禁满足；不发表六份重复草案，不关闭旧 Issue。

源码和状态清理分别记录。当前实施/验证中，未宣布 MERGE_READY。

## 删除与保留

- 删除 168 个 tracked 文件：旧客户端树 143 个、desktop workflow 1 个、唯一供 Rust 测试调用的 seed-artifact.ts 1 个、五份旧规范及三语输出 20 个、desktop 三语 README 3 个。
- 旧客户端目录的 dist、node_modules、src-tauri/gen、target 均为清点确认的生成物，已清理；未建立旧客户端副本、备用二进制或新 TUI。
- 保留短退役入口，当前中英日法导航指向 TUI 需求和 Core 使用方式。两份历史证据中的本地旧源码/翻译链接改为实际存在的固定提交链接；旧验收状态不变。
- 根依赖链、Core 实现、公共 API/DTO/schema、Core workflow 和 issue63/Core 退役回归保留。89 个基线保护文件逐一 hash-object 比对相同。
- API 仍为 82 项（GET 50 / POST 32），新 TUI 已用 0、未用 82；清单集合一致，无重复、无 API 新增/修改。
- 颜色仅保存三种角色的默认/深色六个数值及来源，见[颜色参数](../../../tui/color-provenance.md)。

## 本机状态处置

已核实 production/native-test 两个 bundle identifier，以及 Cargo 可执行名 secretary-desktop-spike 的专属状态。开发版 WebKit origin 元数据为 tauri/localhost。清理前无旧客户端进程、候选状态根无 lsof 打开句柄；文件归属、无 symlink 和 Core 路径隔离均检查。

- production 应用根仅有一个 profile 与 profiles.json。client.sqlite 的 header、user_version=1、domains/drafts/anchors/cache/outbox 表名签名符合源码；只读取元数据，不导出内容。按 allowlist 删除 SQLite/WAL/SHM、delivery.lock、profile 配置及空目录。Core data_dir 映射仅私下留存配置元数据，未复制草稿/outbox/cache。
- 两个 bundle identifier 和已核实可执行名的 WebKit/Caches 六个专属根均删除。HTTPStorages、Saved Application State 及其余候选不存在。
- 两个偏好域先执行 defaults delete；首次复查发现其留下 42 字节的空 plist，解析确认空字典后删除空文件，未重启 cfprefsd 或其他应用。
- 9 个预存独立 Core 后台进程仍运行，未停止、未迁移。混合历史 `.demo-data/issue58`、`issue59-native`、`issue60`、`issue62`、`issue63` 原样保留，包括 fixture SQLite 和原始失败证据；未扫描个人下载目录/外部 app 副本或删除 toolchain。
- 原始路径/签名/清理记录在忽略目录 `.demo-data/issue79-review/`：local-state-before.json、profile-signatures.json、core-profile-mappings.json、local-state-open-handles.json、core-processes-retained.json、local-cleanup-result.json。没有数据库备份或迁移产物。

## 验证进度及首败

- 新的纯 TUI/Core 文档 fixture 在旧 checker 下失败：10 项旧规范/导航硬要求，保存 docs-regression-before.log。改 checker 后，fixture 的首次 git rm 因临时仓库只有暂存无 commit 被拒绝；仅对测试自建 fixture 使用 --force 后通过（docs-regression-after.log / docs-regression-fixed.log）。
- 首次完整文档检查发现根中文 README 旧导航匹配未覆盖，以及三条历史多语言 desktop 链接；补正源文与固定提交链接后通过。原 docs-check-implementation-first.log 保留，修复后 docs-check-implementation-fixed.log：603 份 Markdown、8220 条本地链接、113 个本地化源和 339 份输出。
- 针对性回归：issue20 docs checker、issue63 timeline、native-retirement、retired-entrypoints、process-lifecycle 合计 13/13 通过、0 skip（targeted.log）。
- docs:generate、types:generate、api:generate 均执行完成；公共 API/契约生成物与基线一致。
- 完整 `npm run verify`：659/659 PASS，0 fail、0 skip，约 789 秒；使用本次新建的 PostgreSQL 18.6 和既有 per-test 临时数据库 helper（verify-first.log）。环境 Node 22.22.0、npm 10.9.4、Python 3.9.6。测试临时库全部清理，本次专用 PostgreSQL 已停止并移除，其日志保留；预存 Core/数据库未停止。CI 与准确提交 Claude 实现复核待完成。

## 冻结前审计

- `git diff --check` 通过。生成器完成后公共 Core/API/DTO/schema 文件无变化，根 package/lock 和 Core verify workflow 不变。
- 18 个本机候选状态路径最终均不存在；9 个预存 Core 后台进程存活。没有需要协调裁定的未知专属状态。
- 非文档执行路径不再引用 secretary_desktop；Markdown 到已删源码的链接使用固定提交，未留下指向缺失 main 路径的 GitHub 链接。
- main 普通 branch protection 返回未配置；适用 rules API 返回空数组。无需更改规则，不绕过 Core 三项 CI。
- 尚未合并、未关闭任何 Issue、未实现新 TUI；旧 GUI 未通过/未测试事实保持。准确 HEAD 的 CI/Claude 最终结果记录于 PR，避免纯状态更新改变已复核提交。
