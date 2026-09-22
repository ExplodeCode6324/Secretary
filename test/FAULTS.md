# 故障窗口与并发安排

控制器在每个窗口的前、后分别等待显式 barrier，记录已到达后再注入。至少执行普通异常、进程 SIGKILL 和重新启动；返回式 I/O 错误与真实杀进程分列。断电、设备写缓存及文件系统持久性必须另做 POWER_LOSS，不能由 SIGKILL 推断。

| 窗口 | 注入位置 | 恢复 oracle | 对应用例 |
| --- | --- | --- | --- |
| F01 | 输入对象落盘后、journal Sync 前 | 不保证接受；同键恢复最多一条，无孤立 ACCEPTED | STO-001、STA-001 |
| F02 | journal Sync 后、HTTP ACK 前/后 | 收到 ACK 者零丢失；未收到 ACK 查询/重投收敛 | STO-001 |
| F03 | task INITIALIZING 已提交、目录建立中 | 同 task_id 补初始化；碰撞不覆盖 | SCH-002 |
| F04 | Dispatch 保存后、spawn 前/登记回执后 | 不确定是否启动时先核对 attempt，不再 spawn | STO-006、EXE-004 |
| F05 | grant 消费+Operation.DISPATCHED 提交前/后 | 提交前无动作；提交后无回执停止核验 | AUT-004 |
| F06 | 外部动作完成、结果回执保存前 | RESULT_UNKNOWN，外部账本一次作用，恢复无重复 | EXE-005 |
| F07 | TaskResult 保存/终态/Feedback QUEUED 事务前后 | 要么全不可见，要么详情可查且反馈可补 | EXE-009 |
| F08 | Feedback→Input 事务后、交接 ACK 前 | 一个 Input，重复投递返回同记录 | EXE-010 |
| F09 | 摘要候选已保存、承接事务前后 | 前保留全部原文；后只移除确认覆盖集合 | MEM-002 |
| F10 | PG COMMIT 前/后断线 | 同 change_id 锁内查 receipt；不创建新写入身份 | WLD-007 |
| F11 | JSON 已补交接、PG exported 前 | 同 outbox event_id 去重，关联真实 journal ID | WLD-008 |
| F12 | 归档验证后、RETIRED 事务前 | 再检查 revision/pending；原件不删除 | EXE-015 |
| F13 | 渠道已接收通知、delivery receipt 前 | DELIVERY_UNKNOWN；不盲重发，不称已读 | EXE-017 |
| F14 | 取到取消请求后、进程真实退出前 | CANCEL_REQUESTED 或 UNKNOWN；不得过早 CANCELLED | SCH-008 |
| F15 | Snapshot generation 写入中、CURRENT 切换前后 | 已验证缓存或 journal 重建；禁止空状态 | STO-008 |

并发最小组合：输入×loop 结束、摘要×新输入、摘要×更正、两份摘要×同 revision、批准×撤销、批准×取消、批准×参数/文件变化、两 writer×同 data_root、两操作×同 intent、反馈×重新投递、详情读取×退休、后续执行×退休、PG 同键×断线重试、PG 同 slot×不同更正、程序禁用×分派、完成×取消、恢复×旧 worker 回执。

先逐对穷举上述顺序，再做 seed 固定的随机事件序列。每次随机运行保存输入序列、barrier 顺序及失败最短复现轨迹；缩减轨迹时保留同样的副作用账本与时钟条件。随机测试不可替代明确的提交窗口注入。
