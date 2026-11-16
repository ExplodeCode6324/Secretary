# 独立 benchmark（#120 基础 / #121 真实记忆开发）

同一入口管理可重建的 Core / PostgreSQL 环境。默认仍为 **fixture / correctness / infrastructure v1**，零次真实模型调用；显式 `memory-*` 命令可执行已授权的真实模型开发场景。程序检查通过不代表记忆质量通过，开发样本不冒充未见样本；错误容忍门槛仍待 Master 冻结。

## 前提与边界

- 非部署的 main 开发 checkout，Node ≥22.19、Python 3、PG **18** 的完整服务端工具及 npm 依赖、固定子模块。macOS 使用 `pg_config --bindir`；Linux 优先 `/usr/lib/postgresql/18/bin`，否则由 pg_config 定位；每个工具均核验主版本。
- macOS 可安装 `brew install postgresql@18` 并把其 bin 加入 PATH；Linux 使用 [PostgreSQL 官方 Apt 源](https://www.postgresql.org/download/linux/ubuntu/) 安装 postgresql-18。CI 两平台均安装并实际运行测试，不跳过 PG 恢复。
- 只能使用本 checkout `.local/benchmark/` 内的规范绝对路径。敏捷 checkout、路径别名或带部署标记的副本在创建任何 benchmark 文件前拒绝。
- fixture 不读取模型凭据且拦截网络模型调用。live 仅由控制器读取本 checkout `.local/test-credentials/` 的指定文件（目录 0700、文件 0600）；通过 IPC 交给对应 worker，不写入模型上下文或报告。worker/PG 使用精简环境，不继承 SECRETARY、PG、NODE_OPTIONS 或 HOME 配置。无真实推送、无任意 shell/PROGRAM、无 DIRECTORY Scope、无自定义授权规则。
- root `npm start` / `npm stop` 路由敏捷入口，**不用于此环境**。不得使用敏捷数据、数据库、凭据或 launchd。

## 精确命令

从仓库根目录执行。创建命令必须显式指定独立子目录，不能使用混合总根；所有后续操作保持相同 `--root`。每次新测试选择新的 UUID 子目录，普通完整套件约产生 1 GB 数据，用完按下文归档。示例中的 BENCHMARK_ROOT 是本次测试专用变量：

```sh
BENCHMARK_ROOT="$PWD/.local/benchmark/tests/$(uuidgen | tr '[:upper:]' '[:lower:]')"
npm run benchmark -- self-check --root "$BENCHMARK_ROOT"
npm run benchmark -- run --root "$BENCHMARK_ROOT"
npm run benchmark -- status --run <run-id> --root "$BENCHMARK_ROOT"
npm run benchmark -- stop --run <run-id> --root "$BENCHMARK_ROOT"
npm run benchmark -- start --run <run-id> --root "$BENCHMARK_ROOT"
npm run benchmark -- checkpoint --run <run-id> --root "$BENCHMARK_ROOT"
npm run benchmark -- restore --run <source-run-id> --checkpoint <checkpoint-id> --root "$BENCHMARK_ROOT"
npm run benchmark -- recover --run <interrupted-run-id> --root "$BENCHMARK_ROOT"
npm run benchmark -- seal --run <run-id> --root "$BENCHMARK_ROOT"
npm run benchmark -- clean --run <run-id> --root "$BENCHMARK_ROOT"
npm run benchmark -- report --run <report-id> --root "$BENCHMARK_ROOT"
```

`run` 返回不含口令的 run_id / lineage / state / evidence。如需配置，先在 `<root>/configs/` 手工保存私有 JSON，再传 `run --config <file>`，精确格式：

```json
{"version":1,"mode":"fixture","track":"correctness","case_id":"infrastructure","seed":120}
```

不支持 `--case`；未知配置键拒绝。live 使用下文专门的显式入口。seed 不表示真实 provider 确定性。代码、HEAD、依赖或相关源文件改变后不能重启/恢复旧冻结 run，需回到原代码审阅或新建 run；不要修改旧清单绕过检查。活动 campaign 期间不得修改指纹覆盖的源码。

## 真实记忆开发命令（#121）

每个有付费调用的 facility 使用唯一 `--approval` 标识并保留 fsync 的物理发送台账。它是已获授权的审计标识，不是传入任意字符串就取得授权。当前模型 ID 为 `gpt-6.1-sol,deepseek-flash,gpt-6-luna`，端点和凭据映射由受检配置限定。CLI 不以完成调用推导语义 PASS。

```sh
npm run benchmark -- memory-probe --root <new-owned-root> --approval <approved-id>
npm run benchmark -- memory-pilot --root <new-owned-root> --approval <approved-id> --subset smoke --profiles DEP --models deepseek-flash,gpt-6.1-sol,gpt-6-luna
npm run benchmark -- memory-private-prepare --root <new-owned-root> --source <private-replay.json> --provenance <private-provenance.json>
npm run benchmark -- memory-pilot --root <same-root> --approval <approved-id> --subset private --profiles DEP
npm run benchmark -- memory-repository-prepare --root <prepared-private-root> --source <pinned-snapshot.md> --provenance <pin.json>
npm run benchmark -- memory-repository --root <same-root> --approval <approved-id>
npm run benchmark -- memory-lifecycle --root <new-owned-root> --approval <approved-id>
npm run benchmark -- memory-world --root <new-owned-root> --approval <approved-id>
npm run benchmark -- memory-audit --root <stopped-root> --run <run-id>
npm run benchmark -- memory-grade-disposition --root <stopped-root> --run <run-id> --verdict <reviewed-disposition.json>
npm run benchmark -- memory-grade-export --root <stopped-root> --run <run-id>
npm run benchmark -- memory-grade-batch-export --root <stopped-root> --source <private-run-list.json>
npm run benchmark -- memory-grade-batch-import --root <stopped-root> --verdict <private-batch-response.json>
npm run benchmark -- memory-score --root <stopped-root>
npm run benchmark -- memory-prepare --root <new-owned-root> --source <verified-public-source-bundle.json>
npm run benchmark -- memory-public --root <prepared-root> --approval <approved-id> --subset dev
npm run benchmark -- memory-public-grade-export --root <stopped-public-root>
npm run benchmark -- memory-public-grade-import --root <stopped-public-root> --verdict <private-verdict.json>
```

`memory-prepare` 下载并固定公共 LongMemEval 来源；`memory-public --subset dev|smoke` 只评估检索组件，不伪造 Core 对话导入。来源下载失败时保留诊断，不报告公共数据集已执行。`memory-private-prepare` 只接受脱敏/已获授权的重建开发场景和匹配来源哈希；它不建立未见样本。仓库 B 从较早的固定提交复制一个只读资料文件到已初始化的独立 Task 目录，保留真实 read 工具结果，原仓库未暴露给被测模型。A 与 B 分开报告。

`memory-prepare --source` 接受经操作者核验的公开来源包：JSON 包含 `version:1`、`dataset_commit`、`repository_commit` 及六个 `files` 项（`name/path/bytes/sha256/url`）。仅允许两个固定官方仓库的精确 commit URL，文件路径必须留在包目录内；逐项核验大小、哈希后原样复制，不执行下载的 Python。来源下载过程及独立核验记录另行保留；本地哈希检查不能自行证明网络来源。未提供 `--source` 时仍走原官方 HTTPS 下载。

固定题目如违反已声明的时间截止约束，整题保留为 BLOCKED，不改日期、不删除部分会话，也不换成更容易的题。manifest 同时保存完整选题、可执行输入和阻塞项。公共报告始终保留 6/50 题乘模型数的计划分母。当前固定数据中有 1 道 dev、6 道 smoke 出现晚于 question_date 的同日会话；这表示适配约束未满足，不能直接宣称上游数据错误或模型失败。

公共 QA 变体从已检查的上游 scorer 哈希读取五个字面模板，保留包括时间题 off-by-one 在内的原判定说明；源码变化即要求重新审阅。每批使用独立 Claude Fable 5.2 Extra、15 个不带答案提示的正负控制和严格 JSON 标签，解析变化与 judge 变化都明确标为变体。缺失/中断答案必须 unresolved；控制失败仍保留原判断，但不进入准确计数。`memory-score` 按模型/分片/题型报告每个完整复评分，不选最好一轮；阻塞题仍见计划报告，官方分数始终单独标识。

`memory-lifecycle` 在真实模型提出的独立工作目录写入 fsync 后注入一次 SIGKILL，使用正常 checkpoint/restore 和 `verify-write` 对账，再接续同一 Task 的新执行；对账不计为第二次写入。当前该场景尚不能单独证明多个不同 Task 的意图连续性。`memory-world` 先拒绝实际请求，再仅允许明确给定的合成实体与备注批次，重启后检查。未提出所需动作、工具证据缺失和错误效果都保留，不能用零效果推导通过。

审计只读核验已停止 run 的 journal/CAS、操作参数/凭据、首轮失败历史及 probe 的实际发送上下文。V2 补充评分分别保留首答、提醒后、持久记忆、权限/效果、冷检索和正向 World 覆盖；旧 V1 分母和结果不覆盖。每批新评分使用新上下文和本版控制题，已暴露数据的补评分标为 exploratory。维护任务完成与回答正确分别报告；未完成或 opaque provider context 不得冒充冷记忆证明。

所有 pilot 在派发前写出完整计划矩阵；当前行先记 INCOMPLETE，尚未运行的行保留 NOT_TESTED。创建、停止或封存异常会停止后续派发，保留首个失败及完整分母。仓库 B-v2 向 Task 明确传入已经送达的 probe 前材料；不传未来问题或 oracle。B-v1 未传材料、遇审批即退出的首轮证据保留，不能将其缺口算成记忆质量。

评分导入只接受本 facility 的 `oracles/` 或本 checkout 的 `.local/reviews/` 下私有、归属明确的常规文件，保留原文件和规范 JSON 双哈希。`memory-score` 只做描述统计：不同评分版本分别列出，重复回执不扩大分母，同一 run 的冲突复评分标为待裁决，checkpoint 后继不算独立重复。它同时列出维护失败、driver 失败和未评分 run；`NO_GRADED_FAILURE` 仅表示选定断言没有 FAIL，不表示整轮无错误。S1/S2、重复根因、控制题及最终容忍门槛仍需复核，命令不生成合格结论。

V1/早期 V2 控制题编号曾透露正反例类别；保留历史答对结果，但不作为可靠盲评校准。V2b 使用不带答案含义的编号及稳定混排，需要重新独立校准。公共 P 的描述统计只计算实际取得内容的来源会话召回；只有 ID 的列表不算读取，命中任意片段不等于找到答案。官方准确率保留 NOT_TESTED；授权 Claude 变体也须固定并检查上游提示/parser、独立校准后再评分，检索指标不能替代语义准确率。P 的 Core bootstrap 使用 fixture，独立 reader 才发真实且计账的模型请求，两者不混淆。

## 数据与恢复

每次独立 `run` 使用新 UUID、工作区、PG18 集群、数据库/角色、API token 和完整新状态。控制器 registry 位于工具根目录之外，0700 目录 / 0600 私有文件；命令不输出 DSN/token。controller.lock 使用 OS 锁，进程退出后自动释放，不按 PID 猜测删锁。

`stop` 仅停止 Core，保留 PG 以便检查；`checkpoint` 停止 Core、校验 journal/CAS/绑定/进程/推送账本、复制完整状态（包括空目录）、执行 pg_dump，最后停止 PG，写完整 manifest。临时文件、发现端点、owner.lock、凭据不进入可恢复状态。校验失败保留全部材料，无隐式 clean。

`restore` 真正执行 pg_restore，使用新的 PG 集群和凭据、进程身份、nonce、目录 inode；逻辑 session/domain/task/request 不变。因为 Shared 绑定保存绝对路径，同一 lineage 必须回到 **原规范 pathname**：旧目录移动至 `retired/`，新 staging 晋升到 `slots/<lineage>/active`。未完成的 RESTORING 持久占用该 lineage，旧实例 start/checkpoint/clean 或第二次 restore 均拒绝，只能核验后 recover。禁止同时启动旧 incarnation 或从退休目录启动，不能任意迁移路径。checkpoint 分支不算统计独立重复。源 run 在 checkpoint 后若又产生已记录的 sink 效果，旧 checkpoint 拒绝恢复；不能回退投递账本隐藏后续效果。该检查也覆盖中断后的 handoff。

`recover` 只在导入凭据、checkpoint seal、文件/hash、归属和旧进程状态一致时完成中断的 handoff，或补完已移动但未提交的 clean tombstone；不完整创建/导入保持隔离等待检查，绝不猜测清理。查看私有 runs/evidence/PG 日志，确认旧进程与数据归属再处置；不得手工修改 registry 使未知资源通过。Core 的未知效果需正常 API `verify-write` 或人工对账，不自动重做。

`seal` 确认 worker / PG 停止，封存证据及域文件清单。`clean` 只接受匹配 marker、registry、目录身份、PG control ID、停止进程和完整 seal 的域，将活动目录可逆移动至 `cleaned/`，保留 PG、证据和 tombstone；**不释放磁盘空间、不递归删除**。原 run 无权清理后继 incarnation。

## 测试与报告

`self-check` 通过真实 Core/PG 执行独立运行、PID 重启/API 幂等、完整备份恢复/原 Shared 任务接续、导入行 xmin 不变、工具越界拒绝和证据保留清理。输出私有 `reports/<report-id>/report.json` 与由其渲染的 Markdown；后续重跑创建新报告，保留首次失败。

`npm test` / `npm run verify` 另运行 [离线基础测试](../../offline/benchmark/)，包括控制器切换/清理中断、真实 SIGKILL 的文件写入后对账、受控推送与错过/新建 AT 任务、所有权和危险恢复拒绝。fixture push sink 记录调用、dispatch/batch/attempt，不进行去重；真实推送服务未测试。现有 Core 的推送仍为 at-least-once；SENDING 或 sink/store 不一致 checkpoint 拒绝。fixture 恢复白名单保留工作区 file.write 与 builtin:readonly-shell；live 额外按状态核验被拒绝操作和已提交 World 的参数、凭据与 journal。scope.import 等可能在 App.open 自动执行的操作仍拒绝。

[报告 schema](../../benchmarks/common/report.schema.json) 定义 correctness / memory 两个 track 和六种状态；[渲染/校验器](../../benchmarks/common/report.ts) 保留完整分母、首个失败、缺失用量 null 和证据类别。`self-check` 记录版本/配置/机器、耗时、最后 RSS 样本、文件字节、调用数及私有证据位置；RSS 不是精确峰值。源证据可能含测试内容和连接凭据，仅公开脱敏汇总。断电、任意时刻 PG 物理备份、敌对同用户 OS 沙箱和真实记忆质量均不在本次证据范围。

后续功能逻辑变更测普通 correctness，记忆体系变更测 memory benchmark 并补相关普通回归；跨范围跑两类。具体真实模型矩阵为 GPT-6.1 Sol、DeepSeek Flash、GPT-6 Luna，模型 ID、路由、配置与缺失用量逐次固化。DeepSeek 为必需比较行，Sol/Luna 保留能力边界，不隐去失败。


## 用后归档

Master 指定后续测试数据统一保存在 `/Volumes/share/Files/HDD2/ELIZA/ELIZA_BAK/secretary-test-bak`。创建命令强制采用独立子目录（例如 `--root <repo>/.local/benchmark/tests/<uuid>`）；完成后先停止并 seal 各 run，再运行：

```sh
npm run benchmark -- archive --root <exact-facility-root>
npm run benchmark -- archive --root <exact-facility-root> --apply true
```

第一条只输出 dry-run 清单规模。第二条要求 NAS 已挂载在独立卷，核验每个已登记 run 的所有权、停止状态与 PG 身份，拒绝混合总根、活动/未知/不完整资源。先在本地把完整 facility（含 PG、CAS、工作区、报告、原始失败）打成一个 tar.gz，再传到日期/UUID 目录；只附加少量 manifest、receipt、恢复说明。读取 NAS 上的压缩包逐项核验内容/大小/权限，复查源未变并发布后，才移除对应本地 facility。失败保留源和诊断材料；不得以成功重跑覆盖失败。包内含私有测试凭据，保持访问受限，不提交 Git。独立 API 配置和敏捷持久数据不属于此归档。

worker 仅接收 Core 的非超级用户连接凭据，启动时断言实际角色为 benchmark_core 且 rolsuper=false；管理员凭据留在控制器。默认 fixture 不启用崩溃注入，只有测试配置显式添加 `"fault_injection":"write-after-fsync"` 才在指定写入后发 SIGKILL。配置记录于每次私有证据。fixture 的 fetch 捕获器拒绝意外网络访问；这不是操作系统网络沙箱。

恢复来源通过独立 restoredFrom 元数据记录，不冒充新 run 自己生成的最新 checkpoint。导入行必须非空才执行 xmin 保留断言。只读预检遇到残缺 journal 尾部直接拒绝（PARTIAL_JOURNAL）；这一边界比产品正常 journal 恢复更严格。退休目录当前验证写入前后不变，尚未独立证明完全没有读取；旧索引测试覆盖空索引重建，具体陈旧行替换场景留待后续。AT 用例为停止留出 10 秒；若机器未能赶上窗口则明确失败，不报业务行为通过。

归档的内容核验是 fsync 后的客户端读回；macOS 额外使用 F_NOCACHE，仍不声称验证了 NAS 断电持久性。receipt 明确记录验证方式。任意深度出现额外 facility.json/controller.lock 或 postmaster.pid 都拒绝，避免把嵌套活动实例当作报告/证据清理。普通本地套件完成后按上述命令逐个归档 `.local/benchmark/tests/` 的 facility；CI 使用一次性 runner，不要求连接 Master 的 NAS。live 恢复已使用按状态区分的 Operation 核验；成功 World 必须有同批次提交凭据和 journal，终结拒绝必须有未派发证明，未知文件效果只能在独立目录内正常对账。

## R6 后的协议修订（v3 评分 / v2 公共适配器）

新导出的 S/R 包使用 v3；旧包及评分不覆盖。V3 的 63 个控制包含三个完整六断言包、UNRESOLVED、S4、合理澄清和长轨迹注入错误，旧校准不能代替。模型名遮蔽不等于完全盲评，provider 格式仍可辨认。宿主覆盖限制允许标签；未执行正向 World/冷检索只允许 UNRESOLVED，已确定的错误效果不能用未知覆盖消除。

公共 v2 搜索只返回产品式 200 字符 snippet/offset，v1 整块命中结果只作历史参考。明确工具/请求超限与空答为 SUT_NO_ANSWER，按错误计；基础设施未知保持 unresolved。公共 QA v2 与历史 v1 分别保存，不混算最好结果。

源码在整个 campaign 内固定；创建/启动/发送均检查。控制器崩溃后可运行 `npm run benchmark -- memory-campaign-close --root <exact-facility-root>`，仅在全部归属可核验的 worker/PG 已停止时关闭，保留 orphan 预留与最终费用/ledger 哈希，不重新派发。正常关闭也更新持久批准登记表。发送保护读取 checkpoint 外的 lineage canary/未来输入表；拒绝产生无正文的私有回执。现有错误率门槛继续等待 Master 冻结；本工具不宣布发布合格。

## R9 后的批次校准与逐轨迹处置

首次 V3 导出前提交私有 disposition：version=1、原始 grade-packet 的规范 JSON SHA256（source_artifact_sha256）、protocol_version、reviewed_by、rationale、harness_defects、gradable_assertions。说明哪些断言受历史 harness 缺陷影响，与来源一同冻结，不能消除独立确认的错误效果。批次清单为私有 JSON {"runs":["<run-id>"]}，只含本 facility 已停止的 run。导出包含固定 ID、控制和样本全文；private expected/mapping 禁止发送给 grader。

每个新上下文只评一个 batch，关闭记忆和历史会话引用，不使用工具或仓库；看过答案的代码 reviewer 不能在同一上下文评分。回执绑定批次/样本哈希和完整控制结果；直接 memory-grade-import 拒绝绕过。统计重新核验校准，控制无效/缺失不计严重度。ALL_UNRESOLVED 单列，NO_GRADED_FAILURE 不代表整轮成功。

FAIL 必须带 hard_gate_tags：authority、stale_correction、lost_obligation、false_completion、duplicate_effect、reminder_regression 或 other；PASS/UNRESOLVED 标签为空。S1/S2 的 human_review=true 表示待人工审查，不是已获人工批准。没有回答的探针、不可判定冷检索和未执行 World 正向协议只允许 UNRESOLVED；Retained PASS 必须对应真实维护产物。导出/score 使用不写入原证据的审计模式。

R11 freezes neutral disposition metadata only; reviewer identity/prose stays private and is hash-bound. Calibration receipts bind source hashes and import-time status; rejected responses have receipts, and overlapping batches are refused. The 63 controls include explicit tag checks for unauthorized effect, authority, false completion, duplicate effect, stale correction, lost obligation, reminder regression and other. Tag checking is partial where older controls have no expected tag set. G1 candidates exclude ordinary/reminder-only failures; all consequence failures remain counted.

## #121 单独版本的 Opus 评分员迁移

[中英文迁移计划](../../../docs/fix/fix_20261116_issue121_judge_migration.md)仅覆盖原来未发送的第 10–15 批。原冻结 v3、前九批与 Fable 身份校验保持原义；新子批次使用 `opus-5.5-extra-migration-v1`，不是 v4 重标。导出、尝试记录、导入、计分均持有原 controller lease；新文件先暂存并核验全部哈希，最后发布提交标记。部分写入或丢失标记会拒绝读取，不能直接重跑覆盖。

所有命令都必须指定已有、已停止且归属确认的 `--root`。`memory-judge-export --source <private-bundle> --batch <child-id> --approval <review-CI-proof>` 只接受固定六批清单与仓库中的不透明哈希锚；先推送锚与实现，通过准确 HEAD 的复核/CI，再对真实设施导出。`memory-judge-ready --source <roots-json> --approval <proof>` 分别加锁检查三个设施的六批并写入一致的就绪快照。每次发送前仍重新检查本设施；跨设施快照不是原子事务。

`memory-judge-reserve --batch <child-id> --source <UI-evidence-json>` 在发送前永久预留次数，保存 Opus 5.5 / Extra、Manual、Incognito 的界面证据。`memory-judge-send --attempt <id>` 写发送意图后，操作者在独立浏览器上下文中上传准确请求与固定 wrapper。`memory-judge-import --attempt <id> --verdict <original-copy-file> --source <extraction-observation-json>` 保存原始 Copy、唯一允许的外层围栏/空白处理及证据；响应不能自行选择要导入的批次。原始响应不完整或无效 JSON 的机械重试最多三次；身份、数量、语义或校准失败暂停，不重抽样。预留后未发送也不退还次数。

`memory-judge-reconcile --transaction <id> --sha256 <reviewed-prepare-hash>` 只隔离未提交事务，不重发、不自动修复或提升为成功。隔离保留原始字节及尝试消费记录；导出只可重用原子批次 ID，响应只能原文件重导入。所有未知状态先诊断。

`memory-score` 新报告版本为 `secretary-memory-descriptive-score-v2-judge-strata`，评分员、策略和批次版本均从本地校准链推导。Fable/Opus 分层，混合总数只能表达覆盖，不能合并质量指标、比较评分员或宣布合格。旧报告不覆盖，人工判断仍待 Master。

Migration recovery also exposes `memory-judge-no-response --root <root> --attempt <id> --source <observation.json>` for a confirmed transport failure after a committed send, with no response text. The observation must record `confirmed_no_response: true`, `in_flight: false`, `failure_kind: "CONFIRMED_TRANSPORT_NO_RESPONSE"`, a nonempty `reason`, and owned UI evidence `files`. Quota/model-unavailable states pause instead. Quarantined pre-send reservations remain permanently counted; only a verified unsent reservation below the three-attempt cap permits another. Identical partial readiness publication resumes without overwriting existing records. Journal-less recovery requires the exact inspected preparation inventory digest; reconciliation reports other pending IDs separately. Every send must still use the clean reviewed commit bound in readiness.

Use `memory-judge-inspect --root <root> --transaction <id>` to obtain the exact digest required for reconciliation, including journal-less preparation. Quarantined capture journals still bind original response size/hash; re-import must use identical bytes and the same attempt. A no-response claim refuses any prior capture/terminal/outcome journal, and conservatively refuses journal-less quarantines at or after send-intent. An unrecorded capture interruption requires original browser evidence and a pause on uncertainty, never a replacement response.
