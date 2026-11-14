# Issue #120：隔离 benchmark 基础与可复用验证


> **实施授权与范围更新 / 2026-11-14**：Master 已确认开始实施，并明确 #120 主要构建测试环境基础，具体 benchmark 内容留到 #121。本节优先于以下 R2 计划中的旧状态和在线 smoke 要求。M120-01、真实 provider 计费/传输台账、语义 oracle 与 workload 评分移交 #121；本次不调用真实模型、不复用敏捷凭据，不宣称记忆验收通过。保留独立 PG/Core、恢复/中断/受控副作用协议及统一报告基础。两个具名历史归档候选随计划获准，仍须执行前复查。实现完成后先由同一 Claude 会话复核，再提 main PR、完成 CI，交 Master 检查合并条件，未经该最终检查不自动合并。


R2 · 2026-11-14（Asia/Hong_Kong）。**Claude 计划复核 PASS，待 Master 确认实施。**已纳入 R2 非阻断实施注意项，尚未开始实现。

- 总路线：[issue #119](https://github.com/ExplodeCode6324/Secretary/issues/119)。首项：[issue #120 / MB-01A](https://github.com/ExplodeCode6324/Secretary/issues/120)。
- 已核实 main：`bc2a46d02c93988970f67b0b914efb274782c885`（已合并 #132）。
- 工作分支：`codex/issue120-benchmark-foundation`，未来 PR 目标 main。
- 复核：浏览器 Claude **Opus 5.5 Extra**；计划通过后由 Master 确认实施，代码、CI 及实施复核完成后再由 Master 单独确认合并。
- 对应完整英文稿：[English plan](fix_20261114_issue120_benchmark.en.md)。

## 1. 目标、边界与现状

建立可反复使用、只初始化自有数据的 benchmark 基础，首先完成“备份 → 恢复 → 继续”实测。将今后的验证分为 **程序正确性测试** 与 **记忆体系在真实在线工作负载下的性能/稳定性测试**；复用 `test_case/online` 和实际 Core，不另造评测产品或记忆实现。

Master 本次明确批准隔离 benchmark 例外，覆盖此前“不得另建实例”对本任务的限制。本任务回到 main 开发，计划直接放 `docs/fix/`，不归入敏捷专题。实施时修正从 agile 带入的根 `agents.md` 与测试说明，区分 main 开发、benchmark 和 `/Users/muy/Desktop/secretary-agile` 唯一持久实例。敏捷数据、会话、凭据、Scope、launchd 及持续运行全部保留。本项不部署或停止敏捷实例。当前根 `npm start/stop` 实际调用 `scripts/agile.mjs`，不能用来管理 benchmark。

已只读核对的代码基础：

| 位置 | 可复用部分及限制 |
| --- | --- |
| `test_case/online/api-v1-online-worker.ts` | 新旧 PID/Core instance、逻辑 session/domain、物理发送和 usage 记录；需拆开 oracle 和继承配置。 |
| `issue84-memory-recovery.ts`、`issue84-fixture.ts` | 协议恢复 fixture；同进程 close/open 不能替代跨进程完整恢复。 |
| `test_case/offline/helpers/postgres.ts` | 普通回归的逐用例数据库；其外部 DSN、finally 删除和广域清理不能直接用于 benchmark。 |
| `scripts/agile-diagnostics/{io,capture-files,snapshot-reader}.mjs` | 原子私密文件、路径及静态备份检查；仅复用合适的小工具，不调用敏捷停启协调器。 |
| Core 的 `app/api-v1/core-client/scopes/shell-policy/push-service` | 用实际产品恢复与 API；`App.open` 在 pump 前已有恢复动作，因此防护必须先安装；可注入 pushDelivery，普通 shell 并非 OS 沙箱。 |
| `.github/workflows/verify.yml` | Linux 全量 PG 回归、macOS 定向回归和汇总门禁，需纳入新框架的实际测试。 |

计划阶段没有运行测试、调用模型、恢复备份、归档或改变服务。#84/#111/#114 已完成，不重开旧验收；不推定 U0。框架可先于 U0，继承的生产修复仍需其前置确认。发现产品缺陷时保留首失败并交对应 issue，不把生产改造静默塞进 #120。

非目标：#125 语义时钟、#121 P/S/R 数据和评分阈值、#122 起的完整 M1–M6、存储/GC 重构、任意 shell/PROGRAM 工作负载、真实外部服务、新客户端或运行 agile 克隆。

## 2. 两类测试与用例固化

保留已有 offline 用例和 CI，增加稳定 case ID、版本化描述及共同报告格式，不机械重写所有历史测试。

| 类别 | 触发范围 | 证明什么 |
| --- | --- | --- |
| `correctness` | 功能、协议、状态、授权、恢复；可用 fixture、真实进程及实际专用 PG。 | 程序行为；脚本模型不证明记忆质量。 |
| `memory` | 提取、检索、Context/Consciousness、World 记忆、时间/容量，以及影响记忆的模型或配置。使用真实 provider 和正常 Core 链路。 | 指定真实在线工作负载的效果、稳定性与资源；#120 连续性 smoke 仅证明基础设施，不放行 G1–G4。 |

交叉变更两类都测；不适用项写明范围理由。记忆变更仍跑相关普通回归，定向选择不能代替仓库必需 CI。后续每个 issue 将回归固化为带版本/散列、输入及 oracle 版本、所需能力、拓扑、重复次数、种子和证据要求的用例。种子不承诺 provider 确定性。#121–#125 延展同一 runner。

拟定结构：`test_case/online/benchmark/` 存 CLI、协调器、worker、所有权、checkpoint、provider 观测和受控目标；其 `cases/` 只放模型可见材料。复用 `test_case/benchmarks/common/` 存报告 schema、模板及控制器 oracle，不另加单数 benchmark 同级目录。已有 `benchmarks/issue24-*`、`issue34-recovery.ts`、`performance/memory-search.ts` 保留并索引为合成组件/性能证据，不能当真实记忆验收。`test_case/offline/benchmark/` 存协议/拒绝/进程测试；`test_case/reports/benchmark/` 存脱敏报告。私密 registry、证据、checkpoint 在 Git 忽略的 `.local/benchmark/`，不进入任何任务工作区。

## 3. 自有域、初始化与清理

benchmark 是专用测试设施，每个独立“scenario × 冻结代码/配置 × 重复轮次”新建 UUID 域，不共用累积状态。一次长期运行内重启保持状态及原 request_id；未来推进模拟日期不重新初始化。

**写入前部署守卫：**所有 CLI 子命令先解析真实 checkout/benchmark 根；若为 agile 受保护路径、其软链接别名/重叠路径，或存在持久部署标识（`data/core/journal.jsonl`、`.local/runtime.json`、`.local/maintenance.json`、checkout 内引用 `com.secretary.agile` 的 launchd 配置），在创建目录/锁之前拒绝。Mac 上全局已安装该服务不作为拒绝 main 的条件。用替身测试路径、别名、标识和嵌套根。`agents.md` 明确：main 同步到 agile 后，benchmark 例外也不适用于该 checkout；配置、输出、PG 路径同样不能指向受保护根。

每条独立时间线使用固定运行槽位 `.local/benchmark/slots/<lineage-id>/active/`，独立 Core journal/CAS、Shared/任务/Scope 工作区、发现文件、可变缓存与临时目录。独立重复的 lineage/路径不同；每个物理 incarnation 有独立 run UUID、nonce 和目录身份。证据、checkpoint、registry 及封存的旧 incarnation 在 active 槽位外。API token、端点和端口独立，仅监听 loopback；端口分配及身份握手防冲突，绝不因端口可用而连接未知实例。

R1 后补查发现：`scopes.ts` 的 Shared/NONE `workspace_binding.root_path` 也是绝对路径，Store 禁止修改，写结果对账还会比较旧 operation 的绝对资源。因此恢复采用**同一 lineage 固定规范路径、新物理目录**，不随意搬迁运行路径。持有 lineage 排他锁，确认旧进程全部退出、完整 checkpoint 已保全，写槽位交接意图；将旧 active 原子移入私密封存位置，随后将全新恢复 staging 原子放入已腾空槽位，核验新 inode/nonce 和文件 hash 后才启动。不使用软链接别名、不改 journal/CAS。PG cluster、token、instance 全新；同 lineage 同时只能运行一个 incarnation，拒绝并行分叉。registry 区分旧域封存位置和当前归属，旧 run 清理不能删除继任域；交接中断按持久身份对账，不能只看路径存在。这是旧逻辑路径上的新自有存储，不是重新打开原目录；任意路径可移植恢复明确未测。

**每轮独立 PostgreSQL cluster**，独立 PGDATA、socket、端口、数据库和角色，由控制器用已知二进制创建。Core 只拿该库的非超级用户凭据。拒绝任意已有 DSN/PGDATA。停止/清理/恢复前，registry 与 PG system identifier、实际 `data_directory`、数据库 OID/名称/owner、run marker 必须一致。普通 CI 测试 DSN 不充作 benchmark 集群；能连通不证明归属。

控制器执行的 `initdb/pg_ctl/pg_dump/pg_restore/psql` 同样采用绝对二进制路径、白名单环境及显式 socket/host、port、database、user（按命令适用）；清除继承 `PG*`，显式使用私密空 pgpass/service 文件避免用户默认配置，不记录秘密参数。首版统一 **PG major 18**，server/dump/restore 同 major，记录实际 patch 和二进制身份。CI 在 Ubuntu 通过 PGDG 安装 PG18 server/client，macOS 通过 Homebrew `postgresql@18`，不启动全局服务；解析安装路径并核验版本，适当缓存。必要时仅将受影响 job 的 20 分钟限额提到 30 分钟，报告实际耗时。缺二进制/版本不符让必需 job 失败，不 skip。本机已查为 PG18.6，CI 安装尚未执行。

子进程环境从白名单创建，不能展开整个 `process.env`。显式配置角色模型、flags、输出/context 限额、数据库、token、发现及临时/缓存位置。不读取 `.env.local`、生产 `SECRETARY_*`、PG service/password 文件、通知凭据、默认发现、继承代理或 Node preload。真实模型凭据只从明确获准的配置引用，经私密通道传给所需角色，不写 argv/公开报告。本计划不取得新 key，也不推定可以复用 agile key；online 前必须完成凭据选择。缺失配置即拒绝，不回退。不得改用 `HOME`/`CODEX_HOME` 保存任务变量。

维护经审阅的有效 `SECRETARY_*` 清单（含动态角色/limit 家族），运行前与源码发现的键/家族对照，未分类新增或未知配置即拒绝。记录所有非秘密有效值、明确 unset/default 及秘密存在引用，不记值。worker、PG、控制器临时路径独立，worker `TMPDIR` 隔离 Store journal 锁。专用 benchmark worker 调用产品 `App.open/serveCore`，明确这是“benchmark 入口上的产品 App/API”，不是生产 launcher 验收；打开前必须注入 sink，不得回退 `sendPush`。

控制器互斥锁与持久状态机记录 `CREATED/RUNNING/STOPPED/CHECKPOINTED/RESTORING/COMPLETE/FAILED/INCOMPLETE/EVIDENCE_SAVED/CLEANED`。先写资源创建意图，再创建资源；中断可恢复或隔离，不能猜测资源身份。marker 含 schema、随机所有权 nonce、run/config 身份和规范路径，外部 registry 不向执行器开放。PID 必须结合启动身份、程序/参数、进程组和控制通道；未知或复用 PID 拒绝 kill。

清理仅接受 run ID，不能传任意路径或 DSN。验证 registry、私密 marker、owner/mode、带目录边界的 canonical containment；拒绝符号链接/异常硬链接、根/祖先、生产/未知域、外来共享库、所有权变化、活跃/身份不明进程及缺失证据。只停止归属 Core、子进程及 PG，等退出、保全原始证据和首失败后再清自有域；停机或证据落盘失败则保留。锁内、变更前和遍历时再次检查，使用屏障测试路径替换竞态。不使用任意路径递归删除、`git clean` 或真实敏捷根删除探针。

## 4. 首个运行里程碑：完整恢复演练

通过正常 Core API 形成合成会话/事实、Shared 任务产物、稳定命令/request 记录、受控通知及到期/待处理动作。先用 fixture 验协议，再单独做真实 online 连续性 smoke。不启动真实敏捷备份。

1. 冻结源码、依赖、配置、case 和受控目标设置；在 `App.open` 前确认所有目的地。首版仅支持 Shared/NONE 内部工作区，拒绝外部 DIRECTORY 绑定和已注册 PROGRAM，避免假称移动目录便能安全重写不可变动作参数。
2. 先执行一次本地可计数动作；受控目标账本不随 checkpoint 回滚。以显式屏障制造响应丢失/结果未知边界，保存 request/body/授权身份；用原记录对账，不通过重做未知外部效果猜结果。
3. 停止旧 OS worker 和动作子进程并确认退出；静止边界复制权威 Core/CAS/工作区，取 PG dump、版本及配置清单。World 权威是 journal/CAS，PG 为可重建检索，旧 `wm` 仅属 legacy import。bootable checkpoint 排除 `core-endpoint.json`、`core.log`、`push-secrets/`、`owner.lock`、陈旧 token、PID/其他锁/凭据；诊断副本仅在控制器证据。逐文件 hash、journal 水位、CAS 闭包和完整清单检查，`pg_restore --list` 不能替代导入。新域断言产品已有 `worldStartupPreflight` 产生 fresh bootstrap/FRESH genesis，不造 legacy wm；恢复保留原 World。捕获前追平并冻结 `mem.checkpoint`，实际导入后核对 source/sequence/digest/row counts，首次索引接受原 checkpoint、没有隐式重建；负向错配 fixture 应从 journal 重建且不返回旧行，不能用重建掩盖正向 dump 恢复失败。
4. 按第3节槽位交接新建物理目录与 cluster，登记新 incarnation。恢复前核对 checkpoint 完整性及冻结代码/依赖/配置/case；不匹配或损坏即拒绝。用新角色/凭据实际导入 dump（不恢复 globals，采用 `--no-owner` 和指定 owner）。保留逻辑 session/domain/request、规范工作区路径和历史状态，更新目录 inode/nonce、PID/Core instance、端点/token 与 PG 所有权；明确记录父 checkpoint 和 lineage。旧源完整封存，不在其搬移后的路径启动。
5. 启动前检查绝对路径及进程元数据；所有记录的 operation 进程必须已持久 STOPPED 或按现有身份规则独立证明死亡，否则在 `App.open` 可能发信号前拒绝。不篡改 journal/CAS 或降级 fresh run 掩盖不支持状态。实际接续原 Shared 任务，读写恢复工作区并对账原写资源，CAS 下载本身不够。前后核对封存旧域 hash，并设不可读写 canary；所有实际 root/cwd/effect target 必须在 active 槽位内。
6. 在恢复前安装可计数 `pushDelivery`，仅允许工作区写和产品允许的受限读取；拒绝任意 shell/PROGRAM 和未知目标。只用自有 PG 和显式模型路由。保留定时状态，但后续动作只能落在自有域/受控目标，不继承真实通知地址、权限或凭据。报告不能把本地效果当真实服务送达。
7. 启动新 PID，证明旧进程已退出，原请求及状态可查；继续原时间线，经产品读取产物，核对发送尝试和实际副作用次数。分开报告重复尝试/重复效果，不能让 sink 去重掩盖 Core 重发。已提交命令不得重复生效；RESULT_UNKNOWN operation 经证据对账才继续，此句不适用于 push 重试。

覆盖正常停止备份和有限 crash/restart/未知效果案例，不声称断电持久性或任意写入中数据库备份已验证。checkpoint 分支的共同前缀不算统计独立重复；全新重复无上轮回答/可变缓存，checkpoint 只含本 lineage 已授权历史。后续观测探针是否污染记忆由用例声明。

业务未知效果使用实际 `file.write/verify-write` 与稳定 API 命令对账，通过仅 fixture 使用的屏障定位持久化边界，不声称 push exactly-once。当前 `Pushes.run()` 会重排中断的 `SENDING`，这是已核对的重试合同，不宣称新发现产品 bug。成功恢复场景在捕获前完成并持久化旧推送确认，继续后产生新的到期通知，逐项核对本地效果并记录每次尝试。含歧义 `SENDING` 的 checkpoint 在本次“无重复效果”演练中明确拒绝、保留待处置，不能静默重发或靠 sink 去重变 PASS。本项不修生产推送。

| 效果 | 冻结的判定标准 |
| --- | --- |
| API 命令 | 同 request/body 对应一次提交意图，改 body 冲突。 |
| 中断 file/shell/program | 已 dispatch 且不确定的效果进入 RESULT_UNKNOWN，不盲重做。本项实际执行文件写场景，任意 shell/PROGRAM 不支持。 |
| Push | target/generation/notification 对应固定 dispatch，at-least-once、最多4次、受 quiet/rate 限制。注入 delivery 回调确认前，从 Store 读取对应全部 SENDING 行的 dispatch/attempt/batch ID（一次可批100条），与 sink 独立 call ID 持久关联；无法确定关联则证据无效。另做 fixture-only 同域重启记录预期 interrupted retry，重复 dispatch 身份才失败，不把歧义 checkpoint 纳入无重复恢复案例。 |
| 定时 AT | 停机错过到期应 PAUSED 并报告 missed，业务执行为零；与恢复 ready 屏障后才到期的案例分开。用短期真实 deadline、时间记录和 readiness/dispatch 屏障；若搭建错过原定窗口，目标案例 INCOMPLETE，不重新解释为成功，不造语义时钟。 |

本地通知不等于真实送达；“无重复业务效果”仅对应明确 API/文件写案例，push 重试在报告中如实呈现。

## 5. Oracle 与外部动作隔离

隐藏答案、评分、未来事件及证据归可信控制器。执行器只见当前输入；工作区不复制含 oracle 的 benchmark 源码，配置和 prompt 不预装未来事件，不传 oracle 路径、可反推低熵答案的散列或评分反馈。控制器逐条投递，本项不实现语义时钟。

#120 的边界是**实际可用产品工具的访问隔离**，不冒称 OS 安全沙箱：工作区读写和受限内建只读 shell，不增加用户授权规则，不批准任意命令，不登记 PROGRAM。对 controller/oracle canary 测 `../`、绝对路径、符号链接及禁止 shell/program；源码/oracle 在允许根以外。捕获实际 provider payload，检查隐藏/未来 canary 未泄漏；曾正常教给模型的历史事实不算 oracle 泄漏。若允许工具可越界，停止 online 并记录阻断。未来任意代码工作负载需另行复核 OS 隔离后加入。

真实模型 prompt 保留正常产品工具声明，控制器通过正常 API 拒绝越范围授权，不照搬旧 worker 的静默删工具。若确有 prompt/tool/config 差异必须记录并限制结论。工作区路径只用 opaque UUID，不含 case 名或答案提示。

使用产品已有 push 注入能力、本地私有目标，并在打开恢复 Core 前冻结能力/目标策略，不靠模型“自觉不执行”。只有明确配置的 provider 可发模型网络请求并计数，模型输出不能改 endpoint，拒绝非预期 URL/重定向。Core API/PG/sink 为本地。不承诺抵御同用户恶意宿主进程。

## 6. 统一报告和运行证据

JSON schema 是权威数据，Markdown 从它渲染，两类测试通用。必填：

- schema/track/case/version/run/repeat/lineage/incarnation/issue；源码 SHA/tree、tracked diff 和相关 untracked 源码 hash、子模块、lockfile、构建依赖/runtime 版本。
- 冻结输入/adapter/config 散列；oracle hash 仅私密保存，公开为脱敏引用；角色/provider/请求模型 ID、可取得的实际版本（缺失写 `UNAVAILABLE`）、flags、seed、时区和 UTC 时间。
- 初始化与归属、进程/端点、checkpoint hash、恢复前后逻辑身份、证据引用；断言、实际/预期、请求与效果次数、首失败和复测 lineage。
- 分角色/维护阶段的逻辑调用、物理发送/重试、usage 与缺失情况；延迟、启动/恢复时长、RSS 采样方法及观测峰值、Core/PG/工作区大小、机器 OS/CPU/RAM 和实际工作负载单位；缺失指标不填零。
- planned/executed 总数与 PASS/FAIL/NOT_TESTED/BLOCKED/INCOMPLETE/NOT_APPLICABLE 分母及原因。断言失败保留 FAIL，后续未完项可为 INCOMPLETE；耗尽预算、中断或必要证据缺失不得 PASS。
- 明确 `SCRIPTED_PROTOCOL/REAL_PROCESS/REAL_POSTGRES/REAL_MODEL`、静态审阅及人工验收的证据等级和限制。

物理请求发送前追加意图，完成后记结果；每次真实 provider-send hook 必须等控制器将意图 fsync 后的 ACK，无 ACK 不发送。ACK 后/发送前崩溃只记 dispatch 未确认，不能假称实际发送；分别持久传输入口/结果，对无回包保留不确定性。账本归控制器，跨重启累计历史调用和时间预算。原始数据 0700/0600，公开报告不含 token/DSN/私密对话。报告生成失败也保全原材料；绿复测不能覆盖首失败。review 日志独立放 `.local/reviews/issue120/`。

#120 只冻结基础设施断言及小型真实连续性 smoke 的单轮限额，不决定建议中的 12+12/三次重复/50题/30天/10k 放行阈值。pilot 和 Master 阈值批准仍归 #121/#125/#126。benchmark 限额不成为 agile 总预算。

## 7. 旧测试数据归档

实施时按香港实际执行日期，在 `/Users/muy/Desktop/Codex_Bak/Secretary_Tests_<YYYYMMDD>Bak/<timestamp>/` 归档。**仅下列两项提请 Master 随本计划批准。**已只读盘点并保存全量逐文件 SHA-256 清单 `.local/reviews/issue120/archive-dry-run-manifest.json`，未搬移。表内为逻辑字节，与此前 `du` 约128MiB磁盘占用不同。不补造 marker 声称历史归属；Master 批准这两个明确候选后，执行前仍核验不活跃、引用和清单未变。其他工作树仅盘点，不在 #120 搬移；未知或混合根保留。

| 本 main checkout 内准确路径 | 文件数 / 字节数 | 批准状态 |
| --- | --- | --- |
| `.demo-data/issue112` | 12 / 114,511 | 随本计划待 Master 确认 |
| `.demo-data/issue114` | 6,642 / 121,955,005 | 随本计划待 Master 确认 |

初始清单无 symlink，无名称匹配 credential/secret/token/env/runtime/endpoint 的文件，但不声称任意日志内容无秘密。搬移前检查已知凭据格式/引用且不输出值；若发现凭据或活跃/混合子树，保留整个候选，不静默过滤形成不完整备份。新增候选或清单实质变化须将具体差异交 Master。凭据文件不复制，本项不永久删除，日志/报告归档保持私密。

不扫整个桌面、不通配清 `.local`。保留 Git 跟踪测试源码/历史报告、当前 reviews、`secretary-personal-data`、所有 agile/Scope/凭据、活动工作树、当次 benchmark 证据及已归档备份。登记为 Git worktree 的旧 `.demo-data` 不直接 filesystem rename。嵌套 deployment/恢复材料完整保留，不按“重复”过滤。

逐项检查进程/PG 和活动引用，不启动旧域；拒绝 symlink 逃逸/活动数据，私密清单记录原路径、owner、大小、数量及 hash。完整复制到唯一 staging，校验文件/hash 及适用 dump/CAS，原子发布到 `<archive>/verified-copy/secretary-core/<relative-candidate>` 连同清单和恢复说明，再将已验证原件用同文件系统 rename 搬到 `<archive>/originals/secretary-core/<relative-candidate>`，记录搬移意图并再次核验。两份都保留，本次为归档整理，不是回收空间。授权/活跃判断、空间、校验或同文件系统条件不足则保留原件；不得删掉唯一恢复副本。首失败和旧报告保留原格式，不把旧结论改写成新 schema。仓库存脱敏索引、映射及完整性状态。

## 8. 实施顺序与验收矩阵

Master 确认后：①用例/报告合同、所有权基础与文档例外；②隔离 worker/PG、配置、停启清理、证据及受控目标，先测拒绝路径；③完成 deterministic 全恢复和新 PID、实际 PG 导入；④用获准凭据执行真实 smoke，不以 fixture 替代 online；⑤清单式归档、用例及报告索引/操作说明；⑥相关回归、完整 CI、main PR，同一 Claude 会话复核当前 HEAD，交 Master 确认合并。

| ID | 必需证据 |
| --- | --- |
| C120-01 | 两次独立运行无共享 input/回答/可变 cache/DB/token/端点；marker/registry 不符拒启。 |
| C120-02 | 同轮旧进程退出、新 PID/instance、原逻辑身份保留；同请求同 body 不重复效果，改 body 冲突。 |
| C120-03 | 完整 Core+PG 恢复到固定槽位新目录和新 cluster；旧 inode 封存、新 inode/nonce、PG 原 checkpoint 被接受且无隐藏重建；原 Shared 任务接续读写恢复工作区，旧域 canary/hash 未动、原写资源对账成功，效果符合第4节逐类合同。 |
| C120-04 | 损坏/不完整/配置不符、外部绑定/PROGRAM、陈旧发现/凭据、歧义 push checkpoint、不安全目标、活跃/不能证死的 operation 进程、所有权篡改拒绝；另测错配索引重建及错过 AT 的暂停报告。 |
| C120-05 | 敏捷 checkout/别名/标识在任何写入前拒启；缺失/伪造标记、异常路径/祖先/symlink/hardlink、生产根替身、共享/外来 DB、复用 PID、活跃 child、并发清理、路径竞态、未保全证据拒绝；仅用一次性替身。 |
| C120-06 | setup/stop/checkpoint/槽位交接每阶段/restore/clean 中断可恢复，归属进程已停或明确隔离，不猜测 kill；旧 run 清理不删继任域，拒绝同 lineage 并发恢复。 |
| C120-07 | 所有允许工具无法读取 oracle/未来 canary，真实 payload 不泄漏；恢复前后禁止动作不外发。 |
| C120-08 | 报告 schema/渲染、缺失 usage、预算耗尽 INCOMPLETE、首 FAIL 不被复测覆盖，分母含未执行项。 |
| M120-01 | 真实合成事实→正常维护→固定 lineage 槽位实际 PID restart/restore→继续；保留产品工具声明，身份/副作用与回答分别评价，仅基础 smoke，不证明路径可移植或 push exactly-once。 |
| C120-09 | 只搬两个明确批准且核对未变的候选；变化/未批准/含凭据/活跃/跨工作树根保留；核验清单/hash、verified-copy/originals 目的地和失败源保留，不永久删除或修改个人/agile 活数据。 |

普通正确性入口保留 `npm run verify`，不添加冗余 `test:correctness`。拟新增：`npm run benchmark -- self-check`；`run --config <private-config> --case <id>`；`status/stop/checkpoint/restore/report/clean --run <id>` 并提供必要 checkpoint/config。run 只初始化一次，restore 新建 incarnation，stop/restart 不清库，失败不自动 clean。**benchmark 入口尚未实现/执行**；交付文档必须给出准确参数、依赖和恢复命令。

验证包含新 offline、既有生命周期/API 幂等/授权/Scope/Shared/World/push 回归、类型、文档链接/本地化、Linux 全 PG；macOS 纳入路径/ownership/process，实际 PG 恢复在适用本机及 CI 平台执行，不以 skip 当通过。CI 不用付费模型凭据，本机 online 证据另附。缺环境明确记录，达到合并条件前完成处置。不把 agile DB 交给测试 helper。

## 9. 复核记录与交付门禁

R1：Claude 独立读取准确 main 源码及 issue 后给出 CHANGES_REQUIRED，未运行测试、未查看本 Mac。B1绝对路径、B2推送语义与 Codex 补查发现一致。R2采纳固定槽位/新目录及 canary（B1）；逐效果判定、进程证死和 missed AT（B2）；敏捷目录写前拒绝及 PG 工具环境（B3）；两个明确 hash 清单归档候选随计划交 Master、无跨工作树搬移/永久删除（B4）。

N1–N8均纳入：journal/CAS 权威与索引接受/重建；PG18 CI；专用 App/API worker、临时路径和排除文件；保留模型工具声明、正常 API 拒绝授权；复用 plural benchmarks 和 verify；有效配置清单；fsync ACK 后发送且保留不确定性；opaque 路径。对 N1 的澄清：全新 Store 已由现有 `worldStartupPreflight` 选择 fresh，本项断言该产品路径，不新增 bootstrap API。归档两项由 Master 在计划阶段确认，不把 reviewer 建议当授权。

R2：**PASS**，于 2026-11-14 18:46（香港时间）在同一[Claude 会话](https://claude.ai/chat/601d9435-3950-47a4-9b17-5530207f4219)读取。Reviewer 独立检查 fresh bootstrap、journal/lock 名称、写恢复及对账、授权 API、push 中间行和索引状态，未运行测试；并修正了其 R1 bootstrap 意见。归档数量、本机 PG 版本和 docs 检查为 Codex 提供的证据。

六条非阻断实施注意项全部采纳，实施复核时逐项验：

1. 不凭索引状态字符串断言未重建。导入后、启动前记录 checkpoint 前 document/chunk 的主键、hash 和 `xmin`；首次索引后核对原行/`xmin` 未变（正向 fixture 不含撤回/更新），catch-up 单独记录。
2. 每次 worker open 传完全一致的 canonical 槽位字符串；启动前对 Shared root/file.write resource 按字节和路径分界核对，拒绝直到 `/` 的符号链接祖先；仅 realpath 等价不够。
3. 无重复恢复演练拒绝任何 sink/Store 不一致，包括 sink 已记录送达而 Store 无对应 DISPATCHED，不能只检查 SENDING。
4. 未知阻断语句只指 RESULT_UNKNOWN operation（第4节已澄清）。
5. checkpoint 明确排除 `owner.lock`（第4节已列名）。
6. 文档统一说明：plural `benchmarks/common` 为共同合同，singular `online/offline/reports/benchmark` 为本 runner 分轨入口。

以上是 PASS 后对 reviewer 非阻断要求的落实，不代表运行验收。英文请求/原文回复/截图放 `.local/reviews/issue120/`。文档链接/本地化及 diff 检查通过；运行测试和 CI 为 NOT_TESTED。待 Master 确认实施（含归档两项），之后 PR/CI/实施复核完成再单独确认合并；获准合并后核对 main CI。

## 10. 实施范围与证据（2026-11-14）

Master 在计划复核后明确 #120 只建设环境基础。当前 CLI 拒绝 live/memory 配置；M120-01、provider 发送台账、语义数据集/oracle/评分和真实 workload loader 交 #121。上方 R2 原文是复核历史，不表示未来能力已经交付。准确命令见 [benchmark README](../../test_case/online/benchmark/README.md)。

已实现独立规范路径/PG18 集群、私有 registry 和环境隔离、IPC 放行的真实 Core 子进程、journal/CAS/权限/副作用恢复前检查、真实 dump/import、三阶段目录交接恢复、可逆 clean，以及 JSON schema 校验的统一报告。生产 Core 未改动。

协议验证覆盖独立域、真实 PID 重启/API 幂等、原 Shared 任务继续且退休源不变、导入行 xmin 不变、失效索引从 journal 重建、真实 SIGKILL 后已写文件的 verify-write 对账、受控推送、错过 AT 暂停与就绪后 AT 执行、三种读取越界及隐藏 canary 不进入 fixture 上下文。目录交接和清理中断按阶段注入；破坏 marker/路径/数据库/进程身份、备份、证据 seal 和 sink 一致性均拒绝。

边界：不完整创建/导入保留并隔离，不能自动修复；不是 OS 沙箱或真实恶意模型验收。任意 shell/PROGRAM 与真实传输未开放。SENDING 推送在同 run 重启和恢复都拒绝，本次不声称完成独立的中断推送重试资格验证；产品仍是 at-least-once。RSS 是最后采样，不是精确峰值。fixture 的实际 provider 发送为零、usage 为 null。断电、穷尽 kill 点与物理 TUI 未验证，记忆性能无通过结论。

首次失败原样保留：进程 start identity 的 UTC/本地时区差异；备份遗漏空工作区目录；把异步 verify-write 回执误当最终结果；通过不存在的 goal 字段查 TaskPlan；越界用例接续使用旧 parent。分别修正为统一 UTC、保留目录条目、观察持久操作状态、按实际 AT trigger 查询、使用最新父执行。均为 harness 修正，未改写为产品或记忆缺陷，重跑使用新证据域。

归档执行：issue112 的 12 文件/114511 字节完整复制核验后移动原件，两份保留；issue114 的 6642 文件候选因内容含凭据整体留原位。详情见 [归档索引](../../test_case/reports/benchmark/README.md)。

Master 补充要求同时落实：main/agile 本地 agents.md 内容分开；两边本地 agent、敏捷使用说明、Finder 启停命令停止当前 Git 索引跟踪且保留磁盘原件，共享模板放 docs/agile-attention。三模型比较要求写入本地说明，Luna 不强制通过；两份指定凭据私有复制、0700/0600、不入 Git。额外获准的最小连通性探针不属于 benchmark 的零 provider fixture 结果。

完整检查、准确提交和同一 Claude 会话实施复核结论将随 PR 给 Master。按本次要求先实施复核、后提 PR/完成 CI，再交 Master 检查合并条件；代码冻结后的证据通过 PR 评论补充，不为状态文字反复改 HEAD。

补充恢复约束：所有 registry 读取先验证 run/lineage UUID、状态和受管路径；RESTORING 对同 lineage 保留持久占用；恢复前拒绝 scope.import 等超范围 Operation；旧 checkpoint 不能回退源 run 在捕获后增长的 sink 账本。foreign-checkpoint 用例先确认 Core/PG 都停，再断言准确的 checkpoint 拒绝原因，避免用未停 PG 的前置失败冒充完整性证明。新增实际 post-checkpoint 推送回归，14 项专项通过，持久占用补充的 4 项定向回归通过。


## R3 实现复核及修订

Claude Opus 5.5 Extra 对 e64d2f3 返回 **CHANGES_REQUIRED**。其在 Ubuntu/PG18 独立运行当时的 13 项基础用例全部通过，类型/文档检查通过；完整套件的 8 项进程失败在基线也能复现，未认定为回归。Codex 在本机正常环境完成完整回归：**1266 PASS、0 FAIL、0 SKIP**；最终 HEAD 仍须通过 CI。较早错误沿用 benchmark 精简环境导致的普通套件失败日志保留。

五项阻断意见全部采纳：B1 明确其它旧 checkout 的备份/更新/恢复迁移，main/agile 本地原件已有私有备份；B2 源 sink 在 checkpoint 后前进则拒绝回退，覆盖中断 handoff，并加入真实推送回归；B3 按 Master 新要求完整归档；B4 在源 Core/PG 确认停止后断言准确 CHECKPOINT_MISMATCH，恢复来源 restoredFrom 与当前 run 自己的最新 checkpoint 分开；B5 worker 只接收最小启动许可及非超级用户 Core DSN，实际查询 current_user/rolsuper 确认。

其余意见：能力白名单并约束 file/shell 资源在规范工作区；崩溃注入必须显式配置且记录；导入索引非空才比较 xmin；fixture fetch 阻断；离线说明补充 PG18 服务端前提。残缺 journal 尾部仍保守拒绝。退休目录证据证明没有变更，不证明完全没有读取；旧索引用例证明缺失索引重建，不证明陈旧行替换，限制交 #121。AT 停止窗口延长到 10 秒，若环境错过则明确失败，不能报行为 PASS。

Master 新存储要求覆盖后续测试数据的旧桌面归档位置：`/Volumes/share/Files/HDD2/ELIZA/ELIZA_BAK/secretary-test-bak`。已停止且归属明确的完整 facility 先在本地打成一个 tar.gz，再整包传输，仅附少量清单/回执/恢复说明；读取 NAS 包逐文件校验后才释放本机源。CLI 必须显式选择实例，核验外部挂载，默认 dry-run，拒绝活动、不完整、未知及混合根。首次失败完整保留。归档测试只用临时本地目标，实际 NAS 结果另记。不归档独立 API 凭据或敏捷持久数据；两份本地 agents.md 已记录策略。历史 issue114 混合凭据根继续排除自动归档。

末轮 CLI 检查发现：默认在混合总根创建会导致无法安全归档。创建命令现强制在任何写入前选择独立子目录；生命周期命令仍可显式检查/停止历史总根。说明统一使用同一个具名 root，子进程回归确认缺少 root 或指定总根时拒绝且不改变 facility marker，不自动迁移绝对路径。

R4：59c1b80b 获 PASS_PENDING_CI；Claude 独立通过 Ubuntu/PG18 的 17/17 测试，确认五项阻断解决，十个测试实例全部可归档 dry-run。采纳补充：显式新建 root（ab20b983）、递归拒绝嵌套 facility/lock/postmaster、macOS F_NOCACHE 客户端读回及准确回执措辞、本地敏捷提交记入部署说明、套件磁盘开销及归档提示。真实模型按状态区分的 Operation 白名单留作 #121 准入条件。当前未合并，等待准确 HEAD 复核、CI 和 Master。

90f58588 首轮 PR CI：macOS 684 PASS / 1 FAIL，在受控推送用例读取 observed.json 时失败。通过本地确定性的 open→原子 rename→fstat 重现 UNSAFE_FILE：合法替换后，已打开的旧 inode 的 nlink=0。harness 读取器现关闭该描述符并重新打开、校验规范 O_NOFOLLOW 路径，最多四次；仍拒绝硬链接（nlink>1）、非普通文件和符号链接，不读取已脱离路径的 inode。新增回归在修复前失败、修复后通过。原始 CI/本地失败日志保留，产品 Core 未改；后续提交需重新复核和 CI。
