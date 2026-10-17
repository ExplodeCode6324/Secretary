# Issue #26 提示词整理验收

基线：`6ca900676d537de9374e3b80776e678d360d6d79`（#25 两份 PR 合并后的 main）。实现与规则逐项映射见 [fix 计划](../fix_20261018_issue26_提示词分节重写.md)。

## 改动及长度

主会话分为 Identity、Scope、Delegation、Memory、Feedback、Communication 六节，执行 agent 分为 Task protocol、Workspace and scope notes、Tools and authorization、Completion 四节。工具集合、授权、合同、Settings、Host、MainPromptSnapshot、中文默认说明及 composeInstructions 均保持原样。

| 提示词 | 原字符 / UTF-8 bytes | 新字符 / UTF-8 bytes | 新/原 | 空白分词：原→新 |
| --- | ---: | ---: | ---: | ---: |
| BASE_SYSTEM | 2,588 | 1,740 | 67.23% | 362→232 |
| EXECUTOR_SYSTEM | 2,193 | 1,584 | 72.23% | 322→220 |

字符按模板字符串实际内容计数，不含 TypeScript 声明；两段均为 ASCII。BASE 达到 ≤70% 的整理目标。生产源码 +30/−9，净 +21 行，来自原长行拆成带标题的段落。在线驾驶器 +71/−37，净 +34 行。

| 冻结内容 | SHA-256 |
| --- | --- |
| 新 BASE_SYSTEM 字符串 | `79b5bf6cfdb3a1155de92593f40733764504fdb10223cdf0e3b104aa8da86d04` |
| 新 EXECUTOR_SYSTEM 字符串 | `9c680900847ca7592303c5b6a8e6a5a6d0ba5235ed71b85558c0e44e71d0d01a` |
| instructions.ts 文件 | `94905d9450186485231fab755edfafc41f33efcbe42ce384c4357e308efde335` |
| task-prompt.ts 文件 | `e2b94296b8023ebee50889b7b11107dd8023711ee96bee1fab3630474dd9982e` |

## 真实模型对照

执行模型沿用现有在线入口：`opencode-go / deepseek-v4.1-flash / low`；独立复核使用 Master 指定的 `deepseek / deepseek-flash / max`。前后同一模型配置、驾驶器、调用上限和断言。所有样本使用隔离的合成数据；原始请求、响应、运行目录和日志保留在 Git 忽略目录。

下表的调用数按 main/task 分列，纯主会话场景为总数；时间为驾驶器进程墙钟秒数。未到达的检查单列，未以失败后无限重跑选取成绩。

| 场景 | 旧稿基线 | 首稿 | 语言修订后最终稿 |
| --- | --- | --- | --- |
| 提案 chain | 12/12；13/4 次；138.34s | 12/12；13/4 次；144.71s | 12/12；11/6 次；133.62s |
| RESULT_UNKNOWN | 7/7；2/2 次；22.22s | 7/7；2/2 次；30.72s | 7/7；3/2 次；26.34s |
| 缺少输入 missing | 6/6；5/2 次；75.15s | 6/6；6/3 次；75.52s | 6/6；5/2 次；76.05s |
| 指令及语言 | 5/5；12 次；96.76s | 前2项通过，压缩失败，余3项未到达；7 次；55.25s | 5/5；10 次；84.63s |
| 任务接续 reuse | O01–O03通过，O04失败，O05–O06未到达；17/7 次；321.50s | O01–O04通过，O05传输超时，O06未到达；24/11 次；485.46s | O01–O06通过；18/18 次；274.67s |
| 记忆连续性 | 123/123；22 次；245.64s | 123/123；22 次；206.20s | 前75项通过；第17次请求输出截断；186.74s；配对确认仍失败，见下文 |

基线选择：提案/未知/缺输入采用驾驶器校准后的 `before-files2`，连续性采用 `before-continuity2`，指令与接续采用 `before`。首稿为 `after`；最终稿为 `revised-after`。所有阶段独立保留 manifest，包含提示词文件 hash、驾驶器 hash、模型与实际结束状态。逐检查比较时只将随机记录 UUID 规范化，不合并不同检查。

### 首次失败与修订

- **驾驶器校准**：第一批旧稿提案的独立函数验证通过，但执行 agent 自行调用 shell 自测停在 WAIT_AUTH；未知/缺输入也因 shell 读取等待审批而未到达目标。改为在场景任务中明确限定文件工具，驾驶器独立验证函数，不改变生产工具或授权。旧稿重跑后全部通过；前后使用冻结驾驶器。旧强制审批断言已被 #17 的默认 workspace-write 政策替代；新断言检查实际 Operation 的默认 rule_id 及回执，并在 Execution 尚未结束时交错输入。
- **压缩驾驶器预算**：第一次旧稿连续性在第6次调用前发生 CAPACITY_OUTPUT_LIMIT_CHANGED_BY_ADAPTER。原驾驶器在 Host 冻结预算后截断输出；现将既定 8192 上限提前设在测试模型元数据，使冻结请求与适配器一致。生产预算代码未改。修正后旧稿 123/123 通过。
- **语言退化**：首稿指令测试压缩返回 EMPTY_WORKING_MEMORY，未完成后3项。按计划唯一一次配对确认：旧稿5/5（12次、109.08s），首稿4/5（10次、64.67s）；失败是一次性英文请求结束后仍回答英文。Communication 补明“默认用配置语言；单条回复的语言要求在该回复后到期”，未改变默认说明、composeInstructions 或断言。最终稿5/5通过。
- **接续基线**：旧稿 O04 的执行输出耗尽4096 token，只有 reasoning，没有 submit_result，进入 MISSING_STRUCTURED_RESULT；属于已观测到的模型行为失败。首稿 O04 通过，O05 在重启后的模型请求达到60秒超时而进入 RECOVERY_BLOCKED；该项是传输失败，保留诊断。
- **最终稿连续性**：第17次请求处于 Settings 语言切换阶段，实际 system 为未改动的 COMMITMENT_EXTRACTION；4096 token 均用于推理并以 length 截断，驾驶器禁止自动重试，后续检查未到达。一次配对确认中，旧稿131/131通过（22次、201.76s），最终稿第6次 CONSCIOUSNESS 摘要将合成的义务标签 OBL-71 放入 task_refs，违反现有 UUID schema，压缩失败。前后该摘要 system 内容完全一致，且两类失败请求均未包含 BASE_SYSTEM。该失败保留，正由同一 reviewer 核查契约缺口及处置；当前尚未达到合并条件。确认旧稿使用独立工作目录，生产源码和驾驶器 hash 均已核对。

### 驾驶器一致性

| 文件 | 前后相同的 SHA-256 |
| --- | --- |
| test-live.ts | `988eae8c3eb6858e446ec073ec402183ab65ea5f35f09ea3c245baf8063c0daf` |
| test-task-reuse-live.ts | `12307aed5b5d54b39fda17ba849fb9222f35705007b088082dd342131198abc3` |
| test-instructions-live.ts | `017479cf266c1c6ecd533d0c9720084782fa071786ff77c1cfebee8b45ba6e38` |
| test-continuity-astra-live.ts | `6b3cc4ef14d2556fd0794401a3fbe990f50187423750271354cf7a46cdb66c5b` |

连续性场景覆盖合成的五个逻辑日、压缩、App 关闭重开、Settings 语言切换、修正事实、撤回与未完承诺。它采用同进程 App 重开，并保留产品正常的历史输入锚点；World/PostgreSQL 事实设置不在该在线场景中。

## 快照与升级

Master 于 2026-10-18 确认沿用既有升级前置：先在旧运行时完成中断轮，再升级提示词。跨版本的任意中断恢复另作设计。

- 直接跨版本 CLAIMED 恢复探针：旧 system message/hash 保持，但 Settings 的综合 runtimeHash 变化阻止主循环恢复；Settings 又等待旧轮结束，原探针失败。已有记录不包含可拆分的旧配置指纹，不能据此证明变化仅限提示词。
- 顺序升级探针：旧运行时恢复并完成 CLAIMED 轮，旧 system message/hash 不变；启动新运行时并激活 Settings 后，新输入采用最终 BASE_SYSTEM。结果通过。旧 BASE hash 为 `09a7e716dbd0e73a37dbd4e17ce18ff7cc2acb1b0ab17baaf8562fe5904e97f8`，新 BASE hash 为上表值。
- 原有离线当前轮冻结、中断重启快照及新轮更新测试保留，未修改快照或恢复实现。

## 离线与复核

- 定向 instructions、task-reuse、issue16/prompt、issue23/host：44通过，0失败；无 DSN 时1项 PostgreSQL 场景跳过，最终完整检查使用独立 PostgreSQL。
- 连续性 oracle 自检通过。
- 最终 `npm run verify`（实际 PostgreSQL）：657/657 通过，0失败、0跳过，789.42s；类型检查与文档检查通过。独立 PostgreSQL 已正常停止。
- Hermes 计划 R1/R2 意见已落实，R3 PASS；文件场景校准 PASS；语言有效期修订 PASS，认为现有五项覆盖足够。
- 最终提交 SHA、CI 与合并条件复核将在代码冻结后记录到 PR。
