# demo_pi / demo_src_go 测试与继续开发评估

**建议：以 `demo_src_go` 为继续开发主线；保留 `demo_pi` 作模型接入和记忆策略的参考。两者当前均不能通过整体验收。**

决定依据是 Secretary 自有实现的持久化、状态约束和调度边界。Go 在同组 15 项边界检查中通过 12 项，Pi 通过 1 项；但 Go 同样存在过期决定、Context 可修改、final gate 身份约束缺失，以及本轮真实模型记忆丢项。Pi 在本轮短记忆问答中表现更好，不能据此把 Go 说成各方面都优于 Pi。这些问题发生在各自的 Secretary 实现，不能归咎于 Go/TypeScript 语言或上游 Pi SDK 本身。

## 实际执行结果

2026-09-22，macOS arm64，Go 1.25.6、Node 22.22.0、PostgreSQL 18.6。对包括当前 TUI 修改的工作区做独立复制后运行，未修改两套 demo 的生产源码。基准不是纯 HEAD；[baseline.json](baseline.json) 保存 1,996 个文件的 hash，[环境记录](environment.json) 确认报告生成时源文件没有漂移，Go 内嵌的 4 份主要规范资产与根目录一致。

| 测试批次 | Go | Pi | 证据与口径 |
|---|---:|---:|---|
| 原有离线测试 | 23 通过 / 0 失败 / 3 跳过 | 28 通过 / 0 失败 / 1 跳过 | [Go](go-tests.jsonl)、[Pi](pi-tests.tap)；Go 启用 race detector；跳过的 PG/live 在后续单独执行 |
| 临时 PostgreSQL | 2 通过 / 0 失败 | 1 通过 / 0 失败 | [Go仓储](go-postgres-repository.jsonl)、[Go桥接](go-postgres-bridge.jsonl)、[Pi](pi-postgres.tap)；真实独立临时数据库 |
| **相同 15 组补充边界检查** | **12 通过 / 3 失败** | **1 通过 / 14 失败** | [Go](go-audit.jsonl)、[Pi](pi-audit.tap)；确定性 fixture，无真实模型 |
| AUD12 单条件细化 | 1 有效对照通过 / 2 反例失败 | 1 有效对照通过 / 2 反例失败 | [Go](go-gate-refinement.jsonl)、[Pi](pi-gate-refinement.tap)；分别只改变 epoch、attempt，不另算两项新缺陷 |
| 原有真实模型合成链路 | 1 通过 / 0 失败 | 5 通过 / 0 失败 | [Go](go-live.json)、[Pi正常链](pi-live-chain.json)、[缺资料](pi-live-missing.json)、[未知效果](pi-live-unknown.json)、[transport](pi-live-transport.json)、[拒绝](pi-live-reject.json) |
| 短时输入负载与重新打开 | 1 通过 / 0 失败 | 1 通过 / 0 失败 | 1,000 条输入、2,000 次含重投请求、每批并发 20；[Go](go-load.json)、[Pi](pi-load.json) |
| **真实模型短记忆题** | **9/11 正确，2 项错误** | **11/11 正确** | [逐题评分](memory-scores.json)；8 条资料、3 次摘要、关闭后重新打开、1 组问题 |
| 静态检查 | go vet 通过 | 类型检查、format:check 通过 | [Go](go-vet.txt)、[Pi类型](pi-typecheck.txt)、[Pi格式](pi-format.txt) |

不要把上述行相加为“唯一测试用例覆盖率”：原有测试粒度不同，Go 的 AUD01/AUD13 复用了已有测试，PG 和 coverage 还有重复运行，记忆题与运行测试也不是同一种分母。补充检查刻意针对高风险边界，14/15 失败不表示 Pi 的一般使用有 93% 失败率。

按之前设计的 **120 条用例** 映射，本轮情况如下。没有把少量子项通过伪装成整条验收通过。

| 设计用例判定 | Go | Pi |
|---|---:|---:|
| FAIL：至少一个相关义务有失败反例 | 7 | 16 |
| INCONCLUSIVE：已有部分通过证据，整条未完成 | 55 | 40 |
| BLOCKED_CAPABILITY：缺少恢复快照能力 | 1 | 1 |
| NOT_RUN：本轮没有直接执行证据 | 57 | 63 |
| 完整用例 PASS | 0 | 0 |
| 总数 | 120 | 120 |

详见 [120条逐项映射](case-results.md)、[机器可读映射](case-results.json) 和 [批次汇总](summary.json)。一个缺陷可能关联多条设计用例，7/16 也不是独立 bug 数。测试适配了 demo 接口，映射中注明了相关的扩展契约反例。

## 15 组共同边界检查

| ID | 预期 | Go | Pi | 实际观察 |
|---|---|---|---|---|
| AUD01 | 批准后目标被他人修改，不覆盖 | PASS | FAIL | Pi 将 `concurrent edit` 覆盖为 `expected` |
| AUD02 | 普通决定 deadline 已过，回答必须拒绝 | FAIL | FAIL | 两边仍接受已过期的 OPEN DecisionRequest |
| AUD03 | 同请求普通决定重投返回原结果 | PASS | FAIL | Pi 第二次返回 `DECISION_NOT_OPEN` |
| AUD04 | 引用对象缺失，提交失败不能污染 durable journal | PASS | FAIL | Pi 抛错，但 journal 已从 3614 增至 4553 字节 |
| AUD05 | 已保存 Context 不可原位改 profile | FAIL | FAIL | 两边 store 都接受同 ID 的修改 |
| AUD06 | Input 不得 ACCEPTED 直接跳 HANDLED | PASS | FAIL | Pi 提交成功 |
| AUD07 | Input 必须引用存在的 Session | PASS | FAIL | Pi 接受悬空关联 |
| AUD08 | journal 外层未知字段必须拒绝 | PASS | FAIL | Pi 重新打开时接受未知字段 |
| AUD09 | 非法 base64 必须拒绝 | PASS | FAIL | Pi 忽略 payload 前非法字符 `!` 后继续恢复 |
| AUD10 | 全局事件序列被改为 999，即使 payload hash 正确也拒绝 | PASS | FAIL | Pi 接受断裂；这不是 TASK 子流中的合法缺号 |
| AUD11 | 通知无渠道回执不得标 SENT | PASS | FAIL | Pi 工具直接生成 SENT 与 `available:true` 回执 |
| AUD12 | final gate 核验 operation epoch/attempt | FAIL | FAIL | 两边都接受不匹配值；细化测试的有效对照均成功 |
| AUD13 | QUEUE 在前次执行等待时保留新 occurrence | PASS | FAIL | Pi pending_occurrences 为 0，预期 1 |
| AUD14 | Context.tools_schema 保存真实工具定义 | PASS | FAIL | Pi 写入 system messages，未包含应有的工具定义 |
| AUD15 | UTF-8/CRLF/NUL 保持原字节，同键重投一致、异内容拒绝 | PASS | PASS | 两边均通过 |

AUD04–07 和 AUD12 使用受信测试适配器调用 store/gate 或设置前置状态；它们证明的是内部不变量缺口，**没有证明远程客户端能直接注入任意记录或旧 worker 已造成真实重复作用**。AUD08–10 修改隔离的 journal 副本，用于恢复校验。AUD01 走实际批准与文件写入链路，确实覆盖了测试文件。

## 优先处理的问题

### 两边共同的问题

1. **P1：普通决定忽略过期时间（AUD02）。** Go 的 [Control](../../../demo_src_go/internal/engine/scheduler.go:439) 和 Pi 的 [answer](../../../demo_pi/pi_secretary/src/scheduler.ts:1196) 校验 OPEN 等状态，却未在回答提交时核验 deadline。用户晚到的回答仍可推进执行；不能靠定时维护“可能先过期”代替入口检查。需要在同一提交边界核验 deadline，并测试回答与过期的三个排列。
2. **P1：Context 记录可原位修改（AUD05）。** [Go Tx.Save](../../../demo_src_go/internal/store/store.go:251) 和 [Pi commit](../../../demo_pi/pi_secretary/src/store.ts:236) 允许修改已保存 Context 的 profile。不可变 blob 的 hash 正确，不等于指向它的 Context 语义不可变。需要定义不可变记录种类并拒绝二次修改；测试目前只改 profile，未证明原 blob 字节可覆盖。
3. **P1：final gate 缺少 operation epoch/attempt 约束（AUD12）。** [Go gate](../../../demo_src_go/internal/engine/authorization.go:209)、[Pi dispatch](../../../demo_pi/pi_secretary/src/authorization.ts:233) 接受不匹配身份并重写 owner_epoch。独立变更 epoch 和 attempt 后仍通过，排除了最初同时变更两个条件的定位歧义。当前 demo 的单 writer/同进程执行减少了外部可达性；继续引入异步 worker 前应明确操作重绑定规则，并在事务内核验当前 Execution/attempt，不应把这个内部反例夸大为已复现的外部攻击。

### Pi 额外的主要问题

1. **P0：批准后目标改变仍覆盖（AUD01）。** [prepare](../../../demo_pi/pi_secretary/src/authorization.ts:67) 把 expected_resource_revision 设为 null；[applyWrite](../../../demo_pi/pi_secretary/src/scheduler.ts:849) 的路径校验不足以发现批准后内容变化。应在批准展示时冻结目标 revision，并在实际作用边界重新核验。Go 通过本次顺序变更测试，但“核验后、写入前”的更窄 TOCTOU 窗口仍未验证。
2. **P0：失败提交先落盘再验引用（AUD04）。** [commit/apply](../../../demo_pi/pi_secretary/src/store.ts:291) 先写入并 fsync，再由 apply.verifyRefs 发现不存在的对象。失败返回前已经追加坏引用帧，存在污染恢复日志的风险。应先构造候选视图并完成引用、状态和跨对象校验，再 durable commit。测试证实了坏帧落盘；没有额外声称执行过磁盘断电恢复。
3. **P1：中央存储缺少状态和关联不变量（AUD06/07）。** Schema 形状验证不能替代 state-machine edge 与跨对象引用检查；规则散落于 service，使新增入口更容易绕过约束。
4. **P1：journal 解码宽松（AUD08–10）。** [replay](../../../demo_pi/pi_secretary/src/store.ts:372) 的 JSON.parse/Buffer.from 容忍多余字段与非法 base64，apply 用 Math.max 更新事件序列。需要严格外帧结构、规范编码及全局连续性验证；三项反例是同一恢复边界的不同子项，不应机械算成三个独立严重漏洞。
5. **P1：普通决定缺少重投收据（AUD03）。** 应先按请求键和内容 hash 返回既有结果，再评估新的状态迁移。UI 断线后重试不能误显示失败。
6. **P1：QUEUE 触发丢失（AUD13）。** [tick](../../../demo_pi/pi_secretary/src/scheduler.ts:269) 发现活动实例便 continue，没有保存等待中的 occurrence；迟到又可能按 missed 处理。需要区分前次运行导致的排队与进程离线导致的漏触发。
7. **P1：通知提前 SENT（AUD11）。** [MasterInteract 工具](../../../demo_pi/pi_secretary/src/host.ts:636) 生成合成回执；“本地可见”不等于渠道已确认投递，更不等于已读。应明确 QUEUED/投递中/有回执/未知各状态及协议。
8. **P1：Context.tools_schema 内容错误（AUD14）。** [context.ts](../../../demo_pi/pi_secretary/src/context.ts:42) 保存 system messages。ModelCall.request 另外保存了更完整的调用材料，不能因此说所有工具资料都丢了；但 canonical Context 自身不完整，影响独立恢复和 adapter 迁移。

### Go 的真实模型记忆问题

输入明确记录：P-A 是 Orion 设计联系人，P-B 是 Lyra 财务联系人，二者同名但不同人。第一次摘要保留，**第二次摘要移除整个身份事项，第三次也没有恢复**。重新打开应用后的答案将两项都回答成“未知（资料未提供）”。原始资料曾输入，不应回答成从未提供。

三次 CompactionJob 都为 COMMITTED，模型调用控制器退出码也为 0；这只表示程序执行成功，**语义评分仍是 FAIL**。Go 9/11、Pi 11/11 的逐字段答案与评分规则在 [memory-scores.json](memory-scores.json)，阶段证据在 [Go](go-memory.json)、[Pi](pi-memory.json)。Go 使用 18 次模型调用，Pi 使用 12 次。

[Go 摘要提示](../../../demo_src_go/internal/engine/memory.go:131) 允许没有未履行义务的旧事项缩减或退出，[validateCandidate](../../../demo_src_go/internal/engine/memory.go:269) 对未履行承诺做保护，未强制保留所有普通事实。因此不能简单要求 Consciousness 永不删除旧事项；应保证退出后的索引/原件检索与问题路由可找回信息，建立“摘要遗漏→按实体回查”的回归检查。此处是可用记忆/检索链失败，**不是已证明的 journal 原始资料物理丢失**。

本轮两边同用 gpt-5.6-luna，但模型请求、上下文预算计量、工具与摘要策略不同，且只有一次样本。因此 81.8% / 100% 只能称本题组命中率，不能称长期准确率或稳定胜率。需要将此反例加入固定数据集，再用多 seed、相同资料顺序、预算分桶、无摘要/原文检索对照复测。

## 可维护性与代码质量

| 维度 | Go | Pi | 判断 |
|---|---|---|---|
| 领域约束集中度 | store 候选视图、canonical 状态边、跨记录校验在 durable commit 前执行 | 类型/schema 较好，但状态与关系约束主要靠 service 自律，引用校验过晚 | Go 更适合作为可靠性底座 |
| 类型与重构安全 | `domain.R = map[string]any`；S/M/N/A 错类型常退成零值，字符串字段多 | 生成的 contracts + TypeScript 编译检查，结构重构更安全 | Pi 有明显优势；Go 应逐步换强类型领域记录 |
| 模块体积与职责 | engine 仍集中多个职责，TUI/loop/scheduler 较大 | scheduler 约 1,344 行、host 约 825 行，政策/调度/模型/retention 耦合 | 两边都需拆分；不要仅靠文件行数打分 |
| 异常路径 | 多处失败处理忽略 `a.set` 返回错误；磁盘故障下状态可能没有按预期落盘 | 同步文件操作、复制完整视图和不完整的提交前校验增加后续维护风险 | 两边都应优先补故障路径，而非堆新功能 |
| 模型接入 | 自有 Responses adapter，需自行维护 provider 语义、工具循环与异常分类 | 上游 Pi 模型/agent/tool 生态减少适配工作 | Pi 适合继续作集成参考 |
| 打包与运行依赖 | Go binary 内嵌主要 schema/SQL；PG 另依赖；具体程序仍有其运行环境 | Node、Python fcntl 锁助手、固定上游源码、相对目录 schema/SQL | Go 更容易形成可部署的服务包 |
| 持续增长与恢复 | 全 journal 重放，无恢复快照/历史 GC | 同样无日志轮转/恢复快照，单事件循环还承担同步存储工作 | 都未证明长期运行能力 |
| 测试有效性 | race、进程 SIGKILL、PG、内部状态检查较扎实，但遗漏本次共同缺陷 | 已有测试全部绿灯，仍遗漏多个关键不变量 | 测试数量和覆盖率不能代替故障边界检查 |

Go 的静态风险可定位到 [动态记录辅助函数](../../../demo_src_go/internal/domain/record.go:20) 与 [摘要失败状态写入](../../../demo_src_go/internal/engine/memory.go:151)。这些是源码审查发现；本轮未注入磁盘错误证明所有静态风险都发生过。

覆盖率仅作后续补测导航：Go 原有离线套件为 **48.6% statements**；Pi 原有 runtime/TUI/world 套件为 **83.74% V8 lines、77.29% branches、84.59% functions**。二者插桩与范围不同，PG/live 不在这组覆盖率里，不能用于语言或实现的直接排名。参见 [Go](go-coverage-functions.txt)、[Pi](pi-coverage.tap)。

## 下一阶段顺序

1. 以 Go 为主线，先修复上述 3 项共同边界缺陷与身份记忆找回问题，将本次失败变成固定回归；移除忽略状态写入错误的路径。
2. 为 Context 等不可变记录、Decision/Execution/Operation 建立明确的强类型 API；将提交、gate、调度和摘要检索从泛用 map 修改中收拢。
3. 建立同一组 contract probes，若借鉴 Pi 接入层，也要求通过相同的存储、批准、重投和恢复测试。
4. 再推进 30/90/365 日扩展回放、至少 5 seed、原文检索对照和 24h/72h/7日持续运行；补真实故障窗口、快照/备份能力后才进入相应验收。

不建议同时把两套 demo 都扩展成完整产品：目前 Pi 要补的可靠性核心较多。若目标只是快速尝试新模型和工具，Pi 仍有价值；若目标是 BrainStorm 中能正确恢复、可靠处理状态的长期 Secretary，当前证据支持优先 Go。

## 证据边界与复现

- 本轮没有跑完 120 条完整设计用例、131 条状态迁移的 524 个基本义务；也没有 24h/72h/7日 soak、14 日真实使用、物理断电、完整备份恢复、所有并发排列或完整 SQL/参数注入矩阵。未因耗时而把它们记 PASS。
- 原设计包的 [source manifest](../../sources.json) 中，10 份实现/UI 文档因 TUI 切换等变更产生漂移，[设计检查](../design-check.json) 因此为 FAIL。没有静默刷新旧 hash；BrainStorm、JSON、状态机等其余来源 hash 仍匹配。运行报告使用另行冻结的当前工作区源码，`source_drift_since_freeze=[]` 指本次冻结后无变化，不表示旧设计来源没有变化。TUI 已包含在重测范围，HTTP/同源场景只按 Go 实际保留的本地 API 测试，不套用到已移除服务端的 Pi。
- 负载每条为 1,024 个 ASCII `x` 加序号前缀（共 1,026–1,028 字节）；Go 为真实 goroutine 并发并开启 `-race`，Pi 为单事件循环上的 Promise 并发。Go 接收约 41.2s/重新打开 1.37s，Pi 约 28.8s/0.44s。运行开销与并行背景不同，**不据此评判吞吐、长期泄漏或性能优劣**。
- 负载与短记忆脚本均为 close 后新建 App/Store，未重启 OS 进程；真正跨进程 SIGKILL 的证据来自原有恢复套件，不能相互替代。
- 初次 Go 记忆脚本预算配置超出上限，尚未调用模型即失败；修正测试驱动后重跑成功。首次 exit_code 保留在 [初始命令清单](memory-command-results.json)，重跑见 [重跑清单](memory-go-retry-command-results.json)。原始首轮 stderr 未单独保留，不能据此计作产品缺陷；本轮 Go 的 2 项语义失败完整保留。
- 真实调用使用已有本地角色凭据；公开报告不包含密钥或 provider reasoning/signature。PG 使用测试脚本自己的临时实例，存储/工作区使用隔离副本和临时目录，保留测试证据，不替换 demo 实际会话资料。
- 复现源代码、fixture、命令与内部注入边界见 [probes/README](../../probes/comparison-20260922/README.md)。[汇总脚本](../../scripts/summarize_comparison.py) 仅重算已有证据，不运行模型，不会把退出码 0 自动当作记忆题正确。
