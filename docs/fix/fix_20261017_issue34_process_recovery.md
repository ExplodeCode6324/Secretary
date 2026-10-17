# Issue #34：进程恢复与空闲检查性能

范围：fix；Codex 实施，本地 Hermes 复核；Master 指定 OpenCode Kimi K3，仅 rate limit 时 fallback DeepSeek 官方 provider。最终交 Master 终审，不自动合并。

## 现状与目标

#24 已合并（main c5826c1），已有 Operation 的 `scope.execution_id` 和 `process.state` 派生索引。`processStopped()` 已按 Execution 查询，但 `recoverProcesses(true)` 仍逐条历史 Operation 调用它和收束逻辑；同一 Execution 大量历史操作仍可能平方遍历。`recover()` 的未知操作收集仍对每个 Execution 全表扫描。空闲 tick 只有找到待恢复进程才推进五秒门限。

## 方案

1. 启动恢复保留一次历史 Operation 遍历，以覆盖旧 journal 无 process 的 DISPATCHED/RESULT_UNKNOWN 以及已 STOPPED、待收束的执行；按 execution_id 分组。每个进程仍独立探测和持久化停止证据；全部探测后，每个 Execution 只做一次停止判断及收束。通知仅针对实际尚未确认停止的操作，保留按 Operation 的去重键。
2. 周期恢复复用 process.state 索引，仅处理未 STOPPED 的候选集合，排除当前 running。无候选时也推进五秒检查门限；不产生新持久状态。启动恢复完成后的其他恢复阶段按 execution_id 索引收集未知操作。
3. 同一启动恢复循环的 ModelCall/Feedback 查询也改按 Execution：Feedback 复用 execution_id 索引，ModelCall 在现有通用索引机制增加 scope.execution_id。防止 Operation 改完后仍按候选重复克隆其他类型历史。Scope 占用沿用既有 `processStopped()` 与 Execution 索引；不改身份探测、信号发送、人工 resolve 或 journal 格式。索引仍由成功提交和 journal 重放统一维护。

## 验证

- 先建立会在旧实现失败的遍历计数测试：同 Execution 多条历史操作，恢复查询总访问量近似线性；空闲 tick 五秒内不重复查询候选索引。
- 增加门限正向测试：一次无候选检查后加入 UNCONFIRMED 候选，在五秒门限到期时触发持久恢复与通知；运行中 Execution 不被周期恢复干预。完整启动恢复统计 Operation/ModelCall/Feedback 查询，禁止按候选克隆三者全历史。
- 1 千、1 万、5 万合成历史 Operation，固定少量活动/UNCONFIRMED，包含集中在同 Execution 的历史；对比启动恢复与周期恢复查询计数、耗时及 HTTP 延迟，单列 journal 重放与进程探测成本。基准使用临时合成目录，不接触运行数据。
- 索引结果与全扫描参考对照：提交/修订、STOPPED/UNCONFIRMED、人工 resolve、拒绝提交、重启与缺少 process 的旧记录。
- #16/#18 及 process-lifecycle 回归：身份不明不发信号，不释放 DIRECTORY；UNVERIFIED 不绕过停止检查，NONE 并行和 file.write 未知结果约束不变。
- `npm run verify`、macOS 真实进程测试、PR Linux PostgreSQL 完整 CI；记录实际结果与边界。

## 复核记录

R1：Kimi K3 / opencode-go，CHANGES_REQUIRED。采纳两项阻断：启动恢复内 ModelCall/Feedback 的关联全扫描一并改为 Execution 索引；补候选加入后在一个门限周期内触发恢复的正向测试。验收分别记录离线/macOS 真实进程和 Linux PostgreSQL CI。#34 的 PR 使用 Refs #34，合并并确认 main CI 后再单独关闭，避免结项状态早于最终验证。

R2：两项技术阻断均 CLOSED；仅要求明确上述 Refs/合并后关闭流程，采纳。Reviewer 确认此文字修订后具备执行条件，无需第三轮计划复核。开始实施。

## 首次验证

在 main c5826c1 上新增 4 项回归，1 通过、3 失败：200 条同 Execution 历史操作触发 80,000 条索引返回记录访问；五秒内 10 次空闲 tick 查询 10 次；混合 STOPPED/STARTING/UNCONFIRMED/旧无 process 操作错误地给全部 4 项通知，而非仅 2 项真正未确认操作。已有索引的修订、拒绝提交和旧记录重放对照通过。失败依据为计数和通知对象断言，无墙钟门限。

随后增加完整 recover() 的全表扫描断言：5 个 Execution 触发 6 次 Operation 全表查询，预期仅启动收集时 1 次。原有 #16/#18/process-lifecycle 基线 53/53 通过（macOS，真实进程崩溃测试包含在内）。

## 实施与验证记录

实现按 Execution 去重收束，通知基于探测后重新读取的 Operation；空闲门限无条件推进。复用 Feedback/Operation 索引，新增由同一 apply/replay 维护的 ModelCall execution 索引。新增 7 项回归在 macOS 全部通过。完整验证、三档后测、CI 与冻结提交的最终 Hermes 结论追加到 PR，避免为状态更新重复触发 CI。

基准入口：`npx tsx test_case/benchmarks/issue34-recovery.ts 1000 10000 50000`。历史每个 Execution 包含 100 条 STOPPED Operation（保留未知 effect，以覆盖待人工处置的历史），另有一个模板操作和两个缺少身份的 UNCONFIRMED 进程。该模型测量 Operation 查询路径，未调用真实外部进程探测；身份/信号合同由 #18 的真实进程测试验证。每档 HTTP 是恢复阻塞期间的一次请求，不能作为长期延迟分位数。墙钟受本机并行测试影响，以查询计数和同场景对照为主要证据。初始数据持久化时间不计入恢复，Store 重放另计。
