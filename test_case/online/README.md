# Online tests

从仓库根目录运行；需要本地角色密钥，调用真实 API 并产生用量。

| 脚本 | 命令与范围 |
| --- | --- |
| test-live.ts | `npm run test:live -- <model> <scenario> [task-model]`；chain / missing / unknown / transport / reject |
| test-instructions-live.ts | `npm run test:instructions:live`；用户说明真实模型探针 |
| verify-memory-live.ts | `node --import tsx test_case/online/verify-memory-live.ts <数据目录副本> <报告路径>`；独占目录进行整理及只读模型探针 |

现有 online test 需要后续优化。必须建设更接近日常使用、能够持续衡量行为稳定性的回归用例；具体场景、统计指标和证据要求见 [测试策略](../../docs/testing.md)。本次目录整理不运行付费在线模型测试。
