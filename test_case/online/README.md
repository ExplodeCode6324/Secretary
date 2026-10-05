# Online tests

从仓库根目录运行；需要本地角色密钥，调用真实 API 并产生用量。

| 脚本 | 命令与范围 |
| --- | --- |
| test-live.ts | `npm run test:live -- <model> <scenario> [task-model]`；chain / missing / unknown / transport / reject |
| test-settings-live.ts | `SECRETARY_TEST_DATABASE_URL='<隔离数据库 DSN>' node --import tsx test_case/online/test-settings-live.ts <报告路径>`；World 更正、撤回、说明与约束承接 |
| test-instructions-live.ts | `npm run test:instructions:live`；用户说明真实模型探针 |
| verify-memory-live.ts | `node --import tsx test_case/online/verify-memory-live.ts <数据目录副本> <报告路径>`；独占目录进行整理及只读模型探针 |
| test-continuity-astra-live.ts | `npm run test:continuity:live -- --live --evidence <全新目录>`；真实主模型五逻辑日回忆、整理、持久存储重开和语言设置切换 |

现有 online test 需要持续增加日常场景与多次独立样本；具体场景、统计指标和证据要求见 [测试策略](../../docs/testing.md)。普通离线测试不运行付费模型。

## 多日记忆与语言连续性

`test-continuity-astra-live.ts` 只调用现有 `opencode-go / deepseek-v4.1-flash` 主模型，任务模型禁止调用，不运行 Scheduler；模型工具限制为只读。显式提供 `SECRETARY_CREDENTIALS_FILE` 或 `SECRETARY_MAIN_API_KEY`，前者读取现有 JSON 的 `main` 字段，不创建凭据。

每轮最多 24 次实际请求、15 分钟、每请求 90 秒、输出最多 8192 token，序列化上下文最多 80000 bytes。所有请求（含整理、设置重建及独立承诺提取）共用预算，不静默重试；失败目录拒绝覆盖。报告记录每次原文、源码 SHA、用量与费用估算。费用是 SDK/provider 模型目录字段，不是到账账单。

逻辑日仅为合成标签；重开是同一进程关闭 App 后从持久文件打开，不等于跨日真实使用或 OS 进程重启。主模型可见原始用户输入锚点，不能据此声称仅靠摘要完成回忆。独立字段 oracle 检查与自然语言人工复核分别保留。`--self-check` 只验证 oracle 的正负对照，不调用 API，也不证明模型能力。

## 任务复用与多轮修改

`npm run test:task-reuse:live -- deepseek-v4.1-flash` 运行 O01–O06：直接分析、生成后修改、解释依据、压缩报告、重启续改、独立交付。凭据从 SECRETARY_CREDENTIALS_FILE 或本地 .demo-data/live-credentials.json 读取，主会话与任务角色均为真实模型。使用独立 Store、workspace 和会话，最多每角色 48 次模型调用、100 次工具调用和 12 分钟。只代行两个指定报告文件的隔离写入批准；其他动作失败停止。输出在 reports/task-reuse-20260929/，保留逐次运行和失败，不覆盖首次记录。

## 当前活动有界验收

`node --import tsx test_case/online/test-activity-live.ts <报告路径>` 在独立 Store 中运行合成聊天、一次小规模设置应用及排队输入。默认读取现有主模型凭据，调用上限 12 次、总时限 15 分钟；工具调用结果会被拒绝，task 角色为 fixture。报告标记 running/complete/failed，只在全部断言完成后设置 pass。它不部署服务或修改现用会话。具体证据见[活动验收](../reports/activity-20261005/README.md)。
