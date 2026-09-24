# 持久化与恢复

[Store](../src/pi_secretary/src/store.ts) 是本地权威记录仓储。数据目录通常是根目录 `.demo-data`（fixture）或 `.demo-data/interactive-live`（live）。

| 内容 | 作用 |
| --- | --- |
| journal.jsonl | 哈希链事务帧，跨记录变更、事件和请求回执一起提交 |
| objects/<sha256> | 原始输入、上下文、参数、stdout/stderr、结果等不可变字节 |
| workspaces/<task_id>/work | 任务可变工作文件 |
| owner.lock | Python fcntl helper 持有的进程级互斥 |
| ui-endpoint.json / ui-backend.log | 本机 UI 连接元数据与后台日志；endpoint 包含秘密 token |

对象先写临时文件并 fsync，rename 后同步目录；事务写入 journal 并同步后才确认。Store 校验 JSON Schema、版本与对象引用；读取对象验证 SHA-256 和长度，拒绝对象符号链接。重放可处理不完整尾帧，中段损坏或引用原件缺失会拒绝恢复，不创建假空会话。

请求 ID 与内容 hash 形成幂等回执；同 ID 不同内容报冲突。Scheduler 的 occurrence_key 限制重复周期实例；授权派发绑定 owner epoch / attempt。锁丢失使仓储不可继续安全提交。此机制只负责单数据目录，没有分布式租约。

## 恢复规则

1. 正常关闭后台会停止 loop、处理任务中断、关闭数据库和文件锁。
2. 重启先重放 Store，再恢复 Authorization 和 Scheduler，最后构造 Host。
3. DISPATCHED 但无回执的操作标记未知；中断执行保留 checkpoint 和未知反馈。
4. 主会话用持久化 prompt 与上下文续接中断轮；新一轮才使用新的用户说明。
5. `verifyWrite()` 核验写入目标和预期内容；任意 shell / 程序的外部效果必须另行核实。

备份时先停止后台，再完整复制数据目录；不能只复制 journal。登记程序入口为绝对路径，迁移目录后旧登记可能失效，需要重新登记并复核旧任务；不可通过篡改历史参数或回执掩盖变化。停止命令与数据路径见 [运行手册](operations.md)。

当前没有 journal 分段、快照加速、自动历史垃圾回收、任意程序现场恢复或断电硬件持久性证明。

目录迁移也可能使历史 shell Operation 的绝对 cwd/resource 指向旧目录。历史记录保持原样；待执行操作需复核并重新提出适用的任务/授权，不能改写旧许可后继续执行。
