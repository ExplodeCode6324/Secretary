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
npm run benchmark -- memory-grade-export --root <stopped-root> --run <run-id>
npm run benchmark -- memory-grade-import --root <stopped-root> --run <run-id> --verdict <private-verdict.json>
npm run benchmark -- memory-score --root <stopped-root>
```

`memory-prepare` 下载并固定公共 LongMemEval 来源；`memory-public --subset dev|smoke` 只评估检索组件，不伪造 Core 对话导入。来源下载失败时保留诊断，不报告公共数据集已执行。`memory-private-prepare` 只接受脱敏/已获授权的重建开发场景和匹配来源哈希；它不建立未见样本。仓库 B 从较早的固定提交复制一个只读资料文件到已初始化的独立 Task 目录，保留真实 read 工具结果，原仓库未暴露给被测模型。A 与 B 分开报告。

`memory-lifecycle` 在真实模型提出的独立工作目录写入 fsync 后注入一次 SIGKILL，使用正常 checkpoint/restore 和 `verify-write` 对账，再接续同一 Task 的新执行；对账不计为第二次写入。当前该场景尚不能单独证明多个不同 Task 的意图连续性。`memory-world` 先拒绝实际请求，再仅允许明确给定的合成实体与备注批次，重启后检查。未提出所需动作、工具证据缺失和错误效果都保留，不能用零效果推导通过。

审计只读核验已停止 run 的 journal/CAS、操作参数/凭据、首轮失败历史及 probe 的实际发送上下文。V2 补充评分分别保留首答、提醒后、持久记忆、权限/效果、冷检索和正向 World 覆盖；旧 V1 分母和结果不覆盖。每批新评分使用新上下文和本版控制题，已暴露数据的补评分标为 exploratory。维护任务完成与回答正确分别报告；未完成或 opaque provider context 不得冒充冷记忆证明。

所有 pilot 在派发前写出完整计划矩阵；当前行先记 INCOMPLETE，尚未运行的行保留 NOT_TESTED。创建、停止或封存异常会停止后续派发，保留首个失败及完整分母。仓库 B-v2 向 Task 明确传入已经送达的 probe 前材料；不传未来问题或 oracle。B-v1 未传材料、遇审批即退出的首轮证据保留，不能将其缺口算成记忆质量。

评分导入只接受本 facility 的 `oracles/` 或本 checkout 的 `.local/reviews/` 下私有、归属明确的常规文件，保留原文件和规范 JSON 双哈希。`memory-score` 只做描述统计：不同评分版本分别列出，重复回执不扩大分母，同一 run 的冲突复评分标为待裁决，checkpoint 后继不算独立重复。它同时列出维护失败、driver 失败和未评分 run；`NO_ASSERTION_FAILURE` 仅表示选定断言没有 FAIL，不表示整轮无错误。S1/S2、重复根因、控制题及最终容忍门槛仍需复核，命令不生成合格结论。

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
