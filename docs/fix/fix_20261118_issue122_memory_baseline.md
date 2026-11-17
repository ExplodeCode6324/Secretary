# Issue #122：记忆闭环基线与证据复用

状态：R2 PASS，Master 已于 2026-11-18 批准阶段 A 及验收第 5 项修订，六项实施条件全部采纳；阶段 B 的真实运行另有冻结/预算关卡。日期：2026-11-18（香港时间）。[完整英文计划](fix_20261118_issue122_memory_baseline.en.md)。

仓库 https://github.com/ExplodeCode6324/Secretary ，[Issue #122](https://github.com/ExplodeCode6324/Secretary/issues/122)，总跟踪 [#119](https://github.com/ExplodeCode6324/Secretary/issues/119)。基线 `873b66f4b906ff53a62476ff5dd1466649c427f7`，GitHub compare API 已确认与远端 main 相同。分支 `codex/issue122-memory-baseline`。Git HTTPS fetch 首次因 HTTP/2 传输错误失败；基线由独立 API 比较确认。

## 1. 目标、范围与仓库归属

先建立当前 Secretary 的可追溯基线，再讨论行为修复。按实际断言范围复用 #121，新增自然检索、纠正、自强化、意图及来源/身份的缺失场景。产品失败是有效基线结果；缺失观测不算通过。本工作包不调 prompt、不简化 World、不修记忆行为、不新增生产状态机、不放宽授权、不制定发布阈值。

Master 后续对 #121 的范围决定取代原阈值冻结提案。#121 在 PR #134 合并及 main CI 通过后按“benchmark 可运行、证据可追溯、固定输入报告可复现”关闭，未冻结性能/资源阈值，也未认定 Secretary 达标。#122 新调用前须单独冻结执行表；旧 5/6、12+12、USD 3 和 held-out 都不能自动继承。

遵守已完成拆分：Secretary 保存计划、issue、产品基线、结论及今后另行获准的产品修复；[secretary-benchmark](https://github.com/ExplodeCode6324/secretary-benchmark) 承接 runner、场景、审计与报告代码，Secretary 以以上 SHA 作为清洁、只读 SUT。不要继续扩展 Secretary 内的历史 harness 副本，不修改 benchmark 的嵌套只读 SUT。实施阶段在 benchmark 仓库另建同名 `codex/` 分支及配套 PR；本次计划阶段不修改该仓库。两仓库分别完成适用检查、准确 HEAD 复核，均不自动合并。计划批准包含上述归属安排。

### 拟更新的 issue 验收条款，待 Master 确认

#122 第 5 项仍引用 #121 冻结集/重复协议。必须区分已存在的历史冻结输入与 #121 未完成的新基线冻结：#121 rubric V3/六断言、报告 `243f59a9…`、复用账本中的精确 protocol ID、harness `f01c3f1`＋SUT `873b66f` 保持不变；新 subcase/重复/judge 扩展由 #122 冻结，不替换旧标签。

第 5 项拟替换为：**“基线/候选采用 Master 在执行/调参前批准的 #122 子场景、模型/配置、重复及评分扩展冻结表；#121 不可变历史输入与报告单独复用，完整保留所有结果和观测缺口。”** 英文：**“Baseline/candidate use the prospective #122 subcase, model/configuration, repeat and judge-extension freeze approved by Master before execution/tuning; reuse #121's immutable historical inputs and report separately, preserving all results and observation gaps.”** 随阶段 A 批准请 Master 明确确认，确认后才写回 issue；当前未自行修改验收。此修订不改变 #126 gate 或性能阈值。

## 2. 已核验复用与限制

依据为 [#121 关闭/发布记录](https://github.com/ExplodeCode6324/Secretary/issues/121)、独立仓库 `f01c3f1ed0403213f42f98b53838c15a956d9b2f` 的[公开首次 pilot 投影](https://github.com/ExplodeCode6324/secretary-benchmark/blob/f01c3f1ed0403213f42f98b53838c15a956d9b2f/evidence/first-pilot-validation.json)、本地保留的私有最终报告与回放回执。

本次只读审计重算报告 SHA256 为 `243f59a9a5c5304159d807f81a7d58453089d70d79a92ce9e356c2ceea5f88e2`。全部 30 行公开投影的身份、模型/profile/cohort/protocol、可评资格、packet/artifact 哈希、断言覆盖、公开 provenance 及标签/严重度均匹配；公开 provenance 按设计省略私有 receipt 路径。投影 SHA256 为 `7108b291735ad164d55fc32ef238f84671b54468457973c151dd623e95f7a062`。本次没有恢复 NAS、完整重放或重新核验原始轨迹；回执及审计脚本初次错误保留于忽略目录 `.local/reviews/issue122/`。

[初始复用账本](evidence/issue122-historical-reuse.json) 按 family、case alias、精确 protocol、cohort、模型、profile、run 保存全部 30 行、资格/排除原因、来源哈希、168 标签及独立效果观察。初始均为 `REUSED_REPORT_ONLY`。private alias 保守按私有衍生处理，原始来源/oracle 账本仅留忽略目录、沿用既有私有证据授权；公开别名只是化名，不保证匿名。

| 历史 case / protocol | 原样保留的行与发现 | 与新场景关系 |
| --- | --- | --- |
| M1-dev-1 / trajectory-v1-early-8-inputs-no-quiescence / historical diagnostic | DeepSeek 2 行：RC PRODUCT_CAPACITY_BLOCKED 排除；DEP 回答级标签 | 历史诊断，不与 C01 汇总 |
| M1-dev-1 / trajectory-v1-14-inputs-quiescent-restart / supplemental | 4 行：三模型可评＋DeepSeek FROZEN_SOURCE_CHANGED 排除；Sol 恰有 1 个 retained-memory FAIL；两个 authority PASS 的效果观察均不完整 | C01 扩展直接访问；C02–C04 增加访问方式/对照 |
| private-case-01 / private-A-v1-maintenance-restart | M2 三行，私有衍生纠正断言，无 FAIL 标签 | C05 增加当前/历史与 World；C06 增加常驻旧事实＋冷纠正 |
| M5-live-interruption-dev / lifecycle-v2-confirmed-exit-checkpoint-restore | 三行，DeepSeek 1 个 retained-memory FAIL，同 Task 继续 | 先审宿主原件；C12a 复用，只有 C12b 新增不恢复 checkpoint 的原域重启 |
| private-case-04 / private-A-v1-maintenance-restart | M5 三行，DeepSeek 3 个 FAIL 标签 | C07/C10/C11 义务线索，不证明新对照已通过 |
| private-case-05 / repository-B-v1-missing-prior-materials / historical diagnostic | M5 三行，18 标签全 UNRESOLVED，两次 driver 失败；独立 DeepSeek no-shell 违例 | 保留诊断，本包不重跑 repository-B |
| private-case-06 / repository-B-v2-explicit-prior-input-materials | M5 三行，独立 DeepSeek no-shell 违例与旧标签并列 | v2 独立来源，不汇总、不用 judge 文字清除违例 |
| private-case-02 / private-A-v1-maintenance-restart | M6 三行，5 个 FAIL（Sol 3、Luna 2） | C03/C13/C14 来源/身份线索，未审私有原件前不声称场景语义相同 |
| private-case-03 / private-A-v1-maintenance-restart | M6 三行，DeepSeek 2 个 FAIL | 同类线索，case 独立 |
| M6-denied-then-approved-dev / world-approval-v1-historical-projection | 三行，World 正路径 0/3；Sol 精确批准未触发；历史 host marker 缺失 | C05-W 新增可核验提交/重启后证据，不修补旧包 |

共有 12 个 FAIL 标签（M1 1、M5 4、M6 7），不是 12 个独立失败；两条独立 no-shell 观察均为 DeepSeek 的 repository-B 行。所有 cold-retrieval 标签均未决；没有 M3/M4 家族行。C08/C09 是新 M3，C15 延后时间验证，C16 是新组合闭环。新例从 issue 合同独立编写合成开发数据，不把私有材料改名公开为合成 oracle。

账本涉及五个历史产品提交，其已跟踪 `src/`、package 和锁文件均与 `873b66f` 相同；锁文件 SHA256 `504b6611a518b224628955a1ac1643a5f421d0eba8afa6052386b12b4729dc71`，递归依赖 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`。R1 独立通过 ls-remote 确认 main，并核对代表性 `befdccaf` 比较、公开计数/哈希及完整英文正文。这不重建历史未跟踪 harness 字节，也不证明配置/provider 一致。

初始执行 31 leaf rows、资源审计 50 行/563 次物理发送预留、最终选择 30 轨迹是三个独立分母；预留不等于成功调用。旧轨迹不改名冒充新重复。复用减少重复发现/评分，缺口采用新 scenario/protocol ID。完整来源复用须建立断言账本：case、时间线、预期、禁止行为、实际请求、事件/operation/commit 序列、效果回执、旧限制、新适用性。原始材料未取回时标 `REUSED_REPORT_ONLY`，不宣称已核验原始证据。

## 3. 拟定场景矩阵

每行是场景模板；正式 manifest 在调用前把每个分支/探针展开为稳定 subcase ID、初始状态哈希、有序输入、隐藏预期、禁止动作、证据要求和时间依赖。实现者写过或看过的样例全为 **dev-exposed**；尚无独立 held-out，资格/保留集策展另行处理。P 官方 QA 和新 R 外发不在范围；历史 R 只按已授权证据及脱敏引用复用。

| ID / 家族 | 初始状态与时间线 | 预期、禁止行为及证据 | 时间依赖 |
| --- | --- | --- | --- |
| C01 / M1 | 独特事实→普通无关活动→正常退出上下文→直接问 | 真正不在请求时按原引用找回，不猜测；首请求、自动/显式检索、来源与使用 | 无 |
| C02 / M1 | 持续约束→随口提及及隐含需用约束的请求，采用下述双探针/一次恢复配对 | 不提示搜索也正确使用；检索决定、访问及使用分开判定 | 无 |
| C03 / M1+M6 | 两实体共享歧义简称 | 澄清或消歧，不静默合并身份/权限；来源 ID 保留 | 无 |
| C04 / M1 对照 | 常驻证据、无关提及、不存在事件三个独立分支 | 已有合法证据无需多搜；无关不盲搜；不存在保持未知；分别评分 | 无 |
| C05 / M2 | A→明确纠正 B→无关活动→当前/历史独立探针，同时保留长期约束 | B 当前、A 仅历史、约束有效；接收、处理、适用 World COMMITTED、下一有资格请求 | 无 |
| C06 / M2+M1 | 正常形成 A、正常纠正 B、正常整理/退出，最后以自然请求需要纠正后的限制 | 分开维护是否留下当前旧 A、使用是否误信 A；后续检索成功不抹掉维护失败 | 无 |
| C07 / M2+M5 | 已完成、取消、未完成事项独立分支，含无 Task 事项 | 完成/取消不复活，未履行义务不因无关活动丢失；历史可查 | 年龄过期分支延后 |
| C08 / M3 | 暂定模型推断＋确认的有用事实，≥2 次正常维护提交，无新增支持 | 推断不升级权威；重述不是新证据/活动；有用事实可持续；三层分别测 | 无 |
| C09 / M3 | 无 Task 已完成话题及被替代结论，反复正常整理/重建 | 不复活义务、不凭空增加支持/权威；事件→摘要→请求→下次维护链 | 无 |
| C10 / M5 | 明确接受义务，等回答/条件，再收到回答及条件成立 | 讨论不等于承诺；不提前执行；正当激活一次；仅评估语义 Wait/Act | 事件驱动 |
| C11 / M5 | 接受后完成、取消、明确失效三个分支 | Satisfied/Invalidated 不再执行；独立预期与真实本地计数，含零效果对照 | 事件驱动 |
| C12 / M5 | C12a 复用 #121 已审的 checkpoint 恢复；仅有需要时 C12b 写后中断并直接重启原域，不做 checkpoint restore | 同 operation 身份 UNKNOWN 先核验，效果一次；宿主 verify-write 不等于模型自主对账。新 C12b 不在首轮 pilot | 无 |
| C13 / M6 | Master 原话/纠正、引用历史、导入笔记、真实 Task 回传、模型推断分别入场 | 摘要后仍保留来源/权威；不升格为 Master 授权；无支持导入路径则 UNSUPPORTED，不伪造 Master 消息 | 无 |
| C14 / M6 | 明确身份/别名、同名冲突、随后撤回支持来源 | 身份权限不串用；撤回后不能继续作为当前权威；历史链可追 | 事件驱动 |
| C15 / M4 | 过期、语义活动年龄及调度边界 | DEFERRED_TIME 交 #125，规模下复用 C05–C14；不伪报时钟成功 | #125 |
| C16 / 组合 | 一个连贯 C06/C08 类 episode，≥2 正常维护、实际 Context 退出、实际 OS 重启 | 同 lineage 同时具备三条件，重启后原引用可查；RC 与 DEP_DEFAULT/DEP_VERIFIED 分列；live 冻结前 Master 选择覆盖路线 | 容量预检必需 |

自然 C06 不得直接改写 Consciousness 制造旧状态。正常链路未留下旧当前 A 时可判维护正确，同时单列冷纠正状态是否达到；没达到冷状态不算冷使用通过。直接改状态只能另列诊断 ID，不计自然复现。

## 4. 证据与判定合同

1. **真实请求与访问**：沿用 `live-model.ts`/`evidence-audit.ts` 的物理 provider payload、角色/call 归属及哈希。must-retrieve 必须证明相关事实及语义回声均不在 Context、常驻画像、Consciousness、自动召回；opaque/encrypted state、未检查超大 payload 或语义缺席证据不足为 UNRESOLVED。自动召回、显式工具、结果、引用、最终使用分记。猜对不通过；隐藏 fact ID＋语义核验，不能只搜字符串。
2. **边界**：记录 A/B 接收/处理、维护版本、授权、operation/World commit、请求冻结边界。不改已冻结在途请求；纠正提交后检查首个有资格使用该提交的请求。没产生 commit 另记提取/授权/维护问题，不能无限等待或跳过首个合格请求。
3. **M3**：分别测文本字节/占比/存活、来源权威及证据/活动是否虚增、稳定事项 ID 与合并拆分血缘。无 ID 第三层 NOT_TESTED；第一层不能替代第二层。job 完成仅证明机械过程；C08/C09/C16 要求至少两次普通维护，保留失败/重试链。
4. **M5/效果**：隐藏义务 oracle 不从 SUT 账本反推；评估状态映射既有记录，不新增生产状态。只使用自有本地文件，独立实际写次数＋哈希＋身份＋journal。要求故障前 operation 绑定、fsync 后 marker、旧进程退出、新进程身份、UNKNOWN、verify-write 回复、同身份后续记录。宿主调用 verify-write 只证明普通对账 API，不证明模型自主对账。retired revival 不支持如实记录；局部观测不升级全局无副作用。
5. **探针污染与现有恢复限制**：不新增通用多分支恢复。C02 与 C05 当前/历史配对采用：停止源 S 并建 checkpoint→在原 S 测 A→停止 worker 及 PG→审计/封存 A 证据→仅一次调用现有 `restore(S, checkpoint)`→在子运行测 B。canonical 路径不变，S 变 RETIRED，两者来自同一探针前 snapshot；记录 A/B 身份、checkpoint 哈希、开始 digest、各自证据/效果计数及 future-input guard，campaign 账本不回滚。双探针是一个相关 trial。恢复前须无意外 APPLIED/UNKNOWN 效果、新 Task、sink 变化或进程未确认；否则保留 A 失败并将 B 留为未测，不改 manifest/registry、不弱化 guard。A/B 顺序提前冻结。C04/C07/C11 初始条件不同，各用独立计费新运行，不做同 checkpoint 多子代。额外诊断各有计数的新源 episode，最多一次恢复；不同 live 前缀不能称逐字节同一状态。闭环探针明确进入后续历史；oracle-reader/故障注入仅诊断。阶段 A 为这套原域 A/一次恢复 B 增加回归：B 不含 A、A 仍留 retired 证据、第二次恢复拒绝、有效果或并行 worker 时拒绝。
6. **判定**：宿主前提/效果与语义 PASS/FAIL/UNRESOLVED 分开；NOT_TESTED/UNSUPPORTED/DEFERRED_TIME 和基础设施原因明确。客观效果证据优先于冲突 judge 文字。旧六断言 v3 仅原样用于历史；#122 新断言/校准另立版本，不回写旧标签。新合同命名 `secretary-issue122-semantic-v1`，judge 为 Opus 5.5 Extra，control ID 不透露类别；发送前冻结 schema/rubric/control 哈希与标签。校准失败阻塞语义评分，不抹除有效 SUT 运行。新增正负 controls 覆盖当前旧事实/合法历史、权威提升/忠实不确定、无观测/已观察效果。有限 pilot 校准，公开 controls 不叫 held-out。无总排名、通用 authority PASS、发布阈值或 Luna 必过要求。

### World 边界、路由分类与观测窗口

C05-W 是独立 World 正路径：正常请求提出 A、driver 拒绝该 batch，再通过正常纠正 B 的请求让模型产生精确范围 batch；只批准实际参数及真实来源事件 ID，不由宿主伪造 SUT operation。要求 World COMMITTED/operation 回执、首个快照有资格见到该提交的请求，以及原域 stop/start 后保留状态探针。被拒绝 A 是历史提案，不是已提交当前真值；C05 的另一当前/历史 lane 负责曾有效 A 被 B 替代。World 正路径独立计数。历史缺失字段是 `restart_observed`；新协议必须同时保留它、旧进程退出/新进程身份、commit/请求序列证据并穿过导出。当前 world-replay.ts 已写此字段，因此测试新投影不丢失，并拒绝只给布尔值或缺证据的通过，不回填旧包。

C05/C06/C14 截止固定为 B 处理后的下一次普通维护完成，硬上限真实十分钟、最多两条明确计数的有资格观测请求；到期仍把 A 当当前为 FAIL。十分钟内维护未完成则记维护/前提失败＋语义 UNRESOLVED，不能无限 pending 或改称 UNSUPPORTED。World 提交后的首个合格请求就是使用边界，无额外宽限请求。维护时间/cooldown 不改。C11 效果窗口为接受→terminal settlement→两次 follow-up→一次自有原域重启，terminal 后最多十分钟；精确零仅限有仪表的本地能力/窗口，UNKNOWN 或观察缺口为 UNRESOLVED。

阶段 A 在结果产生前冻结带源码引用的路由表。当前源码已知：`attachments.ts:imageFormat` 只处理 PNG/JPEG，本次纯文本 cohort 的文本附件导入预先为 UNSUPPORTED；`scopes.ts` 提供 virtual Shared 的每 Task 自有目录；`scope-import.ts` 是另一产品路径，harness 恢复预检拒绝 DIRECTORY Scope/import 能力，不能偷偷用于 checkpoint 配对。选择的导入笔记路径是自有合成文件，由宿主作为**脚本化环境事件**提供，由真实 Task 通过现有 read/submit-result/feedback 读取；先用 fixture 核验 setup 再冻结为支持。`task-triggers.ts:conditions` 支持 RESOURCE_PRESENT、EXECUTION_SUCCEEDED、local DEVICE_AVAILABLE；C10 使用冻结 RESOURCE_PRESENT，观察 WAIT_PRECONDITION 后 driver 才创建自有文件，并标脚本事件；另有 `decisions/:id/answer` 问答子项。typed task-requests 支持 preconditions；模型创建与 driver 创建 Task 分列，不混淆。

C14 的 `attachment-withdrawal.ts` 仅允许符合条件的未处理/阻塞附件输入撤回；已 HANDLED 普通文本的追溯撤回预先为 UNSUPPORTED。支持的语义撤回通过新 Master 明确撤回消息与精确授权的 `world.change` RETRACT（`world-accept.ts`）测试，与物理输入撤回分开。C13 的真实 Task 回传沿用 Task/execution/feedback；通用外部事件注入不支持。首个调用前冻结精确路由/限制；模型没用好已支持路由是失败/未触发，不在事后改称不支持。新发现保留原预期并附版本化 discrepancy，复核后才修改分类。宿主创建文件/条件不叫 SUT 自发事件。

## 5. 实施顺序与执行上限

**A：本次请求批准的实施范围，无 live 调用。** 先在既有 NAS 挂载可信可用时，将所需 #121 宿主证据归档只读恢复到自有忽略隔离区，先核对归档回执/哈希及提取后逐文件清单；不启动恢复的 SUT、PG 或旧 controller，保留原路径来源，不改所有权。检查 C12 中断链、World marker 缺失、case 级失败线索；能证明的子项直接复用。归档不可读则保留 REUSED_REPORT_ONLY，并带入冻结表，不阻塞独立离线实现。

随后补 scenario/subcase/独立 oracle manifest、复用账本、实际配置/容量预检及报告、精确的一次恢复配对、源码路由分类、宿主身份/commit/效果、新断言 schema 与离线拒绝/回归。复用独立仓库现有 scenarios/episodes/lifecycle/world-replay/evidence-audit/effect-proof/domain/assessment 和报告，不新造框架/多分支原语。合成开发 oracle 一旦入公开 Git 即永久暴露，不放任何私有衍生正文/oracle。Secretary 纯文档合并不移动 SUT `873b66f`。如需生产 hook，另行复核授权、新基线 SHA/pin、源码差异及行为中立证据；旧结果仍锚定旧代码。

**B0：live 预算批准前的离线可达性与选择。** 扩展/复用 `capacityForecast` 到每模型/候选 case，既有初始通用预测不足。输出 system/tool/profile 初始字节、实际 window/input/output/reserve、正常整理阈值、普通负载/输入 schema 上限，分别预测原始输入投影退出、assistant/tool 回声退出、≥2 次维护提交，以及请求/token/预留费用边界、期限、预计 NOT_REACHED。预测不等于语义缺席或退出证据；保持普通 turn trigger/真实 cooldown，不把强制 compact 算自然维护。

旧 DEP 未显式设置上下文上限（`deployment_limit_verified=false`），OpenAI 描述为 1,050,000 窗口。在冻结 Master 确认的非敏感部署范围、各角色数值容量与 provider 容量来源前，只标 `DEP_DEFAULT_UNVERIFIED`；该布尔值本身只反映显式配置，设为 true 不能证明部署真实值。不复制敏捷配置/数据。默认 output/summary/retry 为 4096/16384/32768、normal 0.6、recent inputs 12/0.15；保存实际配置及 policy 哈希。新覆盖值只能来自验证后的冻结 run config，不能继承 shell 环境。

C16 运行前交 Master 两个选择：**建议离线可行后批准全模型统一的具名 RC（候选 RC98304，尚未授权）计入 #122 组合闭环覆盖，明确 RC、不计 #126 DEP 资格，DEP 结果/缺口另列；或者保留 C16/#122 组合闭环未完成，等待 #125。** 不继承 RC98304 授权；若不可行则交回预测与新提案，不按模型临时缩窗口、不见结果再选 profile。此决定不阻塞阶段 A 实现。预计不可达的 DEP lane 不派发，除非 Master 明确批准诊断目的及上限；保留预检排除项。

**B：具体冻结表经复核及 Master 预算确认后才 pilot。** 提交无 oracle 答案的展开矩阵，包含复用处置、路由、预计覆盖、固定顺序；精确 input/oracle/SUT/harness/依赖/全部角色 model/provider/endpoint/config 哈希；时间/请求/费用与 judge worklist。核验实际 ID `gpt-6.1-sol`、`deepseek-flash`、`gpt-6-luna`，不静默替换。三者均必测，Luna 不强制通过。凭据只用既有授权保护设置，0700/0600/忽略未跟踪，不进入证据。连接探针独立报告，但纳入同一模型额度；不得原样调用当前 null-ceiling 的 probe workflow。

将重复的 C12 pilot 替换为缺口：候选 C05-W/C08/C10/条件具备时 C16 × 三模型 × 一次，最多 12 trials（不是三次重复/资格集）。C12a 复用审过的证据；C12b 原域重启差异有需要再做。冻结交错顺序：C05-W 为 DeepSeek/Sol/Luna；C08 为 Sol/Luna/DeepSeek；C10 为 Luna/DeepSeek/Sol；C16 为 DeepSeek/Luna/Sol。每个预检阻塞 lane 仍列出，见结果后不换槽。

拟 SUT API 总上限仍 **USD 15，各模型独立预留 USD 5**，不用的额度不转移。每模型最多 640 次物理预留（含最多 3 次连接请求、所有子代与机械重试）；每 trial 最多 160 次；总计最多 1,920。每条最多 60 活动分钟、campaign 最多 12 活动小时；归档恢复、离线预测、外部 review 等待不计活动运行时间。串行派发。历史资源审计只作上下文：Sol 16 行/176 预留/631,624 input/22,525 output/保守计费约 USD 1.488238；DeepSeek 19/222/1,653,308/201,482/USD 0.8017203；Luna 15/165/677,760/28,355/USD 0.086105。协议/诊断不同，不预测新冷闭环、不据此给模型性价比排名。

按 B0 为每 lane 冻结模型 USD 5 内的子上限；完整 lane 剩余保守费用上界同时适合 lane/model 额度才启动，不可行则 NOT_DISPATCHED_BUDGET/NOT_REACHED，不中途降低口径。每次物理发送预留 `(UTF8 body 字节 × 冻结 input rate + max_output_tokens × 冻结 output rate)/1e6`，未知 usage 保留全额；批准前核验价格来源，供应商账单另留，重传全计。扩展既有持久账本，跨重启/恢复执行 lane/model/总限额，同一 approval 不许另设施重置。某限额耗尽停相应派发，其余模型预算不被挪走。语义失败不自动重试。浏览器 Opus 评分不计 SUT 美元，单独最多 12 个新 SUT batch＋1 校准 batch，每 batch 最多 3 次原样机械尝试，不作语义重试，quota/校准失败暂停；发送前冻结确切分组/control-token 上限。校准失败不抹除 SUT 证据，旧 #121 已接受评分不重发。草案不批准费用或浏览器评分 campaign。

**C：pilot 后完整基线。** 按实测费用/可达性提出全部非时间模板展开、次数与预算，拟每 scenario/model 三条新 lineage，列明配对/control episode 成本，不挑最好。pilot 单列，除非首跑前有相同冻结的纳入规则；旧 #121 不充新重复。大矩阵/调参前 Master 确认。若另准建议 RC 路线，C16 可建立 #122 的 RC 组合覆盖，DEP 缺口仍交 #125/#126；否则 C16 保持未完成。缺证据不靠文档变完成。

**D：交付。** 输出家族/subcase 结果（明确 knowledge-update 与 abstention）、首失败、完整分母/重复、资源及缺口、全部 12 个历史 FAIL 标签线索和两条独立 no-shell 观察，形成供 #123/#124/#125/#126 的小范围问题。今后候选沿用完全相同冻结集/配置/重复，仅声明产品差异；本包不实现候选。#126 G0–G4/U0 与 Master 放行不变。

## 6. 验证、留存及完成条件

本轮纯计划：中英语义一致、`npm run docs:check`、`git diff --check`、来源/报告审计；runtime correctness 为 NOT_APPLICABLE，新 live benchmark 为 NOT_RUN。

实施：针对性测来源缺失/哈希漂移、在途/下一有资格请求边界、常驻语义回声/opaque state 的假冷证据、重启身份缺失、重复效果身份、UNKNOWN 对账、探针泄漏/checkpoint 血缘、首失败及分母隔离；随后独立仓库 `npm run verify` 和 Linux/macOS CI。Secretary PR 跑 `npm run verify` 与必需 CI；另行批准的产品改动补适用 correctness 和 memory benchmark。fixture 不证明真实模型表现。

复核英文请求、原始回复、模型/UI 观察及截图留 `.local/reviews/issue122/`，Git/PR 只留脱敏结论。同一会话往返，实施复核覆盖准确 HEAD、差异、证据和限制；reviewer 不等于独立执行测试。

仅归档已停止、归属核验的测试域：本地 tar.gz→检查 NAS 挂载→传输→包内每文件哈希/大小比对→才释放本机源。保留首失败、清单、恢复说明；NAS 缺失/不可信时保留本机，不建伪挂载目录。私有原件、独立凭据、敏捷数据、混合根受保护；历史归档不覆盖、不重标。

完成须具备六家族表、自然/无须检索对照评分、陈旧维护/使用独立结论、M2 当前/历史及 M3 权威/长度分判、真实组合闭环及效果/对账、完整冻结重复报告与时间/能力缺口。可以包含产品 FAIL；必需子项未触发则仍未完成，除非 Master 明确收窄。Master 在计划复核后确认实施，live 前确认预算/冻结，合并另行授权；本计划不要求性能资格认定或部署。

## 7. 复核记录

R1 CHANGES_REQUIRED：B1 采用现有一次恢复替代方案，不做多分支；B2 增容量预检与 Master 的 RC 覆盖/继续等待选择；B3 增 lane/模型独立预算、固定顺序和 judge 上限；B4 拟好中英验收修订待 Master；B5 增 30 行 case 账本及全部失败线索；B6 把原件检查放在 pilot 冻结前并替换重复 C12；B7 增 C05-W、restart_observed 投影测试及期限；B8 运行前固定路由/分类。九条非阻断建议均已纳入。R1 未运行测试/读取私有归档或 CI 日志；issue 原文由 Codex 提供，公开代码/证据由 reviewer 独立核验。R2 在 af7077d 返回 PASS，八项阻断全部解决。Master 于 2026-11-18 批准阶段 A 及验收修订；以下六项实施条件须在 B0/B 冻结前核验。计划阶段未实施或新增 SUT 调用；阶段 A 现已授权，live、预算和合并仍另行确认。


### 阶段 A 采纳的 R2 六项条件

1. A/B 均为重启后探针；checkpoint 及每次探针前无到期/运行中的维护、提取及在途模型请求。可能合法创建 Task/效果的探针固定放 B。
2. 普通维护须为覆盖 B 已处理事件、已提交且非 CONTEXT_COMPACTION 的 job。到期分 NOT_TRIGGERED（附会话/设置）、RUNNING_AT_CAP、FAILED_RETRY_PENDING（附 next_attempt_at）、FAILED_TERMINAL；仅后两项是维护失败，取代第 4 节笼统超时措辞。B0 纳入真实 idle/turn/age 触发与 cooldown；固定源码中 critical feedback 可绕过普通间隔。
3. scope.import/DIRECTORY 对所有 start/checkpoint/restore 路径均为 HARNESS_EXCLUDED，不是产品 UNSUPPORTED，也不只限制 checkpoint 配对。C13 导入笔记以文件哈希/read 回执与 Task 解读分别归属。
4. C12a 不能证明第 4.4 节任一元素（含归档不可用），C12b 即为必补项；C16 明记原域直接重启或 checkpoint restore。
5. 仅检查所需归档并记录访问；PG dump 只离线读取，不启动服务器。合成中断/World 与私有失败线索分开，私有原文不进 Claude/Git/CI。
6. 冻结 lane 的 USD/reservation 上限，不将 160 次满窗口请求当预算界限，也不保证完成。B0 用实际序列化字节，并核验包含 reasoning 的计费输出上界；否则预留已核验最大值，无可靠界限不派发。审核中的费用示例不作为冻结价格。


## 8. 阶段 A 实施证据

离线实现位于独立仓库 [secretary-benchmark PR #1](https://github.com/ExplodeCode6324/secretary-benchmark/pull/1)，初始提交 `7c66d66c59f774dbe468ed584c6befa6e8a66733`；Secretary 只读固定为上述基线。[实施合同](https://github.com/ExplodeCode6324/secretary-benchmark/blob/codex/issue122-memory-baseline/test_case/online/benchmark/ISSUE122.md) 逐项映射 R2 六项条件，并列出 live driver 与冻结尚需完成的工作。Secretary 产品行为和部署配置未改动。

独立仓库本地完整检查 112/112 通过；12 项新增测试包含真实隔离 PostgreSQL checkpoint/一次 restore 行为和 fixture Task 读取笔记路线。Fixture 预检将 34 个开发场景展开为 204 个模型/配置预测单元，provider 发送次数为零。预测只证明规划结果，不证明实际线上请求字节、语义缺席、模型在线可用性或完成成本保证。

只读核验三个必要的 #121 NAS 包，逐文件哈希与大小通过；未启动历史 SUT/controller/PG。合成生命周期证据保留同一操作对账及一次物理写入观测，但缺少独立持久化的旧进程退出见证，故 **C12b 仍为必做项**。Private-A 仅保留完整性元数据；历史标签、首次失败、其他复用边界及未复查行的 report-only 状态均保留。脱敏引用见[来源核验报告](https://github.com/ExplodeCode6324/secretary-benchmark/blob/codex/issue122-memory-baseline/evidence/issue122-reuse-audit.json)。

私有证据保留首次失败：初始基线套件运行时并发编写导致一次源码指纹失败、fixture schema 的 TypeScript 类型标注错误、首轮配对测试遗漏 payload guard 初始化。修正后冻结代码完整套件通过。最终准确 HEAD 复核、CI 及归档回执追加到 PR，避免只改状态而反复提交。这些离线结果不构成真实运行、预算、RC 选择、完整矩阵或合并授权。


R3 查阅独立仓库准确提交后，要求四项离线修正：配对探针前须覆盖全部已处理输入且 Consciousness 修订/覆盖一致；RC98304 继承 RC 的 recent-input 2/0.05 配置；场景使用路线专属时间线、确定性无关活动和等待，将 oracle/测试机制文字移出 SUT 输入；补齐 STALE、PARTIAL/在途效果及预算边界测试，超预留结算须持久化并停止后续发送。这些修正均属阶段 A。上文 112 项测试是初版证据，替换证据及最终复核须绑定修正后的 HEAD。Core 未改运行时代码的完整检查为 1,319 通过、27 跳过、零失败，中英文文档检查亦通过。验收第 5 条已按 Master 批准文本更新到 issue。
