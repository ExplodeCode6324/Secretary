# 独立测试环境基础（#120）

此入口建设可重建的 Core / PostgreSQL 环境，当前只接受 **fixture / correctness / infrastructure v1**，零次真实模型调用。真实记忆工作负载、数据集、语义 oracle、provider 台账和评分由 #121 接续。不要把这里的 PASS 当作记忆性能结论。

## 前提与边界

- 非部署的 main 开发 checkout，Node ≥22.19、Python 3、PG **18** 的完整服务端工具及 npm 依赖、固定子模块。macOS 使用 `pg_config --bindir`；Linux 优先 `/usr/lib/postgresql/18/bin`，否则由 pg_config 定位；每个工具均核验主版本。
- macOS 可安装 `brew install postgresql@18` 并把其 bin 加入 PATH；Linux 使用 [PostgreSQL 官方 Apt 源](https://www.postgresql.org/download/linux/ubuntu/) 安装 postgresql-18。CI 两平台均安装并实际运行测试，不跳过 PG 恢复。
- 只能使用本 checkout `.local/benchmark/` 内的规范绝对路径。敏捷 checkout、路径别名或带部署标记的副本在创建任何 benchmark 文件前拒绝。
- 从不读取 `.env`；worker/PG 工具使用精简环境，不继承 SECRETARY、PG、NODE_OPTIONS 或 HOME 配置。无网络模型、无真实推送、无任意 shell/PROGRAM、无 DIRECTORY Scope、无自定义授权规则。
- root `npm start` / `npm stop` 路由敏捷入口，**不用于此环境**。不得使用敏捷数据、数据库、凭据或 launchd。

## 精确命令

从仓库根目录执行。可选 `--root <repo/.local/benchmark/子目录>` 需在每次操作中保持一致。

```sh
npm run benchmark -- self-check
npm run benchmark -- run
npm run benchmark -- status --run <run-id>
npm run benchmark -- stop --run <run-id>
npm run benchmark -- start --run <run-id>
npm run benchmark -- checkpoint --run <run-id>
npm run benchmark -- restore --run <source-run-id> --checkpoint <checkpoint-id>
npm run benchmark -- recover --run <interrupted-run-id>
npm run benchmark -- seal --run <run-id>
npm run benchmark -- clean --run <run-id>
npm run benchmark -- report --run <report-id>
```

`run` 返回不含口令的 run_id / lineage / state / evidence。如需配置，先在 `<root>/configs/` 手工保存私有 JSON，再传 `run --config <file>`，精确格式：

```json
{"version":1,"mode":"fixture","track":"correctness","case_id":"infrastructure","seed":120}
```

不支持 `--case` 或 live 参数；未知配置键拒绝。seed 是 fixture 描述信息，不表示真实 provider 确定性。代码、HEAD、依赖或相关源文件改变后不能重启/恢复旧冻结 run，需回到原代码审阅或新建 run；不要修改旧清单绕过检查。

## 数据与恢复

每次独立 `run` 使用新 UUID、工作区、PG18 集群、数据库/角色、API token 和完整新状态。控制器 registry 位于工具根目录之外，0700 目录 / 0600 私有文件；命令不输出 DSN/token。controller.lock 使用 OS 锁，进程退出后自动释放，不按 PID 猜测删锁。

`stop` 仅停止 Core，保留 PG 以便检查；`checkpoint` 停止 Core、校验 journal/CAS/绑定/进程/推送账本、复制完整状态（包括空目录）、执行 pg_dump，最后停止 PG，写完整 manifest。临时文件、发现端点、owner.lock、凭据不进入可恢复状态。校验失败保留全部材料，无隐式 clean。

`restore` 真正执行 pg_restore，使用新的 PG 集群和凭据、进程身份、nonce、目录 inode；逻辑 session/domain/task/request 不变。因为 Shared 绑定保存绝对路径，同一 lineage 必须回到 **原规范 pathname**：旧目录移动至 `retired/`，新 staging 晋升到 `slots/<lineage>/active`。未完成的 RESTORING 持久占用该 lineage，旧实例 start/checkpoint/clean 或第二次 restore 均拒绝，只能核验后 recover。禁止同时启动旧 incarnation 或从退休目录启动，不能任意迁移路径。checkpoint 分支不算统计独立重复。源 run 在 checkpoint 后若又产生已记录的 sink 效果，旧 checkpoint 拒绝恢复；不能回退投递账本隐藏后续效果。该检查也覆盖中断后的 handoff。

`recover` 只在导入凭据、checkpoint seal、文件/hash、归属和旧进程状态一致时完成中断的 handoff，或补完已移动但未提交的 clean tombstone；不完整创建/导入保持隔离等待检查，绝不猜测清理。查看私有 runs/evidence/PG 日志，确认旧进程与数据归属再处置；不得手工修改 registry 使未知资源通过。Core 的未知效果需正常 API `verify-write` 或人工对账，不自动重做。

`seal` 确认 worker / PG 停止，封存证据及域文件清单。`clean` 只接受匹配 marker、registry、目录身份、PG control ID、停止进程和完整 seal 的域，将活动目录可逆移动至 `cleaned/`，保留 PG、证据和 tombstone；**不释放磁盘空间、不递归删除**。原 run 无权清理后继 incarnation。

## 测试与报告

`self-check` 通过真实 Core/PG 执行独立运行、PID 重启/API 幂等、完整备份恢复/原 Shared 任务接续、导入行 xmin 不变、工具越界拒绝和证据保留清理。输出私有 `reports/<report-id>/report.json` 与由其渲染的 Markdown；后续重跑创建新报告，保留首次失败。

`npm test` / `npm run verify` 另运行 [离线基础测试](../../offline/benchmark/)，包括控制器切换/清理中断、真实 SIGKILL 的文件写入后对账、受控推送与错过/新建 AT 任务、所有权和危险恢复拒绝。fixture push sink 记录调用、dispatch/batch/attempt，不进行去重；真实推送服务未测试。现有 Core 的推送仍为 at-least-once；SENDING 或 sink/store 不一致 checkpoint 拒绝。恢复前的 Operation 能力白名单只允许工作区 file.write 与 builtin:readonly-shell，scope.import 等可能在 App.open 自动执行的操作一律拒绝。

[报告 schema](../../benchmarks/common/report.schema.json) 定义 correctness / memory 两个 track 和六种状态；[渲染/校验器](../../benchmarks/common/report.ts) 保留完整分母、首个失败、缺失用量 null 和证据类别。`self-check` 记录版本/配置/机器、耗时、最后 RSS 样本、文件字节、调用数及私有证据位置；RSS 不是精确峰值。源证据可能含测试内容和连接凭据，仅公开脱敏汇总。断电、任意时刻 PG 物理备份、敌对同用户 OS 沙箱和真实记忆质量均不在本次证据范围。

后续功能逻辑变更测普通 correctness，记忆体系变更测 memory benchmark 并补相关普通回归；跨范围跑两类。具体真实模型矩阵为 GPT-6.1 Sol、DeepSeek Flash、GPT-6 Luna，Luna 失败可以作为能力边界记录，不能遗漏或伪造通过；模型 ID、路由、配置与缺失用量逐次固化，#121 才提供执行入口。
