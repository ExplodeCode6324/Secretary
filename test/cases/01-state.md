# 状态传递与恢复

由 [catalog.json](../catalog.json) 生成；修改唯一来源后运行 `python3 test/scripts/build.py`。

通用隔离设施、竞态排序和判定规则见 [执行协议](../PROTOCOL.md)。每个子情况独立执行和记录。evidence_level 是目标证据类型，不代表已经取得；真实模型场景中的确定性持久化子项可先以 OFFLINE_RUNTIME 单独报告。

<a id="sta-001"></a>
## STA-001 输入的接受与处理分离

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J01, J02。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：宿主停止，合成输入 A 和稳定 request_id。

步骤：

1. 提交 A 并取得 ACK。
2. 只恢复存储检查 A。
3. 启动 loop 完成 A。

预期与禁止结果：

- ACK 后原文与 ACCEPTED 同存。
- 只有该 loop 回复和作用可靠记录后 A 才 HANDLED。
- 保存或展示不等于处理。

证据：客户端 ACK；Input/loop revision；原文 hash。

<a id="sta-002"></a>
## STA-002 长 loop 期间多客户端输入

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J01, J03。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：模型 A 停在响应 barrier，三客户端各持不同输入。

步骤：

1. 并发提交 B/C/D 并重投 B。
2. 完成 A。
3. 依次放开后续调用。

预期与禁止结果：

- 同一时刻主会话 active loop≤1。
- A 的 Context 字节不变。
- B/C/D 各一条且最终均 HANDLED。
- 不得清空后来输入。

证据：请求账本；所有 Context hash；loop 起止事件。

<a id="sta-003"></a>
## STA-003 工具返回不额外唤醒

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J03。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：主会话已认领 A，工具返回包含可检索记忆。

步骤：

1. 返回 memory_read/task_query。
2. 完成本 loop。
3. 只执行内部 Context 重装和摘要。

预期与禁止结果：

- 工具结果仍属于 A。
- 不生成额外 Input/主会话 loop。
- 整理模型调用单独计数。

证据：Input 集合；ModelCall role；工具调用配对。

<a id="sta-004"></a>
## STA-004 认领后中断不误认旧回复

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J14。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：旧 loop X 已完成，新输入 A 已 CLAIMED。

步骤：

1. 在新 loop 保存 checkpoint 后杀进程。
2. 恢复。
3. 读取 X 与 A 的调用关联。

预期与禁止结果：

- X 的完成记录不完成 A。
- A 从自己的边界继续。
- 缺必要 checkpoint 时恢复阻塞。

证据：loop_id/claimed_input_ids；重启后轨迹。

<a id="sta-005"></a>
## STA-005 流式半响应与畸形工具

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J03, J14。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：provider fixture 输出半段包含 file_write 的 JSON。

步骤：

1. 在结束标识前断流。
2. 重启。
3. 再返回完整响应。

预期与禁止结果：

- 半响应只保存为未完成材料。
- 零工具分派。
- 完整响应可靠保存之后才可按正常 gate 发动作。

证据：完整/部分响应原件；工具次数；Call 状态。

<a id="sta-006"></a>
## STA-006 仅宿主模型流程更换

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J09, J14。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：Scheduler 有运行中任务，主会话处于可保存边界。

步骤：

1. 退出主会话流程再唤起。
2. 随后整体应用重启。

预期与禁止结果：

- 前者 session_id/owner_epoch 不变且 Scheduler 可推进。
- 后者保存新 epoch。
- 都不创建新逻辑会话。

证据：进程/实例身份；epoch 提交；task 状态。

<a id="sta-007"></a>
## STA-007 新进程精确装入 Context

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J03, J14。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：Context 包含中文、空白、Unicode、工具 ID 和 provider 扩展块。

步骤：

1. 记录字节/hash。
2. 退出 worker。
3. 新进程读取原件。
4. 附加一个新决定后调用。

预期与禁止结果：

- 原件逐字节相同。
- 新材料追加且历史顺序不变。
- 历史工具无重执行。
- 对象不可变。

证据：原件二进制比较；实际 provider body；外部账本。

<a id="sta-008"></a>
## STA-008 adapter 或 profile 不兼容

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J14。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：已保存含 provider 特有扩展的 Context。

步骤：

1. 改 adapter/profile 后尝试恢复。
2. 模拟未知块。
3. 换回兼容配置。

预期与禁止结果：

- 不静默丢弃扩展或改写原件。
- 阻塞并说明迁移需求。
- 兼容配置恢复可继续。

证据：兼容性错误；原 Context hash；调用计数。

<a id="sta-009"></a>
## STA-009 状态权威冲突

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J09, J11。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：摘要写成功但 Scheduler 为 WAIT_DECISION；事实是旧观测；日志有模型推断。

步骤：

1. 查询状态。
2. 回答是否完成。
3. 用新有效观测纠正后再问。

预期与禁止结果：

- 任务状态取 Scheduler。
- 推断不升级为事实。
- 新依据已知后不用旧摘要误答。
- 执行完成与目标达成分别表达。

证据：各来源快照；回答引用；独立预期表。

<a id="sta-010"></a>
## STA-010 状态图合法和非法迁移

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J02。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：按 canonical catalog 建立可达有效 from 状态。

步骤：

1. 逐边执行 TRANSITIONS 四项。
2. 枚举无定义 from/event 及终态回迁。

预期与禁止结果：

- 合法边满足守卫才提交。
- 非法边拒绝且原状态/revision 保持。
- 诊断审计允许新增。
- 不得只测 graph contains。

证据：逐边子项结果；guard 单条件反例；服务提交轨迹。

<a id="sta-011"></a>
## STA-011 关闭与新输入竞争

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J01, J14。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：应用进入 DRAINING，A 已 ACK，B 正在提交。

步骤：

1. 在接受与关闭屏障两边提交 B。
2. 并发关闭。
3. 重启。

预期与禁止结果：

- 所有收到 ACK 者恢复。
- 其余明确拒绝或同键查回执。
- 关闭前未保存材料不被报成功。

证据：外部 ACK 清单；journal；shutdown 记录。

<a id="sta-012"></a>
## STA-012 输入大小与上下文容量区别

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5, 3.1；语义约束 J01, J04。

规范：[README.md](../../state_machine/README.md)、[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：配置入口 bytes 限额及更小 Context 预算。

步骤：

1. 提交限额-1/等于/加1 的 UTF-8 输入。
2. 对入口接受但 Context 装不下者继续投递小输入。

预期与禁止结果：

- 超入口限额在 ACK 前拒绝或完整附件接受。
- 已接收者绝不截断。
- CAPACITY_BLOCKED 保留待处理要求。

证据：原始 byte 长度；ACK；Context omitted/raw refs。

<a id="sta-013"></a>
## STA-013 丢失唤醒提示仍处理可靠输入

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.4, 2.5；语义约束 J01, J14。

规范：[GO_LAYOUT.md](../../demo_design/GO_LAYOUT.md)、[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：输入已可靠 ACCEPTED，模拟只丢失内存 channel 唤醒提示而不丢数据。

步骤：

1. 在 journal 提交后拦截一次唤醒提示。
2. 让当前 loop 结束并扫描 durable inbox。
3. 主会话停止子情况通过既有应用唤起流程恢复。

预期与禁止结果：

- 待处理要求由持久化记录驱动，不能只依赖内存布尔或 channel。
- 有输入时最终处理且只认领一次。
- 没有新增独立保活服务作为测试前提。

证据：输入 ACK 与 journal；丢提示 barrier；后续 claim/handled 和 loop 记录。
