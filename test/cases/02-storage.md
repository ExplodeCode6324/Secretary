# 持久化、损坏与崩溃

由 [catalog.json](../catalog.json) 生成；修改唯一来源后运行 `python3 test/scripts/build.py`。

通用隔离设施、竞态排序和判定规则见 [执行协议](../PROTOCOL.md)。每个子情况独立执行和记录。evidence_level 是目标证据类型，不代表已经取得；真实模型场景中的确定性持久化子项可先以 OFFLINE_RUNTIME 单独报告。

<a id="sto-001"></a>
## STO-001 ACK 前后真实崩溃矩阵

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J01, J02。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：外部控制器记录 ACK，输入 journal 可设 F01/F02 barrier。

步骤：

1. 对象 Sync 前后、journal Sync 前后、ACK 前后分别 SIGKILL。
2. 重启并重投原请求。

预期与禁止结果：

- 已 ACK 零丢失。
- ACK 丢失不代表未提交。
- 同键至多一个 Input/receipt。
- 不得将内存确认当 durable。

证据：controller ACK；failpoint 经过；新进程读取结果。

<a id="sto-002"></a>
## STO-002 跨对象事务与 CAS

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J02, J11。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：事务同时更新 Execution/TaskResult/Feedback，其中对象有 revision。

步骤：

1. 让一项 expected_revision 过期。
2. 让对象写失败。
3. 再以全有效批次提交。

预期与禁止结果：

- 失败时无部分领域对象更新。
- 成功时同帧全部可见。
- 两竞争更新同 revision 仅一成功。

证据：事务帧；提交前后对象版本；错误原因。

<a id="sto-003"></a>
## STO-003 同键同字节和异字节

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J01。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：首次请求已持久化，保留入口精确 UTF-8 bytes。

步骤：

1. 重投原 bytes。
2. 同 ID 改值。
3. 只改 JSON 键序或空白。
4. 另 producer 使用同局部键。

预期与禁止结果：

- 原 bytes 返回原 receipt。
- 同 producer 同键异 bytes 拒绝且无新动作。
- producer 命名空间按契约区分。

证据：原请求 hash；回执 ID；实际作用账本。

<a id="sto-004"></a>
## STO-004 尾帧与中段损坏

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J02, J16。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：有效 journal 的隔离副本。

步骤：

1. 分别截断最后无换行帧、破坏完整末帧 checksum、中段字节、跳号、重复序号、链摘要。
2. 逐份恢复。

预期与禁止结果：

- 仅允许不完整尾帧保留诊断后截去。
- 完整坏帧/中段/序号异常阻塞。
- 不跳过已确认事务。

证据：损坏位置；诊断副本；恢复错误；ACK 对账。

<a id="sto-005"></a>
## STO-005 不可变对象缺失或篡改

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J14, J21。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：已提交 Context/日志/证据对象及 ObjectRef。

步骤：

1. 分别删必要对象、改一字节、改 bytes 长度、同地址放另一内容。
2. 重启和按引用读。

预期与禁止结果：

- 发现 hash/长度/缺失即阻塞相关读取或恢复。
- 不生成空替代内容。
- 原件不能被普通更新覆盖。

证据：ObjectRef；读取错误；恢复状态。

<a id="sto-006"></a>
## STO-006 派发存在但 worker 回执丢失

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J09, J15。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：已保存 Dispatch，worker 可在注册前后停住。

步骤：

1. F04 杀协调进程。
2. worker 留存或退出两子情况。
3. 重启核对原 attempt。

预期与禁止结果：

- 可证明活着则绑定原实例。
- 不明则 RESULT_UNKNOWN。
- 缺 PID 不足以再次 spawn。
- 新 epoch 限制旧 worker。

证据：attempt/实例记录；spawn 次数；外部观察。

<a id="sto-007"></a>
## STO-007 第二 writer 与旧 epoch

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J02, J09。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：A 持有 data_root OS 锁；B 为另一进程。

步骤：

1. B 启动尝试写。
2. A 退出后 B 接管。
3. 旧 worker 请求新动作并提交旧证据。

预期与禁止结果：

- A 持锁时 B 不写不分派。
- 接管 epoch durable。
- 旧 epoch 新动作拒绝。
- 旧证据可审计但不覆盖当前控制。

证据：锁结果；epoch 帧；worker receipt 归属。

<a id="sto-008"></a>
## STO-008 快照与 CURRENT 故障

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J02, J21。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：被测实现声明支持快照，否则 BLOCKED_CAPABILITY。

步骤：

1. F15 中断写 generation。
2. CURRENT 指向缺失或错误 digest。
3. 从相同 journal 重建。

预期与禁止结果：

- 只使用边界/hash 校验通过的缓存。
- 可回退 journal。
- 不把快照当权威。
- 重建投影一致。

证据：快照 manifest；journal digest；投影比较。

<a id="sto-009"></a>
## STO-009 空间满、只读、短写与 Sync 错误

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J01, J02, J21。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：可注入 I/O 故障的专用 filesystem adapter。

步骤：

1. 在对象 write/rename/目录 Sync/journal write/Sync 分别返回错误。
2. 恢复磁盘后重试原请求。

预期与禁止结果：

- 无法证明 durable 时不 ACK、不执行外部作用。
- 错误可诊断。
- 同键恢复不重复。
- 无静默吞错。

证据：各系统调用序列；ACK/作用计数；错误码。

<a id="sto-010"></a>
## STO-010 跨日志段与游标

P1 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J16。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：多段 journal，单帧有多事件且 TASK 流序号不连续。

步骤：

1. 跨段恢复。
2. 分别用事务游标与事件游标查询。
3. 混用游标。

预期与禁止结果：

- 事务链连续不归零。
- 事件按自己的序列。
- 流内缺号不等于损坏。
- 混用明确拒绝。

证据：两种序列；分页响应；链校验。

<a id="sto-011"></a>
## STO-011 一致备份与混批恢复

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J14, J17, J21。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：实现声明备份能力；JSON/PG 有未完成交接。

步骤：

1. 暂停写与分派并核对 receipt。
2. 制作一致批次。
3. 故意混用另一 PG/objects 批次恢复。

预期与禁止结果：

- 一致批次可对账。
- 混批拒绝或明确阻塞。
- 在途工作文件一致性范围标明。
- 不声称自动备份已实现。

证据：批次 manifest；seq/digest；PG receipt/outbox。

<a id="sto-012"></a>
## STO-012 未知版本与迁移失败

P0 · 目标证据 `OFFLINE_RUNTIME` · `NOT_RUN`

依据：BrainStorm 2.5, 3.4, 5.8；语义约束 J02, J14。

规范：[PERSISTENCE.md](../../demo_design/PERSISTENCE.md)、[STORAGE.md](../../json/STORAGE.md)、[GUARDS.md](../../state_machine/GUARDS.md)。

前置：存储副本含旧/未知 schema_version。

步骤：

1. 用未知版本启动。
2. 在显式迁移中断。
3. 尝试兼容读取与回退。

预期与禁止结果：

- 未知版本不猜读。
- 旧原件不被破坏。
- 迁移有可审查结果。
- 失败不以空会话替代。

证据：版本错误；迁移前后 hash；恢复报告。
