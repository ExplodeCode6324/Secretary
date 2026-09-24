> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../README.md)。

# Secretary 测试设计

本目录依据当前仓库 BrainStorm Baseline v3、状态机、JSON 契约、World Model schema 和 demo 设计编写。目标是验证状态传递与恢复、长期记忆准确率、模块稳定性、异常与并发，以及权限、可观测性和真实任务结果。设计 catalog 的初始状态保留为 `NOT_RUN`；实际执行结果按独立 run 保存，避免把子项通过当作整条验收。

历史 Pi 运行证据见 [Pi 证据索引](../../../test_case/reports/design/comparison-20260922/README.md)。目录拆分前的完整混合报告与原 source manifest 已迁入相邻归档。本次为通用设计重新建立来源快照，不继承旧运行判定。

建议先读 [执行与判定协议](PROTOCOL.md)，再看 [覆盖索引](COVERAGE.md)、[长期记忆评测](MEMORY.md) 和 [长期运行计划](CAMPAIGNS.md)。具体用例在 `cases/`，机器可读唯一来源是 [catalog.json](catalog.json)。状态图全边测试义务另见 [转换矩阵](TRANSITIONS.md)；矩阵不是已实现的运行测试。

| Master 的要求 | 用例与评测入口 |
| --- | --- |
| 状态正确传递、恢复 | [状态与恢复](cases/01-state.md)、[持久化与崩溃](cases/02-storage.md)、[端到端](cases/09-e2e.md) |
| 长期记忆准确率 | [工作记忆](cases/03-memory.md)、[事实与证据](cases/07-world.md)、[量化方案](MEMORY.md) |
| 各模块稳定性 | [调度](cases/04-scheduler.md)、[执行与交接](cases/06-execution.md)、[持续运行](CAMPAIGNS.md) |
| 异常、竞态、并发 | [存储](cases/02-storage.md)、[授权](cases/05-authorization.md)、[负载与接口](cases/08-resilience.md)、[故障窗口](FAULTS.md) |
| 其他场景 | 证据缺失、提示注入、时间变化、程序更新、归档、恢复兼容性、通知、实际产物独立验证 |

在仓库根目录执行以下命令，只检查测试设计与样本自身：

```sh
python3 test/scripts/check.py
```

检查报告为 [reports/design-check.json](../../../test_case/reports/design/design-check.json)，级别只能是 `DOC_ONLY`。检查内容包括用例唯一性、J01–J21/模块/基线章节映射、状态图漂移、源文件摘要、样本引用与格式、本地链接和生成文档一致性。它不验证守卫实现、fsync、数据库事务、摘要语义或运行稳定性。

`scripts/build.py` 根据 catalog 和当前状态图生成索引与 Markdown；修改用例后执行它。`fixtures/memory-timeline.json` 是人工设定的合成事实和预期答案，不能用被测模型的回答反写它。`fixtures/run-record.example.json` 是未运行的报告模板。

当前参考实现为 [Pi demo](../../../test_case/reports/implementation/REVIEW.md)。首次设计时现有测试仅作接线参考；历史运行证据见上述索引。设计源文件快照见 [sources.json](sources.json)；未将其他 Secretary 仓库的历史设计覆盖到本基线。真实模型测试仅使用本地配置中的角色凭据与合成资料，不读取私人对话。

快照缓存、自动备份、真实物理掉电、外部通知、未来 EVENT 来源等必须按各实现声明能力单独报告 `BLOCKED_CAPABILITY` 或 `NOT_APPLICABLE`，不能计入 PASS。48 小时保留、性能阈值和质量门槛是候选参数或本测试设计建议，均不改写 BrainStorm。
