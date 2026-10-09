# Issue #8 验证与边界

改动前固定分支 HEAD 为 `f8dbddcf4338914c1d264efff0fd26d5bc07c2cb`，远端 main 为 `38daab6cbbccf9f6a85071ff5933eaa198d77de8`。固定 Pi 子模块 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`。首次缺少子模块的类型失败与初始化后结果分别保留。runtime 基线 167 项：162 通过、5 跳过、0 失败；类型检查通过。

原始日志、临时 PostgreSQL、合成崩溃工作目录保留于本机临时位置或测试后清理，不提交真实会话、身份、数据目录、凭据或运行快照。数据库测试使用单独初始化的 loopback PostgreSQL，并且只写合成数据。

## 测试责任映射

| 原验证内容 | 新版验证位置 |
| --- | --- |
| TUI/Web 双客户端共享后台与关闭独立性 | `issue8/api.test.ts` 的并发 detached Core 启动、两客户端、退出/停止/重启 |
| 文本命令、旧 routes/static/SSE | 旧兼容断言退出新版范围；API 认证、旧路由拒绝、严格 body 验证替代；可靠 SSE 属于 #9 |
| 预览先于持久结果、可见思考过滤、call ID、重启历史 | 原 `streaming.test.ts` 保留断言并改为 API v1 timeline/command；消息签名与 redacted 内容仍不暴露 |
| 活动状态、并发慢查询、无输入泄漏 | 原 `activity.test.ts` 改为活动详情与 World 慢查询；保留在途活动投影与无泄漏断言 |
| 历史分页、定位、限制、无旧正文扫描 | 原 `activity-history.test.ts` / `timeline-window.test.ts` 使用新版接口，底层大历史 oracle/性能断言保留 |
| Settings CAS、有效说明不提前改变、非法文本、显式 apply | 原 `instructions.test.ts` 通过新版 draft/apply 运行原断言 |
| 记忆恢复来源、一次授权和期限 | 原 Issue #4 的 Host/expiry HTTP 用例迁移到新版受理/对账，保留原 owner 提交、提取次数和过期拒绝断言 |
| 纯详情查询与显式续留 | `issue8/api.test.ts` 比较查询前后 Execution 整条记录；viewed 增加 revision，RETIRED 不复活 |
| 命令崩溃一致性 | `issue8/crash.test.ts` 真正 SIGKILL：消息/任务/审批/Settings 在 fsync 前和 fsync 后、内存安装前各一个故障点，长命令在 QUEUED/RUNNING 落盘后分别 SIGKILL；重启验证受理与领域变更同帧，无重复执行 |
| API Schema / Swift | 生成 DTO、响应实例校验、固定合成示例、Swift Codable 解码；超出 JS 精确整数范围的版本字符串及未知字段保留 |
| World 精确槽、目录、版本与数据库领域回归 | `issue8/world.test.ts` 加原 World/Settings/边界套件，在隔离 PostgreSQL 运行 |

仅三个特定旧 UI 验收保留为显式 skip：dual-ui 的 TUI 进程 UI 文本，web 的旧 UI 共享协议，web-render 的旧静态 allowlist；它们不代表新协议缺测。Markdown 安全渲染、底层 TUI 领域测试仍运行。新版本不恢复旧路由来让旧兼容断言变绿。

测试中曾发现并修复：API 活动详情遗漏实时投影、旧测试调用已移除路由、混合时间线把活动条目误计作消息。首次失败日志未覆盖；更正后验证相同业务断言。取消请求使用既有 `CANCELLED_OR_REJECTED` 状态，并额外断言 `MASTER_CANCELLED` 原因。

## 交付边界

此分支没有调用真实模型、部署现有实例、运行生产数据迁移、操作 Portable 或实现 SwiftUI。UI 字体与比例、真实网络接入、原生用户体验与可靠事件补发分别留给后续工作。长命令在未知中断后不会自动重发；外部效果必须基于原领域记录核验。

数据库第二次复跑时复用了上一轮合成库，固定 fixture 的 source_key 冲突导致旧 World 用例拒绝；改用全新隔离数据库验证，不修改原领域断言。

文档检查已有缺失历史报告/迁移目标的基线错误；交付报告按错误集合比较新增与消失项，不伪报全部通过。最后执行的精确测试数量附于 fix 计划。
