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

测试中曾发现并修复：通用投影错误处理审批参数/任意 JSON 中的同名元数据字段（已保留参数原值并加入断言）、API 活动详情遗漏实时投影、旧测试调用已移除路由、混合时间线把活动条目误计作消息。首次失败日志未覆盖；更正后验证相同业务断言。取消请求使用既有 `CANCELLED_OR_REJECTED` 状态，并额外断言 `MASTER_CANCELLED` 原因。

## 交付边界

初次交付尚未调用真实模型；本次追加授权的 online 验证见下节。此分支没有部署现有实例、运行生产数据迁移、操作 Portable 或实现 SwiftUI。UI 字体与比例、真实网络接入、原生用户体验与可靠事件补发分别留给后续工作。长命令在未知中断后不会自动重发；外部效果必须基于原领域记录核验。

数据库第二次复跑时复用了上一轮合成库，固定 fixture 的 source_key 冲突导致旧 World 用例拒绝；改用全新隔离数据库验证，不修改原领域断言。

文档检查已有缺失历史报告/迁移目标的基线错误；交付报告按错误集合比较新增与消失项，不伪报全部通过。最后执行的精确测试数量附于 fix 计划。


## PERRI 四项复审缺陷的修复

修复基线 `a1b69ec35436d1c727748c4ad2e6c0c206424769`；修复代码与永久回归提交 `ee386efe953b8319f4e83a5a44e263062f55e590`。仍在 draft PR #15，等待 PERRI 独立复审和 Master 终审。

| 项目 | 修复与永久验证 |
| --- | --- |
| 历史决定 request ID 被新命令重新占用 | 从 journal 的 DecisionRequest.answer_request_id 重建占用索引。MASTER/MAIN × 重开前后四个 HTTP 用例必须返回 409，名称和 journal 序号不变；既有 API 相同请求回执重放仍通过。 |
| PostgreSQL 时间变成空对象 | Date 输出 ISO 字符串；真实数据库和 HTTP 对照 entity/fact 的时间与 null。 |
| 自定义 predicate schema 键被删除 | value_schema 原样输出；SQL 写入含 entrypoint/workspace/payload_ref 的合成 schema，经 HTTP 取回后检查精确相等及值校验。另断言 Program schema CAS 引用继续隐藏路径。 |
| TypeScript 公共类型缺失 | 生成用 namespace 展开全部 66 个命名定义，公开 ApiV1 根语义不变。外部消费者编译 47 种操作 request/response 和所有定义，并有错误字段/类型的负向断言；不以重复生成成功替代消费验证。 |

首次针对性运行 7/7 失败；修复后同一组 7/7 通过。随后增加的日期与 schema 引用隔离用例也通过。日志、基线全文件哈希及后续重跑结果留在私有本地证据目录。

全套验证同时并行时出现 5 个首次失败：runtime 的 activity/TUI 等待超时两项，Issue #2 两项 SIGKILL worker 在固定 20 秒期限被 SIGTERM，API DTO 流程一次 fetch failed。随后各套件依次运行；未改变原断言、超时、重试或生产 HTTP 代码。首次 fetch 未记录 cause，不能断言其根因已确认，也不能把这次失败从记录中删除。

记忆恢复边界：已有 Issue #4 的 expiry-host/evidence-expiry 回归证明未消费票据重开后失效，而已消费回执仍可重放。API QUEUED 的调度不绕过此校验；本轮检查代码与既有回归，未新增该 API 特定崩溃窗口的独立复现，不列为第五个已修复缺陷。

PERRI 提供的原始复现 ZIP 未能导入：当前 Mac executor 无 Library materialization 工具及对应技能，无法验证归档 SHA-256。本节 red/green 来自本机独立永久回归，不声称运行过原 ZIP。


### 最终离线验证

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test`，独立复跑 | 167 项：159 通过，8 跳过，0 失败；跳过原因仍为 5 个未配置 PG、3 个已退出旧 UI 兼容范围 |
| `npm run test:api`，独立复跑 | 32 项：30 通过，2 个 PG 用例在数据库套件运行，0 失败 |
| Issue #2–#5 全部 offline，独立复跑 | 183 项：181 通过，2 跳过，0 失败 |
| 新隔离 PostgreSQL：API World + runtime World/Settings/settings-memory-boundary | 14/14 通过，无跳过；临时服务已停止 |
| API 再生成 / 外部 TypeScript 消费者 / Swift 示例 / diff whitespace | 均通过；生成文件内容哈希不变 |
| `npm run docs:check` | 49 个继承错误，较本轮基线新增 0、消失 0；不宣称文档检查全绿 |

### 独立 Astra/high 有界 online

使用现有 OpenCode 配置和已有私密凭据，未修改部署配置；全部为合成数据及隔离 Store，无设备访问。三轮运行的 10 个生产文件哈希均与修复代码提交一致。总共 12 次实际 HTTP 尝试（均收到 200，但 HTTP 成功不等于业务验证通过），达到上限后停止；每请求 90 秒、输出最多 4096 token、上下文最多 80000 bytes。实际运行合计 90.863 秒；首个到最后一个请求含离线排查为 346.758 秒，均在 15 分钟内。

| Provider / 模型 | 角色 | 真实请求 | token 合计 | SDK 目录费用估算 USD |
| --- | --- | --- | --- | --- |
| opencode-go / deepseek-v4.1-flash | main | 11 | 25,814 | 0.007439172 |
| opencode-go / gpt-5.6-luna | task | 1 | 833 | 0.000266600 |
| 合计 | | 12 | 26,647 | 0.007705772 |

输入 8,771、输出 10,452、cache-read 7,424，cache-write 0；推理 token 已包含在输出，不重复累计。12 次请求都有 usage；真实账单费用不可用，目录估算不等于实际收费。

**整体 online：NOT PASSED / PARTIAL COVERAGE。**

- 已通过：API 主会话；第一个算术任务的 TaskDetail 与持久 Execution 成功、结果 42；Settings APPLIED；真实模型在设置后仍记得合成事实并遵守英文说明；显式重试后的真实整理达到 COMMITTED；同一进程内关闭/重开后 session 身份一致。
- 第一轮（4 次请求）：测试脚本只在最终 payload 限制输出，未同步上游整理预算，被 `CAPACITY_OUTPUT_LIMIT_CHANGED_BY_ADAPTER` 在发送前正确拦截；第二段任务未成功。另有一次 loopback fetch failed，原 cause 未记录。不能据此断言生产任务接续存在已确认缺陷。
- 第二轮（5 次请求）：测试进程在 App 打开前统一输出/整理预算为 4096，loopback 仅在 harness 中使用 Connection: close，无自动 HTTP 重试。设置及事实/语言 oracle 通过；真实整理候选被原 `SUMMARY_PRIOR_BOUND_EXCEEDED` 校验拒绝，自动验证重试在发送前被测试策略阻止。
- 第三轮（3 次请求）：保留第二轮失败目录，仅复制其合成 Store 到新私密目录，通过显式 API 整理及原有验证重试完成摘要与提取，原边界不变。重开后准备真实回忆时预算已耗尽，被 harness 在传输前阻止；这不证明生产恢复失败。
- 未通过/未验证：完整两执行任务链；整理并重开后的真实回忆。不得计为端到端 online 通过，不转嫁给 #9–#14。若继续验证，应在核准的新有界预算内补足这两个场景。

原始上下文、响应、运行身份、endpoint 和 Store 均不入库。online 不覆盖 World/PostgreSQL（已由独立离线数据库套件覆盖）、OS 进程重启、可靠 SSE 或真实长期记忆质量。原始输入锚点可能保留，不声称只靠摘要完成回忆。

#9 的持久同步，#10 的 SwiftUI，#11 的真实设备接入，#12 的 EVENT，#13 的远程执行及 #14 的模拟界面仍是独立后续范围；本轮四项缺陷全部在 #8 修复。交付保持 draft、等待独立复审，不合并、不关闭 Issue。
