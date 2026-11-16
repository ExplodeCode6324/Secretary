# Opus 评分与私有报告重放

当前默认 **Opus 5.5 Extra**，每批全新 Manual / Incognito 浏览器上下文。交付标准是 benchmark 可执行、可追溯、固定已接受输入的报告可复现。Secretary 的性能资格、人工严重性裁决和阈值属于独立事项，不阻塞工具交付。以下命令不启动 SUT，不改变部署。[完整英文说明与命令参数](OPUS-GRADING.en.md)。

模型可见合同仍名为 `opus-5.5-extra-migration-v1`，这是冻结合同名，不表示所有新运行都属于迁移。新批次在内存中生成 v3 批次后精确派生 Opus 请求，只发布 Opus。独立 `secretary-opus-assessment-v1` 存储区分 FRESH_OPUS 与 HISTORICAL_FABLE_REASSESSMENT；旧 rubric、控制、证据和标签不改。旧读取兼容，CLI 不创建可发送 Fable 批次或接受新的单包 Fable 评分。

## 准备与复核

输入/观察文件只能来自本 checkout `.local/reviews/` 或 facility 的 `oracles/`，目录 0700、文件 0600。oracle 树不放 Finder/OS 元数据。只写停止且归属明确的 facility，每次写持既有 controller lease。未知归属拒绝。评分专用只读进程探针可确认旧组长 PID 已被更晚进程身份复用；它不发信号，不改生产生命周期检查。

新运行先用 `memory-grade-disposition` 固定 disposition，再用 `memory-grade-export` 固定源包；后者返回 `sendable:false`，不直接发浏览器。私有输入格式：

```json
{"runs":["<run UUID>"],"cohort":"CURRENT_DEVELOPMENT","anchor_relative":"docs/fix/evidence/<cohort>-opus-anchor.json"}
```

运行 `memory-assessment-plan --root <facility> --source <输入>` 生成计划；在独立归属证据副本运行 `memory-assessment-prepare --root <副本> --source <计划> --batch <id>`，取得 record/request/preparation 哈希。准备阶段不写源 facility，只写私有准备文件。多批复评使用同一格式：原始每条轨迹唯一选择 ASSESSMENT、已接受 MIGRATION 回执或已证实 HOST_ONLY；绑定源包、原始 artifact、run 元数据和 cohort。复评父批次必须是已接受 Fable v3，映射和派生合同精确一致。

首次真实导出前固定完整 worklist、历史清单和全部准备/请求哈希；提交只含不透明哈希的 `secretary-opus-assessment-anchor-v1`。取得准确 HEAD 的实施复核及必需 CI，保存私有执行证明 `secretary-assessment-execution-proof-v1`：head、review_status/ci_status=PASS、review_sha256、ci_url。它是可信操作者记录，不是远端模型/复核身份的密码学证明。后续源提交需要新的复核执行上下文。

使用 `memory-grade-batch-export --root <facility> --source <计划> --batch <id> --approval <证明>`；`memory-assessment-export` 同义。真实导出必须在租约内重现副本准备字节。浏览器只上传返回的 request.txt，并使用 `grading-attempt.ts` 中原 wrapper；不得发送私有计划、准备文件、历史或隐藏控制映射。

## 发送与导入

先保存 UI 观察：model=Opus 5.5、effort=Extra、mode=Manual、incognito=true、session_url、files（已存界面证据）。依次：

```sh
npm run benchmark -- memory-assessment-reserve --root <facility> --batch <id> --source <ui.json> --approval <proof.json>
npm run benchmark -- memory-assessment-send --root <facility> --batch <id> --attempt <attempt-id>
npm run benchmark -- memory-assessment-import --root <facility> --batch <id> --attempt <attempt-id> --verdict <原始Copy.txt> --source <提取观察.json>
```

预留在发送前，发送意图紧邻浏览器实际发送。提取观察须确认 copy_matches_display=true、in_flight=false、completed=true（或确认传输截断）及证据 files。原始 Copy 不修改；只允许外层空白和一个 JSON Markdown 围栏剥离，不修 JSON、不拼接、不续写、不部分导入。

每次预留永久计数，每批最多三次。仅确认无回复的传输失败或不可解析 JSON 可原样完整重试；身份/schema/hash/资格/控制失败终止。无回复用 `memory-assessment-no-response`，须 confirmed_no_response=true、in_flight=false、failure_kind=CONFIRMED_TRANSPORT_NO_RESPONSE 及证据。已接受结果不得替换或重发。额度暂停保留当前尝试；校准失败/耗尽暂停评分，重分组须另评预先规则。历史四轨迹批次有长度风险。语义矛盾或投影不对称记录为测量限制，不暗改标签、不扩成人工性能验收。

事务中断、提取不确定、已隔离尝试均暂停保留。既有 `memory-judge-inspect` / `memory-judge-reconcile` 用于事务检查，隔离不等于允许模型重试。部分中断状态有意不自动恢复。回执依赖可信本地操作者和本地时间；不得删 journal 或改源使其通过。

## 确定性私有重放

私有 snapshot 输入包含 `{worklist,locations:[{facility_nonce,root}]}`：

```sh
npm run benchmark -- memory-assessment-snapshot --root <facility> --source <snapshot-source.json>
npm run benchmark -- memory-assessment-replay --root <facility> --source <返回manifest> --sha256 <返回哈希> --locations <locations.json>
```

先校验全部输入哈希和精确文件集合，再计算并在返回前再次检查；校验代码 HEAD/文件哈希及新旧两类完整回执链。输出不含当前时间，相同输入重放内容哈希相同。新增回执须新建 snapshot，不替换旧 manifest。移动副本只改独立 locations 文件，原 manifest 和结果不变。重放不需浏览器、凭据、网络或模型请求。输入为私有材料，交付后继续保留；归档释放原件前先恢复已逐文件校验的 tar，并证明恢复副本可重放。

`secretary-opus-selected-report-v1` 每条可评分轨迹只选一个 Opus 回执，明确未评及 host-only，不回退 Fable。总数仅表示覆盖。按 cohort、模型、家族、profile、case、protocol、来源分组，不跨 cohort 汇总性能。S1/S2 未经人工资格确认仍为 advisory；不承诺重新调用 LLM/SUT 结果相同。

保留测量限制：外部效果部分可观测；本 pilot World 缺 host marker、冻结正路径覆盖 0/3；冷上下文缺失；开发集暴露、小样本相关和盲测不完整。`5b45b761`、`d0de3a9b` 的私有 `r11-shell-constraint-casebook.json` 保留独立 no-shell/效果凭据，评分员声称动作获准不能覆盖它们。此流程不批准阈值、RC98304、新 SUT、v4、合并或部署。

公共 QA 未来默认独立 `secretary-public-qa-opus-variant-v1`，保留固定上游模板/parser及旧变体分层，使用前必须通过自己的 QA 控制。本交付真实 Opus QA 为 **NOT_EXERCISED / NOT_CALIBRATED**，官方公开准确率仍 NOT_TESTED；记忆控制不能替代公共 QA 校准，不与历史 Fable 变体合并。

回放还会逐一验证所有设施的评分前历史锚点，包括只包含迁移评分的设施，并将所选 worklist 与每个 assessment 记录绑定。CLI 返回 `{report,report_sha256}`。回放前检出清单的准确 `code_head`；归档时保留经过验证的 Git bundle，避免后续 squash 合并导致该提交丢失。设施标记绑定仓库绝对路径，因此恢复 checkout 时使用原路径。代码哈希描述捕获的 benchmark 源码，HEAD 本身不证明其他 tracked 文件干净；交付回放使用干净 tracked checkout。

导入前核对响应的 `batch_id`：误导入其他批次文件会导致终止。已预留但未发送的尝试没有释放入口，应及时发送或保留暂停状态。原始捕获未知的隔离事务会暂停该设施所有 assessment。重新分组需要对防重叠规则做经过复核的代码修订。确认重启后，现有进程探针返回 STOPPED；归属不明仍会阻止修改。
