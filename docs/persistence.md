# 持久化与恢复

[Store](../src/pi_secretary/src/store.ts) 是本地权威记录仓储。数据目录通常是根目录 `.demo-data`（fixture）或 `.demo-data/interactive-live`（live）。

| 内容 | 作用 |
| --- | --- |
| journal.jsonl | 哈希链事务帧，跨记录变更、事件和请求回执一起提交 |
| objects/<sha256> | 原始输入、上下文、参数、stdout/stderr、结果等不可变字节 |
| workspaces/<task_id>/work | 任务可变工作文件 |
| owner.lock | Python fcntl helper 持有的进程级互斥 |
| core-endpoint.json / core.log | 本机 Core 发现元数据与日志；endpoint 包含秘密 token |

对象先写临时文件并 fsync，rename 后同步目录；事务写入 journal 并同步后才确认。Store 校验 JSON Schema、版本与对象引用；读取对象验证 SHA-256 和长度，拒绝对象符号链接。重放可处理不完整尾帧，中段损坏或引用原件缺失会拒绝恢复，不创建假空会话。

请求 ID 与内容 hash 形成幂等回执；同 ID 不同内容报冲突。Scheduler 的 occurrence_key 限制重复周期实例；授权派发绑定 owner epoch / attempt。journal 的重放快照、不完整尾帧修复和追加均由持有 OS 锁的 helper 执行。JS Store 通过每次打开独有的本地通道提交事务，收到对应事务的 fsync 确认后才安装内存状态；helper 不可用或结果未知后不重试追加，新 owner 不接管旧通道。异步进程退出通知和缓存的 owner epoch 仅供辅助检查，不能代表写权限。此机制只负责单数据目录，没有分布式租约。

## 恢复规则

1. 正常关闭后台会停止 loop、处理任务中断、关闭数据库和文件锁。
2. 重启先重放 Store，再恢复 Authorization 和 Scheduler，最后构造 Host 和 Settings，恢复待完成的设置切换。
3. DISPATCHED 但无回执的操作标记未知；中断执行保留 checkpoint 和未知反馈。
4. 主会话用持久化 prompt 与上下文续接中断轮；新的用户说明在完整摘要及 context 重建成功后才使用。
5. `verifyWrite()` 核验写入目标和预期内容；任意 shell / 程序的外部效果必须另行核实。

备份时先停止后台，再完整复制数据目录；不能只复制 journal。登记程序入口为绝对路径，迁移目录后旧登记可能失效，需要重新登记并复核旧任务；不可通过篡改历史参数或回执掩盖变化。停止命令与数据路径见 [运行手册](operations.md)。

当前没有 journal 分段、快照加速、自动历史垃圾回收、任意程序现场恢复或断电硬件持久性证明。

目录迁移也可能使历史 shell Operation 的绝对 cwd/resource 指向旧目录。历史记录保持原样；待执行操作需复核并重新提出适用的任务/授权，不能改写旧许可后继续执行。

## 设置批次恢复

PostgreSQL 的 settings_batch_receipt 确认事实批次是否提交，Store 的 SettingsApplication 确认摘要与 context 是否完成切换。跨域状态不假装原子提交：数据库结果未知时保持 gate，锁定回执查询后再恢复；确认数据库成功后必须完成本地重建。见[统一生效协议](settings-activation.md)。

## 即时请求与要求快照兼容

TaskPlan.pending_requests 是即时请求的唯一待执行表示，每项记录 request_id、occurrence_key、due_at、proposal_ref。pending_occurrences 继续只保存周期时间点。新即时请求以 request_id 作为发生键，唯一性为 task_id + occurrence_key；Execution.proposal_ref 保存不可变的本轮完整提案。取消或分派后从队列移除，历史受理关联保留在 task.request.accepted 事件和回执中；移除原因保存在 task.request.removed。

Store 重放时建立 TaskPlan 历史版本索引。旧 Execution 缺少 proposal_ref 时，Scheduler 按其 plan_revision 找到对应历史提案并持久固定，找不到则阻塞启动，不退回最新计划。旧 pending_requests 缺省为空，旧 once 仍只执行一次；新代码保留旧请求指纹的有限兼容读取。CREATED 中断恢复到 WAIT_PRECONDITION，DISPATCHING / RUNNING 中断保持 RESULT_UNKNOWN 守卫。

暂停计划保留待执行接续；CLOSED 计划清除待执行项并释放 parent。请求取消、分派和子执行结束均更新 parent 的 pending_followup_ids，避免自身依赖。

新增字段是向前读取兼容，不保证旧代码读取升级后的 journal。部署前必须备份完整目录并保留兼容读取版本；产生新执行或副作用后不能仅退回旧代码或恢复旧备份。应停止新派发，使用支持新契约的修复版本继续核验和恢复，保留全部操作回执。尚未产生新操作时，可在另一个隔离副本验证升级前备份；不得借回滚重放已发生的外部操作。

主会话在 Scheduler 已提交回执、Host 工具结果尚未保存的窗口中断时，仅对具有持久回执的 task_propose 重建结果。其他未确认工具仍进入 RECOVERY_BLOCKED。接续材料的来源与派生证据由 TaskProposal.source_context_refs 区分；checkpoint 原件保留，模型输入只投影直接 parent 的 assistant/toolResult 证据，不递归嵌入旧分派包。


## API v1 持久边界

CoreIdentity、AssistantProfile、ClientRegistration 和 ApiCommand 写入现有 journal/CAS，不另建业务数据库。owner/data_domain 身份持久保存，服务 instance_id 和普通分页游标签名密钥每次启动变化；SyncMetadata 的同步签名密钥与 history_id 持久保存。发现文件由 backend 启动时以私密权限原子替换，关闭只移除本实例的记录；不是权威业务存储。旧 ui-endpoint.json 不用于新客户端发现。

短命令的 ApiCommand 与首个领域变更同一帧提交，NO_CHANGES 也保存回执；request_id 绑定 owner、路径和规范化完整 body。Store 重放同时恢复旧 Scheduler.answer 的请求身份占用，跨操作复用冲突。短命令 ACCEPTED 可长期保留，业务完成读对应资源，不等待虚构的统一 COMPLETED。

长命令先 QUEUED，执行前 RUNNING，正常结束 COMPLETED；异常或重启中断为 UNKNOWN。QUEUED 可在新进程继续，但领域授权/版本/票据门禁仍有效；RUNNING 不自动再次派发。memory/recovery 的未消费票据在服务重启后失效，持久 ApiCommand 不延长许可；已消费请求按 ExtractionRecovery 和 ModelCall 证据对账。

新增持久记录不保证旧二进制可读，协议也不兼容旧 TUI/WebUI。旧数据回放中的默认字段承接是领域兼容读取，不是旧客户端兼容层。迁移与回退详见[API 切换说明](api/v1/README.md#切换与回退)。

## Issue #9 同步与通知

新增 SyncMetadata、DeliveryTarget、NotificationRouting 和 NotificationDelivery；均复用 journal/CAS。初始化显式记录旧数据切换边界，历史对象不重写。Delivery 目标/内容身份不可变，received/presented/read 只能单调添加。新通知与投递意图同事务；ACK 与 ApiCommand 同事务。同步 cursor 校验 sequence/digest/history；只有完整事务才推进。SQL 004 增加独立 World 数据代次和事务内版本时钟，outbox 仍是原权威桥接。备份/回退、显式代次更新与未知副作用规则见[同步恢复说明](api/v1/sync.md)。
