# Issue #9：轻量同步与通知验收（2026-10-12）

批准计划见 [fix 文档](../../fix/fix_20261012_issue9_轻量增量同步与通知已读.md)。基线为 `main@e342fc48`，实施分支为 `codex/issue9-plan`。旧 `39abcd47` 未合并或 cherry-pick，其历史测试不计入本批证据。

## 本地结果

Node 22.22.0；使用本批独立 PostgreSQL cluster，所有数据库场景由 helpers/postgres.ts 创建/删除独立库。未连接正式 World。原有 393 个未跟踪资料均保留，原始日志、源码前后 SHA-256、第一次失败和数据库资料保存在仓库外，不提交运行身份或真实业务数据。

最终实际总入口：设置专用 `SECRETARY_TEST_DATABASE_URL` 后执行 `npm run verify`。check、docs:check 通过；526 项，**525 pass / 0 fail / 0 skip / 1 TODO**，约 544 秒。TODO 是原有 AUD14 Context.tools_schema 表示问题，已关联 #24，本批未改变其断言或状态。测试文件按文件串行，单用例内部的并发客户端/后台验证保留。

Issue #9 共 22 项全部通过；承诺/来源 16 项全部通过。以下计数从同一次最终全量 TAP 按文件提取，均为 fail=0、skip=0、todo=0；它们不是独立测试运行的汇总。

| 组 | 文件（test_case/offline/issue9/） | pass | 核验内容 |
| --- | --- | ---: | --- |
| CUR | cursor.test.ts | 2 | 重启、格式/数据域/水位、同身份备份分叉、同前缀继续 |
| FEED / VIEW | changes.test.ts | 4 | mutation/log-only、内部空变化、事务数、超大事务整体退化、多页字节预算、根 revision 相同的任务刷新 |
| LOAD | pagination.test.ts | 2 | 共用稳定元组、原数组不变、筛选绑定、无关写入、首次位置重放、已有列表入口 |
| VIEW / NEW | client-contract.test.ts | 2 | 最后发起响应生效、最新失败保持待刷新、数据/水位单一原子文件、历史通知初始边界 |
| CRASH | crash.test.ts、workers/crash.ts | 1 | 实际子进程 journal admission 后、SSE 写出前 SIGKILL，重放完整事务与原回执 |
| SSE | stream.test.ts | 3 | after/Header、鉴权、心跳/瞬态无 id、8 连接 BUSY、关闭清理、暂停 TCP 与恢复 |
| PRE | preview.test.ts | 1 | 2,000 次预览不写 journal、最终 call_id 收敛一次、Unicode 消息分片 |
| NOT | notifications.test.ts | 2 | A/B 展示、全局已读、原子 admission、请求冲突、业务幂等、重启、内容有界/Unicode/JSON、原文保留 |
| NEW | mappings.test.ts | 2 | 实际规则派发统计与停用、Operation 人工裁定、ModelCall-only 和日志历史依赖 |
| READ | readonly.test.ts | 1 | cursor/changes/SSE/资源 GET 不改 sequence/digest/CAS/记录/Input/ModelCall |
| WORLD | world.test.ts | 1 | 真实 PostgreSQL outbox、GET 不 drain、重启导出与去重、world 失效 |
| API | api.test.ts | 1 | 公共样例、SSE OpenAPI 媒体类型、类型化 CoreClient |
| MEM | ../issue3/commitment.test.ts、../issue3/provenance.test.ts | 16 | 真实 presented admission 与维护、read/send 不使证据失效、来源先后/批次/sourceEnd、错结果/复合承诺/旧 SENT 拒绝 |

复跑总入口为 `npm run verify`；定向入口为 `npx tsx --test --test-concurrency=1 test_case/offline/issue9/*.test.ts test_case/offline/issue3/{commitment,provenance}.test.ts`。单文件可替换 glob 为上表文件。CI 同样必须配置 PostgreSQL，不能以 skip 代替 World 证据。

暂停 TCP 场景最终测得待写峰值 **228,011 bytes**，预算 524,288 bytes；暂停端在 drain 超时内被独立关闭。另一客户端、命令和受控模型后台同时推进，命令/后台完成小于 3 秒的断言通过。断开后从原应用游标恢复；反复连接关闭及 Core close 活动流计数归零。

## 编译与生成

正常 check 通过后，临时删除 mutationMappings 的 Scope 项：`npm run check` 因 `Property 'Scope' is missing` 预期失败；立即原样恢复后通过。表类型直接使用生成的 `Mutation["object_type"]`，没有断言或宽泛索引签名绕过穷尽性。反例和日志不提交；开放字符串日志映射另有行为测试。

`npm run types:generate`、`npm run api:generate`、`npm run docs:generate` 重复生成 93 个受检文件，SHA-256 完全一致。Swift 实际命令 `swift docs/api/v1/decode-examples.swift docs/api/v1/examples.json` 通过，覆盖大十进制位置、invalidate、展示/未读、截断和 Unicode。改动文件 Prettier 检查、git diff --check、文档链接检查通过。

## 首次失败与处理

- 基线 check 与 API/记忆定向：58 pass、0 fail、2 PostgreSQL skip；随后建立独立库，本批最终全量 skip=0。
- 第一轮定向 20 pass、1 fail：测试错误地要求重启后末端不增加。改为核验旧游标解析到原 sequence，并允许启动恢复追加事务；旧断言和日志保留。
- Issue #9 首轮 15 pass、2 fail：Execution fixture 使用不存在的 last_viewed_at；SIGKILL 用例未立即接住 fetch 断线拒绝。改用既有 last_activity_at，并立即接住传输拒绝，保留“提交后未写出、重启恢复”的断言。
- 联合回归 160 pass、3 fail：产物测试假定插入顺序；attention 观察版本改动；SSE 的 stream 占位名无法由外部 DTO 导入。产物断言检查两页身份不重复且含目标；attention 保留原观察 fingerprint，分页不依赖它；操作表使用 SyncTransaction 与 text/event-stream 元数据。没有删减下载完整性、期限、DTO 消费者断言。
- 首次全量 521 pass、3 fail、0 skip、1 原有 TODO；上述 3 项失败保留。最后串行全量 525 pass、0 fail、0 skip、1 原有 TODO。总入口固定串行以隔离 SIGKILL/慢 TCP/大量 CAS 场景；未改领域断言、重试次数或业务超时。

## 范围、增减与交付

共同分页只有 Cursors.page 一套算法，ApplicationService 默认首次事务位置/ID；内嵌身份只传 keyOf。已有调用点各不超过 2 行语义适配；attention 的额外观察版本保留也在此范围内。没有通知内容分页端点、通用 cas-text、展示业务记录/快照、投递路由、独立 World 时钟或历史重置。

| 类别 | 增加 | 删除 | 净增 |
| --- | ---: | ---: | ---: |
| 手写生产源码与工具入口 | 813 | 52 | 761 |
| schema、操作表与生成文件 | 977 | 2 | 975 |
| 测试 | 1575 | 9 | 1566 |
| 手写文档与示例 | 207 | 13 | 194 |

统计以本批实施相对批准计划提交为准（不混入先前计划的初次创建）。PR 的完整差异另包含两次计划提交。Linux CI 的最终提交状态以 PR Checks 为准。合并、Issue 关闭、部署均未执行。没有修改 Pi 子模块或设备线。

Core 的协议与最小测试客户端已验证；真实 SwiftUI 缓存/水位持久化、系统通知和实际展示由 #10 验收，渠道发送由 #22 接入。本批使用受控模型 fixture，不宣称真实模型效果。journal 全量重放与索引增长沿用现有边界，历史回收/大历史性能留待 #24。
