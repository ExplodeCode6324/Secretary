# Issue #9 实现与隔离验证记录

日期：2026-10-10。状态：**IMPLEMENTED / ISOLATED_TESTS_PASSED / NOT_DEPLOYED**。

对应 [Issue #9](https://github.com/ExplodeCode6324/Secretary/issues/9)、[获准计划](../../fix/fix_codex-issue9-durable-sync_20261010_持久同步与多端通知回执计划.md)与[同步协议](sync.md)。Master 已批准代码实现与隔离测试。本记录不代表推送实现、合并、关闭 Issue、生产迁移或设备验收。

## 基线与实际改动

从 `main@9623095a34f01933feeb74995dbb4d49edc8300e` 的阶段 1 API 开始，计划提交为 `9cfbf30f31bf1f00fb3c675b56ac7cf9e636fdc7`；工作分支为 `codex/issue9-durable-sync`。开工前冻结了源码文件散列、Issue 正文、依赖版本与首次检查日志，原始证据留在仓库外。

主要实现：

- JournalTransaction 的 mutation/log/receipt 位置形成持久 ChangeFeed；签名 cursor 绑定历史、投影、owner/session/client、sequence 与 digest。固定水位资源目录、分片补发、SSE 与瞬态显示各自有明确边界。
- Notification 内容与 NotificationDelivery 分离，NotificationRouting 防止未路由意图重复领取；DeliveryTarget 绑定可信登记。received/presented/read 独立保存，拒绝越端、错版本、乱序和事实改写。
- 记忆的狭义汇报承诺接受可验证 presented 证据；received 不能履约，后续 read 不破坏已保存的展示证据，原来源和任务匹配保护仍运行。
- SQL 004 增加事务版本时钟与独立历史代次；World 一致读、outbox 积压、导出失败及两种崩溃窗口可对账。
- 公共 schema、操作表、生成 OpenAPI/TS DTO、Swift 合成解码样例与架构/运维文档同步更新。

实现细化：bootstrap 返回固定 S 的资源版本目录及当前查询入口，不把尚未加载的全文声称为 S 的快照；旧通知零重写，初始化只保存切换标记与受理结果；无目标的新意图经显式每批最多 100 条 claim 领取；SSE 采用同一持久位置轮询，不依赖内存发布回调。共享索引随历史增长，不宣称常数内存启动或历史裁剪。

## 可复核版本

业务实现、测试、配置及公共合同共 36 个修改/新增文件的排序 SHA-256 清单已保存在本地证据目录。清单文件自身 SHA-256：

`5c233aa11b70ddd3dcb2e28218486c8bc4103a20c3b60afc6995a53b9c7408ec`

| 合同 | SHA-256 |
| --- | --- |
| 内部 contracts.schema.json | `3f1e571f83fe70cd6e4e9d33aa5a368e328246d5f2063c0c11474745c481e5a4` |
| 公共 API schema.json | `48c08e93e639a786149ae9912e0115db5530c84bcdcbfba89f0ded1c66e7a4e7` |
| 004_sync.sql | `70c1c1345d84c884b218f3ea9aa7f6c5012a419e0dda781d036fc6b71cb3adc1` |

环境：macOS arm64、Node 22.22.0、PostgreSQL 18.6、Swift 6.0.3。使用真实文件 journal/CAS、真实 loopback HTTP/SSE、fixture 模型与新建隔离数据库；未调用真实 provider。崩溃用例执行真实子进程 SIGKILL，不把抛异常等同于进程中断。

## 基线与最终检查

| 检查 | 改动前基线 | 最终结果 |
| --- | --- | --- |
| `npm run check` | 通过 | 通过，包含新增测试 |
| `npm test` | 159 通过 / 8 跳过 | 159 通过 / 8 跳过 / 0 失败；单独运行整个套件 |
| `npm run test:api`，配置隔离数据库 | 32/32 | 32/32，零跳过 |
| `npm run test:issue5` | 11/11 | 11/11 |
| `npm run test:sync`，配置隔离数据库 | 首个新断言在旧代码得到 NOT_FOUND，符合缺功能预期 | 25/25，零跳过，包含 4 项 World 用例 |
| runtime PostgreSQL 临时集群脚本 | 基线 API 数据库测试通过，未冒充相同套件 | 11/11，补跑 runtime 的 5 项数据库条件测试 |
| Issue 3 commitment + provenance | 本轮按受影响边界定向回归 | 15/15 |
| `npm run test:review` | 本轮补充审计 | 36/36；沿用脚本对历史 AUD14 的排除 |
| Swift 解码 `sync-examples.json` | 新增 | 通过 |
| 合同/文档重新生成、文档链接、diff 检查 | 文档链接 0 错误 | 见本记录末尾交付检查 |

runtime 的 8 项跳过包括 5 项 PostgreSQL 条件测试和 3 项已退役 UI 测试。5 项 PostgreSQL 测试已在单独临时集群真正执行；3 项旧 UI 跳过保留，不算 SwiftUI/TUI 已验收。没有修改旧断言或增加其超时预算。

复现入口（数据库变量必须指向新建隔离库）：

```sh
npm run check
npm test
SECRETARY_TEST_DATABASE_URL='<isolated-test-dsn>' npm run test:api
SECRETARY_TEST_DATABASE_URL='<isolated-test-dsn>' npm run test:sync
npm run test:issue5
node --import tsx --test test_case/offline/issue3/commitment.test.ts test_case/offline/issue3/provenance.test.ts
npm run test:review
python3 test_case/offline/test-postgres.py --pg-bin '<postgresql-bin>'
swift docs/api/v1/decode-sync-examples.swift docs/api/v1/sync-examples.json
npm run types:generate
npm run api:generate
npm run docs:generate
npm run docs:check
git diff --check
```

## 故障矩阵与证据

新测试位于 [issue9](../../../test_case/offline/issue9/)，原 API 回归位于 [issue8](../../../test_case/offline/issue8/)。下表按计划编号列出实际覆盖，不把同一测试中的多个断言算成独立测试数量。

| 计划 | 实际验证 |
| --- | --- |
| S01 | records-only、logs-only、混合事务、private 与 receipt-only 空批次；必要引用可见、内部 payload 不泄露、水位可前进 |
| S02 | bootstrap 同步块捕获 S；固定页期间修改旧资源和追加新资源，旧分页的版本和目录长度不漂移；过期页拒绝 |
| S03 | 快照后建连前、补发后再提交，SSE 从同一持久序列继续；断线从完整 cursor 重连 |
| S04 | 消息与 ACK 各在 append/fsync 前、fsync 后且 install/响应前 SIGKILL；恢复保持 history、替换 instance，原 request_id 单次受理 |
| S05 | cursor 篡改、目标/投影/历史不符、未来序号及 digest 不符明确拒绝；正常恢复旧 cursor 有效 |
| S06 | 3,200 个资源的单事务分片、从最后完整 cursor 重播、中文/emoji/组合字符长正文分块，拼接内容一致 |
| S07 | 真实暂停读取的网络连接，35,000 个持久事件，超时断开且缓冲受限；另一个客户端仍能提交命令并读取补发 |
| S08 | transient 无持久 ID、预览更新不增加 journal；最终消息来自持久变化；流在 Core 关闭时释放 |
| S09 | A/B 范围分离；binding 轮换后旧查询被拒绝、已建立流收到 control 并结束；禁用仅停止后续路由 |
| C01/C02 | 新跨进程消息/ACK 用例与原 API 的请求重试、冲突、任务、审批、决定、Settings 对账及 deadline/CAS 断言结合；未另写第二套命令幂等 |
| N01/N02 | 读取/写 socket 不产生 ACK；A/B 回执独立，错目标/版本/前置事实被拒绝；响应丢失重试、重复 ACK 不增加 Delivery revision |
| N03 | 无目标意图显式领取一次；新目标不追发已路由通知；目标禁用保留历史回执 |
| N04 | QUEUED/SENDING/SENT/FAILED/DELIVERY_UNKNOWN 五种旧状态，初始化 fsync 前后 SIGKILL，再按原 ID 重试；旧对象散列、正文与 SENT receipt 保持原样，无新增历史 Delivery |
| N05 | 真实 fixture 提取/压缩流程中，received 不能履约，可信 presented 可以，后续 read/重启保持结果；旧来源/任务证据专项继续通过 |
| W01 | SQL 已提交但未 journal 导出、journal 已导出但 exported_at 未标记两个 SIGKILL 窗口；按 SQL 原 event_id 补齐，无重复实体/事件 |
| W02 | 未提交写入不可见、提交后版本更新、rollback 不推进版本、目录翻页拒绝旧版本、独立历史重置 |
| W03 | outbox 积压和导出失败可见，恢复后清除；真实拒绝连接的数据库 socket 不破坏 journal bootstrap，World 明确 unavailable |
| V01 | profile/记忆/产物/related/attention 公开失效引用，实际任务执行及请求资源关联；读取仍保留稳定 actor |
| R01/R02 | 查询前后 journal、模型调用、输入/投递/留存无额外写入；原 runtime、API、记忆和审计回归保留单会话、授权及先持久化后工具执行的保护 |

## 限额与本次观测

| 场景 | 负载与结果 |
| --- | --- |
| 大事务 | 3,200 个合成 Notification，32 个片段；两页分别 505,536 和 72,907 字节，均小于 512 KiB；第一页无完成 cursor，重播确定且无遗漏 |
| 慢连接 | 1 个暂停读取的 SSE 连接、35,000 个持久日志事件；峰值应用待写 67,812 字节，小于 512 KiB，实际慢连接关闭 1 次 |
| 另一客户端 | 上述负载中，独立消息命令本次受理约 104 ms；这是一次局部观测，不是服务 SLA |
| 长正文 | 14,000 组中文、emoji 和组合字符；每块最大 32 KiB，完整 CAS 散列校验使用固定 64 KiB 缓冲 |
| 服务限额 | 最多 32 条同步连接、100 个启用目标；快照页扫描最多 100 项、TTL 5 分钟；慢写 drain 最长 5 秒 |

没有进行 32 个并发客户端或长期最大负载验收；不据单次测量宣称任意历史规模下低延迟。主 journal、Store 重放和共享版本索引随历史增长；没有历史裁剪方案。

## 保留的失败与修正

1. 新断言在旧实现首先返回 NOT_FOUND，红灯记录保留，确认它不是对已有功能的自证测试。
2. 开发过程的类型检查暴露导入/DTO/测试夹具类型不匹配，均修正后重跑；最后新增旧状态夹具将错误的 UNKNOWN 改为合同中的 DELIVERY_UNKNOWN，正文校验改用既有 Store.bytes 接口。
3. 大事务夹具同步提交占用事件循环后，第一次 fetch 复用了已关闭的空闲连接。测试在提交后让关闭回调获得 20 ms 调度机会；分片大小、资源总数、cursor 与重播断言未放宽，后续及最终全套通过。
4. World 崩溃测试最初假定 outbox 只有 1 条；实际 Settings 同事务创建 source 和 entity，共 2 条。修正为核对 SQL 原始 event_id 集合、实体数及重复导出后的精确事件数，保留首次失败。
5. 同时运行大事务、API、审计与 runtime 时，原活动恢复测试出现一次 `activity condition timeout`。未改该测试或超时值，停止跨套件竞争后单独重跑完整 runtime，159 通过、0 失败；保留并行失败与重跑日志。并发资源竞争是与复跑结果一致的解释，未声称证明其唯一根因。

## 交付检查与边界

重新运行三套生成器后，36 个实现/合同/测试文件的散列清单无变化。`docs:check` 检查 205 份 Markdown、3,114 个本地链接，0 错误；基线同为 0 错误。`git diff --check` 通过。58 个修改/新增文件的路径与新增内容扫描未发现本机私有路径、设备地址、常见凭据字面量或运行数据文件；原始日志和运行目录不纳入提交。远端 main 与远端计划分支仍分别停在上述基线和计划提交，本实现仅在本地提交。

本次未运行 SwiftUI/TUI、真实模型、远程/Portable 设备、生产数据库迁移或硬件断电测试。客户端落地/游标原子替换仅由合成测试客户端演示，不代表原生客户端已开发。所有客户端仍共享本机 owner 权限，目标 binding 防止错端操作，不提供敌对设备之间的权限隔离。

外部复制同前缀旧备份无法仅凭旧 cursor 自动识别，恢复须显式更新 journal/World 代次并对账外部副作用；UNKNOWN 不自动重试。旧运行时不能直接打开新增记录。生产切换、推送实现、合并与关闭 Issue 继续由 Master 决定。
