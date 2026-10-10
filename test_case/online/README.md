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

2026-10-10 **历史首轮**有界运行结果为 **未通过完整线上验收**（后续独立场景结果见下节，旧证据不改写）：总计 12 次真实调用、26647 token、90.863 秒执行时间，SDK 目录费用估算 $0.007705772，实际账单不可用。主模型 `opencode-go / deepseek-v4.1-flash` 调用 11 次（25814 token），任务模型 `opencode-go / gpt-5.6-luna` 调用 1 次（833 token）。主会话、设置应用及其事实/语言影响、显式重试后的整理有证据；第一个任务通过 API 和持久状态核验，但完整任务链未通过。Store 重开保留会话，重开后的真实回忆在 provider 发送前被测试预算拦截，未验证。首次测试预算对齐错误、loopback fetch 失败及随后真实整理的 `SUMMARY_PRIOR_BOUND_EXCEEDED` 均保留，失败记录不改写为通过；原始与聚合证据均存于仓库外私密目录。

## 独立任务链与真实进程重启验收

在上述真实模型环境变量和既有凭据路径已设置后，可独立运行：

```sh
node --import tsx test_case/online/test-api-v1-live.ts --live --scenario task-chain --evidence '<仓库外全新任务证据目录>'
node --import tsx test_case/online/test-api-v1-live.ts --live --scenario memory-restart --evidence '<仓库外全新记忆证据目录>'
```

两个场景各限 12 次实际 provider HTTP 请求、10 分钟，单请求限 90 秒、4096 输出 token、80000 字节上下文。`api-v1-online-worker.ts` 在独立 OS 子进程中启动隔离 API v1 服务，凭据仅在子进程内读入现有 `roleModel`。调用计数与用量写入私密账本，重启后继续累计；生产 summary 校验与正常 `previous_error` 重试保持原样。

历史 `task-chain` 场景通过 API 请求先返回 42，再在同一任务、明确父执行上返回 84；其数值断言只匹配模型 summary，两个 TaskResult.artifacts 均为空，verified_by 均为 NOT_VERIFIED。因此通过范围仅为真实任务模型传输、两个成功执行及其任务/父执行身份，不证明文件写入、shell 执行、产物下载或独立计算。它遗漏了原 `test-live.ts` 的独立程序验算和 `test-task-reuse-live.ts` 的非空产物/不可变性核验，下节新增严格产物用例补齐。主会话通知消费和自动整理仍不属于该任务场景。

记忆场景先完成合成事实主会话、设置应用和独立事实/语言 oracle，再要求真实整理 `COMMITTED`。准备阶段最多使用 10 次请求，硬性保留两次给重启后回忆。关闭必须得到旧子进程退出码 0，并确认旧 PID 已退出；随后以新 PID、新 Core instance 打开同一 Store，检查会话/数据身份，再实际调用主模型验证同一 oracle。没有给 probe 注入正确事实值；独立审计确认原始事实仍在重启后的真实模型请求上下文中，因此是产品持久连续性验证，不是仅靠摘要回忆的证明。

初轮失败分类补充：第二个任务的持久错误是 `LIVE_BUDGET_EXHAUSTED`，源于预算对齐失败后测试共享 gate 关闭；不是任务模型拒绝。`SUMMARY_PRIOR_BOUND_EXCEEDED` 的候选原始 items 为 1971 字节，未超 prompt 宣告的 2048 字节限制；Host 补入 WorkItem 元数据后超过原 prior bound。原生产第二次更紧限制的重试随后成功，未放宽断言。初轮 `fetch failed` 没有捕获 cause，具体原因仍未知。

后续分别授权的两个独立场景按上述原有断言通过：历史 summary-only 任务链 2 次真实请求、2228 token、SDK 估算 $0.00071245；记忆与 OS 进程重启 7 次真实请求、14390 token、SDK 估算 $0.00474465。合计新增 9 次、16618 token、估算 $0.00545710，实际账单不可用。任务模型为 `opencode-go / gpt-5.6-luna`，主模型为 `opencode-go / deepseek-v4.1-flash`。记忆准备阶段使用 6 次请求，重启后的实际回忆使用 1 次；旧进程退出、新 PID/Core instance、同一数据域/会话及精确事实/英语 oracle 全部核验。初轮失败证据完整保留；后续通过不改写初轮结论。

## API v1 真实工具与产物字节验收

`test-api-v1-artifacts-live.ts` 新增严格用例，不改写旧结果。显式授权后，用既有 `SECRETARY_CREDENTIALS_FILE`、`SECRETARY_MODE=live`、`SECRETARY_TASK_PROVIDER=opencode-go` 和当前任务模型运行：

```sh
node --import tsx test_case/online/test-api-v1-artifacts-live.ts --self-check
node --import tsx test_case/online/test-api-v1-artifacts-live.ts --live --evidence '<仓库外全新私密目录>'
```

每轮限 12 次实际 provider HTTP 请求、600 秒，单次限 90 秒、4096 输出 token 和 80000 字节上下文。请求开始时间至少间隔 20 秒；请求等待同样计入时间预算。失败不覆盖、无静默重发，任何未知效果或授权范围外动作停止。

模型仅可写两份完整内容已审核的小程序，分别用精确 `/usr/bin/python3 -I -S -B stage1.py`、`stage2.py` 命令执行，timeout 必须为 10 秒。文件、命令、工作目录、非符号链接和已有文件集均在实际工具执行及 API 授权前核对。第一程序实时计算 `sum([17,25])`，第二程序读取实际 `first.json` 字节并记录输入 SHA256，再将其结果乘 2；程序没有预填 42/84 输出。模型在续接执行中还必须实际读取第一产物。JSON 输出只由程序以排他创建方式生成，不允许模型直接写入。

验收要求同一任务的两个执行及父关系正确，四个写入/执行 Operation 均明确成功；错误 display_hash 必须被 API 拒绝。两阶段各提交程序和 JSON 两件真实产物，通过产品 API 列表、元数据和下载取得四件产物，并记录 HTTP 状态、长度、ETag、SHA256 和执行归属。第二阶段结束后再下载第一产物验证不可变。宿主只用 API 下载的字节独立算术验证，再将已核对的下载程序放入全新 oracle 目录重执行；第二次宿主执行的输入来自 API 下载的第一 JSON，而不是宿主预填结果。另核对真实 shell stdout 与下载输出字节完全一致，以及成功 read 工具结果包含第一 JSON。Store/工作目录比较仅为补充证据。

产品 `verified_by=NOT_VERIFIED` 保持原值，宿主验算证据另行记录；shell 生成产物的 `producing_operation_id` 可以为空，使用执行归属、精确代码/命令、成功 shell 回执及 API 内容哈希共同追溯。主会话通知消费、设备、部署、World 与 SSE 不在该用例范围。

严格用例第一轮在第 7 次请求失败：provider 返回 HTTP 200，但模型 stopReason=error，原因是 token rate limit。前六次为 toolUse，四项操作均 SUCCEEDED/APPLIED、无未知效果；第二输出虽已生成，但缺少最终 submit_result，第二 TaskResult 无产物，严格验收仍失败。六次有用量请求合计 23048 token、SDK 估算 $0.00387508，第七次用量不可用，不能按零计算。该轮源码和证据保持不可变；随后新增的 20 秒节流仅改变测试请求节奏，不改生产代码、批准范围或 oracle。

明确授权后的全新第二轮通过全部严格断言：`opencode-go / gpt-5.6-luna` 共 7 次实际 HTTP 请求，均为 HTTP 200 / stopReason=toolUse，耗时 124.724 秒，34354 token，SDK 目录估算 $0.005207920，实际账单不可用。真实工具计数为 read 1、write 2、bash 2、submit_result 2；一个任务的两个成功执行各发布两件非空产物，四项操作回执、API 下载字节、续接输入哈希与宿主独立重执行均通过。57 项源文件哈希与运行前冻结值一致，生产代码未改动。

两轮分别获得授权，合计 14 次请求；每轮各 7 次，均未超过各自 12 次上限。已知用量合计 57402 token、目录估算 $0.009083000，第一轮失败请求用量仍不可用，因此这不是完整总用量或账单。第一轮失败与 1114 份更早历史证据均保留且哈希未变。第二轮通过不删除、覆盖或改写任何首次失败。
