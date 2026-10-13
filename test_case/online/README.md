# 真实模型验证

online 脚本从仓库根目录显式执行，使用指定角色模型、已有凭据和新建私密证据目录。每轮按脚本预算记录实际 HTTP 请求、用量、时间、首次失败与独立验算结果。普通 `npm test` 运行离线回归。

## API v1 场景

配置已有角色凭据文件，其中 main/task 为独立密钥：

```sh
export SECRETARY_MODE=live
export SECRETARY_MAIN_PROVIDER=opencode-go
export SECRETARY_MAIN_MODEL='<主模型>'
export SECRETARY_TASK_PROVIDER=opencode-go
export SECRETARY_TASK_MODEL='<任务模型>'
export SECRETARY_CREDENTIALS_FILE='<已有私密凭据文件>'
node --import tsx test_case/online/test-api-v1-live.ts --self-check
node --import tsx test_case/online/test-api-v1-live.ts --live --scenario memory-restart --evidence '<全新私密目录>'
```

| 场景 | 验证内容 | 默认预算 |
| --- | --- | --- |
| test-api-v1-live.ts，默认 | 主会话、任务、设置、整理与重开 | 12 次 HTTP、15 分钟 |
| `--scenario task-chain` | 同任务两轮及父执行身份，数值结果取模型 summary | 12 次、10 分钟 |
| `--scenario memory-restart` | 真实整理、旧 OS 进程退出、新 PID/Core instance、同数据域回忆 | 12 次、10 分钟，准备阶段最多 10 次 |
| test-api-v1-artifacts-live.ts | 真实工具、四件产物下载与独立算术/程序验算 | 12 次、10 分钟，请求起始间隔至少 20 秒 |

上述场景单请求默认 90 秒、4096 输出 token、80000 字节上下文。预算累计实际 provider HTTP 发送；失败目录保留。self-check 验证 oracle 正负对照，使用零次模型调用。

memory-restart 的模型请求包含现有原始输入锚点，验证摘要、历史和持久状态共同提供的连续性。task-chain 关注执行关系；产物字节和工具效果由下一节场景验证。

## 工具与产物

```sh
node --import tsx test_case/online/test-api-v1-artifacts-live.ts --self-check
node --import tsx test_case/online/test-api-v1-artifacts-live.ts --live --evidence '<全新私密目录>'
```

模型先写程序计算 `sum([17,25])`，再接续同一任务，读取第一份结果并运行第二程序翻倍。测试范围包含两份指定程序写入和精确 Python 命令，执行前校验代码、目录、timeout 和审批 display_hash。

两轮各发布程序与 JSON 两件产物。验收通过 API 下载四件文件，核对长度、ETag、SHA-256、归属及第一轮内容在接续后保持一致；独立 oracle 读取下载字节计算，并在新目录重执行下载程序。另核对真实 read 和 shell 输出。TaskResult.verified_by 保持产品实际值 NOT_VERIFIED，宿主验算单独记录。

## 其他场景

`test-issue21-28-live.ts` 联合验证旧输入退出与历史找回。使用自建隔离 PG 测试 DSN、已有 `SECRETARY_CREDENTIALS_FILE` 和全新私有 `SECRETARY_LIVE_EVIDENCE` 目录；真实数据实例不能作为测试 DSN。它调用 opencode-go/deepseek-v4.1-flash 完成 24 轮合成对话及一次材料压力轮，经普通整理、Settings 和重开后主动检索背景事实并引用原事件。核对实际请求和传输均已不含事实，工作记忆/账本不缓存答案，最新修正与另一条未变约束仍有效，原文仍可读。

默认最多 100 次物理发送、40 分钟，单次 90 秒；`SECRETARY_LIVE_MAX_CALLS` / `SECRETARY_LIVE_WALL_MS` 可收紧预算。`SECRETARY_LIVE_RESUME_STORE` 只用于本脚本已完成 24 轮的隔离合成 Store，重新核验原回复后继续余下验收；不改写来源或预置检索答案。每次运行独立记录计数与源码散列，汇报续验时累计各次调用并保留首失败。本次 2026-10-13 联合结果见[执行记录](../../docs/fix/fix_20261012_issue21_28_记忆检索与旧输入有界退出.md#13-实施记录)。

| 入口 | 用途 |
| --- | --- |
| npm run test:live | 链路、缺失信息、未知结果、传输与拒绝场景 |
| npm run test:task-reuse:live | O01–O06 多轮修改、解释、重开接续与指定报告产物 |
| npm run test:instructions:live | 有效说明的模型行为 |
| npm run test:continuity:live | 五个合成逻辑日、事实/语言连续性与设置切换 |
| test-settings-live.ts / verify-memory-live.ts | 指定隔离 Store 的 World、设置与记忆探针 |

continuity 场景最多 24 次请求、15 分钟，单请求 90 秒、8192 输出 token、80000 字节上下文；只调用主模型。其重开在同一 OS 进程内进行。task-reuse 场景默认每角色最多 48 次模型调用、100 次工具调用、12 分钟，写入范围为指定报告文件。

早期 activity/streaming 浏览器驾驶脚本使用原 UI 路由，按对应历史版本复现。当前 API 专用入口为 test-api-v1-live、api-v1-online-worker 和 test-api-v1-artifacts-live。

## 报告与重试

报告保存源码散列、配置范围、请求计数、首轮失败和后续独立运行。SDK 目录费用作为估算记录，缺失 usage 单独标注。原始请求、响应和凭据保持在私密目录，公开汇总见[API 验证记录](../../docs/api/v1/verification.md)。该记录保存 2026-10-10 的实际结果。

默认 API 脚本支持 `--memory-settings-only`；`--retry-compaction-from` 从本脚本指定失败目录复制合成 Store 到新目录后重试整理。再运行时通过 SECRETARY_ONLINE_ATTEMPT_BUDGET、SECRETARY_ONLINE_TOTAL_MS 设置剩余预算，保留原失败记录。具体可接受的错误和参数由脚本校验。
