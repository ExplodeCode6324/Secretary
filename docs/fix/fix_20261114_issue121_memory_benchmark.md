# #121 真实模型记忆 benchmark：数据、工作负载与评分计划

状态：R1，待浏览器 Claude Opus 5.5 Extra 复核；实施 NOT_STARTED。复核后先交 Master 确认，之后才能实施。pilot 后冻结实验表是第二次独立决定。[English](fix_20261114_issue121_memory_benchmark.en.md)。

仓库 https://github.com/ExplodeCode6324/Secretary ；[#121](https://github.com/ExplodeCode6324/Secretary/issues/121)，总路线 [#119](https://github.com/ExplodeCode6324/Secretary/issues/119)。main 基线 `6f3cd06327144d48960926af4ef90bbb24578bfd`（#133/#120 已合并）；分支 `codex/issue121-memory-benchmark-plan`。本轮不合并 agile、不部署、不实施生产记忆修复。

## 1. 交付边界与现状

#121 交付可复现、能如实记录失败的**测量体系**、有界真实模型 pilot，以及供 #122/#125/#126 使用的 Master 确认冻结表。框架交付不等于记忆可靠性通过，不要求把所有模型调到通过。发现的产品失败保留为基线，由后续 issue 修复。顺序：复核计划 → Master 同意实施 → 框架与评分器验证、获准 pilot → Master 冻结样本/配置/评分/资源 → #122 等开展保留集基线和候选调参。

复用 `test_case/online/benchmark/{cli,domain,worker,snapshot,archive}.ts` 的自有 PG18/Core、规范路径恢复和 NAS 归档。现有配置仅支持 fixture/correctness/infrastructure v1，worker 禁 fetch、使用脚本回复；`test_case/benchmarks/common/report.{ts,schema.json}` 已有 correctness/memory、六状态和证据类别。扩展现有 runner，不另起生命周期系统。复用 `model.ts:roleModel` 的真实最终 payload 容量检查、零 SDK 自动重试、SSE 和 low reasoning；主会话、任务、维护、提取都须真实模型，逐次记录实际路由。`memory-search.ts` 从权威事件建立索引，没有任意历史导入合同，因此 P 首轮只声明组件级。恢复白名单目前连已完成 `world.change` 都拒绝，须先补按状态核验。

不建设 onboarding/候选收件箱、检索算法、向量库、异步整理、语义时钟、生命周期重写、UI、默认 GC 或放宽授权。#122 管语义基线/修复，#125 管加速时间/容量。禁止根 npm start/stop、敏捷数据/配置/凭据/Scope/launchd。

## 2. 模型、端点与有界执行

| Master 指定名称 | 官方资料支持的候选 API ID | 拟用 provider/端点 | 状态与定位 |
| --- | --- | --- | --- |
| gpt6.1 sol | `gpt-6.1-sol` | OpenAI，`https://api.openai.com/v1`，Responses | 实际权限/连通未验；必测对照 |
| deepseek-flash | `deepseek-flash` | DeepSeek，`https://api.deepseek.com`，按安装 registry 确定兼容适配器 | 实际权限/连通未验；必测对照 |
| gpt 6 luna | `gpt-6-luna` | OpenAI，`https://api.openai.com/v1`，Responses | 实际权限/连通未验；能力刻画，**不强制通过** |

2026-11-14 查阅 [OpenAI 模型目录](https://developers.openai.com/api/docs/models)、[GPT-6 指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.1-sol)、[DeepSeek API](https://api-docs.deepseek.com/api/create-response/)。官方命名不证明账号权限、registry 支持或网络可用。冻结前核验实际 API、base URL、model ID、推理/工具流、上下文/输出上限和返回模型/快照；无固定快照时记录别名漂移、访问时间及可复现限制，不擅自换模型/端点。

S/R 每个主配置让所选模型承担全部产品角色，比较完整配置的系统。尽可能统一 prompt、工具、事件、语义配置、上下文/输出预算及限额；原生参数差异逐项冻结，不声称相同 reasoning 标签等于相同算力。不暗用更强维护模型；混合角色和 oracle-reader 单列诊断。P 使用所选 reader 和同一冻结检索适配器。

API 凭据只在本 checkout `.local/test-credentials/`，0700/0600，核对忽略/未跟踪；不进上下文、报告、URL、Git。worker 经受限启动通道取得其模型所需密钥，留在 closure；grader 密钥只在 SUT 工具不可达的控制器评分进程。调用前核对凭据复用和端点授权，本轮计划不调用 API，问卷不索要 key。先做最小合成连通探针，区分 DNS/TLS/auth/model/capability，与真实 workload 分开；不修改全局代理/路由/敏捷配置。

拟 pilot 上限（待实施批准）：同时一个 episode；SDK 不重试；只有确认尚未收到有效回复/效果的传输失败最多显式重试一次并保存初次失败，不默默重发不确定请求。单请求 180 秒、P 单题 10 分钟、S/R 单 episode 30 分钟且最多 60 次物理模型请求；输出 4096 tokens，受 registry 和原容量检查约束。pilot 总限额 6 小时及等值 USD 30，记录价格和汇率日期；每次发送前预留最坏请求成本。无法证明预算上界时停止相应请求，未知用量不算零。分记 input/output/cache/reasoning，缺失为 null。触限 INCOMPLETE，不覆盖已发生失败；增额须经 Master 确认新 campaign。正式资源表由 pilot 与 #125 冻结，不成为敏捷预算。

## 3. 三条独立数据轨道

### P：公共组件参考

选择 LongMemEval **cleaned S** 的 `longmemeval_s_cleaned.json`，来源为[原仓库](https://github.com/xiaowu0162/LongMemEval)链接的[官方数据集](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)，不暗换 V2/M。冻结 dataset revision、文件 SHA256/字节数、许可正文/来源、官方评分器 commit/hash。仓库 MIT 不自动证明每个数据文件许可；许可未确认则阻断该版本使用，不猜测、不提交语料。

拟 smoke **50 题**：六个 question_type 各选 7 道非 abstention（42），另选 8 道 `_abs`（共 50）；每层按 SHA256(`secretary-121-v1|question_id`) 升序，平手按 ID。固定 ID/层/算法；版本不足额时在看到成绩前修订。另取六道互不重叠公共 dev 题（每类型一题）供 pilot，排除出 smoke，记录重叠历史。公开题属于已曝光参考，不称未知保留集。

输入仅允许 question_id/question/question_date、原始顺序及角色/文本/日期和不透明来源 ID；递归剔除 answer、has_answer、answer_session_ids、标签和其他未知字段。历史作为引用材料，不伪造 live assistant 事件，不把原对话变成新的 Master 指令。在 benchmark 自有组件 corpus 使用已有分词/分块/查询机制；若需提取共享 helper，须保持行为并回归，adapter 说明实际复用和新 glue。不写产品 journal。拟固定字面 question 查询、top 20 chunks、确定性平手排序、证据按原时间排序、不按 gold 选证据、不按模型调 query。记录截断/预算拒绝和来源映射。只能证明 retrieval＋reader 组件，不证明 Core 自然检索/维护；full-history 若另做是单独实验。

锁定官方 `evaluate_qa.py`、`print_qa_metrics.py`、prompt/parser/dependencies/judge。官方 judge 实际可用且获单独批准时，原样评分，标注“50题子集／组件适配／官方评分器”，不称全套成绩。三种被测模型不隐含 judge 授权。拟备选 Sol＋官方 prompt 是明确 **judge variant**，不能填官方分数；官方栏保留 NOT_TESTED/BLOCKED。judge 错误/非法输出记未决，不能自动判正确或错误。P 不作为 Secretary 放行门槛。

### S：Secretary 生命周期工程场景

拟 **12 dev＋12 独立 held-out**，每个 split 的每 M 类两个 episode。源事件、实体及因果时间线应独立，改写一句不算新 episode。每个 episode 8–16 条脚本 Master 输入，通常中英交替，含无关干扰和固定观察点；assistant/工具行为由真实模型生成。一整个 episode 的全部必要断言决定成绩，不挑个别问题。

经正常 Core API 输入，实际串行整理/原文退出、按需自然提取及获授权 World 提交、任务/义务处理、真实 PID 重启/恢复。不得手改摘要/时间或预填 World 来冒充自然提取；种子 World 仅作单列下游读取诊断。

| 类别 | dev A/B（held-out 使用不同事件对应覆盖） | 必测证据 |
| --- | --- | --- |
| M1 自然访问 | 远处历史偏好／相关证据不存在 | 无“请检索”暗示的检索决策、实际请求包含、正确使用或有据拒答 |
| M2 僵尸信息 | 常驻旧事实＋冷历史新纠正／旧但仍有效限制 | 维护与后续使用分判；旧记录可历史保留，不能覆盖新纠正 |
| M3 自强化 | 助手猜测被摘要复述／无关重复整理 | 内容占用、来源权威、细粒度事项血缘、活动时间分报；无稳定身份如实缺项，字节稳定不等于通过 |
| M4 时间/容量 | 实际退出后的日期推理／有界驻留容量下重启恢复 | 实际整理/退出次数、时间、上下文和恢复身份；#121 不声称加速30日或10k |
| M5 意图/行动 | 无 Task 的未完成承诺／一意图多 Task 且写入中断 | 独立义务、真实效果次数/文件/状态；对账后不虚假完成或重复作用 |
| M6 来源/权威 | 第三方引文指令冲突／纠正先拒绝后授权 | 权威正确、拒绝无效果、批准有回执、不泄漏未来 |

每对包含正负或边界/恢复分支；驱动 FSM 公开，只按显式 API 状态走固定分支，不依赖隐藏答案或 judge 反馈。记录实际分支，未支持仍在分母。冷记忆前提：证据确实退出 effective context、索引 ready、摘要提交后原文退出、需要时真实恢复。期限内未达到前提记失败/未完成，不能用常驻答案算冷记忆成功。M4 输入中的模拟日期只是叙事，不加速真实 cooldown/年龄；相关行为等 #125，当前 NOT_TESTED。小容量实测不外推大规模。

### R：Master 批准的私有/受控衍生场景

Master 已选先填[脱敏问卷](issue121_private_scenarios_questionnaire.md)，当前未提供或授权向 API 发送个人数据。拟首轮 2 dev＋2 不同 held-out，针对 Master 首要失败模式，扩容在冻结前确认。不得从 agile 或聊天历史主动挖取，不把虚构例子称真实。受控衍生需私有原文→替换、来源/日期/截取边界及 Master 期望确认。

没有数据则 R=NOT_TESTED，#121 私有数据条目仍待办；P/S 工程可继续，不宣称真实个人记忆通过或 #121 全完成。Master 可明确接受缩小的 P/S 交付，同时保留 R 后续。

每份数据明确 SUT 与独立 grader 的具体 endpoint、允许字段/日期范围/替换/保留期；未获外部评分许可可由人评分。本地隔离仍会向 API 发上下文。真实内容不送 Claude 计划复核、不进 Git/CI；权限未满足拒绝派发。

## 4. 隐藏 oracle、实验纪律与隔离

版本化 manifest 含 dataset/episode/split、输入哈希、事件序列、每 cutoff 的期望事实/限制/义务/禁止效果/来源、模型角色/评分器、代码/子模块/依赖、硬件/时区、seed、重复数、限额及权限。输入与控制器 oracle/未来事件分开；后两者位于 Core/Scope/Shared/CAS/PG 外。worker 不获 oracle 路径、gold 标签、未来事件或评分输出，只逐步释放下一输入。期望由原始事件独立编写，不从 SUT 不完整账本倒推。

记录作者、看过输入/oracle/失败的人、曝光时间与冻结哈希。实施调试只看 dev；held-out 在框架/schema 验证后，由 Master 或明确授权且不做候选调参的独立策展者封存。作者不同本身不保证未见，held-out oracle 不进代理上下文/Git。无独立性则明确标“已曝光回归”，保留结果，泛化结论前补新未见事件。看过失败并据此调参后转回归，补全新保留集。本计划阶段不需擅自委派其他 agent。

#120 是工具可达边界，不是 OS 沙箱。真实模型启用前，用完整真实工具集证明 canary 不可读：禁任意 shell/PROGRAM、DIRECTORY 导入、外部写入/真实推送；保留工具 schema，让危险请求走正常拒绝，不靠删工具或许可自定义规则。允许自有 Shared 文件、正常授权写入、journal/CAS World 提交和计数本地通知 sink。首次及恢复后 effective payload 均检测秘密/答案/未来 canary，逐条允许工具路径验证。

恢复预检改按状态：完成 World 操作须验证持久回执及归属；终态拒绝/失败须无未决进程/效果；待执行/可派发只放行明确支持的能力和自有资源；未知、外部、模糊效果阻断。RESULT_UNKNOWN 写入走原对账，不自动重做。仅修改 harness 预检，不改 Core 权威/授权；每种可接受状态、错回执和危险 pending 均先 correctness 测试。

非干扰探针同 checkpoint、同规范 lineage slot 顺序恢复，分支相关，不冒充独立重复。主闭环探针正常进入后续记忆并保留。不同模型从新域重放原输入，不移植另一个模型生成的记忆。oracle-evidence reader 仅作单独归因，不混入主成绩；单轮 replay 不把旧结果塞给不同工具参数。

## 5. 评分、对照与拟定阈值

分开实验有效性、语义质量和资源合规。S/R 每断言 PASS/FAIL/UNRESOLVED，附来源证据/理由；必要断言全通过才 episode 通过。分 M 类报告整数、每次重复向量、valid/attempted/planned 分母、失败类型、波动范围；不合并掩盖 G1，不 best-of-three，相关重复不算独立置信样本。

G1 关键违例：未授权/越界作用、禁止的重复作用、虚假完成、来源提权成指令、纠正失效并改变受约束行动、应继续存在的义务/有效限制丢失。先验真实回执/持久状态/文件/sink 次数，再对独立语义预期；账本没义务不证明没丢义务，观测不完整不证明零作用。任何关键违例使该配置失败；零观察仅为范围内证据。

G2：事实/限制、拒答、证据使用、检索、维护分别报告。P gold recall 只供诊断，不影响检索。S/R 冻结 rubric、必要事实/禁止断言、source ID、cutoff；能客观比对先客观判。拟固定 Sol 语义 grader，独立进程/prompt、盲化 SUT 名称，承认同模型家族偏差，不使用 SUT 自评。Master/人工核验全部关键判决、judge 分歧/非法输出和其余 pass/fail 分层抽取的 20%；必要人工未完成则未决。换 judge/rubric 作为保留输出上的新版本 rescore，不覆盖首判。

评分对照至少 12 个手工冻结合成样例（每 M 一正一负），并有成对丢义务、陈旧纠正、错误来源、虚假完成、冗长错误、正确改写、非法 JSON、judge 注入。要求确定性对照和关键负例全部正确拒绝、正例接受，非法输出未决；对真实效果做正负变异。对照失败则受影响评分无效，保留后只在 dev 修复。

pilot 后待 Master 冻结的建议：S held-out 12×3 独立重复×3 模型=**108 episode runs**。Sol、DeepSeek 各自要求 G0 全部计划必测运行有效；G1 全重复零关键违例；G2 每 M 类两个 episode×三次中至少 **5/6 整体成功**，且必要边界分支全部观察到。必要断言未决/不支持阻断资格，不缩分母。Luna 同样 workload/评分、完整报失败，但自身失败不阻断放行；未达同标准不称 Luna 合格。P 50×3×3=450题次，仅参考。R 拟四 episode（2 dev/2 held-out），held-out 2×3×3=18次；Sol/DeepSeek 每个保留 episode 3/3 且零关键违例，按 Master 实际优先级冻结。P/S/R 和模型不混总分。

小样本只支持有限验收。pilot 可支持调整题数/分支/整数阈值，但候选调参前须 Master 确认，保留旧建议/旧结果。30模拟日、10k存储单位和完整容量是 #125 待确认范围；十二 S 场景不证明它们。G3 的语义、延迟/启动/恢复、内存、积压和成本边界与 #125 协同冻结；#121 实测报告不宣称 G3。#126 保留 G4 与放行权。

## 6. 获准后的实施顺序

1. 在现有目录补 live/config、dataset/oracle/selection/freeze、报告扩展 schema，区分 P/S/R 及组件/闭环/诊断，兼容 v1 fixture。唯一入口仍 `npm run benchmark -- ...`，显式自有 facility root。`validate/probe/pilot/evaluate` 是拟新增子命令，未实施前不冒称可用；已有 lifecycle/archive 保持权威。
2. 加凭据安全的真实 stream 与物理发送台账：attempt/logical call/role/request hash/时间/返回模型/status/usage/不确定性；先 fsync intent 再发、后记完成，说明崩溃歧义。私有捕获 effective payload/工具结果，不含 header/秘密。每次 SDK/HTTP 请求、维护/提取/评分和重试分计；发送前容量拒绝另计。拒非批准 origin/redirect；fixture 保持零发送。
3. live 前完成状态恢复拒绝和 oracle canary。合成事实→真实整理退出→真重启/恢复→续接的 continuity smoke，观测角色/效果；提取/退出失败保留，不用 fixture 替代。
4. 实现 P 组件 loader/scorer、S dev 驱动/oracle/grader；R 只准备问卷与许可。离线正负验证来源、选题、cutoff、白名单、评分控制、预算台账、半流/取消、报告。共享检索 helper 行为保留回归。
5. 凭据/端点/预算批准后，三模型各跑 **6道独立 P dev＋6个 S dev（每 M 一例）×一次=36 主运行**，另每模型最多一次 continuity smoke。各角色/评分调用都占总额。R pilot 需另有来源/端点许可和明确矩阵/预算。保存全部失败/不可用及 provider/harness/timeout/capacity/unsupported/incomplete 分类。pilot 不调候选；仅修 harness 缺陷，另 run ID，保留首失败。
6. 交 Master pilot＋可审阅冻结表：确切 ID/split 曝光、角色/模型快照/参数、judge/controls、重复数、G1/G2整数、费用/次数、真实整理退出/负载、#125资源接口及 R/时间缺项。确认前不进入资格测试或候选调参。
7. 实施验证：针对性协议/泄漏/效果/恢复 correctness，`npm run check`、`npm run docs:check`、`npm run verify`、必需 Linux PG18/full suite 与 macOS benchmark CI。收费 online opt-in、不成为 CI 凭据依赖；实测 pilot 另附。harness-only 的原生 TUI/agile 同域改动 NOT_APPLICABLE，不称已测；产品变更超出行为保留 helper 则重新计划/补受影响回归。
8. 已停止、归属核验测试 facility 走现有本地 tar.gz→已挂载 NAS→逐文件读回 hash/size→receipt→释放本地流程。目标 `/Volumes/share/Files/HDD2/ELIZA/ELIZA_BAK/secretary-test-bak`，挂载缺失拒绝。完整首失败/证据保留；独立 API 凭据、活动/未知/混合根、敏捷数据排除。R 的 NAS 保留/访问需授权；本地只留小型脱敏索引。

## 7. 验收与复核记录

| ID | 必需证据 |
| --- | --- |
| A121-01 | 不可变清单锁定输入/oracle/split/license/adapter/model/judge/config/source；变异、缺同意、旧 freeze 拒发 |
| A121-02 | 所有允许工具和恢复前后 effective payload 无答案/未来/凭据泄漏；fixture 仍零调用 |
| A121-03 | 三模型实际 probe/pilot、全角色及物理调用/usage 台账；Luna 失败完整保留且不强制通过 |
| A121-04 | P 原历史/官方评分区分；S 真闭环/整 episode 评分；R 独立可溯源或明确待办 |
| A121-05 | 正负控制能拒坏事实/效果、接正确改写；未决不 PASS；完整分母/首失败跨重跑重评保留 |
| A121-06 | 真实模型重启恢复及按状态拒绝完成；checkpoint 分支不冒充独立重复 |
| A121-07 | pilot＋Master 调参前冻结；#125资源责任保留；R/许可/预算待办不称全完成 |
| A121-08 | 必需 correctness/CI、归档回执/说明；同 Claude 会话复核实施精确 HEAD；Master 另授合并 |

R1 待 Claude Opus 5.5 Extra。本轮仅计划文档校验，runtime/CI/pilot NOT_TESTED。原请求/回复/截图在忽略目录 `.local/reviews/issue121/`。计划及空问卷无个人数据；Master 选择先问卷，未回不是同意。review PASS 仅代表可交 Master 决策，不是实施许可或记忆验收。
