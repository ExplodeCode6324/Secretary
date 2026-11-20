# #122 阶段 B 执行修订

[English](fix_20261118_issue122_stage_b.en.md) · [原计划](fix_20261118_issue122_memory_baseline.md) · [独立 benchmark](https://github.com/ExplodeCode6324/secretary-benchmark/pull/1)

本修订用于新的 B 轮次，不修改 #121 或阶段 A 的结果、首次失败和配置。Master 关注 Secretary 的实际可用性，而非固定型号排名。

- **模型与预算。** DeepSeek Flash 系列必测；本轮请求 `deepseek-flash`，[供应商文档](https://api-docs.deepseek.com/quick_start/pricing)说明当前服务版本为 V4.1-Flash-1017。每次冻结记录别名、日期、供应商来源和响应标识，轮次中途发生可检测版本变化则分列，不把别名当作不可变快照。对照组为 `gpt-6-luna` 和 `gpt-6.2-sol`，只在确认账户额度耗尽时跳过剩余对应项。网络失败、短期限流、无权限均另记，不算额度耗尽。复用既有隔离凭据，不设美元上限；估值、供应商用量、未知用量和账单分开。保留原定请求数、超时、重试及账本约束。
- **B0。** 每个模型和配置用真实 fixture 采集初始模板、工具、窗口、reserve 和 recent-input 预算。用正常整理阈值、单条输入余量及 recent-input 窗口导出 filler。原始投影退出、assistant/tool 回声退出和普通维护提交需分别实测。离线报告不能宣布冷闭环或可保证完成。补查输入泄漏、M5 三个缺失子场景、实际探针 A 输入与 Main Consciousness；冷证据绑定同 lineage 的请求、读取及使用。
- **轮次范围。** 每组一次，固定顺序 C05-W：Flash/Sol/Luna；C08-inference：Sol/Luna/Flash；C10-condition：Luna/Flash/Sol；C16-combined：Flash/Luna/Sol。共 12 个槽，不补位、不把历史重放算新重复。C16 最后可能触及时间限制；不默认授权 RC98304，也不把它当 DEP 结果。单槽最多 160 次物理发送、60 分钟；每模型 640 次（含最多 3 次连接探针）、全轮 1,920 次及 12 小时；不因无美元上限放宽。仅校准及最多 12 个评分批，每批最多三次相同机械尝试。
- **派发关卡。** 凭据不进入冻结材料；SUT 仅收合成输入。冻结输入/oracle/代码/依赖/配置哈希、按角色列出 provider/endpoint/model、实际序列化字节和输出计费界限、校准包与私有键摘要、分组和时间。复核通过、Master 确认具体冻结后才运行，按精确产品记录绑定 World 授权、Task 条件和次数。先报告宿主前提与效果，再独立报告语义。只读模型目录不是推理探针，连接成功不是 workload 通过。产品、部署、扩展矩阵及合并均不在本次授权。

## C16 候选冻结表 · 2026-11-21

Master 已确认：第 10–12 槽依次为 DeepSeek Flash、GPT 6 Luna、GPT 6.2 Sol，统一使用 RC98304 候选配置，不按模型另调窗口。[逐槽输入、时间线及配置摘要](evidence/issue122-c16-candidate.json)绑定 11 月 18 日 B0 原件。Main/Task 窗口均为 98,304，recent-input 为 2 / 0.05。当前配方每模型估算 60 轮填充；DEP 各 186 轮，单槽上限 160 次，DEP 超限记录保留。60 轮不是总请求数，也不是已完成两次维护的证据。本决定只选候选配置，不是冻结签字、派发或部署验收。

## R6 执行规则（2026-11-21）

仅对新的 B 轮次，下列规则取代 R2/S6、R5 中冲突的表述。历史标签、输入和首次失败不变。

1. **物理派发守护。** 新版策略不含美元准入字段，本轮拒绝旧 schema；历史回放沿用旧策略。发送前持久预留一次物理请求、实际序列化字节和冻结的计费输出 token 上界。输入 token 对字节、含 reasoning 的总输出对输出上界分别比较，不得相抵。回归须覆盖输出超限而总金额仍低于预留。用量缺失或歧义时保留全部预留为估值，不记零或账单。任何分项越界持久化并停止整个 campaign，重启仍生效；美元差额只报告。无有效价格或输出上界不得派发；开跑前 24 小时内复核官方价格及版本，发现变化即停。冻结服务档、上下文价格分段、缓存保留期；按请求字节上限、费率及次数列每模型与总计的预计和最坏费用，不作预算门槛。
2. **次数、时钟、重试。** 每模型保留 3 次连接探针；C05/C08/C10/C16 分配 160/160/160/157 次，C16 标 LANE_CAP_REDUCED，不借用、不返还。整条 lane 的固定次数须落在 lane/model/campaign 剩余额度内；每模型 640 次、合计 1920 次。串行；从首次发送算单槽 60 分钟、全轮 12 小时，暂停不停钟。Main、Task、维护和探针的每次物理发送均绑定 lane/model/episode，探针另报。每个 SUT 逻辑请求最多一次机械重试，仅限有证据未开始执行的明确暂时拒绝或短期限流，仍占原次数及时间；送达不明、有副作用、上界/身份异常、语义失败不得重试。judge 另限三次相同机械尝试。
3. **身份与错误。** 每次请求/响应绑定请求 ID、provider、endpoint、公布版本/日期和返回标识或允许的指纹。仅回显别名时只归因到供应商公告窗口，不声称锁定后端快照。检测到版本切换即停止该模型并分列证据，后续槽以身份待决不派发，不替换或混算。冻结各供应商状态码＋错误码白名单及反例；原始错误字节本地取哈希，仅脱敏导出摘要、状态、分类、attempt 与时间（TLS 无 HTTP 正文）。OpenAI 429+insufficient_quota 为额度耗尽，rate_limit_exceeded 不是；DeepSeek 文档规定的 402 余额不足为耗尽，429 为限流。401/明确凭据拒绝为 AUTH；HTTP 前 TLS 失败为 TLS；明确服务暂不可用为 TRANSIENT；其余歧义为 UNKNOWN。只有可归因耗尽才跳过后续对照组。主组额度/认证/账户阻断则暂停整轮，现有时钟不停；Master 可在期限内修复或充值，在同一授权、同一计数下继续未开始的工作，不重跑部分完成的轨迹。
4. **分母。** 每槽一个终态，首个决定性事件优先，原有尝试不抹除。COMPLETED 仅代表协议完成；INCOMPLETE 保留首个槽上限/故障或 INCOMPLETE_QUOTA 原因；NOT_DISPATCHED_PREFLIGHT 含配置不全及版本切换后的身份待决槽；DEFERRED_BY_DECISION 是 C16 明确暂缓，不是超时；UNRUN_CAMPAIGN_TIME 是全轮时限排除的未启动槽；SKIPPED_CONTROL_QUOTA 只用于额度耗尽排除的未启动对照槽；BLOCKED_PRIMARY 用于明确终止时仍因主组账户阻断的槽；STOPPED_BOUND_VIOLATION 用于全轮上界越界而停止的在途/未启动槽；VERSION_TRANSITION 用于切换发生的轨迹。已终态的槽不改。始终列 12 槽及各终态数量；语义分子分母只算实际行使的断言，与覆盖率并列，保留 UNRESOLVED。
5. **可比场景。** 第 1–9 槽统一 DEP_DEFAULT_UNVERIFIED（不是部署资格），提供逐模型 B0 预测。三个 C10 均只跑同一 typed C10-condition / RESOURCE_PRESENT，各用一条新轨迹。typed answer、模型创建 Task、仅讨论均标 UNCOVERED_IN_PILOT，留阶段 C，不拼接或拆算。固定 SUT 873b66f 的 main-tools.ts 第 249 行 task_propose 无 preconditions 字段，api/contracts.ts 第 475 行的 typed 请求有；模型自建 RESOURCE_PRESENT 路线不可由该工具表达，标为不支持。扩展 manifest 的模型自建 Task 改走真实 QUESTION/answer 路线，不用脚本创建冒充模型行为。C16 候选选择不变。
6. **冻结材料。** 新描述符及新配置预测与 #121 历史 Sol 6.1、未知实际版本的历史 DeepSeek 分列。冻结 12 槽表、首次发送日历、各槽耗时与尾槽风险、配置/代码和校准包/键哈希、证据披露边界。CI、冻结表复核和 Master 派发确认仍是包括推理探针在内的前置条件。R5 只审了提供的计划文本。

## R6 结论与处置

2026-11-21 香港时间，阶段 B **实施计划就绪**复核 PASS，R5 三个阻断均解决。四项实施复核条件全部采纳：HALTED 必须附 PROVENANCE_CHANGE、OPERATOR 或 INFRASTRUCTURE；版本变更后未启动的槽标 NOT_DISPATCHED_PREFLIGHT / VERSION_HOLD。仅能按公布窗口归因时，每条 lane 开始及整轮结束复核公布版本，跨窗口轨迹不混算。一次重试仅限驱动重传；不增删 Secretary 自发重复请求，每次物理发送仍计量。回归须验证拒绝旧策略，且无 USD 字段或占位值时所有物理守护仍生效。冻结前按 C16 完整工作负载和耗时评估 157 次、60 分钟，不只计算 filler。审核人仅复核来稿和算术，未核查源码、本地测试、CI 或供应商。Master 的实施决定与后续冻结、派发及合并授权分开。

## 阶段 B 运行入口

Master 已批准实施与离线验证。以下命令通过独立 benchmark checkout 的 `npm run benchmark -- baseline-stage-b-<命令> --root <隔离设施>` 执行，设施属于该 checkout 的 `.local/benchmark/`。

| 命令 | 输入与产物 |
| --- | --- |
| `calibration` | 在设施内一次生成私有答案和盲评包，重复执行核验原件并返回同一对摘要。 |
| `prepare` | 读取从已核验 B0 归档取得的 `configs/issue122-b0.json` 及操作人整理的 `configs/stage-b-inputs.json`。产出 12 槽候审配置，包含 Main/Task 绑定、输入和 oracle 摘要、C16 整槽预测、时限和物理上限，返回文件摘要。 |
| `report` | 离线回放计划与账本，列出每槽处置、已行使的断言、校准、已知用量和估算保留量。 |
| `start`、`dispatch` | 具体冻结另获批准后，两条命令都传入批准的 `--sha256` 和唯一 `--approval`。前者绑定设施和批准号，后者串行启动探针与工作负载，并可根据持久记录处置中断的尝试。 |
| `repair`、`stop` | 主组账户修复经批准后带上对应 `--attempt` 及原批准号和摘要，再执行派发。显式停止会为余下各槽记录终态。 |
| `calibration-begin`、`calibration-finish`、`grade-prepare`、`grade-begin`、`grade-finish` | 本地登记评审尝试及结果，由操作人在评审会话交付获准的盲包。机械重试复用同一份内容。 |

输入配置逐模型列出官方来源 URL 和原文摘要、核验时间、公布版本与允许的返回标识、默认服务等级和缓存设置、适用上下文范围、缓存命中及未命中费率、单独核实的输出上界。同时填入私有校准回执的两个摘要。费用与耗时预测覆盖普通对话、Task、维护、观察等待和重启，合计纳入探针。供应商原文有变化时需重新核验。驱动自动重传次数取零，Secretary 自身每次重复发送仍由发送端落账。
