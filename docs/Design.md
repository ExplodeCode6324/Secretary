# Secretary 持续认知与执行架构设计（Design2）

> 状态：初步设计，随验证结果持续调整  
> 核心目标：让 Secretary 在有限上下文内持续感知、持续思考、持续执行，并保证每次行动都能被持久化、验证和追溯。

---

# 1. 背景

当前 Agent 普遍通过以下信息组装一次模型调用的上下文：

```text
context = memory + knowledge + artifact + state
```

并且通常需要人类输入触发一个新的 Session（会话），才能重新组装上下文并产生行为。

Secretary 设想为一种持续存在的 Agent：它能够 24 小时接收外界信息，依靠动态组装的上下文产生即时反应，并通过外部持久状态维持长期任务、身份与认知连续性，而不是依赖一条无限增长的会话历史。

Secretary 对 Master 的交互在外部表现为“单一、连续的会话”；但在内部，LLM 调用仍然是离散、短暂、可重放的。真正持续存在的是数据库中的世界状态、任务状态、执行记录与证据。

---

# 2. 术语

- **Secretary**：一个持续存在的 Agent 实例，由外部持久状态维持身份和连续性；LLM 调用本身是离散、短暂且可重放的。
- **Master**：Secretary 的唯一用户与最终授权人。
- **Source Event（源事件）**：外部渠道产生的一次原始事件，例如一条邮件通知、一次心率采样或一次文件变更。
- **Observation（观察记录）**：经统一格式化后，对“何时、何地、由谁、发生了什么”的可追溯描述。
- **Derived Feature（派生特征）**：由程序或模型从观察数据中计算、提取出的高信息密度特征。
- **Live World State（实时世界状态）**：系统当前认为此刻成立的状态，例如 Master 的位置、活动、设备状态和当前项目。
- **Long-term World Model（长期世界模型）**：系统对稳定事实、长期偏好、人物关系、资源和项目背景的持续认知。
- **Consciousness State / Attention State（当前意识状态）**：从实时状态、长期认知、当前目标和近期变化中筛选出的“此刻值得模型持续知道的信息”。
- **Decision Context（即时决策上下文）**：为一次快速判断、即时回复或任务创建而组装的单次调用上下文。
- **Task Working Context（任务工作上下文）**：为推进某个长期任务的当前步骤而按需重建的上下文，不承载完整任务历史。
- **Decision Envelope（决策封套）**：一次模型调用的结构化输出，包含面向 Master 的回复草稿，以及任务或动作提案。
- **Task Runtime（持久任务运行时）**：负责保存、调度、恢复和推进长期任务的系统，不依赖模型上下文本身维持任务连续性。
- **Task Projection（任务投影）**：由完整任务状态压缩得到的摘要，用于进入 Open Loops 和当前意识状态。
- **Action Proposal（动作提案）**：LLM 对下一步动作的结构化建议，尚未获得执行权。
- **Action Command（原子动作指令）**：经格式、权限、风险和状态校验后，由系统正式交给执行器的最小可执行命令。
- **Evidence（证据）**：证明某次执行尝试或外部效果真实发生的日志、回执、对象哈希、截图、消息 ID、Commit SHA 等记录。
- **Projection（状态投影）**：把已验证的事件和任务状态转换为实时状态、长期认知或当前意识摘要的过程。
- **Response Release Gate（回复释放门）**：根据任务提交、授权或效果确认等真实状态，决定回复草稿何时可以发送给 Master。

---

# 3. 设想

## 3.1 Secretary 接管的信息

1. 个人生命体征，例如心率、血压、体温。
2. 个人活动信息，例如定位、环境声音、环境图像和设备活动。
3. 个人社交关系，例如微信等社交软件中的关系与通信记录。
4. 个人数字化智力资产，例如笔记、文档、学习记录和代码仓库。
5. 部分个人资产，例如银行账户、投资组合和数字货币钱包。
6. 个人公开联系方式，例如邮箱。

## 3.2 Secretary 自己拥有的资源

1. 相对于 Master 独立的公开沟通渠道，例如独立邮箱。
2. 相对于 Master 独立的资产账户，例如银行、投资或数字货币账户。

> 独立账户不代表 Secretary 获得无限自主权。账户权限、操作范围、资金限额和对外身份表达仍应由明确的授权策略控制。

---

# 4. 预期功能

1. 24 小时监控 Master 的生命体征，并与个人活动信息联合处理；在异常时发出提醒或警报，并定期提供健康建议。
2. 动态识别 Master 的活动状态，在不同场合使用不同的交互方式和工作策略。
3. 建模 Master 的社交关系网，通过 ADB 或其他技术手段监控社交软件，获取新消息并提醒 Master；在获得授权后，接管部分发送和回复功能。
4. 以单一连续会话的形式服务 Master，同时在内部通过离散模型调用与持久状态维持连续性。
5. 接受需要数分钟、数小时甚至更长时间的任务，在模型上下文被重建、进程重启或外部条件暂时不满足时仍能继续推进。
6. 对执行行为保留完整的任务状态、动作记录、外部回执和验证证据，避免把“模型认为已经完成”当成“现实中已经完成”。

---

# 5. 核心设计原则

## 5.1 感知数据逐层压缩

数据处理遵循以下方向：

- 数据量逐层变小。
- 信息密度逐层提高。
- 更新时间逐层减缓。
- 语义程度逐层提高。
- 每一层都能追溯到下层证据。

示例：

```text
原始心率：88, 89, 91, 94, 93, 95, 92, 91...
    ↓
Derived Feature（派生特征）：
过去 30 分钟平均心率 92；相对于办公状态基线 +16%；持续 28 分钟
    ↓
Live World State（实时世界状态）：
生理唤醒水平略高于当前活动基线
    ↓
Consciousness State（当前意识状态）：
Master 当前在办公室进行持续桌面工作，身体状态总体正常，但近期生理唤醒略高
```

完整认知链路为：

```text
Raw Signal（原始信号）
    ↓
Source Event（源事件）
    ↓
Observation（发生了什么）
    ↓
Derived Feature（数据意味着什么）
    ↓
Live World State（当前状态是什么）
    ↓
Long-term World Model（长期认知是什么）
    ↓
Consciousness State（现在值得注意什么）
    ↓
Decision Context（本轮判断需要知道什么）
```

## 5.2 持久状态负责连续性，LLM 负责阶段性判断

LLM 不负责永久记住任务和世界状态。以下内容必须保存在模型上下文之外：

- 当前目标与未闭环事项。
- 长期任务及其成功条件。
- 已完成和待执行步骤。
- 执行尝试、重试次数和错误类型。
- 正在等待的时间、事件或 Master 授权。
- 对外部世界产生的效果及其验证证据。
- Secretary 已向 Master 作出的承诺。

模型每次只读取完成当前判断所需的有限切片，并输出结构化决策。

## 5.3 即时反应与长期任务上下文分离

现有 Context Builder（上下文构建器）只负责构造即时决策上下文，用于快速反应、回复 Master、决定是否创建任务或处理重要状态变化。

长期任务由独立的 Task Context Builder（任务上下文构建器）根据任务持久状态重建工作上下文。完整执行日志不会进入即时反应上下文，也不会被长期保留在单一模型会话中。

```text
即时反应：
Consciousness State + 当前触发事件
    ↓
Reaction Context Builder（即时反应上下文构建器）
    ↓
Decision Context（即时决策上下文）
    ↓
Decision LLM（即时决策调用）

长期任务：
Task State + Latest Results + Relevant World State
    ↓
Task Context Builder（任务上下文构建器）
    ↓
Task Working Context（任务工作上下文）
    ↓
Task-Step LLM（任务步骤决策调用）
```

这两个 Builder 是逻辑角色，V1 可以由同一个服务以不同模式实现，不需要为此部署两个模型或构建多 Agent 系统。

## 5.4 LLM 只能提出任务和动作，不能直接宣告现实状态

模型输出的结构化内容首先是 Task Proposal（任务提案）或 Action Proposal（动作提案）。只有经过以下检查后，系统才能生成真正的 Action Command：

1. Schema Validation（结构校验）：字段、类型和参数是否符合工具协议。
2. Policy Validation（策略校验）：是否符合权限、风险和账户范围。
3. State Validation（状态校验）：任务版本、资源版本和前置条件是否仍然成立。
4. Approval Validation（授权校验）：高风险行为是否已经获得 Master 授权。

LLM、普通 Worker 和 Executor 都不能直接把自己的判断写成已确认的 Live World State 或 Long-term World Model。

## 5.5 行动结果必须重新进入观察链路

执行器返回成功，只能证明“执行器完成了一次尝试”，不能自动证明外部世界已经达到预期结果。

每次行动都必须经历：

```text
Action Intent（准备做什么）
    ↓
Action Attempt（实际尝试了什么）
    ↓
Effect Observation（外部世界发生了什么）
    ↓
Verification（结果是否符合预期）
    ↓
State Projection（系统最终承认什么状态）
```

已验证的执行效果应重新写成 Observation，回流到原有的状态估计和世界模型链路，从而形成真正的闭环：

```text
Observe（观察）
  → Understand（理解）
  → Decide（决策）
  → Act（行动）
  → Observe Effect（观察结果）
  → Verify（验证）
  → Update State（更新状态）
```

---

# 6. 逻辑架构

## 6.1 感知、认知与意识链路

```text
┌──────────────────────── External Sources（外部数据源） ────────────────────────┐
│                                                                                │
│ SmartBand / Watch   GPS   PC状态   Calendar   Email   GitHub   Chat   Camera   │
└──────────┬───────────┬─────┬─────────┬──────────┬───────┬──────┬───────┬────────┘
           └───────────┴─────┴─────────┴──────────┴───────┴──────┴───────┘
                                         │
                                         ▼
                         Ingress / Normalization
                 （统一接入与规范化：格式、来源、时间、身份）
                                         │
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ Temporal Observation Layer（时间观察层：记录何时发生了什么）                  │
│                                                                               │
│ event_time / ingest_time / source / subject / type / value / evidence_ref    │
└───────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                                        ▼
                 Domain Processing Layer
         （领域数据处理层：把原始数据转换为可理解特征）

    Health Processor（生命体征处理）
    Location Processor（位置处理）
    Activity Processor（活动状态处理）
    Project Processor（项目状态处理）
    Communication Processor（通信内容处理）
                                        │
                                        ▼
                       Derived Features（派生特征）
                                        │
                                        ▼
                       State Estimation（状态估计）
                                        │
                     ┌──────────────────┴──────────────────┐
                     │                                     │
                     ▼                                     ▼
┌───────────────────────────────┐        ┌────────────────────────────────┐
│ Live World State              │        │ Long-term World Model          │
│ （实时世界状态）              │        │ （长期世界模型）               │
│                               │        │                                │
│ Master 在哪里                 │        │ Master 长期偏好                │
│ 正在做什么                    │        │ 人物与组织关系                 │
│ 当前身体状态                  │        │ 项目长期状态                   │
│ 当前设备状态                  │        │ 资源与资产                     │
│ 当前活动项目                  │        │ 稳定事实、规律和关系           │
└──────────────┬────────────────┘        └────────────────┬───────────────┘
               │                                          │
               └─────────────────────┬────────────────────┘
                                     ▼
                 Salience / Cognitive Admission
              （显著性与认知准入：判断哪些变化值得注意）
                                     │
                                     ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ Consciousness State / Attention State（当前意识状态）                         │
│                                                                               │
│ = Relevant Live World State（相关实时状态）                                   │
│ + Relevant Long-term World Model（相关长期认知）                              │
│ + Active Goals（当前目标）                                                    │
│ + Open Loops / Task Projections（未闭环事项 / 任务投影）                      │
│ + Recent Significant Changes（近期重要变化）                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 6.2 即时决策、任务执行与反馈闭环

```text
                         Trigger（触发事件）
              Master 输入 / 显著状态变化 / 任务重要事件
                                  │
                                  ▼
                     Consciousness State
                         （当前意识状态）
                                  │
                                  ▼
                 Reaction Context Builder
                 （即时反应上下文构建器）
                                  │
                                  ▼
                       Decision Context
                       （即时决策上下文）
                                  │
                                  ▼
                         Decision LLM
                                  │
                                  ▼
                       Decision Envelope
                         （决策封套）
                  ┌───────────────┴────────────────┐
                  │                                │
                  ▼                                ▼
          Reply Draft                      Task / Action Proposal
          （回复草稿）                     （任务 / 动作提案）
                  │                                │
                  │                                ▼
                  │                       Schema / Policy Gate
                  │                       （格式、权限与风险校验）
                  │                                │
                  │                                ▼
                  │                          Task Service
                  │                       （任务持久化服务）
                  │                                │
                  │                   ┌────────────┴────────────┐
                  │                   ▼                         ▼
                  │              Task Store                 Outbox / Queue
                  │             （任务状态库）              （可靠事件投递）
                  │                   │                         │
                  │                   └────────────┬────────────┘
                  │                                ▼
                  │                       Task Orchestrator
                  │                       （任务编排与唤醒）
                  │                                │
                  │                                ▼
                  │                      Task Context Builder
                  │                       （任务上下文构建器）
                  │                                │
                  │                                ▼
                  │                      Task Working Context
                  │                        （任务工作上下文）
                  │                                │
                  │                                ▼
                  │                         Task-Step LLM
                  │                                │
                  │                                ▼
                  │                        Action Proposal
                  │                          （动作提案）
                  │                                │
                  │                                ▼
                  │                       Schema / Policy Gate
                  │                                │
                  │                                ▼
                  │                         Action Command
                  │                         （原子动作指令）
                  │                                │
                  │                                ▼
                  │                    Worker / Executor Adapter
                  │                    （工作进程 / 执行器适配器）
                  │                                │
                  │                                ▼
                  │                    Action Result + Evidence
                  │                       （执行结果与证据）
                  │                                │
                  │                                ▼
                  │                     Verifier / Reconciler
                  │                       （验证器 / 对账器）
                  │                         ┌──────┴──────┐
                  │                         │             │
                  │                         ▼             ▼
                  │                Task State Update   Effect Observation
                  │                  （任务状态更新）   （外部效果观察）
                  │                         │             │
                  │                         ▼             │
                  │                  Task Projection      │
                  │                  （任务摘要投影）      │
                  │                         │             │
                  │                         └──────┬──────┘
                  │                                ▼
                  │                 Temporal Observation Layer
                  │                                │
                  │                                ▼
                  │              State Estimation / World Model Update
                  │                                │
                  └──── 回复释放条件满足后 ─────────┴──→ Response Dispatcher
                                                   （回复分发器）
```

说明：

1. `Reply Draft` 只是候选回复。Response Release Gate 根据 `task_committed`、`approval_granted`、`effect_confirmed` 等真实状态判断是否允许发送；系统只有在相应条件成立后，才能向 Master 释放“任务已接受”“邮件已发送”“任务已完成”等表述。
2. 长期任务的每一步都从任务库和最新世界状态重建上下文；任务中间日志不会持续堆入即时决策上下文。
3. 任务状态变化只有达到显著性阈值时才触发对 Master 的进度汇报，避免每个内部步骤都打扰 Master。
4. `Effect Observation` 回到时间观察层后，与其他外部数据使用同一套状态估计和世界模型更新逻辑。

---

# 7. 上下文与模型调用类型

| 调用类型 | 中文说明 | 触发条件 | 主要输入 | 主要输出 | 生命周期 |
|---|---|---|---|---|---|
| Decision Invocation | 即时决策调用 | Master 输入、显著状态变化、任务重要事件 | 当前触发事件、Consciousness State、相关事实和任务投影 | 回复草稿、创建或更新任务的提案、授权请求 | 单次调用 |
| Task-Step Invocation | 任务步骤调用 | 新任务入队、前一步完成、定时唤醒、外部条件满足 | Task State、成功条件、最新结果、相关世界状态、必要产物 | 下一步动作提案、任务重规划、等待条件或结束判断 | 每一步重建 |
| Verification Invocation | 辅助验证调用 | 结果无法完全由确定性程序判断时 | 预期效果、执行证据、独立读取结果 | 候选验证结论和理由 | 单次调用；不能单独成为权威证据 |

上下文边界：

- `Decision Context` 只回答“此刻该如何响应或是否创建任务”。
- `Task Working Context` 只回答“当前任务下一步该做什么”。
- 完整执行日志、原始文件和历史证据通过引用按需加载，不直接展开到上下文中。
- 当前意识层只保留 Task Projection，例如任务状态、进度、阻塞、下一次唤醒条件和最近重要变化。

任务投影示例：

```text
任务 T-104：审查 ScentRise 仓库
状态：RUNNING（执行中）
当前阶段：运行测试并复核鉴权逻辑
进度摘要：代码结构分析已完成
阻塞：缺少生产环境数据库配置
最近重要变化：发现一个高风险鉴权问题
下一次唤醒：测试任务结束或 Master 补充配置
```

---

# 8. Decision Envelope（决策封套）

模型每次调用应返回一个统一的结构化封套。下面是示意结构，不代表最终字段已经冻结：

```json
{
  "decision_id": "dec-20260902-0001",
  "response": {
    "draft": "任务已经登记，我会先检查仓库结构和现有测试。",
    "release_condition": "task_committed"
  },
  "decision": {
    "type": "create_task",
    "request_key": "req-20260902-0001",
    "task_proposal": {
      "goal": "审查目标仓库并形成完整报告",
      "success_criteria": [
        "完成前端视觉问题审查",
        "完成后端逻辑问题审查",
        "识别历史修复导致的高耦合代码",
        "所有结论附带文件或测试证据"
      ],
      "constraints": [
        "当前阶段不修改代码",
        "无法验证的结论必须标记为不确定"
      ],
      "priority": "normal",
      "risk_class": "READ_ONLY"
    }
  }
}
```

推荐的 `decision.type` 初始集合：

- `respond_only`：仅回复，不创建任务。
- `create_task`：创建持久任务。
- `continue_task`：对现有任务提出下一步处理意见。
- `request_approval`：请求 Master 授权。
- `pause_task`：建议暂停任务并记录原因。
- `cancel_task`：建议取消任务；最终取消由 Task Service 根据权限执行。

约束：

1. 自然语言回复不是机器状态的权威来源，结构化字段才是系统处理依据。
2. 结构化提案也不是现实状态的权威来源，必须经系统校验、执行和验证。
3. 回复文本必须与已提交状态一致；若任务写库失败，不能向 Master 表示“任务已开始”。
4. 对“已发送、已删除、已支付、已修改、已完成”等完成性表述，`release_condition` 必须依赖已确认的外部效果。
5. 同一 `request_key` 重复提交时，Task Service 必须返回同一任务或明确的去重结果。

---

# 9. Task Runtime（持久任务运行时）

## 9.1 组件职责

| 组件 | 中文职责 | 不承担的职责 |
|---|---|---|
| Task Service | 创建和更新任务，维护任务版本与状态机 | 不自行决定复杂任务下一步 |
| Task Orchestrator | 根据任务状态、依赖、时间和外部事件决定何时推进任务 | 不直接执行外部副作用 |
| Scheduler / Trigger | 定时唤醒、事件唤醒和超时处理 | 不判断任务是否成功 |
| Task Context Builder | 为当前任务步骤加载最小必要上下文 | 不保存完整任务历史 |
| Worker / Executor Adapter | 调用具体工具、API、ADB、Shell 或应用适配器 | 不直接修改世界模型 |
| Verifier | 检查外部效果是否达到预期 | 不以执行器自报成功代替验证 |
| Reconciler | 对账数据库状态和外部真实状态，处理不一致与结果未知 | 不隐藏不确定状态 |
| Task Projector | 把完整任务状态压缩成 Open Loop / Consciousness 摘要 | 不成为任务权威存储 |
| Response Release Gate | 检查回复所依赖的任务、授权或效果状态是否已经成立 | 不生成自然语言内容 |
| Response Dispatcher | 根据释放结果和通知策略向 Master 发送回复 | 不提前释放未成立的完成性表述 |

## 9.2 任务状态机

推荐的初始任务状态：

```text
CREATED             已创建
READY               可执行
RUNNING             执行中
WAITING_EXTERNAL    等待外部事件或时间
WAITING_APPROVAL    等待 Master 授权
BLOCKED             因不可自动解决的问题阻塞
COMPLETED           成功条件已验证
FAILED              已确定无法完成
CANCELLED           已取消
```

基本状态流转：

```text
CREATED → READY → RUNNING
                    ├→ WAITING_EXTERNAL → READY
                    ├→ WAITING_APPROVAL → READY
                    ├→ BLOCKED → READY / FAILED / CANCELLED
                    ├→ COMPLETED
                    └→ FAILED
```

只有任务的全部成功条件都得到满足和验证后，才能进入 `COMPLETED`。

## 9.3 动作状态机

推荐把“执行器运行成功”和“外部效果确认成功”分开：

```text
PENDING                 待执行
DISPATCHED              已下发
RUNNING                 执行中
EXECUTION_SUCCEEDED     执行器报告成功
EXECUTION_FAILED        执行器报告失败
RESULT_UNKNOWN          结果未知，可能已经产生副作用
VERIFYING               正在验证外部效果
EFFECT_CONFIRMED        外部效果已确认
EFFECT_REJECTED         外部效果与预期不符
CANCELLED               动作已取消
```

典型流转：

```text
PENDING → DISPATCHED → RUNNING
                         ├→ EXECUTION_FAILED
                         ├→ RESULT_UNKNOWN → VERIFYING
                         └→ EXECUTION_SUCCEEDED → VERIFYING
                                                  ├→ EFFECT_CONFIRMED
                                                  └→ EFFECT_REJECTED
```

`RESULT_UNKNOWN` 是必须保留的一级状态。网络超时、执行器崩溃或外部接口响应丢失时，系统不能简单地认定失败并重试，否则可能造成重复邮件、重复订单或重复资金操作。

---

# 10. 执行结果与准确回库

## 10.1 四层记录模型

| 层级 | 记录内容 | 示例：发送邮件 |
|---|---|---|
| Action Intent | 系统计划做什么 | 向指定收件人发送某主题邮件 |
| Action Attempt | 执行器实际尝试了什么 | Gmail API 请求参数、时间、返回码 |
| Effect Observation | 从外部系统重新观察到了什么 | Sent 中存在指定 message_id，收件人和正文哈希一致 |
| State Projection | 系统最终承认什么事实 | 邮件已确认发送，任务步骤完成 |

## 10.2 权威写入者

| 数据 | 权威写入者 | 禁止直接写入者 |
|---|---|---|
| Task 当前状态 | Task Service | LLM、普通 Worker、Task Projector |
| Action Attempt | Executor Result Handler | LLM |
| Effect Observation | Verifier / Observation Adapter | LLM、普通任务编排器 |
| Live World State | State Estimation | Executor、LLM |
| Long-term World Model | World Model Updater | Executor、普通 Worker、LLM |
| Open Loop / Task Projection | Task Projector | LLM 任意覆盖 |
| 原始证据与外部回执 | Executor / Sensor Adapter | 模型生成文本 |
| 对 Master 的消息发送状态 | Response Dispatcher | Reply Draft 生成模型 |

核心约束：

> LLM 可以提出“世界可能发生了什么”，但不能直接把这个判断写成系统已经承认的事实。

## 10.3 验证等级

建议按可靠性从高到低使用以下验证方式：

1. **External Receipt Verification（外部回执验证）**：使用消息 ID、订单号、交易哈希、Commit SHA 等外部唯一标识复核。
2. **Independent Read-back（独立回读验证）**：通过独立读取接口确认目标对象的最终状态。
3. **State Comparison（状态对比验证）**：比较执行前后快照、版本号、哈希或关键字段。
4. **UI Observation（界面观察验证）**：通过截图或 UI 状态确认；可靠性低于正式 API 回执。
5. **Model-assisted Verification（模型辅助验证）**：模型理解截图、文本或复杂结果；只能形成候选结论，重要操作仍需其他证据或 Master 确认。

---

# 11. 可靠性、安全与权限机制

## 11.1 Idempotency Key（幂等键：防止重复副作用）

每个 Action Command 应至少包含：

```text
action_id
attempt_id
idempotency_key
```

相同幂等键的重复请求必须被执行器或外部适配器识别。对于不支持幂等键的外部系统，应先通过业务唯一标识查询，再决定是否重试。

## 11.2 Preconditions（前置条件：防止基于过期状态执行）

动作执行前必须校验关键资源状态，例如：

```json
{
  "type": "resource_version_equals",
  "resource": "file-123",
  "expected_version": 12
}
```

前置条件不成立时，系统应停止动作、重新读取状态、重建任务上下文并再次决策，而不是继续使用旧上下文覆盖新状态。

## 11.3 Transactional Outbox（事务发件箱：保证落库与投递一致）

创建或更新任务时，在同一数据库事务中写入：

```text
execution_task
execution_event
execution_outbox
```

事务提交后，由 Dispatcher 可靠投递 Outbox 中的事件。这样可以避免“数据库显示任务已创建，但 Worker 从未收到任务”的状态分裂。

## 11.4 Lease / Heartbeat（租约与心跳：恢复中断任务）

Worker 获取任务或动作时应持有带有效期的租约，并定期发送心跳。租约过期后，Orchestrator 才能把任务重新分配给其他 Worker。

对可能产生副作用的动作，租约过期不能直接等同于安全重试；必须先进入 `RESULT_UNKNOWN` 并执行对账。

## 11.5 Retry Classification（重试分类）

错误至少分为：

- `TRANSIENT`：临时网络错误、限流，可退避重试。
- `PERMANENT`：参数错误、权限拒绝，不应自动重试。
- `AMBIGUOUS`：请求可能已执行但响应丢失，必须先验证外部效果。
- `POLICY_BLOCKED`：策略或授权不允许，等待 Master 或策略变化。

## 11.6 Approval Gate（授权门）

动作风险等级建议至少包括：

| 风险等级 | 中文说明 | 默认策略 |
|---|---|---|
| READ_ONLY | 只读操作 | 可自动执行，仍需审计 |
| REVERSIBLE | 可可靠撤销的写操作 | 可按资源范围预授权 |
| EXTERNAL_WRITE | 对外写入或发送 | 默认需要明确授权或白名单 |
| DESTRUCTIVE | 删除、覆盖等高破坏性操作 | 每次确认或严格策略授权 |
| FINANCIAL | 涉及资金、投资、钱包 | 限额、双重确认和独立对账 |
| IDENTITY | 代表 Master 对外表态或签署 | 必须限制对象、内容和身份范围 |

授权记录至少包含：

- Master 身份与授权时间。
- 授权的账户、资源、对象和操作类型。
- 金额、次数或时间范围。
- 是否允许子任务继承。
- 到期时间和撤销状态。

## 11.7 Secret Isolation（密钥隔离）

API Key、登录令牌、钱包私钥和长期凭据不应进入 LLM 上下文或普通任务数据库。执行器只接收最小权限、短时有效的凭据句柄。

## 11.8 Auditability（可审计性）

任何产生外部副作用的操作都应能够回答：

- 是哪个 Master 请求或系统事件触发的？
- 哪次模型决策提出了该动作？
- 哪条策略和授权允许了该动作？
- 哪个 Worker 在何时执行？
- 使用了什么参数和资源版本？
- 外部系统返回了什么？
- 系统如何验证最终效果？
- 哪次状态投影将其认定为完成？

---

# 12. 预期物理架构

## 12.1 总体原则

- 高频数值数据进入 Time-series DB（时序数据库）；V1 可先使用 PostgreSQL 的时序扩展或同实例部署，数据量证明确有必要后再独立拆库。
- 结构化认知、任务和权威状态进入 PostgreSQL。
- 大型原始内容、产物和证据进入 Object Storage（对象存储）。
- Vector / Search（向量与全文检索）仅作为派生索引，不作为权威状态来源。
- 消息队列只负责传输和唤醒，任务权威状态仍保存在 PostgreSQL。
- V1 优先使用单体部署与单 PostgreSQL，只有验证吞吐瓶颈后再拆分分布式组件。

## 12.2 物理组件图

```text
                              Secretary Runtime

 External Sources
       │
       ▼
 Ingress Adapters ───────────────→ Object Storage
       │                           （原始 payload / 文件 / 截图 / 音视频）
       ▼
 Observation / Processor Services
       │
       ├───────────────────────→ Time-series DB
       │                         （心率 / HRV / GPS / 设备指标 / 高频采样）
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL / Core DB（权威关系数据库）                                       │
│                                                                              │
│ ingestion schema（接入与观察域）                                             │
│ cognition schema（认知与世界状态域）                                         │
│ execution schema（任务与执行域）                                             │
│ interaction schema（会话与回复域）                                           │
│ outbox schema（可靠事件投递域）                                               │
└───────────────┬──────────────────────┬──────────────────────┬────────────────┘
                │                      │                      │
                ▼                      ▼                      ▼
       Task Orchestrator       Context Builders      Outbox Dispatcher
                │                                             │
                └──────────────────────┬──────────────────────┘
                                       ▼
                              Worker Queue / Scheduler
                                       │
                                       ▼
                              Executor Adapters
                       （Email / GitHub / ADB / File / Browser）
                                       │
                                       ▼
                              External Systems
                                       │
                                       ▼
                         Verifier / Reconciler
                                       │
                                       └────→ Observation Layer

 Optional Derived Indexes:
 PostgreSQL FTS / pgvector / External Search Engine

 Separate Security Boundary:
 Secret Store / Credential Broker（密钥存储与最小权限凭据代理）
```

## 12.3 PostgreSQL 逻辑分域

### ingestion schema（接入与观察域）

| 表 | 作用 |
|---|---|
| `source_event` | 保存源事件 envelope、来源、接入时间和去重键 |
| `observation` | 统一观察记录与 `evidence_ref` |
| `derived_feature` | 派生特征、计算方法和有效时间范围 |
| `evidence_index` | 外部回执和对象存储证据的索引 |
| `processor_checkpoint` | Processor 消费位置、版本和运行状态 |

### cognition schema（认知与世界状态域）

| 表 | 作用 |
|---|---|
| `entity` | 人、组织、设备、项目、账户等实体 |
| `assertion` | 带来源、置信度、有效期和证据的候选事实 |
| `live_world_state` | 当前有效状态及版本 |
| `world_model_fact` | 稳定事实、关系、偏好和长期规律 |
| `goal` | 当前和长期目标 |
| `open_loop` | 未闭环事项；主要由任务投影生成 |
| `episodic_memory` | 重要事件和阶段性经历摘要 |
| `consciousness_snapshot` | 特定时刻的意识状态快照，用于调试与重放 |

### execution schema（任务与执行域）

| 表 | 作用 |
|---|---|
| `task` | 任务主体、目标、成功条件、约束、风险等级和当前状态 |
| `task_step` | 当前步骤、依赖、输入、输出和步骤状态 |
| `action` | 原子动作、前置条件、预期效果、验证计划和幂等键 |
| `action_attempt` | 每次真实执行尝试及错误分类 |
| `task_event` | 追加式任务状态变更日志 |
| `approval` | Master 授权、范围、限额、有效期和撤销状态 |
| `artifact` | 报告、代码、日志、截图等任务产物引用 |
| `task_projection` | 面向 Open Loop 和 Consciousness 的压缩摘要 |
| `worker_lease` | Worker 租约、心跳和恢复信息 |

### interaction schema（会话与回复域）

| 表 | 作用 |
|---|---|
| `interaction_event` | Master 输入、Secretary 回复和系统通知事件 |
| `decision_record` | Decision Envelope、模型版本和上下文引用 |
| `reply_draft` | 模型生成的候选回复及释放条件 |
| `reply_delivery` | 实际发送状态、渠道、时间和外部消息 ID |

### outbox schema（可靠事件投递域）

| 表 | 作用 |
|---|---|
| `outbox_event` | 与业务状态同事务提交、等待可靠投递的事件 |
| `inbox_dedup` | 消费端去重记录，防止同一事件重复处理 |

## 12.4 关键字段建议

任务至少包含：

```text
task_id
parent_task_id
source_interaction_id
goal
success_criteria
constraints
priority
risk_class
status
next_wakeup_at
version
created_at / updated_at
```

动作至少包含：

```text
action_id
task_id
step_id
tool
operation
arguments_ref
preconditions
expected_effect
verification_plan
risk_class
idempotency_key
status
```

执行尝试至少包含：

```text
attempt_id
action_id
worker_id
lease_id
started_at / ended_at
request_ref
response_ref
external_receipt
error_class
result_summary
```

## 12.5 存储与分区建议

- `source_event`、`observation`、`task_event` 按时间分区；初期可按月分区。
- 高频时序数据按时间和 `subject/source` 标签组织，由时序数据库负责压缩和保留策略。
- `entity`、`live_world_state`、`world_model_fact`、`task` 初期不分表，依靠主键、状态和时间索引。
- Object Storage 采用不可变对象，数据库保存对象地址、内容哈希、MIME 类型、来源和保留策略。
- pgvector / Search 保存可重建索引；索引损坏或删除不应影响权威状态。
- V1 可使用 PostgreSQL Outbox 配合 `FOR UPDATE SKIP LOCKED` 实现任务队列；只有在吞吐、跨语言或跨节点需求明确后，再引入独立消息中间件。

---

# 13. V1 明确不做的事情

为避免项目在核心假设得到验证前膨胀为通用分布式工作流平台，V1 不实现：

1. 多 Agent 自主协作和复杂角色社会。
2. 通用 DAG（有向无环图）可视化编排平台。
3. 跨数据中心一致性和复杂分布式事务。
4. 允许模型直接生成并执行任意 Shell、SQL 或资金操作。
5. 同时接入所有生命体征、社交、资产和设备渠道。
6. 让模型直接修改 Long-term World Model 中的权威事实。
7. 在缺乏证据的情况下自动把任务标记为完成。
8. 为了“未来可能扩展”提前拆出大量微服务、消息中间件和独立数据库。

建议的初始执行限制：

- 一次任务步骤最多生成一个具有外部副作用的 Action。
- 只读 Action 可以在明确资源范围内有限并行。
- 外部写入默认需要授权。
- 财务操作初期只读，不提供自主交易或转账能力。

---

# 14. 推荐开发顺序

开发顺序应围绕五个最高风险假设展开：

1. 在有限领域内，Long-term World Model（长期世界模型）能否形成可查询、可追溯的最小认知底座。
2. 外部事件能否稳定进入系统，并形成可重放的 Observation 与 Live World State。
3. Secretary 能否把长期认知、实时状态和当前目标组织成有界且有用的 Consciousness State。
4. 长期任务能否脱离模型会话持续存在，并在中断后从正确位置恢复。
5. 执行结果能否通过证据和对账准确地回到任务状态与世界状态。

每一阶段都设置退出条件。未通过退出条件时，不进入更高风险阶段。

## 阶段 0：冻结最小协议与项目骨架

**目标**：先定义跨模块不会轻易变化的边界，避免后续边写边改导致所有组件耦合。

开发内容：

- 统一 ID、时间、来源、主体和证据引用格式。
- 定义 Source Event、Observation、Assertion、Decision Envelope、Task、Action Command、Action Result 的最小 Schema。
- 定义任务状态机、动作状态机和错误分类。
- 建立 PostgreSQL、数据库迁移、审计日志和基础服务骨架。
- 建立对象存储接口；初期可以使用本地兼容实现。
- 所有状态更新都通过明确的 Service 接口完成，不允许各模块任意更新数据库表。

退出条件：

- 同一个输入事件重复提交不会生成重复 Observation。
- 任意一条任务、动作和结果都能通过 ID 追溯到来源。
- 状态流转只能通过对应的权威服务完成，无法被 Worker 任意覆盖。
- Schema 能够向后兼容地增加字段，并保留版本号。

## 阶段 1：Long-term World Model v0（最小长期世界模型）

**目标**：先在有限领域内建立一个可以使用的长期认知底座，验证 Secretary 是否能够从结构化世界模型中正确取回背景，而不是一开始就追求自动学习全部生活信息。

推荐只覆盖以下对象：

- Master 的基础身份与稳定偏好。
- 常用设备和账户的逻辑身份，不保存密钥。
- 当前重点项目、仓库和主要目标。
- 少量重要人物及其与 Master 的关系。

开发内容：

- Entity、Assertion、World Model Fact 的最小数据结构。
- 事实来源、证据、置信度、有效时间和版本。
- 同一事实的更新、失效和冲突并存机制。
- 基于结构化条件的相关事实查询接口。
- 使用人工录入、配置文件或固定测试数据构建 World Model v0。

退出条件：

- 任一事实都能说明来源、更新时间、有效期和置信度。
- 新事实不会静默覆盖冲突事实，而是生成新版本或冲突记录。
- 给定项目、人物或场景时，查询接口能稳定返回相关事实而非整个世界模型。
- LLM 无法直接把输出写入权威事实表。

暂不开发：

- 自动从所有历史数据抽取长期事实。
- 向量数据库驱动的全量记忆检索。
- 复杂知识图谱推理。

## 阶段 2：最小观察与实时状态链路

**目标**：验证“持续输入 → 观察 → 派生特征 → 实时状态”能够稳定工作，并能与 World Model v0 中的实体正确关联。

推荐先接入两个低风险渠道：

1. Secretary 与 Master 的会话输入。
2. PC 活动、项目文件或 Git 仓库变更中的一种。

开发内容：

- Ingress / Normalization。
- Temporal Observation Layer。
- 一个或两个 Domain Processor。
- Derived Feature 和 Live World State。
- Observation 与 Entity 的关联。
- Processor checkpoint、事件去重和历史重放。

退出条件：

- 服务重启后能够从 checkpoint 继续处理。
- 对同一批历史事件重放时，得到一致的实时状态。
- 每个状态都能追溯到具体 Observation 和原始证据。
- 实时变化不会错误覆盖 World Model 中的长期事实。

暂不开发：

- 对外写操作。
- 大量传感器和社交渠道。
- 自动长期记忆晋升。

## 阶段 3：Consciousness 与即时反应闭环

**目标**：验证 Secretary 能否把 World Model v0、Live World State、当前目标和近期变化组织成有限上下文，并对 Master 输入或显著事件做出稳定反应。

开发内容：

- Salience / Cognitive Admission。
- Consciousness Snapshot。
- Reaction Context Builder。
- Decision Envelope 结构化输出。
- `respond_only` 和 `create_task` 两种决策类型。
- Reply Draft、Response Release Gate 与 Response Dispatcher 的最小实现。

退出条件：

- 上下文大小在长时间运行后保持有界，不随完整历史线性增长。
- 模型能够正确使用相关长期事实，同时不会把整个 World Model 塞入上下文。
- 重要事件能够触发反应，低显著性事件不会持续打扰 Master。
- 回复内容与实际提交状态一致；任务写库失败时不会声称任务已经开始。

暂不开发：

- 真实外部副作用。
- 多阶段复杂任务。

## 阶段 4：只读型持久任务运行时

**目标**：验证长期任务能够跨多次模型调用、进程重启和等待状态持续推进，而不会把任务中间信息打爆即时反应上下文。

开发内容：

- Task Service、Task Orchestrator、Scheduler 和 Worker Lease。
- Task Context Builder 与 Task-Step Invocation。
- PostgreSQL Outbox / Inbox 去重。
- 只读 Executor，例如文件读取、仓库搜索、网页读取或数据库只读查询。
- Task Projection 到 Open Loops 和 Consciousness。

推荐验证任务：

- 对一个本地代码仓库进行分阶段审查并生成报告。
- 持续观察一个项目目录，在满足条件后继续下一步分析。

退出条件：

- 任务在进程重启后能够从正确步骤恢复。
- 完整任务日志不进入即时上下文，Reaction Context Builder 只读取压缩任务投影。
- Task Working Context 仅按当前步骤加载必要历史、结果和产物。
- 重复投递不会重复创建任务或重复完成同一步骤。
- 任务可以正确进入 `WAITING_EXTERNAL`、`BLOCKED`、`COMPLETED` 和 `FAILED`。

## 阶段 5：证据、验证与反馈回流

**目标**：解决“执行器说成功”和“外部世界确实成功”之间的差异。

开发内容：

- Action Attempt、Evidence、Verifier 和 Reconciler。
- `RESULT_UNKNOWN` 状态和对账流程。
- 独立回读、哈希比较和外部回执验证。
- Effect Observation 回写 Temporal Observation Layer。
- 经验证结果更新 Task State、Live World State 和任务投影。
- 任务重要事件重新进入 Salience，并在必要时触发对 Master 的进度或完成通知。

退出条件：

- 任务不能仅凭 Worker 的 `success=true` 进入完成状态。
- 模拟响应丢失后，系统能够先对账而不是盲目重复执行。
- 每一个 `COMPLETED` 任务都能找到支持成功条件的证据链。
- 执行结果回流后可以触发新的状态估计和必要的 Master 通知。

## 阶段 6：受控的可逆写操作

**目标**：在低风险环境中验证幂等、前置条件、授权和回滚机制。

推荐动作：

- 在沙箱目录创建或修改文件。
- 在 Git 临时分支生成 Commit，但不自动合并。
- 创建邮件草稿，但不发送。
- 创建日历草稿或待确认事件。

开发内容：

- Action Policy Gate。
- Preconditions 和资源版本检查。
- Idempotency Key。
- Approval Gate。
- 操作前后快照和回滚路径。

退出条件：

- 重复投递不会产生重复文件、重复 Commit 或重复草稿。
- 资源版本变化时动作会停止并重新规划，而不是覆盖新状态。
- 未授权动作无法进入 Action Command。
- 每次写操作都能完整审计和可靠回滚，或明确标记为不可回滚。

## 阶段 7：对外通信与身份行为

**目标**：让 Secretary 在明确授权范围内代表自己或 Master 与外部系统通信。

推荐接入顺序：

1. Secretary 自有邮箱。
2. Master 邮箱中的低风险白名单操作。
3. Calendar（预约和修改日程）。
4. 社交软件消息草稿。
5. 经过确认的消息发送。

开发内容：

- 外部消息 ID 和发送回执验证。
- 收件人、身份、渠道和内容范围授权。
- 回复释放条件与真实发送状态绑定。
- 误发防护、撤销策略和敏感信息检查。

退出条件：

- 系统不会把“已创建草稿”描述为“已发送”。
- 网络超时后能通过外部消息 ID 对账，避免重复发送。
- Secretary 自有身份与代表 Master 的身份在权限和审计上严格区分。

## 阶段 8：长期世界模型自动演进与多领域一致性

**目标**：在执行闭环稳定后，把 World Model v0 从人工维护的认知底座扩展为由多渠道证据逐步更新的长期世界模型。

开发内容：

- 从 Observation 和 Episodic Memory 生成 Candidate Assertion（候选事实）。
- 事实置信度、有效时间、来源和证据的自动更新。
- 冲突事实检测、版本更新和事实衰减。
- Episodic Memory 到稳定事实的晋升流程。
- 增加健康、位置、通信、项目等更多 Domain Processor。
- 让任务结果作为新的 Observation 参与长期认知更新。

退出条件：

- 新事实不能仅凭一次 LLM 输出成为稳定认知。
- 冲突来源能够并存、比较并等待进一步证据，而不是静默覆盖。
- 世界模型能够解释事实来源、更新时间和置信度。
- 多领域状态进入 Consciousness 后不会导致上下文失控。
- 对历史事件重放不会无控制地重复生成相同事实。

## 阶段 9：高风险资产只读接入

**目标**：先建立资产观察、风险分析和对账能力，不立即开放资产控制权。

开发内容：

- 银行、投资组合和钱包余额只读接入。
- 账户快照、交易流水和资产变化 Observation。
- 异常交易提醒和独立对账。
- Secret Store、最小权限令牌和敏感字段脱敏。

退出条件：

- 资产数据能够跨来源对账并发现差异。
- 模型上下文、日志和对象存储中不泄露长期凭据。
- 任何资产变化结论都能追溯到正式账单、链上交易或机构回执。

## 阶段 10：有限财务执行与更高自治

**目标**：只有在此前所有阶段长期稳定后，才评估有限资金操作和更高自治。

前置要求：

- 独立风控策略引擎。
- 金额、对象、频率和账户白名单。
- 双重确认或带外确认。
- 强制幂等、独立回读和日终对账。
- 紧急停止、账户冻结和权限撤销路径。

即使进入此阶段，也应从模拟环境或极小金额开始。Secretary 不应因为具备工具调用能力，就默认拥有自主交易、转账或资产处分权。

## 阶段 11：性能扩展与基础设施拆分

**目标**：仅在真实负载证明单体架构存在瓶颈后进行扩展。

可能的后续工作：

- 将 PostgreSQL 队列替换为独立消息中间件。
- 多 Worker 并行和资源级调度。
- 独立搜索引擎和向量索引服务。
- 时序数据库独立集群和冷热分层。
- 多模型路由、成本控制和本地 / 云端模型协同。
- 高可用、故障转移和跨设备执行。

进入条件：

- 已有可复现的吞吐、延迟、可用性或成本瓶颈。
- 拆分后的收益大于新增的一致性、运维和调试成本。

---

# 15. 第一条端到端验证路径

为了尽快验证整套架构，而不是分别完成大量孤立模块，推荐第一条端到端任务选择：

> **Master 提交一个本地代码仓库审查任务，Secretary 创建持久任务，分阶段读取文件和运行只读检查，生成带证据的报告，并在完成后通知 Master。**

这条路径可以同时验证：

- Master 输入进入 Observation。
- Decision Context 和 Decision Envelope。
- 任务创建与回复释放条件。
- 长期任务跨多次模型调用推进。
- Task Working Context 不污染即时反应上下文。
- Worker 中断恢复、Outbox 和去重。
- 文件、日志和报告进入 Object Storage。
- 结果证据、完成条件和任务投影。
- 任务完成事件回流到 Consciousness 并触发最终回复。

在这条路径稳定之前，不建议优先接入健康设备、ADB 社交操作、真实邮箱发送或资金账户。