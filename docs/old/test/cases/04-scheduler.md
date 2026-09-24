> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../../README.md)。

# 计划、调度与取消

由 [catalog.json](../catalog.json) 生成；修改唯一来源后运行 `python3 test/scripts/build.py`。

通用隔离设施、竞态排序和判定规则见 [执行协议](../PROTOCOL.md)。每个子情况独立执行和记录。evidence_level 是目标证据类型，不代表已经取得；真实模型场景中的确定性持久化子项可先以 OFFLINE_RUNTIME 单独报告。

<a id="sch-001"></a>
## SCH-001 提案三层检查分离

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J06, J07。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：未知程序、非法参数、合法未来计划、缺设备已触发计划各一份。

步骤：

1. 提交四种提案。
2. 推进时钟与恢复设备。

预期与禁止结果：

- 非法退回不等待。
- 未来计划无执行副作用。
- 已触发缺前提 WAIT_PRECONDITION。
- 恢复后才能 READY。

证据：receipt；Plan/Execution 状态；worker 次数。

<a id="sch-002"></a>
## SCH-002 初始化中断与目录碰撞

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J06, J21。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：已 ACK task_id，workspace 尚未建好。

步骤：

1. F03 中断并重试。
2. 创建同路径但不同 owner manifest。
3. 模拟只读目录。

预期与禁止结果：

- 恢复同 task_id。
- 碰撞/不可写为 INIT_FAILED。
- 不覆盖他任务、不分配第二 task_id。
- 修复后按原 ID 初始化。

证据：workspace manifest；plan revision；文件 hash。

<a id="sch-003"></a>
## SCH-003 触发去重与时间边界

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J07, J08。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：IMMEDIATE、AT、INTERVAL 均固定 trigger 与时钟。

步骤：

1. 重复 tick。
2. 在触发前1ms/等于/后1ms运行。
3. 并发 tick。
4. 重启再 tick。

预期与禁止结果：

- 每个 occurrence 唯一。
- AT/IMMEDIATE 不重复。
- INTERVAL 使用 anchor+UTC seconds。
- 无提前执行。

证据：occurrence 清单；fake clock；dispatch 账本。

<a id="sch-004"></a>
## SCH-004 错过触发的三种策略

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J07, J08。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：同周期分别用 REPORT_ONLY、SKIP、CATCH_UP_ONE。

步骤：

1. 离线跨100个周期再恢复。
2. 另提交未指定策略提案。

预期与禁止结果：

- 按持久化策略仅反馈/跳过/至多补一个。
- 缺省回显 REPORT_ONLY。
- 不集中补跑100次。

证据：接受的提案；遗漏事件；新 execution 数。

<a id="sch-005"></a>
## SCH-005 同计划重叠和跨计划上限

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J08, J09。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：max_workers=2，慢周期任务 A，独立任务 B/C。

步骤：

1. 触发 A 两次，分别测试 QUEUE/SKIP。
2. 并发触发 B/C。
3. 让 A 完成。

预期与禁止结果：

- A 活跃执行≤1。
- 队列保留 occurrence 不误判遗漏。
- 不同计划并发≤2。
- 排队任务最终推进。

证据：worker 时间轴；occurrence 状态；队列年龄。

<a id="sch-006"></a>
## SCH-006 前提新鲜度、缺失与依赖

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J08, J09。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：设备 checker 分别 TRUE/FALSE/UNKNOWN/过期/缺失；依赖有多个执行。

步骤：

1. 触发并观察。
2. 篡改摘要称依赖成功。
3. 提供有效 Scheduler 依赖证据。

预期与禁止结果：

- 仅新鲜真实前提允许 dispatch。
- 不能以摘要或另一 execution 成功替代。
- 错误 checker 名不默认 TRUE。

证据：ConditionResult；依赖 ID；dispatch 计数。

<a id="sch-007"></a>
## SCH-007 等待期限与无人响应

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J08, J18。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：等待设备/普通决定/授权，分别无 deadline 和有 deadline。

步骤：

1. 推进超过候选48h。
2. 推进到 deadline。
3. 模拟无回复。

预期与禁止结果：

- 无 deadline 不自行过期或默认同意。
- 显式到期且无在途作用按规则结束。
- 等待不能被闲置回收。

证据：clock；waiting ids；Execution/Retention。

<a id="sch-008"></a>
## SCH-008 取消与完成的三种竞态

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J09, J15。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：可阻塞的运行程序，有外部作用账本。

步骤：

1. 分别完成先于取消、取消先于完成、作用完成但回执丢失。
2. 信号返回后延迟真实退出。

预期与禁止结果：

- 已完成记 SUCCEEDED。
- 确认停且作用已知才 CANCELLED。
- 未知转 RESULT_UNKNOWN。
- cancel ACK 不冒充停止。

证据：信号/退出时间；作用记录；终态依据。

<a id="sch-009"></a>
## SCH-009 运行中 deadline

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J09, J15。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：DISPATCHING/RUNNING 且有在途操作，显式 deadline。

步骤：

1. 使 deadline 到期。
2. 返回取消响应。
3. 延迟作用回执。

预期与禁止结果：

- 先 CANCEL_REQUESTED/核验。
- 无证据不可直接 EXPIRED。
- 结果按实际作用。
- 无重复 worker。

证据：deadline/取消事件；回执；状态轨迹。

<a id="sch-010"></a>
## SCH-010 计划暂停关闭与已有实例

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J08, J09。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：ACTIVE 周期计划有一个运行实例和已接受排队 occurrence。

步骤：

1. 暂停、恢复、关闭。
2. 随后到达新周期。
3. 检查已接受实例策略。

预期与禁止结果：

- 暂停/关闭阻止新 occurrence 分派按规范处理。
- 不凭计划状态伪造已有执行结束。
- 已接受例外需明确记录。
- 关闭不复活。

证据：plan/execution 分离记录；dispatch 来源。

<a id="sch-011"></a>
## SCH-011 程序更新禁用与分派竞争

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J19, J13。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：ENABLED 程序有固定 revision/code_digest，任务待 dispatch。

步骤：

1. 禁用与 dispatch 两种顺序。
2. 更新参数 schema/代码。
3. 改代码但不登记。
4. 尝试模型注册。

预期与禁止结果：

- 禁用后无新分派。
- 已运行保留旧依据。
- 不兼容或 digest 漂移拒绝。
- 模型无人工登记权限。

证据：登记历史；Dispatch code digest；进程启动记录。

<a id="sch-012"></a>
## SCH-012 当前不支持的触发类型

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 5.1, 5.2, 5.3, 5.4；语义约束 J07。

规范：[SCENARIOS.md](../../demo_design/SCENARIOS.md)、[DECISIONS.md](../../demo_design/DECISIONS.md)、[Execution.md](../../state_machine/Execution.md)、[SEMANTICS.md](../../json/SEMANTICS.md)。

前置：EVENT 来源未登记，或提出 cron/DST 节假日调度。

步骤：

1. 分别提交。
2. 再用合法固定UTC INTERVAL。
3. 变换显示时区。

预期与禁止结果：

- 不假装已支持 EVENT/日历语义。
- 明确拒绝或能力不足。
- 合法周期不因显示时区重复。

证据：提案错误；trigger 持久化；时钟轨迹。
