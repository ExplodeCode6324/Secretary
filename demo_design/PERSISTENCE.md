# JSON 与 PostgreSQL 持久化协议

## 部署边界

Demo 为单机单用户、本地文件系统。`secretary serve` 承担 Scheduler、主会话宿主驱动、UI/API、唯一状态写入与恢复；模型 loop/任务可以使用按需 worker 子进程。没有单独输入服务，没有新增数据库。主会话 worker 退出不影响 Scheduler、待输入和 UI 授权。

`data_root` 保存宿主状态；`workspace_root/<task_id>` 保存任务工作文件。两个根目录可同盘，不宣称具有 OS 权限隔离。程序/agent 不直接修改宿主权威状态，所有改变经宿主入口。

```text
data_root/
  owner.lock
  journal/000001.jsonl
  objects/<sha256-prefix>/<sha256>
  snapshots/<generation>/manifest.json
  snapshots/<generation>/<type>/<id>.json
  CURRENT
workspace_root/
  <task_id>/workspace.json
  <task_id>/work/
  <task_id>/executions/<execution_id>/manifest.json
```

workspace 文件可以变化；作为证据或 context 的内容提交前复制为不可变对象并记录 hash。execution manifest 引用 immutable objects，不靠可改的 work 文件作唯一证据。运行时目录不提交 Git。

## 一个 JSON 事务怎么提交

1. 单个 journal writer 持有系统独占锁；域对象修改通过同一个协调器串行提交。摘要模型与 worker 可并行，但不能绕过提交器。
2. 大内容/新状态完整快照写临时对象文件，计算精确字节 SHA-256，文件 Sync，rename 到内容地址，Sync 父目录。对象已经存在则验证相同 bytes/hash。
3. 校验状态机、身份、归属、request hash、expected_revision，以及整批对象的跨引用；同批对象先在候选视图检查。
4. 构造一个 JournalTransaction，包含全量新快照引用、所有 OperationLogRecord 与 CommandReceipt。事务 payload 编码为 UTF-8 JSON；其字节 checksum 包在外层 `{"payload_b64":"...","sha256":"..."}`，一行一帧。checksum 针对解码后的 payload，不依赖 JSONB 或键排序。
5. 追加完整帧并 Sync journal，只有这一步成功才更新内存索引、答复 ACCEPTED 或允许下一步外部执行。新日志段创建要先同步目录。
6. snapshots 是缓存，不是权威；可在事务后异步生成。写完 generation 全部文件并 Sync 后切换 CURRENT，Sync 目录。恢复仍验证所覆盖 journal seq/digest。

不会把“分别覆盖多个 JSON 文件”当成跨对象事务。实现必须同步文件及相关目录，并针对实际文件系统验证持久化顺序；本设计尚未通过掉电测试。

## 重放与所有者

先取得本地独占文件锁，再检查 schema_version、连续序号、previous_digest、checksum 和对象内容。只有最后一个未完成尾帧可截去（保留诊断副本）；中间损坏、缺少必要对象、重复序号等阻塞恢复。重放只更新内存索引/投影，绝不调用模型、工具、发通知或执行程序。

新 owner_epoch 可靠保存后才接收控制请求。旧 worker 回执先按 instance/attempt 核对；旧 epoch 不可派新操作。已完成的旧 epoch 外部作用证据仍可审计，不将证据丢弃。PID 不可作唯一身份，子进程取消使用已关联的实例与进程组；取消函数返回不等于实际退出。

文件锁和 epoch 只保证 demo 受管理入口的单写/分派，不提供多机分布式租约，也不抵御共享用户下任意 shell 绕开工具入口。与 BrainStorm 的早期无复杂 sandbox 范围一致。

## 跨文件系统与外部执行

接受任务的 journal 事务先给 task_id、INITIALIZING、请求回执；随后幂等创建 task 目录和 owner manifest；下一事务标 ACTIVE。崩溃后按原 task_id 完成目录初始化，不新建任务。

有触发且前提满足后写 DISPATCHING + Dispatch，随后 spawn。启动时 worker 使用 attempt_id 向宿主登记；重启后先核对既有 worker。不能证明未启动时进入 RESULT_UNKNOWN/核验流程，不能因为缺 PID 文件就再 spawn。

执行操作时先原子消费有效授权并写 Operation.DISPATCHED，再调用外部资源。此间崩溃不能保证 exactly-once 外部作用；只保证“不盲重做”。能用外部 idempotency key 时使用 intent_id，仍记录回执。

## World Model 跨存储交接

JSON 内保存 WorldCommand 与放行后的 Operation，携带稳定 change_id。PG 事务锁定 change_id 与 fact_slot，写事实/冲突、change_receipt、audit_outbox 后提交。PG 不保存权限范围。

PG 提交后，将同 outbox event_id 幂等写入 JSON journal，更新 WorldCommand 和 Operation 结果；journal durable 后才标 PG outbox exported。PG 已提交而 journal 未写可安全补交接；journal 已写而 exported 未更新则按 event_id 去重。连接中断先查 receipt，同键不同 hash 拒绝；没有 receipt 才进入同 change_id 事务并取得同键锁再次查询，避免与仍在运行的原事务竞争。只恢复原已授权的数据库写，不重复消费批准。

不是跨文件/PG 原子事务；通过 receipt/outbox 避免已写入事实丢失审计或重复改变。仅 WORLD 已确认的数据库写使用此恢复协议，不能类推为任意外部操作可自动重试。

## 日志、归档与备份

Operation Log 的逻辑 MAIN/TASK/SYSTEM 流由 journal 中的原始记录及对象组成；按流导出的 JSONL 和索引是可重建投影。主会话原文、工具参数/返回、agent context、程序 stdout/stderr 都保存完整原件引用，不用结论替代。

退出 Scheduler 先验证 ArchiveManifest，再提交 RETIRED 墓碑。删除的仅是热索引/可操作入口；日志与 immutable objects 保留。Demo 暂不自动删除历史对象或压缩 journal，故不引入危险 GC；长期归档/压缩需另行定义。

备份流程：暂停新分派和写入，完成 in-flight PG 提交的 receipt 核对，记录 journal seq/digest，PG 一致性备份和 objects/journal/snapshots/registry 同批标记；工作文件按任务 checkpoint 冻结或标明不一致范围。恢复核验两个存储的批次与桥接记录；不能任意混用不同时间备份。具体自动备份实现是 demo 后续工作，本包只规定边界。

frame 的 sequence 从 1 开始，首帧 previous_digest 为 64 个 0；之后是上一帧 payload SHA-256。sequence 不能跳号。OperationLogRecord.sequence 是独立事件序列，同帧可分配多个连续值。跨日志段链继续，禁止每段重置。回放先严格解码外帧的 payload_b64/sha256，限制解码后字节数并校验，再按 JournalTransaction schema 解码。外帧只允许这两个键。

快照 manifest 保存 schema_version、generation_id、最后 journal sequence/digest、owner_epoch、各对象 type/id/revision/ObjectRef；CURRENT 仅 generation_id。workspace.json 保存 schema_version/task_id/created_at，execution manifest 保存 task_id/execution_id/checkpoint_id/result_id/对象引用列表。它们是可重建索引或目录归属标记，不是另一套领域权威；字段契约补充见 [存储封装](../json/STORAGE.md)。

owner_epoch 的生命周期属于应用协调进程，Session 保存当前值供主会话核验。主会话模型 worker 单独退出/唤起不重新取得全局锁，也不递增 epoch；否则会错误地使仍由同一 Scheduler 管理的任务失效。
