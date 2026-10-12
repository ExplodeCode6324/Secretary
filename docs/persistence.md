# 持久化与恢复

## 本地存储

| 路径 | 内容 |
| --- | --- |
| journal.jsonl | 哈希链事务帧，包含记录变更、事件和幂等回执 |
| objects/<sha256> | 输入、上下文、参数、输出与产物的不可变字节 |
| workspaces/<task_id>/work | NONE 或未选 Scope 任务的可变工作文件 |
| owner.lock | Python fcntl helper 持有的单目录写锁 |
| core-endpoint.json / core.log | 当前 Core 的发现信息与日志 |

DIRECTORY 任务使用 Scope 的物理目录；Execution 记录创建时的完整绑定。Store 先持久化对象，再追加并同步 journal 帧，收到 fsync 确认后安装内存状态。记录通过 Schema 校验，对象读取时核对类型、长度和 SHA-256。

Python helper 持有 OS 文件锁，负责重放、尾部不完整帧修复与追加。每次打开 Store 使用独有本地通道；通道失效后需重新打开并从 journal 确认结果。中段损坏或原件缺失会报告恢复错误，供维护者检查完整副本。

## 幂等与版本

请求回执绑定 owner、路径、request_id 和规范化 body。相同请求重放原回执，相同 ID 的不同内容返回冲突。Task 的 occurrence_key 标识单次工作；授权派发绑定参数、版本和 owner epoch。

TaskPlan.pending_requests 保存即时请求；Execution.proposal_ref 固定每轮提案。旧执行缺少该字段时，恢复从对应 plan_revision 的历史版本补齐。取消和分派移除队列项，同时保留原受理和移除事件。

CoreIdentity 的 owner/data_domain 跨重启保持；instance_id 和游标签名密钥每次启动更新。发现文件含本机认证 token，采用私密权限，仅代表当前服务实例。

## 启动恢复

Core 依次打开 Store，恢复 Authorization 和 Scheduler，再构造 Host、Settings 并恢复设置应用。已保存的模型响应和工具结果用于接续；剩余模型尝试次数随逻辑调用保存。MemoryExtractionJob 从已完成分段继续补提，旧 ExtractionRecovery 仅用于读取历史。

长 API 命令中，QUEUED 可继续派发，RUNNING 的中断记录为 UNKNOWN。shell/program 依据机器启动标识、进程组和身份确认是否停止；具体流程见[状态机](state-machines.md#进程生命周期)。未知文件写入可核验内容，其他作用由 owner 裁定。作用结论和进程状态分别保存。

主会话在 task_propose 已受理、工具响应尚未保存的窗口中断时，可由持久回执重建工具结果。其他未确认工具进入恢复处理。接续材料保留直接 parent 的证据引用，原 checkpoint 仍可读取。

## PostgreSQL 桥接

World 事务同时提交事实、变更回执和 audit_outbox。Core 将 outbox 导出到 journal 后标记已导出；重启按回执去重继续。Settings 用 `settings_batch_receipt` 确认数据库提交，再完成本地记忆和 context 切换。两个存储各自提交，由持久回执连接恢复流程。

当前存储采用完整 journal 重放和 CAS 原件留存。分段、快照加速、历史回收与追加性能属于 #24；恢复和空闲 tick 的 Operation 扫描优化属于 #34。

## 备份与升级

停止 Core 后备份完整数据目录、配套 PostgreSQL、代码和配置。先在隔离副本验证新版本重放，再切换运行目录。未完成 Settings 使用其原配置完成恢复。

程序登记入口和历史 Operation 可能包含绝对路径；迁移目录后重新登记适用程序，并检查待执行任务的绑定。旧记录保留原身份。回退以兼容代码和完整备份为基础，同时对账升级期间发生的外部作用；避免用旧状态重复执行已发生的操作。运行命令见[运行手册](operations.md)。
