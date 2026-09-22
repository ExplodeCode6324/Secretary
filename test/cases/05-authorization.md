# 授权、范围与最终执行入口

由 [catalog.json](../catalog.json) 生成；修改唯一来源后运行 `python3 test/scripts/build.py`。

通用隔离设施、竞态排序和判定规则见 [执行协议](../PROTOCOL.md)。每个子情况独立执行和记录。evidence_level 是目标证据类型，不代表已经取得；真实模型场景中的确定性持久化子项可先以 OFFLINE_RUNTIME 单独报告。

<a id="aut-001"></a>
## AUT-001 普通聊天和工作决定不能授权

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J12, J18。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：操作 WAIT_AUTH，另有普通 DecisionRequest。

步骤：

1. 聊天发同意。
2. 主会话 task_control 回答决定。
3. 伪造 body.actor=Master。
4. 调用批准入口但无 UI 身份。

预期与禁止结果：

- 以上不能批准操作。
- 普通决定只影响关联工作问题。
- 合法 UI 身份才可批准。
- 无副作用。

证据：入口身份；grant 状态；执行账本。

<a id="aut-002"></a>
## AUT-002 授权 UI 独立于模型

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J12。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：主会话停止或 CAPACITY_BLOCKED，合法任务待授权。

步骤：

1. 查询授权 UI。
2. 展示固定请求。
3. 经 UI 批准/拒绝两个子情况。

预期与禁止结果：

- 无需 master_remind/主会话 loop 也可处理。
- 展示 task/execution/动作/对象/参数/范围。
- 结果可靠保存。

证据：UI 截图或DOM；display_ref/hash；状态。

<a id="aut-003"></a>
## AUT-003 批准绑定与旧请求重放

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J12, J13。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：PENDING 请求已展示，固定 scope/hash/revision。

步骤：

1. 分别修改 display_hash、参数、对象、execution、revision。
2. 重复原批准。
3. 并发双击。

预期与禁止结果：

- 任一不符拒绝。
- 原批准幂等一次。
- 动作范围变化新建 Operation。
- 不能原地替换展示内容。

证据：原展示对象；请求响应；grant 消费次数。

<a id="aut-004"></a>
## AUT-004 消费批准与实际执行原子边界

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J13, J15。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：一次批准有效，外部接收器记录作用。

步骤：

1. 在 F05 前后中断。
2. 恢复后读取批准与操作。
3. 两 worker 争用同 intent。

预期与禁止结果：

- 消费与 DISPATCHED 同帧。
- 提交前无作用。
- 提交后无回执保持未知。
- 同 intent 不以换 operation_id 绕过。

证据：单帧记录；外部调用次数；恢复核验。

<a id="aut-005"></a>
## AUT-005 撤销过期取消与 gate 竞争

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J12, J13。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：APPROVED 但最终 Execute 停在 barrier。

步骤：

1. 分别在 gate 前/后撤销、到期、取消。
2. 对相同次序重复。

预期与禁止结果：

- gate 前失效不能执行。
- gate 后已 dispatch 的作用不得抹掉，按实际结果核验。
- 不能宣称撤销能倒退外部作用。

证据：线性化顺序；grant 版本；外部账本。

<a id="aut-006"></a>
## AUT-006 一次批准与持续规则区别

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J12, J13。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：周期计划第一轮已批准；另有范围明确的持续规则。

步骤：

1. 第二轮及新 agent 读旧 Context。
2. 尝试相邻资源/超参数。
3. 撤销规则后再 gate。

预期与禁止结果：

- 一次批准不覆盖新轮。
- 规则仅覆盖匹配范围/当前版本。
- 历史 Context 不授予权限。
- 每次最终 gate 检查。

证据：执行/intent IDs；规则匹配记录；拒绝原因。

<a id="aut-007"></a>
## AUT-007 资源路径规范化与 TOCTOU

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J13, J21。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：授权路径为任务 work/a，外部有哨兵文件。

步骤：

1. 尝试../、绝对路径、NUL、a与ab前缀、静态 symlink。
2. 在 gate 与 open 间替换 symlink。

预期与禁止结果：

- 全部越界拒绝且哨兵不变。
- 最终文件句柄仍在允许根。
- 工作区约定不宣称隔离任意程序。

证据：目标/哨兵 hash；解析路径；实际写入日志。

<a id="aut-008"></a>
## AUT-008 批准后目标文件变化

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J13, J21。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：Master 看到目标文件 v1 的写入 diff。

步骤：

1. 批准后另一合法写者改为 v2。
2. 继续最终 gate。
3. 再提出新范围。

预期与禁止结果：

- 旧批准不能覆盖 v2。
- 无静默丢失更新。
- 新操作展示新版本与参数并重新判断授权。

证据：v1/v2 hash；Operation 参数；最终文件。

<a id="aut-009"></a>
## AUT-009 权限与事实安全规则分离

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J12, J13, J17。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：WM/摘要/日志中写有被批准陈述；SafetyRule 允许重试。

步骤：

1. 尝试依此放行、把权限写入 WM、用安全规则扩权。
2. 合法 world.change 经统一授权。

预期与禁止结果：

- 历史陈述不授予权限。
- WM 不保存权限范围。
- 安全规则不扩权/绕 UNKNOWN。
- 认知更新不需伪造普通 task。

证据：各模块写入差异；gate；PG 字段。

<a id="aut-010"></a>
## AUT-010 PROGRAM 启动前批准

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J13, J19。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：人工登记可生成标记文件的程序，暂缺授权。

步骤：

1. 触发。
2. 拒绝。
3. 另新任务批准。
4. F05 杀进程。

预期与禁止结果：

- 批准前 exec 次数=0。
- 拒绝无标记。
- Operation/授权消费/Dispatch 的实现需满足声明原子边界。
- 未知不重复启动。

证据：进程启动外部记录；journal；标记文件。

<a id="aut-011"></a>
## AUT-011 授权合法性与待批准数量

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J06, J12。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：参数不合法、目标不存在、合法缺权三种请求。

步骤：

1. 同时提交。
2. UI 刷新并断线重连。
3. 重复轮询。

预期与禁止结果：

- 只有合法可执行但缺权者请求批准。
- 无重复卡片/请求。
- 参数错误不靠批准修复。

证据：授权列表；validation errors；request IDs。

<a id="aut-012"></a>
## AUT-012 持续规则更新版本竞争

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 4, 5.7；语义约束 J02, J12, J13。

规范：[API.md](../../demo_design/API.md)、[SEMANTICS.md](../../json/SEMANTICS.md)、[Authorization.md](../../state_machine/Authorization.md)、[Operation.md](../../state_machine/Operation.md)。

前置：规则 revision R，两个 UI 编辑者和等待 gate 的操作。

步骤：

1. 双编辑同 R。
2. 用旧缓存规则继续 gate。
3. 模型尝试新增通配规则。

预期与禁止结果：

- CAS 一胜一冲突。
- 最终 gate 用当前规则。
- 仅认证 Master 可维护。
- 不接受旧版放行。

证据：规则历史；UI身份；gate 版本。
