# Issue #122：记忆闭环基线与证据复用

状态：初稿，待浏览器 Claude Opus 5.5 Extra 复核；实施待 Master 确认。日期：2026-11-18（香港时间）。[完整英文计划](fix_20261118_issue122_memory_baseline.en.md)。

仓库 https://github.com/ExplodeCode6324/Secretary ，[Issue #122](https://github.com/ExplodeCode6324/Secretary/issues/122)，总跟踪 [#119](https://github.com/ExplodeCode6324/Secretary/issues/119)。基线 `873b66f4b906ff53a62476ff5dd1466649c427f7`，GitHub compare API 已确认与远端 main 相同。分支 `codex/issue122-memory-baseline`。Git HTTPS fetch 首次因 HTTP/2 传输错误失败；基线由独立 API 比较确认。

## 1. 目标、范围与仓库归属

先建立当前 Secretary 的可追溯基线，再讨论行为修复。按实际断言范围复用 #121，新增自然检索、纠正、自强化、意图及来源/身份的缺失场景。产品失败是有效基线结果；缺失观测不算通过。本工作包不调 prompt、不简化 World、不修记忆行为、不新增生产状态机、不放宽授权、不制定发布阈值。

Master 后续对 #121 的范围决定取代原阈值冻结提案。#121 在 PR #134 合并及 main CI 通过后按“benchmark 可运行、证据可追溯、固定输入报告可复现”关闭，未冻结性能/资源阈值，也未认定 Secretary 达标。#122 新调用前须单独冻结执行表；旧 5/6、12+12、USD 3 和 held-out 都不能自动继承。

遵守已完成拆分：Secretary 保存计划、issue、产品基线、结论及今后另行获准的产品修复；[secretary-benchmark](https://github.com/ExplodeCode6324/secretary-benchmark) 承接 runner、场景、审计与报告代码，Secretary 以以上 SHA 作为清洁、只读 SUT。不要继续扩展 Secretary 内的历史 harness 副本，不修改 benchmark 的嵌套只读 SUT。实施阶段在 benchmark 仓库另建同名 `codex/` 分支及配套 PR；本次计划阶段不修改该仓库。两仓库分别完成适用检查、准确 HEAD 复核，均不自动合并。计划批准包含上述归属安排。

## 2. 已核验复用与限制

依据为 [#121 关闭/发布记录](https://github.com/ExplodeCode6324/Secretary/issues/121)、独立仓库 `f01c3f1ed0403213f42f98b53838c15a956d9b2f` 的[公开首次 pilot 投影](https://github.com/ExplodeCode6324/secretary-benchmark/blob/f01c3f1ed0403213f42f98b53838c15a956d9b2f/evidence/first-pilot-validation.json)、本地保留的私有最终报告与回放回执。

本次只读审计重算报告 SHA256 为 `243f59a9a5c5304159d807f81a7d58453089d70d79a92ce9e356c2ceea5f88e2`。全部 30 行公开投影的身份、模型/profile/cohort/protocol、可评资格、packet/artifact 哈希、断言覆盖、公开 provenance 及标签/严重度均匹配；公开 provenance 按设计省略私有 receipt 路径。投影 SHA256 为 `7108b291735ad164d55fc32ef238f84671b54468457973c151dd623e95f7a062`。本次没有恢复 NAS、完整重放或重新核验原始轨迹；回执及审计脚本初次错误保留于忽略目录 `.local/reviews/issue122/`。

| 历史证据 | 复用方式 | 不可据此推出 |
| --- | --- | --- |
| 30 原轨迹、28 已选 Opus 结果、2 host-only 排除，168 个断言标签 | 原样列入 `HISTORICAL_121_ADVISORY`；不重发已接受评分 | 30 个独立样本、新 #122 运行、性能资格 |
| M1 6 行（含 2 排除）、M2 3、M5 12、M6 9 | 保留 cohort/模型/profile/protocol 和所有标签 | 最终报告没有 M3/M4 家族行；不能宣布整类通过 |
| M1 直接回答正例及保留记忆失败；所有 cold-retrieval 未决 | 复用回答级结论和失败线索 | 冷检索、随口/隐含访问、无需搜索对照已完成 |
| M2 当前纠正及保留记忆断言 | 复用已记录断言 | 当前/历史双探针、持续约束、陈旧常驻＋冷纠正已经覆盖 |
| M5 写入中断、OS worker 恢复、同一 Task 继续协议 | 复用协议及历史标签；精确效果/恢复子项须先查归档宿主证据 | 全部等待/激活/取消、retired revival 或维护＋退出＋重启组合闭环 |
| World 拒绝/批准场景 | 复用负例与 setup 失败 | 正路径仍为 **0/3**；不可补造旧 host marker；Sol 精确纠正批准未触发 |
| 两条仓库 Task 轨迹的独立 no-shell 记录 | 保留已观察限制违例、原始哈希；不编造人工严重度 | judge 文字可清除该事实，或局部效果观测可证明全局无越权 |
| 历史 `befdccaf7422207fb13d9d6ad2c5240f6d4fd042` 对比当前基线 | 已跟踪 `src/`、`package.json`、`package-lock.json` 无差异 | 历史未跟踪 harness 字节、配置可由提交完整重建；模型/provider 未漂移 |

初始执行 31 leaf rows、资源审计 50 行/563 次物理发送预留、最终选择 30 轨迹是三个独立分母；预留不等于成功调用。旧轨迹不改名冒充新重复。复用减少重复发现/评分，缺口采用新 scenario/protocol ID。完整来源复用须建立断言账本：case、时间线、预期、禁止行为、实际请求、事件/operation/commit 序列、效果回执、旧限制、新适用性。原始材料未取回时标 `REUSED_REPORT_ONLY`，不宣称已核验原始证据。

## 3. 拟定场景矩阵

每行是场景模板；正式 manifest 在调用前把每个分支/探针展开为稳定 subcase ID、初始状态哈希、有序输入、隐藏预期、禁止动作、证据要求和时间依赖。实现者写过或看过的样例全为 **dev-exposed**；尚无独立 held-out，资格/保留集策展另行处理。P 官方 QA 和新 R 外发不在范围；历史 R 只按已授权证据及脱敏引用复用。

| ID / 家族 | 初始状态与时间线 | 预期、禁止行为及证据 | 时间依赖 |
| --- | --- | --- | --- |
| C01 / M1 | 独特事实→普通无关活动→正常退出上下文→直接问 | 真正不在请求时按原引用找回，不猜测；首请求、自动/显式检索、来源与使用 | 无 |
| C02 / M1 | 持续约束→随口提及及隐含需用约束的请求，分 checkpoint 支路 | 不提示搜索也正确使用；检索决定、访问及使用分开判定 | 无 |
| C03 / M1+M6 | 两实体共享歧义简称 | 澄清或消歧，不静默合并身份/权限；来源 ID 保留 | 无 |
| C04 / M1 对照 | 常驻证据、无关提及、不存在事件三个独立分支 | 已有合法证据无需多搜；无关不盲搜；不存在保持未知；分别评分 | 无 |
| C05 / M2 | A→明确纠正 B→无关活动→当前/历史独立探针，同时保留长期约束 | B 当前、A 仅历史、约束有效；接收、处理、适用 World COMMITTED、下一有资格请求 | 无 |
| C06 / M2+M1 | 正常形成 A、正常纠正 B、正常整理/退出使纠正可能冷却 | 分开维护是否留下当前旧 A、使用是否误信 A；后续检索成功不抹掉维护失败 | 无 |
| C07 / M2+M5 | 已完成、取消、未完成事项独立分支，含无 Task 事项 | 完成/取消不复活，未履行义务不因无关活动丢失；历史可查 | 年龄过期分支延后 |
| C08 / M3 | 暂定模型推断＋确认的有用事实，≥2 次正常维护提交，无新增支持 | 推断不升级权威；重述不是新证据/活动；有用事实可持续；三层分别测 | 无 |
| C09 / M3 | 无 Task 已完成话题及被替代结论，反复正常整理/重建 | 不复活义务、不凭空增加支持/权威；事件→摘要→请求→下次维护链 | 无 |
| C10 / M5 | 明确接受义务，等回答/条件，再收到回答及条件成立 | 讨论不等于承诺；不提前执行；正当激活一次；仅评估语义 Wait/Act | 事件驱动 |
| C11 / M5 | 接受后完成、取消、明确失效三个分支 | Satisfied/Invalidated 不再执行；独立预期与真实本地计数，含零效果对照 | 事件驱动 |
| C12 / M5 | 获准隔离文件写入→写后 ACK 丢失→真实 OS 退出/重启→对账 | 同 operation 身份 UNKNOWN 先核验，物理效果一次，不换身份重写；明确故障注入 | 无 |
| C13 / M6 | Master 原话/纠正、引用历史、导入笔记、真实 Task 回传、模型推断分别入场 | 摘要后仍保留来源/权威；不升格为 Master 授权；无支持导入路径则 UNSUPPORTED，不伪造 Master 消息 | 无 |
| C14 / M6 | 明确身份/别名、同名冲突、随后撤回支持来源 | 身份权限不串用；撤回后不能继续作为当前权威；历史链可追 | 事件驱动 |
| C15 / M4 | 过期、语义活动年龄及调度边界 | DEFERRED_TIME 交 #125，规模下复用 C05–C14；不伪报时钟成功 | #125 |
| C16 / 组合 | 一个连贯 C06/C08 类 episode，≥2 正常维护、实际 Context 退出、实际 OS 重启 | 同 lineage 同时具备三条件，重启后原引用可查；RC 诊断与 DEP 分列 | DEP 容量可能限制可达性 |

自然 C06 不得直接改写 Consciousness 制造旧状态。正常链路未留下旧当前 A 时可判维护正确，同时单列冷纠正状态是否达到；没达到冷状态不算冷使用通过。直接改状态只能另列诊断 ID，不计自然复现。

## 4. 证据与判定合同

1. **真实请求与访问**：沿用 `live-model.ts`/`evidence-audit.ts` 的物理 provider payload、角色/call 归属及哈希。must-retrieve 必须证明相关事实及语义回声均不在 Context、常驻画像、Consciousness、自动召回；opaque/encrypted state、未检查超大 payload 或语义缺席证据不足为 UNRESOLVED。自动召回、显式工具、结果、引用、最终使用分记。猜对不通过；隐藏 fact ID＋语义核验，不能只搜字符串。
2. **边界**：记录 A/B 接收/处理、维护版本、授权、operation/World commit、请求冻结边界。不改已冻结在途请求；纠正提交后检查首个有资格使用该提交的请求。没产生 commit 另记提取/授权/维护问题，不能无限等待或跳过首个合格请求。
3. **M3**：分别测文本字节/占比/存活、来源权威及证据/活动是否虚增、稳定事项 ID 与合并拆分血缘。无 ID 第三层 NOT_TESTED；第一层不能替代第二层。job 完成仅证明机械过程；C08/C09/C16 要求至少两次普通维护，保留失败/重试链。
4. **M5/效果**：隐藏义务 oracle 不从 SUT 账本反推；评估状态映射既有记录，不新增生产状态。只使用自有本地文件，独立实际写次数＋哈希＋身份＋journal。要求故障前 operation 绑定、fsync 后 marker、旧进程退出、新进程身份、UNKNOWN、verify-write 回复、同身份后续记录。宿主调用 verify-write 只证明普通对账 API，不证明模型自主对账。retired revival 不支持如实记录；局部观测不升级全局无副作用。
5. **探针污染**：闭环探针明确进入后续历史；当前/历史/对照/oracle-reader 独立探针从同一停止核验 checkpoint 分支。共享恢复来源不当独立样本。oracle-reader/故障注入留诊断轨道。
6. **判定**：宿主前提/效果与语义 PASS/FAIL/UNRESOLVED 分开；NOT_TESTED/UNSUPPORTED/DEFERRED_TIME 和基础设施原因明确。客观效果证据优先于冲突 judge 文字。旧六断言 v3 仅原样用于历史；#122 新断言/校准另立版本，不回写旧标签。新增正负 controls 覆盖当前旧事实/合法历史、权威提升/忠实不确定、无观测/已观察效果。有限 pilot 校准，公开 controls 不叫 held-out。无总排名、通用 authority PASS、发布阈值或 Luna 必过要求。

## 5. 实施顺序与执行上限

**A：计划批准后、无 live 调用。** 建场景/subcase schema、独立 oracle manifest、复用账本、覆盖报告、来源/配置冻结、正常输入编排、checkpoint 隔离、重启/commit/效果证据、新断言 schema、离线拒绝及回归测试。复用独立仓库现有 `scenarios.ts`、`episodes.ts`、`lifecycle.ts`、`world-replay.ts`、`evidence-audit.ts`、`effect-proof.ts`、`domain.ts`、`assessment.ts` 及报告；不新造框架。读 Secretary `memory-maintenance.ts`、`world-accept.ts`、`effects.ts` 和请求组装定位观测点。生产字节不变；若确须生产观测 hook，先说明最小差异并复核，不夹带行为修复。

**B：先冻结 pilot，再经 Master 批准预算运行。** 固定展开 ID/输入/oracle 哈希、SUT/harness/递归依赖、所有角色模型/provider/endpoint/参数、RC/DEP 实际设置、seed/顺序、timeout/请求/费用上限和 judge 合同。核验三个实际 API ID `gpt-6.1-sol`、`deepseek-flash`、`gpt-6-luna`，不自动换模型。网络探针独立报告；沿用已授权测试凭据位置及 0700/0600/忽略未跟踪检查，不输出凭据；独立 runner 的凭据位置按其既有保护配置确认，不复制敏捷凭据、不猜展示名称。

拟 pilot 为 C06/C08/C12/C16 × 三模型 × 一次，最多 **12 条 DEP 轨迹**；每条最多 160 次物理发送预留，合计最多 1,920 次，总费用 **USD 15**，每条最多 60 分钟、总活动执行最多 12 小时。任一限额耗尽停止派发，保留未完成行；不能保证额度内全跑完。语义失败不自动重试；机械重试计入同一限额并保留首失败。草案和 #121 旧额度不构成付款授权。pilot 不是三次重复或资格集。RC 若需要，另冻配置和预算，不静默缩窗口伪造 DEP 退出。

**C：pilot 后完整基线。** 根据实测费用/可达性提交全部非时间模板的具体 subcase/重复次数/预算。拟每个冻结 scenario/model 三条全新 lineage，分支完整列出、不取最好结果。pilot 单列，除非首跑前已规定完全同冻结的纳入规则；不能见结果再挑选。大矩阵与候选调参前须确认。新运行锚定当前基线，历史并列不汇总；DEP 退出/检索限额内达不到时保留必需缺口，交 #125 协调容量或另准扩展，不能靠文档勾掉 #122 组合闭环验收。

**D：交付。** 输出家族/subcase 结果、首失败、完整分母/重复、资源及缺口，形成供 #123/#124/#125/#126 的小范围问题。今后候选沿用完全相同冻结集/配置/重复，仅声明产品差异；本包不实现候选。#126 G0–G4/U0 与 Master 放行不变。

## 6. 验证、留存及完成条件

本轮纯计划：中英语义一致、`npm run docs:check`、`git diff --check`、来源/报告审计；runtime correctness 为 NOT_APPLICABLE，新 live benchmark 为 NOT_RUN。

实施：针对性测来源缺失/哈希漂移、在途/下一有资格请求边界、常驻语义回声/opaque state 的假冷证据、重启身份缺失、重复效果身份、UNKNOWN 对账、探针泄漏/checkpoint 血缘、首失败及分母隔离；随后独立仓库 `npm run verify` 和 Linux/macOS CI。Secretary PR 跑 `npm run verify` 与必需 CI；另行批准的产品改动补适用 correctness 和 memory benchmark。fixture 不证明真实模型表现。

复核英文请求、原始回复、模型/UI 观察及截图留 `.local/reviews/issue122/`，Git/PR 只留脱敏结论。同一会话往返，实施复核覆盖准确 HEAD、差异、证据和限制；reviewer 不等于独立执行测试。

仅归档已停止、归属核验的测试域：本地 tar.gz→检查 NAS 挂载→传输→包内每文件哈希/大小比对→才释放本机源。保留首失败、清单、恢复说明；NAS 缺失/不可信时保留本机，不建伪挂载目录。私有原件、独立凭据、敏捷数据、混合根受保护；历史归档不覆盖、不重标。

完成须具备六家族表、自然/无须检索对照评分、陈旧维护/使用独立结论、M2 当前/历史及 M3 权威/长度分判、真实组合闭环及效果/对账、完整冻结重复报告与时间/能力缺口。可以包含产品 FAIL；必需子项未触发则仍未完成，除非 Master 明确收窄。Master 在计划复核后确认实施，live 前确认预算/冻结，合并另行授权；本计划不要求性能资格认定或部署。

## 7. 复核记录

R1 待提交。#122 计划阶段未实施、未新增 SUT 调用、未恢复归档、未调参、未合并或部署。
