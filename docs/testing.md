# 测试策略

[test_case](../test_case/README.md) 将可执行 offline、显式 online 与每次报告分开。静态原始测试设计仅在 docs/old 中保留，不计入当前运行覆盖。

```sh
npm run verify
npm run test:review
python3 test_case/offline/test-postgres.py --pg-bin /path/to/postgresql/bin
python3 test_case/offline/audit/run-world.py --pg-bin /path/to/postgresql/bin
```

普通 offline 测试涵盖 Store、Host、Scheduler、授权、记忆、说明、shell、TUI/Web、崩溃恢复。world.test 无测试 DSN 时跳过；PostgreSQL runner 创建临时 Unix socket 集群并执行实际 TypeScript 仓储，结束后停止清理，不连接应用数据库。review 的 AUD14 是历史误报并显式排除，不能声称全部历史探针无例外通过。

显式在线入口：

```sh
npm run test:live -- deepseek-v4.1-flash chain gpt-5.6-luna
npm run test:instructions:live
node --import tsx test_case/online/verify-memory-live.ts <数据目录完整副本> <报告路径>
```

这些命令会产生 API 用量。test-live 支持 chain / missing / unknown / transport / reject，驾驶器只代行场景限定的预期写入许可；故障注入不是 provider 自然故障。verify-memory-live 独占指定目录并执行记忆整理，优先对完整副本使用；它不启动调度 pump。普通 npm test 不包含这些脚本。

## Online 后续优化

现有 online 主要是短场景链路和特定功能探针。需要建设更接近日常使用、能够持续衡量行为稳定性的回归用例：

| 维度 | 后续场景与量化目标 |
| --- | --- |
| 长对话 | 多日输入、插话、更正、偏好变更；遗漏率、事实保持、承诺生命周期 |
| 任务闭环 | 并行任务、缺材料、批准/拒绝/撤销、取消和延迟反馈；重复派发、越权次数 |
| 不确定性 | 中断、超时、缺回执、过期知识与冲突；未知效果盲重试、无证据成功声明 |
| 记忆稳定性 | 多次整理、上下文压力、重启续接；来源保留、承诺误关闭、摘要事实漂移 |
| UI 日常使用 | TUI/Web 双开、设置并发修改、通知展示、后台重连；一致性与可恢复性 |
| 统计对照 | 固定语料与模型配置，多次运行；通过率、失败分布、调用数、延迟与成本 |

未来套件应记录模型/provider、prompt版本、代码 hash、初始数据、操作授权边界、每个验收点和失败原件。用确定性断言衡量权限与状态，以人工盲审/独立评分衡量摘要与沟通质量，比较基线和趋势，不能单次跑通就宣称行为稳定。本节是计划，尚未实现完整日常回归套件。

证据层次分别为静态设计检查、OFFLINE_RUNTIME、POSTGRES_RUNTIME、LIVE_MODEL 和 REAL_USE；各层互不替代。
