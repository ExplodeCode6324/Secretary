# 数据流

## 输入与主会话

```mermaid
sequenceDiagram
  participant U as Master UI
  participant H as Host
  participant S as Store
  participant M as Pi 主会话
  U->>H: 输入文本
  H->>S: 原始对象 + Input ACCEPTED + 输入事件
  H-->>U: 持久化后接收确认
  H->>S: 领取 batch + MainPromptSnapshot
  H->>M: 工作记忆 + 未覆盖历史 + 本轮输入
  M->>S: 经 durableStream 保存 Context/ModelCall
  M->>H: 工具调用 / 回复
  H->>S: 工具回执 / Notification / Input HANDLED
  U->>H: poll / presented
  H->>S: Notification SENT
```

`SENT` 表示 UI 展示回报，不是 Master 已理解内容的证明。工具日志和摘要不被作为新的 Master 输入来源。

## 任务与作用

```mermaid
flowchart LR
  A[task_propose] --> B[TaskProposal 对象]
  B --> C[TaskPlan + workspace]
  C --> D[到期与前置条件]
  D --> E[Execution + Dispatch]
  E --> F[Pi 工具或 Program]
  F --> G[Operation WAIT_AUTH]
  G --> H[Master 完整展示后批准]
  H --> I[派发前复核]
  I --> J[作用 + 持久回执]
  J --> K[恢复执行 / submit_result]
  K --> L[TaskResult + Feedback]
  L --> M[反馈转 Input]
  M --> N[主会话查询详情并汇报]
  J --> U[缺少确定回执: RESULT_UNKNOWN]
```

提案的 goal、constraints、acceptance_criteria、materials 和 continuation 形成执行协议。材料标为不可信任务数据。结果的 artifacts 指向已保存对象；workspace 中工作文件仍可变。工具输出不等于独立验收。

## 记忆与知识

Consciousness 整理读取旧事项、原始输入/事件、任务状态和承诺，产生候选摘要；提交前检查版本和输入边界。成功更新覆盖游标，失败保留原记忆及未覆盖原文。

模型/TUI World 提案先持久化 WorldCommand/Operation，批准后进入 Settings 协调器。Master 管理页先保存草稿，一键应用记录明确的 Master 证据；两种入口均在完整摘要和 context 容量检查后执行 PostgreSQL 批次事务。事务写 change_receipt 与 audit_outbox；drain 将数据库事实提交回执桥接到 journal，再标记 outbox 已导出。这是两个持久化域的可恢复桥接，不是跨数据库和文件系统的原子事务。

实现依据：[host.ts](../src/pi_secretary/src/host.ts)、[scheduler.ts](../src/pi_secretary/src/scheduler.ts)、[world.ts](../src/pi_secretary/src/world.ts)。

## 已完成任务的接续

Master 补充要求 → Host 发现/查询原 Task → task_propose(reuse_task_id, parent_execution_id) → Scheduler 校验最新 parent、执行空闲、资料和 workspace → 固定有效提案 → 同一 journal 提交回执、pending_requests 与 parent 保护 → tick 原子消费并创建带 proposal_ref 的新 Execution → 现有授权与执行流程 → 保存新结果和不可变产物 → 释放 parent 保护并反馈。

重复请求先重放回执，不能因已受理后任务繁忙而拒绝原请求。普通结果解释由主会话直接处理；新独立交付创建新 Task，parent-only 仍是新任务引用旧材料。
