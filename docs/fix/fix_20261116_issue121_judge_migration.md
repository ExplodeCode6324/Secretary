# #121 — 保留冻结 V3，将六个未发送批次迁移至 Opus

状态：R18 技术方案执行条件 PASS；按 Master 沿用的授权进入实施。本方案是独立版本的评分员迁移，不是 V4 rubric，也不是重标计划。[English](fix_20261116_issue121_judge_migration.en.md)。

仓库 https://github.com/ExplodeCode6324/Secretary ；[issue #121](https://github.com/ExplodeCode6324/Secretary/issues/121)、[草稿 PR #134](https://github.com/ExplodeCode6324/Secretary/pull/134)。核查代码 HEAD：`34c358129a8f3a3e089d8c823170a144f19b0bf5`，分支 `codex/issue121-memory-benchmark-plan`，目标 main。本补充仅对明确未发送的尾部六批替代原 Fable 评分员选择；原中英文 benchmark 计划及 V3 历史在原范围内继续有效。

## 1. 请求、授权与现状

Master 要求从第 10 批恢复，使用新开的 Opus 5.5 会话完成剩余六批及材料最终复核；澄清后明确选择“剩余评分也改 Opus：先做独立版本的评分员迁移复核，保留原 v3 历史”。Master 明确沿用原实施授权，并选择独立复核的评分员迁移来完成剩余六批；当前指令已满足本范围的实施授权步骤，技术方案 PASS 后直接继续，不重复申请相同授权。R15–R17 笼统要求再次确认是 Codex 过度解释，现予更正。真实导出及评分仍须先通过实施复核和 CI。没有合并、部署、关闭 issue、新 SUT 请求/campaign、RC 98304、V4 重标或资格阈值授权。

当前 15 批中 9 批已接受，覆盖 28 条可评分轨迹中的 19 条；原始 30 条与完全排除的 2 条仍保留。已接受各批均 63 个控制通过，全部是候选判断，人工裁决为零。第 10–15 批均 NOT_SENT，轨迹数依次 2、1、1、1、1、3，迁移严格保持该全集、顺序和构成。R13/R14 私有锚点继续约束重试、disposition、人工复核升级及原请求；已接受批次禁止重发。PR 仍 draft/open，旧 HEAD 的绿灯不证明本次迁移实现。

现代码将请求说明、packet.expected_judge、样本/批次校验及 controls 绑定 Fable 5.2 Extra；直接扩大全局白名单会削弱旧身份约束。loadBatch 比较完整原 packet，修改旧 metadata 会破坏历史验证。scoreDevelopment 在回执校准之前按旧 packet 验证，summarizeJudgments 又没有评分员维度；这些路径必须一起处理。

## 2. 冻结来源与新封装

所有原 sealed packet、父批次、私有 mapping/key、请求、响应、回执、拒绝、锚点及已发布分数文件逐字节保留。rubric `secretary-memory-consequences-v3`、sealed payload 版本、证据、断言顺序/允许标签、disposition、63 个控制及 opaque ID、私有预期、批次构成均不变。不重新生成 controls、不打乱样本、不修补原文本、不改语义说明；只改评分员身份并加入显式来源链。

新封装版本为 `secretary-semantic-grade-batch-v3-judge-migration-v1`，唯一策略 `opus-5.5-extra-migration-v1`，不提供任意 provider/model 开关。子批次使用新 UUID/payload hash；每个样本保留原 packet UUID、sealed payload hash 及完整 payload，仅外层 expected_judge 改为 `{provider:"Claude browser",model:"Opus 5.5",effort:"Extra"}`。批次说明仅将两个 Fable 身份字面量改为 Opus，并添加补充 A 固定的中性来源原句，说明同一 V3 语义使用不同评分员。评分请求不含旧分数、复核意见、SUT 身份、私有答案或人工草稿。

子批次绑定父 UUID、父文件 hash、payload hash、private-data hash 及本地迁移清单 hash。私有 mapping/expected 原样复制。清单冻结 facility 归属、六个父 UUID/顺序、packet/run 映射、原哈希、零提交记录及已接受历史哈希清单。私有路径、run 映射、答案和授权记录留本地；公开来源仅含 opaque ID、digest 和版本/策略。另存提交文本及 wrapper 的 hash。

读取子批次时先验证原父批次、当前原 packet、清单成员及所有 hash，再从父数据推导唯一允许的 metadata 变化，比较完整子 payload/mapping/controls，不能泛化为忽略某些字段。拒绝未知版本/策略、语义变化、递归/循环迁移、同父第二子批次、缺文件及映射变化。原父读取与历史回执验证保留既有证据和行为。

## 3. 资格、串行与导入

在现有 owned-domain CLI 新增显式 benchmark 迁移导出命令；要求所属运行已停止、campaign 关闭、root/path/link/权限检查及已复核私有清单。第一次子导出前固定完整六父清单，逐项吻合原未发送队列，保持顺序/构成；发送仍串行。父批次存在任何导入回执或 run verdict（包括校准失败）均不能迁移。操作员核对请求提交账本，不能以“无回执”推断未发送。

普通导出继续拒绝 run 重叠；唯一例外是验证通过的一代父子关系。拒绝其他重叠、第二子、已接受或已发送父、缺未发送声明、清单变化。子批次提交后禁止再向其父导入新响应，但历史回执仍可读取。子导入拒绝重复接受及竞争的父/run 回执；不能把新写入限制套到历史读取。

全部导出、导入及评分复用现有 facility controller 排他 lease，持锁后重查状态，详见补充 B。先暂存全部文件，最后发布持久 commit marker。读取遇到迁移/导入半状态须拒绝；崩溃保留诊断/暂存证据，人工核对后恢复，不能自动覆盖重试。子批次提交后永久占用父/run 集合，本方案禁止手工或自动回退 Fable，包括校准失败后。哈希证明完整性/来源，不能证明浏览器实际模型或人工授权。

评分员策略必须来自验证过的封装。旧 V3 继续只接受原 Fable alias/Extra 拼写；迁移版严格要求批次及每个样本为 Opus 5.5 / Extra，匹配 packet metadata，拒绝混合身份或低 effort。相同策略传至 verdict/controls，不能信任响应自行声明的策略。导入与读取都重算 63 controls 及完整分母；完整但校准失败的回复保留为排除证据后暂停，不重试刷分。直接无校准导入仍禁用。

## 4. 报告与人工复核

先通过验证后的回执链解析 packet/策略，再验证迁移 verdict，不能放松原 packet 身份。judgment history 与所有分组键增加 canonical 评分员、封装/策略版本；原报告字节不改，另发新描述性报告版本，分列 Fable 历史与 Opus 迁移。无可验证身份的旧数据为 UNKNOWN，不根据当前 UI 猜测。可按层报告计数/逐 run 行；28/28 只能表达总覆盖，不能合并通过率/严重度率、声称同一评分员、排名、错误概率、评分员一致性或等效校准。SUT/case 构成与评分员相互混杂；controls 只证明协议校准，不证明评分员等效。

v7 材料/workbook 留作快照，创建 v8 并加入来源列，保留原标签、草稿、人类字段和相同人工维度。保留记忆 20 个可判定行、首次/提醒各 23 个可判定加 7 个 UNRESOLVED-only 来源行及升级规则继续有效。模型不能完成“人工复核”。新争议依已锚定规则记录；强迫矛盾标签、投影不对称或校准失败须暂停。独立效果证据、首次失败继续保留，资格、严重度/G1/G2/容忍度由 Master 决定。

## 5. 验证与执行顺序

1. 新 Opus 5.5 Extra / Manual / Incognito 复核中英文方案；实施复核沿用同一 review 会话。技术方案 PASS 后按 Master 沿用的实施授权继续。
2. 修改既有 grading、grading-batch、grader-controls、score、cli、离线 memory 测试与 benchmark 文档；不改产品 runtime/live 工作负载。保留首次测试失败。
3. 合成 fixture 测试：旧 Fable 接受/旧包 Opus 拒绝；仅有效子链接受 Opus；错误/混合身份或 effort；63 controls 绑定；来源/rubric/controls/mapping/清单/身份篡改；已接受/已发送父和重叠；重复/并发导出导入；被替代父导入；崩溃半状态拒绝；历史回执兼容；评分员分组和 distinct-run 覆盖。原 19 条纯只读验证（补充 D）前后哈希、标签和历史文件必须一致，不调用 SUT。
4. 新准确 HEAD 跑 focused correctness、type/docs、项目完整验证及必需 CI；既有 live 证据复用，新 live 运行 NOT_AUTHORIZED。把 diff/HEAD/证据/限制/清单设计交同一 reviewer，实施复核与检查通过前不评分。
5. 代码/fixture 检查后，先纯推导六批清单/payload，不写真实 facility，提交并推送 opaque 锚点；准确 HEAD 实施复核和 CI 通过后，才在真实 facility 重现锚定 bytes 并导出请求/ready record，检查唯一允许变化、旧历史哈希和服务停止状态。保留原队列，新索引记录父子映射。每次发送前核查 UI，保留截图、时间、URL、请求 hash；UI 仅证明显示模型，没有不可变 provider snapshot。
6. 按 10–15 串行，每批独立新 Opus 5.5 Extra / Manual / Incognito context，只上传公开冻结请求和原 wrapper。首次十分钟、之后五分钟检查；保留 Copy 原文/渲染/截图。最多三次相同完整提交，仅机械传输/格式失败可重试；禁止重试已接受响应、续写、拼接、修 JSON、部分导入、拆批或语义重试。来源/身份拒绝暂停，不得重新提交模型，详见补充 C。暂停时保存状态及原因，不声称完成。
7. 剩余九条接受后验证互斥 19+9 覆盖、旧历史 hash、六子回执链、controls 及人工范围，输出双语 v8/最终清单。材料最终复核送指定 review 会话，与评分隔离；未独立执行不得声称独立验收。交付草稿 PR/HEAD/CI 和 Master 待定项，不宣告 merge-ready、不合并。

fixture 仅在停止、归属验证后按既有 NAS tar.gz 逐文件核验流程归档；真实来源保留供评分/人工核查，不清理混合根、凭据或 agile 数据。

## 复核记录

- R15：CHANGES_REQUIRED，要求明确转换、事务可见性、归档内来源链与响应终止规则；检查英文/源码。
- R16：CHANGES_REQUIRED（少量补充），要求 attempt 绑定、穷尽结果、lease 存活及新文件 marker 覆盖；检查双语一致。
- R17：CHANGES_REQUIRED（一处顺序冲突），要求真实导出后置；前轮问题实质已解决。尝试/fence/记录补充在 R18 处理。各轮均为所供材料检查，未独立执行；尚未实施或迁移评分。

## R16 规范补充 — 处理 R15 B1–B4、R1–R7

本补充属于执行合同，覆盖上文含糊表述。R15 只检查提供的英文方案/源码，没有验证 CI、运行测试、重算哈希或检查中文一致性。R16 提供两种语言完整文本、本处置及缺少的相关源码。尚未实现或迁移评分。

### A. 精确转换与身份

使用 UTF-8 和既有 JavaScript `JSON.stringify` 哈希约定，不排序 key，保留来源对象 key 顺序。子批次磁盘对象按以下顺序构造：

```text
{batch_id, payload_sha256, private_data_sha256, payload, migration}
payload = {version, controls, packets, instructions, provenance}
provenance = {judge_policy}
migration = {version, manifest_file, manifest_sha256, parent_batch_id,
             parent_payload_sha256, parent_file_sha256,
             parent_private_file_sha256, parent_private_data_sha256}
```

payload.version 为 `secretary-semantic-grade-batch-v3-judge-migration-v1`，migration.version 为 `secretary-judge-migration-binding-v1`，judge_policy 为 `opus-5.5-extra-migration-v1`。清单冻结前分配子 UUID。父版本必须精确为 `secretary-semantic-grade-batch-v3`，结构上禁止递归。controls 直接复制父值，绝不重新生成。逐 packet 保留 key 顺序，仅原位替换已有 expected_judge 的值为有序 `{provider:"Claude browser",model:"Opus 5.5",effort:"Extra"}`；其他字段、ID、payload/hash 不变。私有数据原样复制，同时核查原文件 bytes/hash 与 parsed-object hash。子对象要与确定性推导完全一致，拒绝重排或未知字段，不能只比较值。

instructions 中必须恰好出现两次 `judge:{model:"Fable 5.2",effort:"Extra"}`，替换成 `judge:{model:"Opus 5.5",effort:"Extra"}`，再追加以下逐字字符串（含首个空格）：

```text
 This batch preserves the frozen V3 rubric and evidence; its judge is Opus 5.5 Extra under opus-5.5-extra-migration-v1.
```

推导后 UTF-8 sha256 必须为 `6fcf7edf445f6a582dfff1ebdf9b1417172aef27a4f57e97279c03d93638e12d`，不同原说明或哈希均阻断，不能模糊替换。浏览器上传仅为有序 `{batch_id,payload_sha256,payload}`，不上传 private_data_sha256、migration、清单或私有映射/答案；本地验证仍检查这些绑定。外层原 wrapper 另存哈希。

迁移仅接受 `Opus 5.5` / `Extra`，拒绝 `claude-opus-5-5` 和 `extra`。packet provider 必须是 `Claude browser`；响应 judge 仅含 model/effort，不含 provider。这是标识合同，不是实际模型证明。旧 approvedJudge 不变；独立 policy check 在 verdict/batch/control 及 legacy 调用点显式传入，不能默认回退。旧 calibration 输出 key 顺序/值完全不变，因为历史回执比较序列化 controls。

### B. facility 内完整来源链、事务与锁

六父分布在三个 facility。生成完整六批清单，含预分配父子 ID、父哈希、子 payload hash、原清单 digest、提交/拒绝账本清单、授权引用。有序字段为 `{version,cohort_id,entries,history_inventory_sha256,submission_inventory_sha256,authorization_reference}`；每条 entry 有序字段为 `{ordinal,facility_nonce,parent_batch_id,child_batch_id,parent_file_sha256,parent_payload_sha256,parent_private_file_sha256,parent_private_data_sha256,child_payload_sha256,runs,packet_ids,not_sent_attestation}`。未发送声明引用已核对账本并声明零提交，不能从无回执推出。run ID 仅本地保存。归档清单用相对文件名及逻辑 facility nonce，不依赖绝对 review 路径。每个有关 facility 的 `oracles/migrations/<cohort_id>/` 保存相同清单 bytes 及本地支撑清单/声明文件，目录 0700、文件 0600，检查 owner/nlink/no-link；每父有不可变 index entry 绑定父、子、export transaction。子回执只依赖本 facility，不依赖其他 facility 或 `.local/reviews`。

基线包含全部原 oracles/reports 文件及请求/尝试/拒绝账本，不仅成功 V3 文件。通过源 basename/hash 及保留原文把每个拒绝关联到已知提交；无法归属的拒绝阻断 NOT_SENT 声明。归档包括来源清单及本地依赖；测试合成 child archive 恢复后无需原 review 目录仍可验证。实际归档继续遵守已停止/归属核验/NAS 规则。

普通导出、迁移导出、全部导入、评分统一复用 Domains.use 的 controller.lock。lease.py 使用 nonblocking OS flock、已核验的 owned/regular/single-link 文件及子进程管道；有效占用返回 CONTROLLER_BUSY。持有者死亡后 OS 释放锁；留下的路径不是仍持有的“过期锁”，不删除。锁状态不安全或不确定则拒绝，不自动或手工破锁，不另建/嵌套竞争锁。修改入口要求可信 lease context，或把写 helper 封装为外部不可访问；不能直接调用模块绕过，测试用同一入口合同。纯只读校验可用不可变副本。

每次导出/导入事务：

1. 持锁重查归属、停止、关闭、资格、哈希、无第二子/竞争回执、无未协调事务；预分配全部目标文件名。将 prepare journal 和 staged 文件写入 `oracles/.grading-transactions/<transaction_id>/`，暂存名称不匹配既有 batch/verdict 扫描器。任何提升前 journal 已持久记录操作、所有预定相对目标及内容哈希。
2. fsync 文件；只向不存在目标提升。导出顺序为清单/依赖（首次）、私有 batch、child batch、不可变父子 index；导入顺序为 batch receipt、全部逐 run verdict。绝不覆盖证据，fsync 目录；中断保持显式未提交。
3. 最后以排他临时文件、fsync、rename、目录 fsync 发布 `oracles/grading-commit-<transaction_id>.json`。有序字段 `{version,transaction_id,operation,files,parent_child}`；files 列出所有提升的相对文件名/大小/hash，parent_child 含父子/index 绑定，非迁移导入为 null。marker 不含自身 hash；复用现有 durable write，但持锁显式检查不覆盖。
4. loadBatch、重叠扫描、receiptCalibration、评分先检查 journal/marker/files 一致性：pending journal 无有效 marker 或不匹配均拒绝。child 文件/回执即使 journal 被删也必须具备 export/import marker 和本地 index。原历史回执不追补 marker；新 legacy 写入也用 journal，防止半写伪装历史。评分同锁，不能观察活动事务。
5. 崩溃协调是独立的本地修复，不是新模型提交。检查基线及暂存/已提升 hash，把未提交事务保留并隔离到有记录的 reconciliation ID，不改变任何基线文件。失败事务绝不自动提升；不确定则继续阻断。协调成功后可原文件重导，沿用模型 attempt ID/hash，不消耗新模型尝试。已提交 child 永久占用原集合。

首次浏览器评分前，生成并提交全部六个 child，dispatch preflight 将六个 marker 与完整清单核对；保存 ready record（清单 hash、顺序六个 child payload hash、历史清单 hash），在私有 review record 发布这些 digest，且每 facility 保存可归档副本。dispatch 工具遇到缺失/不完整 ready record 拒绝；这是操作前提，不声称能阻止无关手工浏览器操作。本方案禁止任何手工或自动回退。

### C. 响应处理表与终止规则

继承 R13 addendum sha256 `c9bf1ba5c993a551dc344fca1aab01ea739b3d9baf2e9cef042e79d8dee4b299`，R14 reminder escalation sha256 `5e7be7f0202070195688b730b8936c6e82bade5871071f9f35adbcbb6c5aaac2`。子协议收紧原机械重试许可，不新增语义重试。最终清单记录全部尝试、失败导入和复制异常。

| 观察结果 | 处理 |
| --- | --- |
| 本地复制为空/陈旧，或与已完成页面不符 | 重取同一回复，保留异常；不得因复制失败重新问模型。 |
| 无完整回复、确认传输截断，或实际回复为 INVALID_GRADE_SUBMISSION_JSON | 仅在上一回复确定不完整/不可用且无在途响应时，可新 context 逐字重发完整请求；总共最多三次模型提交。保留原文/诊断，不修补/续写；完成状态有歧义则暂停。 |
| parsed 响应身份/effort/hash（含 alias）错误、批次/样本分母错误或重复/缺失 sample ID | 暂停诊断；本方案不允许操作员或自动重发，不以此重新抽取成绩。 |
| 来源/hash/mapping/manifest/资格/保留 metadata/marker/重叠拒绝 | 暂停、不重发；只可在保留原响应下修正提取或经验证的本地实现问题。来源变化需要新复核计划。 |
| 首个完整 parsed 响应通过 batch/sample 身份及分母检查 | 模型提交终止，不论标签、rubric 合法性或校准结果，不能重抽。 |
| 终止响应 rubric schema 错误：tags、prerequisite lock、evidence、human_review、label/severity | 保存拒绝并暂停，不修 JSON、不重试；包括 GRADE_HARD_GATE_TAGS_REQUIRED、GRADE_PREREQUISITE_NOT_MET、GRADE_EVIDENCE_REQUIRED、GRADE_HUMAN_REVIEW_REQUIRED、GRADE_LABEL_SEVERITY_CONFLICT、GRADE_INVALID_VERDICT、GRADE_CONSEQUENCE_REQUIRED。 |
| 完整结构合法但 controls FAIL | 原子保存排除回执 CONTROL_INVALID 后暂停；重标需新计划及授权。 |
| 完整且接受、controls PASS | 最终候选判断，移至下一个冻结 child；人工仍待定。 |
| 三次耗尽、规则强迫矛盾标签、投影不对称、额度/模型不可用 | 暂停并存准确状态，无 fallback、拆批或第四次。 |
| 完整响应后本地写入中断 | 按 B 协调，仅原文件重导，不再次调用模型。 |

在语义校验前检查批次身份及全部样本 ID/数量；导入前保存完整响应，并在语义检查前持久记录终止状态，即使 importer 拒绝也不能撤销终止。校准失败保持 CONTROL_INVALID，不能补造成功分数。

### D. 报告信任、回放与补充验收

canonical `judge_stratum`、`judge_policy`、`grading_envelope_version` 从验证后的 batch/receipt 链推导，不能来自 verdict echo 或未变的 sealed payload version。原有效 Fable alias 归为同一 Fable 层。原 verdict 不增加来源顶层字段，来源在新 score 输出推导。写入前在 response 顶层及每个 sample 拒绝保留字段 精确为 received_at、qualification、source_sha256、source_file_sha256、calibration；必需的自报 judge 字段不是保留字段。Opus 不得走 MISSING calibration 回退。child 来源链缺失/损坏硬失败；UNKNOWN 只用于确实无法确立身份的旧无校准行，不适用于有效 child 或已接受 Fable V3。

真实源 preflight 仅调用纯读 validateVerdicts/validateGradeBatch/receiptCalibration，并检查前后清单，不调用 import 或 scoreDevelopment。会写报告的 score replay 在归属明确的合成/副本 fixture 上执行，不改变原 corpus。真实执行后所有基线文件不得修改/删除；新增仅限已复核 child batch/private/index/manifest/dependency/transaction/marker/receipt/verdict/new-score 模式及新版本私有请求/回复/截图/报告。resume pointer 等可变进度元数据另记，不属于不可变证据。所有旧 controls 序列化结果及 19 条标签均须与历史一致。

补测试：key 顺序；旧 controls 字节一致；未知 alias；child ID 配父 hash 及反向；父迟到响应；注入第二 child；manifest/index/ready 缺失或替换；pending journal 部分文件；删除 journal 后仍缺 marker；并发 CLI export/import/score；进程死亡释放 OS 锁但不删锁文件；不安全锁文件；协调后原文件重导且 attempt 数不变；拒绝无法归属；sample 嵌套保留 metadata；Opus 缺 calibration；全部六批 dispatch readiness；无外部依赖的 archive 恢复验证。这些均为合成 correctness，不是真实模型验收。

R15 处置：采纳并细化 B1–B4、R1–R7。其示例 O_EXCL 过期锁方案由已验证的现有 OS controller lease 替代，不另加锁；“只读回放必须写入”的判断予以限定，纯读验证与生成 score 的回放明确区分。reviewer 源码检查、Codex 核验与 Master 批准仍分别记录。

## R17 澄清 — 处理 R16 N1–N4、R-a–R-h

以下约束补全 B–D；A 的 schema 已原位修订。父 UUID/hash 完全移到本地 migration，公开 provenance 只含 judge_policy。尚未导出 child，不存在修改已冻结子 hash；instruction hash 不变。

- **绑定尝试的提交/导入和终止覆盖（N1/N2）：** 每次发送前，在本 facility 有效 lease 与事务协议内写不可变预留，字段顺序 `{version,attempt_id,child_batch_id,ordinal,request_file,request_sha256,wrapper_sha256,ui_evidence,prepared_at}`。身份本地分配，不由响应提供；UI 引用含本地相对文件名/hash，所需证据复制进 facility 以自包含保存。send-intent、response/outcome 另写不可变记录，不改 reservation。任何 reservation 都永久占 ordinal，即使协调后也不释放；未协调或仍在途时不得新尝试；三次上限数 reservation，不只数成功导入。child import 必须显式 `--attempt <uuid>`，先从记录确定预期 child，检查对象类型、精确 batch UUID/payload hash、样本身份/分母，不能按响应路由。父 echo、未知/畸形 ID、parsed array/null/非对象、hash 错误均归本 child 身份错误，不归父迟到证据。所有新 rejection 记本地确定的 attempt/child ID、source hash、error、outcome class。终止/outcome 文件在锁内写入、不可覆盖、由相同 journal/marker 提交。覆盖区分 NOT_SENT、ATTEMPT_OUTCOME_UNCERTAIN、RETRY_ELIGIBLE、ATTEMPTS_EXHAUSTED_PAUSED、TERMINAL_REJECTED_NOT_COUNTED、CONTROL_INVALID、ADVISORY_PENDING_HUMAN_REVIEW；终止拒绝不能仅显示 ADJUDICATION_PENDING 或仍可重抽，最终清单保留各状态。
- **提取与穷尽决策（N2）：** 先保存 Copy 原始 bytes。唯一规范化为 trim 外层空白；若整个 trimmed 文本恰是一个 fence block，移除一个外层 opening fence（三个反引号或三个反引号加 json，后接换行）及独占最后一行的 closing fence，再 trim。保存规范化 bytes 及转换记录；不删内嵌 fence/prose/comment、不修 JSON。外围 prose 保留为模型原文，因而是 invalid JSON。只有确定已完成且忠实复制的实际 invalid-JSON 回复或确认传输不完整，才可走 C 第 2 行，仍受三次 reservation 上限；提取不确定留第 1 行/暂停。补 GRADE_CONSEQUENCE_REQUIRED 为 rubric-schema 终止拒绝。parsed 非对象和未知/错误 ID 在查源前归第 3 行，不受旧错误名误导。任何未列的 parsed-response 结果暂停、不再问模型；任何 importer error code 本身都不授予重试。
- **lease 存活与跨 facility readiness（N3）：** Python 子进程持 flock；其异常退出就是 Node lease 丢失。lease 向 callback 暴露可信存活断言，子进程异常退出使 context 失效；每次提升、发布 marker 前断言，失败则中止并保留未提交状态。测试中途杀持锁 Python 子进程，不能全程只信首次 LOCKED。原 unsafe-lease 映射 CONTROLLER_BUSY，可保留已测试的 fail-closed code，或捕获脱敏 stderr 区分，不泄露凭据。ready record 逐 facility 构建，每个读写都持该 facility 锁，不嵌套跨 facility 锁；每次发送前再持本地锁验证 child 的 manifest/markers/ready。全集 ready 是非原子快照，必须本地复验。
- **基线成员定义历史豁免（N4）：** 有冻结基线的 facility 中，任何不在基线内的 batch/private/receipt/verdict，无论名字/版本像旧版还是 child，都必须列于有效 marker；删 journal 不能变成历史。每个 child verdict 自身必须在 import marker，不只 receipt。新 attempt/terminality/rejection/provenance 同样遵守事务/marker。读取既核对基线成员也核对旧文件 hash，inventory 自身由外部 anchor digest 绑定。
- **精确名称和上传 bytes（R-a/R-b）：** 派生字段为 judge_stratum，与自报 judge 区分。D 已精确列五个 importer 写入的保留字段；judge 仍是必需输入。公开请求文件为 `judge-migration-request-<child_batch_id>.txt`，bytes 为 UTF-8 `JSON.stringify({batch_id,payload_sha256,payload}, null, 2) + "\n"`，字段按此顺序；payload hash 仍用 compact JSON.stringify(payload)。发送前从 committed child 重算 bytes，对照文件及 reservation hash。统计残余 Fable 文本，如属冻结来源只披露不修改；Codex 六父实际核查仅 expected_judge/instruction 含 Fable，controls 无此标识。
- **持久外部锚点与准确 HEAD（R-c）：** 首次评分前，在现 PR 分支推送含纯 opaque digest 的 commit，文件 `docs/fix/evidence/issue121-judge-migration-anchor.json`，记录 manifest hash、顺序六个 child payload hash、全集基线 inventory hash。不提交私有 mapping/path/response/expected key。GitHub pushed commit SHA 是外部锚点，本地可改记录或临时 Incognito URL 不足；不新增合并授权。此数据 commit 及 exporter 修复必须包含在最终 implementation review、必需本地验证和 CI 的准确 HEAD 内，之后才发送。顺序细化为：代码/fixture 验证→不写真实 facility 的纯推导和 anchor commit→准确 HEAD 实施复核/CI→真实导出重现锚定 bytes→ready record→逐次复验→发送。导出本身不授权发送，最终材料复核覆盖当前 HEAD/锚定结果。
- **归属、回放写入与恢复（R-d/R-e/R-f）：** 每次 child load 核对 entry.facility_nonce 与现有 facility.json；migration 入口缺 facility.json 则拒绝，不能让 Domains.use 新建。基线/归档含 facility.json，restore 测试覆盖丢失/替换。检查 scoreDevelopment 的间接 writer（auditEpisode/scorePublicComponents/scorePublicGrades），观察副本 fixture 回放全部新增文件，真实源生成 score 前确定允许写模式；意外写入阻断。真实源 score 只在第 7 步持锁执行。导出崩溃保留/隔离证据，明确协调并与确定性推导逐字比较后，才能同一预分配 child UUID 重跑相同导出；不重新分配 UUID、不接受变化 bytes，不确定则阻断。这是本地恢复，不是新模型尝试。
- **清单范围和双语一致（R-g/R-h）：** 全集基线按 nonce 枚举所有持有 15 批或原 30 轨迹的 facility，包括全排除行，不限三个迁移 facility。外部请求/尝试/拒绝证据逻辑 namespace 为 review-ledger/，有关来源链/声明依赖保留本地副本。暂存/隔离目录 0700。正文统一 SUT 身份、原父行为、串行发送、禁止全部回退，并将拒绝和纯读校验指向 C/D。R16 按阅读确认 A–D 等价，未独立执行。

补测试：显式 attempt 路由（含父 pair echo）、不可变 attempt/outcome 和上限计数、终止拒绝覆盖、纯 fence 提取与外围 prose、未列 parsed error、lease 子进程死亡、逐 facility ready 复验、删 journal 后无 marker 的新 legacy 名称文件、逐 verdict marker 成员、facility marker 恢复、精确请求序列化和保留字段 allow/deny。采纳全部 R16 意见及上述有据限定；不扩大 SUT 或资格授权。

## R18 最终顺序和细节澄清

采纳 R17 B1。两种语言唯一有效顺序：代码/fixture 验证；不写真实 facility 的清单/payload 纯推导（可在 owned 副本演练完整导出）；提交并推送 opaque anchor；准确 HEAD 实施复核及必需 CI；在该 HEAD 向真实 facility 导出，重现锚定 manifest/child payload 和确定性副本演练文件；全部六批 ready；逐次持锁复验；发送。export transaction 特有 metadata 可按预分配的确定性 fixture 值比较，冻结后不能静默重新生成。任何改变推导 bytes 的修复必须在真实导出前重推导/重锚定/重审。本方案不提供已提交 artifact 修补或重新分配路径，提交后不符则暂停。正文第 4–5 步按此统一顺序理解，真实导出不先于最终实施复核。

每个 reservation 永久计入最多三次，即使后来协调证明未发送也不释放。耗尽状态为 ATTEMPTS_EXHAUSTED_PAUSED，不是 RETRY_ELIGIBLE。fence 规范化只检查 outer whitespace trim 后首尾两行：首行精确为三个反引号，或紧接 json 的三个反引号；末行精确为三个反引号，换行允许 LF 或 CRLF。匹配则仅删首尾两行并 trim body；绝不扫描/计数内部反引号，rationale 中含反引号不改变算法。保留原 bytes/转换证据，这是提取而非修复响应。

采纳 R17 可选建议简化保留字段：仅五个 importer 写入的 metadata 禁止；echo judge_policy、grading_envelope_version、judge_stratum 永远不具权威，可留原证据。scorer 仅从验证来源链显式构造字段，不 spread raw submission 进 report row；用恶意 echo 测试。必需评分员 model/effort 校验不变。

实施关注项明确为：Domains.use 前检查现有 facility.json；测试恢复该文件；测试 lease 子进程死亡，并如实记录最后一次存活断言与文件发布之间残余窗口，不声称数学上原子的锁存活证明。可信本地串行操作者、不覆盖发布与事务验证限制该残余，发现丢锁即中止。没有迁移 child 的 facility 由第 7 步评分前后全基线 hash/成员比较保护，不假装有 child marker。末批三轨迹保持不拆，耗尽按既有明确预案暂停，不推定新拆批授权。原 V3 内容及已接受结果不改。

授权更正是 Codex 根据 Master 实际当前指令作出的适用判断，不请 reviewer 代授：Master 沿用原授权、要求完成六批并明确选择先独立评分员迁移复核，因此技术方案 PASS 后继续实现。新 SUT、阈值、V4、RC98304、合并/部署/关闭仍不在授权内。


## R18 结论与实施检查

浏览器 Opus 5.5 Extra R18 给出技术方案执行条件 PASS，确认双语一致。仅检查所供材料，未独立执行、重算 hash、访问仓库或 CI。实现必须在提升前比较全部确定性暂存导出 bytes/journal hash，列清不含未预分配时间/随机数的比较文件，并在复核等待期后逐 facility 持锁重查冻结的基线/提交文件列表。复核输出和 CI 备注不得写入这些冻结路径。facility marker、丢锁、全集基线、恶意 echo、LF/CRLF fence 测试仍必需。原回复及截图私有保留，方案 PASS 不代表代码或评分已通过。

## R19：提交准确 HEAD 复核前的实现证据

已实现独立批次版本、不可变事务、绑定尝试的响应处理和按评分员分层的计分路径，原 `approvedJudge` 别名保持不变。十一项迁移测试与四十项原记忆测试通过，覆盖同步写入时持锁子进程死亡、双硬链接发布中断及原字节重导入且不增加尝试、六批就绪、身份/数量/语义/校准结果、次数耗尽、脱离原复核目录后的设施内链读取、计分写入观察和恶意来源回显。恢复链测试使用归属明确的目录副本；NAS 压缩归档及读回核验属于另行操作检查，不以单元测试冒充。计分回放仅新增按内容寻址的报告，原有副本文件哈希不变。共享 controller lease 阻止导出/导入/计分并发进入；跨设施浏览器发送顺序仍由串行操作者负责。

只读审计复验了原有十九条已接受收据链，以及八个设施和复核台账的 377 个冻结证据文件。六个确定性子批次已在三个归属明确、停止的证据投影副本中成功导出；真实设施尚未导出子批次，尚无新模型提交。公开锚只含清单/历史及六个载荷摘要。生产导出另要求复核 HEAD 证明中的副本准备日志摘要，并在暂存/发布前精确比较。历史空白剪贴板抓取作为证据保留，仍不允许作为评分输入。五个旧私有复核文件收紧为 0600，字节不变，私有目录保留权限变更回执。

首轮全量检查保留了 `FROZEN_SOURCE_CHANGED` 失败，原因是 Codex 在测试期间修改 benchmark 源码，导致该次源码冻结失效；不将其报告为通过。完整检查与必需 CI 将在随后冻结的实现 HEAD 运行。以上检查不代表部署、人工合格判断或合并授权。

## R20 恢复与历史兼容性修正

R19 实现复核要求修改。三个阻断项及八项相关建议全部采纳。首次发布前，导出器核查未来基线的完整成员列表，以及原父批次和私有文件的真实字节，避免多余 oracle 文件或序列化变化造成已经提交却无法读取的迁移。准备记录可恢复：保留完全相同的既有记录，在各根目录的部署保护与租约下补齐缺失记录，最后重读三个目录中的记录。

经核实隔离的预约若不存在已提交预约、发送意图或已捕获回复，永久占用原次数，但未满三次时允许预约下一次。已提交发送但确认传输失败且没有回复时使用 `memory-judge-no-response`；不可变结果保留 UI 证据与空回复哈希，不伪造回复文本。额度或模型不可用仍须暂停，不属于这种传输重试。无准备日志的中断恢复仅接受已经检查的空目录或已识别准备临时文件，绑定其精确清单哈希并隔离。恢复结果同时报告本次隔离成功和仍未处理的事务 ID，不以另一个待处理事务的错误掩盖已经完成的修改。终局确定后发现重复 verdict/receipt，也必须提交终局拒绝记录。

UI 证据使用独立的自有文件读取器，限制 16 MB，并允许大小写不同的截图扩展名。测试锚点注入不再绕过已复核 HEAD 与干净工作树核验；测试单独注入执行状态读取器。准备记录持续绑定已复核的干净提交；后续源码提交需要新复核的执行上下文，不能暗中改写准备记录。冻结锚点身份保持不变。合成复核 fixture 放在本 issue 的历史证据目录之外。

18 项迁移测试通过，并保留 R20 首次失败：非规范父文件的 fixture 原先先触发已提交文件完整性保护；修正后模拟没有事务标记的历史父批次，准确核验发布前错误。新增检查覆盖迁移前后的旧校准源/状态篡改错误、Fable 规范来源分层、所有者/权限拒绝，以及已提交的迟到父批次拒绝证据。真实已停止运行的副本重放、确定性导出逐字节比较、完整验证、准确 HEAD 的 CI 和 reviewer 通过，仍是正式导出与发送的前提；fixture 通过本身不授予这些条件。
