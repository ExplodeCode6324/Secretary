# Online tests

从仓库根目录运行；需要本地角色密钥，调用真实 API 并产生用量。

| 脚本 | 命令与范围 |
| --- | --- |
| test-live.ts | `npm run test:live -- <model> <scenario> [task-model]`；chain / missing / unknown / transport / reject |
| test-settings-live.ts | `SECRETARY_TEST_DATABASE_URL='<隔离数据库 DSN>' node --import tsx test_case/online/test-settings-live.ts <报告路径>`；World 更正、撤回、说明与约束承接 |
| test-instructions-live.ts | `npm run test:instructions:live`；用户说明真实模型探针 |
| verify-memory-live.ts | `node --import tsx test_case/online/verify-memory-live.ts <数据目录副本> <报告路径>`；独占目录进行整理及只读模型探针 |

现有 online test 需要后续优化。必须建设更接近日常使用、能够持续衡量行为稳定性的回归用例；具体场景、统计指标和证据要求见 [测试策略](../../docs/testing.md)。本次目录整理不运行付费在线模型测试。

## 任务复用与多轮修改

`npm run test:task-reuse:live -- deepseek-v4.1-flash` 运行 O01–O06：直接分析、生成后修改、解释依据、压缩报告、重启续改、独立交付。凭据从 SECRETARY_CREDENTIALS_FILE 或本地 .demo-data/live-credentials.json 读取，主会话与任务角色均为真实模型。使用独立 Store、workspace 和会话，最多每角色 48 次模型调用、100 次工具调用和 12 分钟。只代行两个指定报告文件的隔离写入批准；其他动作失败停止。输出在 reports/task-reuse-20260929/，保留逐次运行和失败，不覆盖首次记录。
