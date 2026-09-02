# VerificationResult

## 1. 定义

`VerificationResult` 是 Verifier 或 Reconciler 按 Action 的 Verification Plan 对外部效果进行独立检查后形成的结构化结论。模型辅助验证只能生成候选内容，最终结论必须由受控 Verifier 结合证据等级确定。

## 2. 字段

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schema_version` | `integer` | 是 | 初始为 `1` |
| `verification_id` | `uuid` | 是 | 验证过程标识 |
| `action_id` | `uuid` | 是 | 被验证 Action |
| `attempt_ids` | `array<uuid>` | 是 | 相关执行尝试 |
| `verification_plan_hash` | `string` | 是 | 实际采用计划的哈希 |
| `method` | `string` | 是 | 验证等级方法 |
| `expected_effect` | `object` | 是 | 规范化预期效果 |
| `observed_effect` | `object` | 是 | 独立回读的结构化结果 |
| `conclusion` | `string` | 是 | `CONFIRMED`、`REJECTED` 或 `INCONCLUSIVE` |
| `evidence_refs` | `array<uuid>` | 是 | 支持结论的证据 |
| `model_decision_id` | `uuid|null` | 是 | 模型辅助时填写 |
| `verifier_id` | `string` | 是 | 受控 Verifier 组件 |
| `verifier_version` | `string` | 是 | Verifier 版本 |
| `observed_at` | `timestamp` | 是 | 独立观察时间 |
| `recorded_at` | `timestamp` | 是 | 结论持久化时间 |
| `trace_id` | `uuid` | 是 | 跨层追踪标识 |
| `integrity` | `object` | 是 | 结论载荷哈希 |

验证方法：`EXTERNAL_RECEIPT`、`INDEPENDENT_READBACK`、`STATE_COMPARISON`、`UI_OBSERVATION`、`MODEL_ASSISTED`。

## 3. 不可变量

1. `CONFIRMED` 必须满足 Verification Plan 的全部成功判据并关联至少一项证据。
2. `MODEL_ASSISTED` 不能单独确认重要外部副作用；需要其他证据或 Master 确认。
3. 执行器自报结果不能作为唯一独立回读来源。
4. 无法确认时使用 `INCONCLUSIVE`，不得为了推进状态而猜测成功或失败。
5. `INCONCLUSIVE` 对应 Action 保持或进入 `RESULT_UNKNOWN`，并触发后续对账或升级处理。
6. Verification Result 创建后不可改写；新证据产生新验证记录和状态事件。

## 4. 持久化映射

现有架构不新增独立 PostgreSQL 表。V1 将 Verification Result 的不可变载荷作为对象保存，并完成以下同事务或可靠事件链：

1. 证据登记到 `ingestion.evidence_index`。
2. `observed_effect` 写为 `ingestion.observation` 的效果观察。
3. 结论摘要和载荷引用写入 `execution.task_event`。
4. Action Service 依据结论更新 Action 状态。

如果实现阶段要求对 Verification Result 进行独立关系查询，再由 Master 决定是否新增 `execution.verification_record` 表；本设计不预先改变现有逻辑表清单。
