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

## API v1 有界真实调用

`test-api-v1-live.ts` 使用认证的 `/api/v1` 命令和查询，验证合成主会话、两个关联任务、说明设置应用、真实整理及 Store 重开后的事实和语言承接。只改隔离数据；任务模型只允许 `submit_result`，主模型只允许只读工具。它不测试 World/PostgreSQL、设备或可靠 SSE。

先明确授权付费调用，并显式指定当前可用的角色模型与已有凭据文件：

```sh
SECRETARY_MODE=live \
SECRETARY_MAIN_PROVIDER=opencode-go SECRETARY_MAIN_MODEL='<当前主模型>' \
SECRETARY_TASK_PROVIDER=opencode-go SECRETARY_TASK_MODEL='<当前任务模型>' \
SECRETARY_CREDENTIALS_FILE='<已有私密凭据文件>' \
node --import tsx test_case/online/test-api-v1-live.ts --live --evidence '<仓库外全新私密目录>'
```

总上限为 12 次实际 provider HTTP 请求、15 分钟、每请求 90 秒、每次输出 4096 token、上下文 80000 bytes。SDK 重试也计入实际 HTTP 请求；首次 provider 失败阻断后续调用。协调后的再次运行需设置 `SECRETARY_ONLINE_ATTEMPT_BUDGET` 和 `SECRETARY_ONLINE_TOTAL_MS` 为剩余请求及时间预算，累计不得超过 12 次和 15 分钟。失败目录拒绝覆盖；原始请求、响应及运行标识仅保存在私密证据目录，公开报告只发布脱敏聚合结果。费用为 SDK 目录估算，账单费用不可用。`--self-check` 仅验证 oracle 正负对照，0 次线上调用。

测试进程在打开隔离 App 前把主/任务输出上限及整理/整理重试预算统一设为 4096，保持生产请求预算与最终 payload 的精确断言一致；不会编辑部署配置。Loopback API 请求使用 `Connection: close`，不增加自动重试。`--memory-settings-only` 只跑主会话、设置和记忆，不能报告任务链通过。

`--retry-compaction-from '<此前私密证据目录>'` 仅供明确授权后的失败整理重试：检查前次是本脚本合成 memory/settings 运行且有 `SUMMARY_PRIOR_BOUND_EXCEEDED`，把合成 Store 复制到新的证据目录，保留原失败目录，继续用 API 整理并重开回忆。只有该显式重试允许生产流程的 `previous_error` 重试；所有 HTTP 请求仍计入剩余预算。原始 summary/prompt/校验规则不变，预算耗尽仍报告未通过。

2026-10-10 有界运行结果为 **未通过完整线上验收**：总计 12 次真实调用、26647 token、90.863 秒执行时间，SDK 目录费用估算 $0.007705772，实际账单不可用。主模型 `opencode-go / deepseek-v4.1-flash` 调用 11 次（25814 token），任务模型 `opencode-go / gpt-5.6-luna` 调用 1 次（833 token）。主会话、设置应用及其事实/语言影响、显式重试后的整理有证据；第一个任务通过 API 和持久状态核验，但完整任务链未通过。Store 重开保留会话，重开后的真实回忆在 provider 发送前被测试预算拦截，未验证。首次测试预算对齐错误、loopback fetch 失败及随后真实整理的 `SUMMARY_PRIOR_BOUND_EXCEEDED` 均保留，失败记录不改写为通过；原始与聚合证据均存于仓库外私密目录。
