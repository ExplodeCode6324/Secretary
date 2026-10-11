# Issue #16 + #18：Scope 与未知结果裁定联合修复计划

- 日期：2026-10-12（Asia/Hong_Kong）
- 关联 Issue：[#16](https://github.com/ExplodeCode6324/Secretary/issues/16)、[#18](https://github.com/ExplodeCode6324/Secretary/issues/18)；共同约束：[#7](https://github.com/ExplodeCode6324/Secretary/issues/7)
- 文档状态：**已批准，实施中**
- 修订：2026-10-12 完成 Ayanami 审查逐项核实；S2 已由 Master 确认“仅 DIRECTORY 串行，NONE 可并行”，Master 已于 2026-10-12 授权按修订计划实施、验证并提交 PR，暂不合并。
- N1 修订：采纳 Master 转述的无重连恢复方案；macOS 做真实进程验证，Linux 由 CI 覆盖。
- 领取：两项均已指派给 `ExplodeCode6324`，执行者 Codex，按同一批次共同验收。
- 实际基线：`main@cc1a976af04d41ae60d863e09c578bc54c8fd5f5`；本地 HEAD 与远端 main 一致。
- 前置：#20 已随 PR #29 合入；#19 已随 PR #31 合入；两项 Issue 均已关闭。Pi 子模块为 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`。
- 工作位置：沿用 `secretary-core` 主工作目录；计划分支 `codex/issue16-18-plan`，文档位于 `docs/fix/`。

## 1. 目标与范围

Master 管理工作范围；主会话为任务选择范围；Scheduler 固定每次执行的工作目录并串行派发同一 DIRECTORY 范围内的执行。NONE 使用各任务独立目录，沿用全局 worker 限额。未知操作由 Master 裁定，确认停止的执行释放活动槽，同一文件的未知写入继续受保护。

本批交付 Scope 持久记录、owner API、主会话与执行包、路径解析、派发约束、裁定入口、恢复收束、生成合同和联合测试。#17 的默认授权策略、#9 的 ChangeFeed、#10 的客户端界面各自后续实现。World 只引用 scope_id，不取得权限决定权。既有任务维持临时 workspace，不迁移文件；DIRECTORY 项目目录及其文件不由任务留存清理删除。

明确拆成两个 PR：先 #18（裁定、收束、TASK 恢复及受控进程停止证据），后 #16（Scope、目录与派发）。#18 独立验收后，按 Master 本轮“提交 PR、先不合并”的要求，#16 以 #18 为基线创建堆叠 PR；将来 #18 合入后再调整 #16 的 base 并复跑 CI；两个 Issue 在联合验收后一起结项，首个 PR 不自动关闭 #18。

## 2. 当前源码与修复依据

以下为上述基线的静态核对；本轮只制定计划，行为验证在授权实施后执行。

| 已核对位置 | 当前行为与影响 | 修改方向 |
| --- | --- | --- |
| `src/contracts/contracts.schema.json` 的 `$defs.Scope` | 已有同名类型表示 session/task/execution 调用归属，不是可管理的工作范围 | 保留原嵌套结构；新增内部 `WorkScope` 定义，`record_type` 和公开 DTO 使用 `Scope` |
| `scheduler.ts:373–395, 772–808, 929–958` | 初始化、接续校验依赖 task/work；Execution 没有工作根绑定 | 分离元数据位置与执行根，创建 Execution 时持久绑定 |
| `scheduler.ts:1337–1364` 及 read/bash/write/program/产物路径 | `safePath` 接受 task ID，多个工具直接拼接 task/work | 统一 `rootFor(execution)` 与 `safePath(execution, relative)` |
| `scheduler.ts:1018–1240` | ready 后直接 run；WAIT_AUTH 恢复先应用已授权操作；只有全局 worker 限额 | 在任何执行副作用前同步取得范围槽，覆盖授权恢复入口 |
| `scheduler.ts:1618, 1838, 2104–2120`；`app.ts:43–46` | shell/program 为独立进程组；进程句柄只在内存，重启 recover 不核验旧进程；close 可能取消升级 SIGKILL 的定时器 | 持久启动身份、先落盘后允许命令启动、重启有界清理；以整组停止证据控制放行 |
| Pi `packages/agent/src/harness/tools/write.ts:33`、`harness/env/nodejs.ts:762–771` | 当前 Scheduler 实际导入的 write 经 NodeExecutionEnv 自动递归创建父目录 | 复用同一 write 授权，删除另行 shell mkdir 的计划 |
| `authorization.ts:31–43` | 未知操作按 action/resource 拦截；shell resource 将随 #16 变为共享根 | 文件按目标路径阻塞；shell/program 按执行阻塞 |
| `authorization.ts:337–356` | `finish(..., UNKNOWN)` 必然产生 RESULT_UNKNOWN | 人工 UNVERIFIED 要明确保存 FAILED/UNKNOWN，不能直接套用 finish |
| `scheduler.ts:1730–1777, 1921–2027, 2173–2258` | verify-write 有局部收束；finish 与反馈分两次提交；重启只补部分反馈 | verify-write、人工裁定和启动恢复使用同一收束函数 |
| `scheduler.ts:1240–1322, 2219–2238`；`transport.ts:106–160` | TASK 已用 durableStream，但重启把运行中执行统一变成未知；传输请求身份依赖上下文内容 | 从原持久请求恢复纯模型阶段，复用 #19 的成功响应和尝试计数 |
| `application-service.ts:180–258` | 短命令通过 withAdmission 与首个业务变更一同落盘，重放先查 ApiCommand | Scope 写入与 resolve 复用既有短命令协议 |
| `host.ts` 的 MainPromptSnapshot / task_propose；`task-prompt.ts` | 主会话没有工作范围列表；恢复会重新构造执行包 | 新循环保存有界范围快照；同一模型请求恢复使用原包 |

固定源码基线：[提交浏览](https://github.com/ExplodeCode6324/Secretary/tree/cc1a976af04d41ae60d863e09c578bc54c8fd5f5)。#19 的已合入计划明确把跨进程 TASK 恢复留给 #18，因此本批需要补 Scheduler 接入，不能仅依据 #19 已关闭而省略。

## 3. 方案与合同

### 3.1 Scope 记录与 owner 命令

新增 `Scope` 记录：标准 id/revision/updated_at，加 name、description、kind（DIRECTORY/NONE）、root_path、notes_path、state（ACTIVE/ARCHIVED）。DIRECTORY 默认 notes_path 为 `.secretary/NOTES.md`；NONE 的 root_path、notes_path 为 null。

内部保留当前 `$defs.Scope` 调用归属结构，新增 `$defs.WorkScope` 生成内部 WorkScope 类型，避免重命名所有授权、日志和模型调用。新增记录接入 Stored 联合、journal object_type 和必要状态目录；不改写历史 journal。新增 TaskProposal、TaskPlan、Execution、TaskResult、Feedback 的 scope_id；旧记录缺失时按 null 读取。

公开入口均位于 `/api/v1/`：

| 入口 | 语义 |
| --- | --- |
| `GET scopes` | 有界分页，返回 ACTIVE 和 ARCHIVED 记录及 revision；查询无副作用 |
| `POST scopes` | request_id + 创建字段；返回既有命令 receipt，resource_ids 指向新 Scope |
| `POST scopes/{id}` | request_id + expected_revision + 修改字段；归档记录不重新启用 |
| `POST scopes/{id}/archive` | request_id + expected_revision；只归档记录，保留任务、产物和目录 |
| `POST operations/{id}/resolve` | request_id + expected_revision + outcome + note；裁定未知操作 |

沿用 local-owner 身份，actor 由服务端写为 MASTER_UI，拒绝客户端注入权限字段。模型工具仅可引用 scope_id，不能管理 Scope 或裁定 Operation。任务、执行、操作详情与命令结果 DTO 返回 scope_id 或裁定摘要；不增加客户端 UI。

根路径必须绝对、存在、为目录且本身非符号链接；使用规范物理路径按路径组件检查同根/祖先/子孙冲突，不用裸字符串前缀。祖先路径和子路径沿用 safePath 的符号链接拒绝规则；失效或被替换为符号链接的目录在使用时再次拒绝。notes_path 是经过同一文件路径规则校验的相对路径。不存在的笔记按空处理；已有不安全笔记路径给出明确诊断，不绕过校验。

DIRECTORY 根另须与 Core 的实际数据目录 `realpath(store.dir)` 完全不重叠：同根、其祖先、其子孙均拒绝，错误为 `SCOPE_ROOT_RESERVED`。创建、更新以及派发使用绑定根时执行同一检查，防止数据目录配置变化绕过规则。规则只针对用户配置的 DIRECTORY 根，NONE/无 Scope 的受管 task/work 继续位于数据目录内。Core 源码仓库不一并列为保留目录，允许正常开发任务；若数据目录放在该仓库内部，该仓库作为根仍因数据重叠而被拒，应把运行数据放到项目外。

这条规则防止把 journal/CAS 纳入普通项目相对路径的写入范围。已有 bash 是本地用户权限，之前也可能经显式命令访问外部文件；因此不采用审查中“#16 之前不存在此风险”的绝对说法，保留目录规则也不替代 shell 授权或 OS 隔离。

冲突集合由 ACTIVE DIRECTORY Scope 根目录和仍占槽 Execution 的 DIRECTORY 绑定组成，排除当前 Scope 自己。更新根目录后，旧执行的物理目录仍受占用保护；两次并发创建/修改通过同一 Store 写入入口串行校验和落盘。kind 的修改仅影响之后创建的 Execution。

### 3.2 Execution 绑定、接续与留存

Execution 创建时保存不可变 `workspace_binding`：kind、root_path、notes_path（DIRECTORY 使用）；scope_id 单独保存。DIRECTORY 取当时 Scope 配置，NONE/无 scope 绑定原 task/work。绑定一经写入即不可修改，由 Store 校验保护，防止恢复时或后续调用意外切目录。

不采纳 S1 的“取得槽时再绑定”：#16 在设计、生命周期及验收中明确要求创建时绑定；当前 `conditions()` 还在派发前用 safePath 检查 RESOURCE_PRESENT。推迟绑定会令排队预条件跟随 Scope 修改改变目标，须另改合同与预条件语义，不只是删除一项守卫。本批维持创建时绑定和旧绑定冲突处理。

`rootFor(execution)` 只读绑定。历史 Execution 缺绑定时确定性回退到旧 task/work，不读取当前 Scope；新 Execution 必须保存完整绑定。TaskPlan.workspace 保留旧元数据定位用途，不再作为所有执行 cwd 的权威。

DIRECTORY 初始化仅创建数据目录内的任务 manifest、executions 等元数据，不创建 task/work。NONE/无 scope 保持原初始化。接续校验拆开元数据归属与工作根校验；`reuse_task_id` 未填/null scope_id 均继承原任务，显式不同 ID 拒绝，换范围须新建任务。同一任务后续执行可采用同一 Scope 的新配置；已有执行仍用旧绑定。

所有路径消费者共同迁移：预条件、read、write 准备与落盘、shell cwd 与 resource、program cwd、verify-write、submit_result/CAS 捕获、producing_operation_id 匹配。执行目录内只有正常工作文件和经 write 授权的共享笔记；checkpoint、回执和产物快照留在数据目录。program 的授权 resource 保持注册程序身份，不借 Scope 改变程序授权合同。

Scope 归档后，新提案及新接续被拒绝；已创建未派发执行进入 WAIT_PRECONDITION/SCOPE_ARCHIVED；已接受但尚未创建 Execution 的请求在物化后保持同样等待，保留取消入口。已取得槽、正在运行或 WAIT_AUTH/WAIT_DECISION 的执行继续，归档不撤销当前执行。留存仅沿用当前元数据归档行为，不增加目录垃圾回收。

### 3.3 派发、占槽与根目录变更

按 Master 对 S2 的明确决定：同一 scope_id 的 DIRECTORY 执行最多一个活动执行；NONE 与无 Scope 的不同任务仅受现有全局 worker 限额约束，同一 task 仍保留原有不并发规则。判断使用 Execution 创建时绑定的 kind，而非可变的 Scope 当前 kind，避免修改类型后把已有 DIRECTORY 执行从占用检查中漏掉。活动状态集合为 DISPATCHING、RUNNING、WAIT_AUTH、WAIT_DECISION、CANCEL_REQUESTED；停止证据未确认的执行另按下述规则保留占用。

在 run/execute 的真实派发入口、首次 await 之前同步重读当前 Execution/Scope、校验冲突并持久取得槽。占槽由既有 Execution 状态表达，不新增持久锁表；DISPATCHING 表示已取得槽。PROGRAM 首次授权请求和 WAIT_AUTH 恢复执行也必须经过该入口；调整 Authorization.dispatch 的允许前态，与新的 DISPATCHING 顺序一致。

同 tick 两个 DIRECTORY READY 执行只有一个取得槽；另一项回到 WAIT_PRECONDITION/SCOPE_BUSY，下一 tick 自动重评。WAIT_AUTH、WAIT_DECISION 已有槽可重入；派发失败走统一结束流程释放。RESULT_UNKNOWN 的运行 entry 或受控进程组尚未确认停止时继续占槽和保留物理根占用，重启后也不能只看内存 running map。取消请求、leader 的 close、发送 kill 成功以及 Master 已裁定结果都不是整组停止证明。启动恢复先完成旧执行停止检查和分类，再允许新派发。

还需覆盖跨 scope 的旧绑定：A 的排队执行已绑定旧目录，A 改根后 B 获得该旧目录。此时 A 不能按旧绑定与 B 并发写入。派发重新检查绑定根与其他 ACTIVE Scope/活动执行根的重叠，冲突时 WAIT_PRECONDITION/SCOPE_ROOT_CONFLICT，供 Master 取消或调整 Scope；不偷偷重绑 A 的 Execution。

#### 受控进程崩溃清理（B2）

采纳 B2 的风险与清理要求，但不采用“spawn 后仅存 PGID、重启直接 kill”的约 20 行方案。它遗漏 spawn 到落盘的窗口，也不能区分复用后的进程身份。[Node 的 detached 说明](https://nodejs.org/api/child_process.html#optionsdetached)确认非 Windows 子进程可成为新进程组/会话；[kill 说明](https://nodejs.org/api/child_process.html#subprocesskillsignal)提示旧 PID 复用和信号不等于退出的风险。

1. shell/program 共用一个窄启动封装。Operation 在 spawn 前保存启动 token 和未确认停止标记；先启动只等待许可的 wrapper，取得 PID/PGID、平台启动身份（含系统启动标识/进程开始身份）、operation/attempt 关联并提交 journal，之后才经专用控制通道放行真实命令。wrapper 收到 EOF 或父进程死亡而尚未获许可时退出，不能执行命令。控制通道不复用 program 的参数 stdin，也不把命令串拼入另一层 shell。
2. 控制通道只属于本次 Core 生命周期。wrapper 发现通道 EOF 时自行清理它管理的工作进程组；重启后的 Core 不重连 wrapper，不建立监听端口、重连握手或常驻进程服务。Core 从 journal 读取启动身份，按下面四种情况核验和处理；正常 cancel/timeout 复用同一终止与复查逻辑，不能因 leader 先 close 就取消组员清理。
3. 每次发送 SIGTERM 或 SIGKILL 前重新核对系统启动身份、PGID 与可核验的进程开始身份；两秒等待后不沿用旧检查结果。身份不匹配、无权限或证据不足时，不发送终止信号，保留停止未确认标记及占用，给 Master 一条去重通知。运维清理后重检；leader 已消失而组员仍在时，不以 leader PID 查询失败代替组查询，无法核验组身份则走保留分支。
4. Operation 的效果裁定与进程停止元数据分开保存。即使裁定为 UNVERIFIED，停止未确认也不释放目录；恢复重检在 outcome 已终结时仍继续。新旧记录都不能凭未知操作数量为零自动得到“已停止”结论。
5. 在 #18 PR 内完成最小封装与启动/停止窗口验证：macOS 本机运行真实 shell/program 和 Core SIGKILL 场景，Linux 由 CI 运行同组真实子进程场景；模拟结果不能替代这两项平台证据。#16 复用其停止证据。若某平台不能提供可靠停止判断，明确拒绝在该平台启用 DIRECTORY 的 shell/program 派发，不降级为数字 PID 盲杀。主动 setsid 脱离管理的程序不纳入本批通用追踪；命令合同禁止将这类后台进程作为普通受控任务启动。

重启核验以 journal 中已持久的启动身份为依据，按顺序处理：

| 情况 | 判断与动作 |
| --- | --- |
| 系统已重启 | 同一主机的可靠系统启动标识与记录不同，说明记录中的进程已终止；保存 STOPPED，不向相同数字的新 PID/PGID 发信号。标识缺失、不可读取或数据搬到另一主机不作此推断 |
| 进程组不存在 | 在同一受支持主机/进程可见范围内，对有效 PGID 的组查询明确得到不存在（例如 kill(-pgid, 0) 的 ESRCH），保存 STOPPED。leader 不存在、空的模糊查询结果或权限失败均不算组不存在 |
| 进程组存在且身份匹配 | Core 直接对该组发 SIGTERM；约 2 秒后重查，已消失则 STOPPED，仍在且身份重新核验一致才发 SIGKILL；再有界等待约 2 秒并复查。若仍存在或无法确认停止，保留占用并通知 |
| 身份不符或无法检查 | 不发送 SIGTERM/SIGKILL，保留占用并通知；包括 EPERM、旧记录缺少所需身份、组员存在但无法可靠关联原记录等情况 |

依据：[POSIX 4.17](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap04.html#tag_04_17)规定进程组生命周期结束前不能复用其 ID；[kill 的错误语义](https://pubs.opengroup.org/onlinepubs/009604499/functions/kill.html)区分 ESRCH 和 EPERM。因此“原受控组已不存在”是停止证据，“相同数字的组当前存在”仍需身份检查。POSIX 不保证分开的身份查询和 kill 是原子操作：组可能在两者之间结束并随后复用 ID；实现需尽量缩短这段窗口、在每次发信号前重新核验，对观察到的身份变化停止自动清理，不能把反复查询宣称为完全消除了复用竞态。平台核验语义与剩余窗口在 PR 中如实记录，不把未知状态当作停止。

该封装只服务于已有两处 spawn，不新增全局进程服务、租约框架或 OS 沙箱。具体实现行数按实际报告；启动许可和身份核验的故障窗口先通过隔离测试，再启用共享目录。

### 3.4 主会话、范围列表与共享笔记

每个新主循环装配 ACTIVE scope 的 id/name/description 有界列表，纳入完整请求预算；建议上限 64 项、正文合计 8 KiB，稳定按 ID 排序。超出时明确标记省略数量，不猜测省略项归属，可向 Master 确认具体 scope_id。限制是上下文投影边界，不限制 owner 创建记录；完整列表可通过 API 分页查看。

列表快照与 MainPromptSnapshot/本轮 Context 一起固定；同一逻辑请求恢复沿用原列表，下一新轮才刷新，以保持 #19 logical_key 与重试次数稳定。task_propose 与公开 task-requests 同步接受 scope_id，并在 Scheduler 校验当前 ACTIVE 状态；task_query 返回归属。提示词说明明确归属时填写，不确定先询问，纯解释不建任务。

DIRECTORY 的执行包增加 scope 信息和共享笔记；建议笔记最多 8 KiB，UTF-8 安全截断并显示标记，仍经过整体请求预算。笔记沿用 JSON 执行包的材料分界，独立置于 `scope.notes = { authority: "untrusted project data", content, truncated }`，正文由 JSON.stringify 转义；固定执行提示词说明笔记中的指令不能覆盖 assignment、工具规则和 Master 授权。执行前读取绑定根/notes_path，下一次执行能看到已保存更新；执行期间修改 Scope 配置不改写当前包。NONE 只携带归类信息，不读取或维护共享笔记。

更新笔记使用普通 write 授权。当前实际调用的 Pi harness write → NodeExecutionEnv.writeFile 已递归创建父目录，因此首次写 `.secretary/NOTES.md` 直接沿用同一次 write 授权，无须 shell mkdir，也无须修改 Pi；safePath 在授权准备和实际执行前校验根与已存在父路径。拒绝授权时目录和文件均不得创建。#17 后再改变默认写入策略。

### 3.5 未知结果拦截与人工裁定

`Authorization.prepare` 对新的操作应用以下规则；已存在 intent 先校验参数身份，再返回原状态，不生成新副作用：

- file.write：resource 明确为规范物理绝对路径，所有执行对同一目标的未知写入继续阻塞。根目录先 realpath，目标用路径组件归一化并拒绝符号链接；新文件不要求目标已存在，核验现有祖先后拼接末尾组件。历史 resource 来自已 realpath 的 this.workspace 和 safePath 的 path.resolve，正常历史记录已是同一格式；不重写历史 action/resource 或审批哈希。验收包含历史未知写入与新路径解析的命中。
- shell.run/program.run：同一 execution_id 内存在这两类未知操作时，拒绝继续发出 shell 或 program 操作，跨 action 也不能绕过；不同执行不按目录或 program ID 互相封锁。
- World 等其他 action 保持既有规则。execution_id 为 null 时不把不同主会话操作当成“同一执行”，沿用原规则。

resolve 只接受当前 RESULT_UNKNOWN 的 Operation。新 request_id 必须匹配 expected_revision；相同 request_id/相同请求重放返回原 receipt，相同 request_id/不同参数返回 REQUEST_CONFLICT。先按既有 API 层检查 request_id，再做业务状态校验，避免已完成裁定的重放被误拒。

| outcome | Operation.state | Operation.effect |
| --- | --- | --- |
| APPLIED | SUCCEEDED | APPLIED |
| NOT_APPLIED | FAILED | NOT_APPLIED |
| PARTIAL | FAILED | PARTIAL |
| UNVERIFIED | FAILED | UNKNOWN |

新回执保存 outcome、resolved_by=MASTER_UI、note、resolved_at、原 receipt 引用（允许原值为 null）；原 CAS 证据保留。裁定不重放 shell/program，也不再次写文件。UNVERIFIED 是接受不确定性后的终态，通过专门的 resolve 映射提交，不调用会重新变成 RESULT_UNKNOWN 的 `finish(UNKNOWN)`。

Operation 变更、裁定事件与 ApiCommand 接收在同一个 journal frame 落盘；回复丢失后仍能通过请求 ID 查询。主会话通过反馈和 execution/operation 查询看到裁定内容。非执行关联的 Operation 仍可保存裁定，执行收束仅适用于关联 Execution；World 的既有回执核验流程保持原职责。

### 3.6 共用收束与恢复

抽取一个小型 `settleUnknownExecution`，由人工 resolve、verify-write、停止后的执行清理和启动 recover 调用；以 Store 当前 Operation 集合为准重算 unknown_operation_ids，不相信历史缓存数组。

1. 仍有未知操作：保持 RESULT_UNKNOWN；人工裁定某一项不能让剩余项失去可见性。
2. 已确认停止、最后一项已裁定/核验：结束为 FAILED，detail 记录“执行中断，结果已由 Master 裁定”或自动核验依据，以及各操作裁定引用；不把 APPLIED 误当整个任务成功。停止未确认时保持等待并显示清理原因，即使所有 outcome 已保存也不能终结后释放目录。
3. verify-write 成功保存 APPLIED 后进入同一路径，哈希不符仍保持未知；自动核验不得冒充 MASTER_UI。
4. 已保存裁定、Execution 未结束时重启：补完 FAILED/TaskResult；已保存 TaskResult、Feedback 未保存时，复用现有按 result_id 补反馈逻辑。重启/tick/重复请求都只产生一个 TaskResult 和一条终结 RESULT Feedback，既有 UNKNOWN 提醒作为历史保留。
5. 等待授权或普通决策若随执行结束失效，则沿用现有取消/过时处理；未决操作不能在终态执行上再次派发。

没有剩余待裁定操作不自动等同于纯模型中断。恢复分类检查 executor、取消标记、ModelCall/Context/Checkpoint 及操作回执：

- AGENT 确认中断于模型传输或成功响应消费边界，且没有未对账工具副作用时，恢复原 Execution；不创建接续任务。重用持久 ModelCall.request 对应的消息、原执行包与请求参数，复用 #19 durableStream，保留 logical_key、transport_attempt、retry_at。
- RESPONSE_SAVED 已有成功响应时复用，不新增供应商请求；FAILED/INTERRUPTED 的诊断内容不当成功。未成功请求最多原预算内三次发送，耗尽即 FAILED 并反馈。
- 不能在原 checkpoint 后再追加新的 executionPrompt 调用 `agent.prompt()`，否则上下文变化会形成新请求。恢复分支按持久消息边界 `continue()`，成功响应的工具结果按 intent/回执对账，已经完成的工具不重复执行。
- PROGRAM、中断位置无法证明、取消中或上下文不一致的执行，确认停止且无未知 Operation 时结束 FAILED 并反馈；有未知 Operation 时等待裁定，停止未确认时等待清理。不存在“unknown_operation_ids 为空就重跑任务”的兜底。
- 启动顺序为 Authorization.recover → 等待 Scheduler 的有界进程恢复检查 → Execution 分类/收束 → 允许 pump 派发。App.open 需要 await 恢复入口；超过有界清理时间仍未确认的项保留持久占用/去重通知，其余不冲突工作继续。恢复派发同样取得 Scope 槽，原绑定根不改变。

## 4. 新增守卫与防止的具体故障

优先使用既有 INVALID_PATH、SYMLINK_REJECTED、REVISION_CONFLICT、REQUEST_CONFLICT；仅新增下列业务原因或等价错误。

| 守卫/原因 | 防止的具体故障 |
| --- | --- |
| SCOPE_NOT_FOUND / SCOPE_ARCHIVED | 模型伪造 ID、归档后继续创建或启动排队任务 |
| SCOPE_ROOT_RESERVED | 将 journal/CAS 数据目录或其祖先/子孙作为普通项目根，允许相对路径写入运行数据 |
| Scope 根目录冲突（创建/更新拒绝；派发 SCOPE_ROOT_CONFLICT） | 两个 Scope 通过嵌套路径、别名或排队旧绑定写入同一目录 |
| SCOPE_BUSY | 同一 DIRECTORY 的 READY 或 WAIT_AUTH 恢复绕过单活动执行；不用于 NONE |
| 接续 Scope 不匹配 | reuse 静默切工作范围或未填时退回临时目录 |
| Execution 绑定不可变 | Scope 修改或恢复逻辑把已批准操作导向另一目录 |
| OPERATION_NOT_UNKNOWN | 对已完成操作二次裁定、覆盖既有结果 |
| 受控启动许可、身份核验和停止未确认原因 | spawn 未落盘时启动命令、Core SIGKILL 后孤儿进程与新执行并发、重启误杀复用 PID |
| 持久模型请求/工具结果对账 | 重启刷新包导致重试预算重置，或成功工具被重复执行 |

不引入通用租约系统、分布式锁、状态机框架或新的恢复票据。

## 5. 实施顺序与验收

Master 确认本计划后按顺序实施：

1. 重新核对 main、Issue、工作树和子模块；记录实施基线，运行统一 verify 基线并保留首次失败。现有未跟踪本地报告不进入提交。
2. PR-A 实现 #18：拦截规则、resolve 短命令、共用收束、纯模型恢复及 shell/program 受控启动/停止证据；完成独立回归、真实崩溃窗口和合同更新，供审查并待 Master 安排合入。
3. 本轮从 PR-A 验证后的提交开堆叠 PR-B 实现 #16（PR-A 仍不合并）：Scope schema/owner API、保留目录检查、Execution 绑定及集中路径解析，适配接续和归档；将 Master 已批准的 NONE 并行决定同步到 Issue #16 的相关合同条款。
4. 接入实际派发占槽、主会话范围快照、共享笔记和公开 DTO；完成跨两项 Issue 的联合场景。
5. 更新生成合同、状态目录、必要行为/测试文档，定向测试通过后跑完整 verify 和含 PG 的 CI；报告源码净增减及首次失败到修复的证据。

测试放入 `test_case/offline/issue16/` 与 `test_case/offline/issue18/`，自动纳入 #20 glob 和类型检查；复用 runtime、issue8、issue19 的 fixtures、真实子进程与专用 PG helper。不新增自定义 runner，不调用付费供应商。

| 验收组 | 场景与明确预期 |
| --- | --- |
| Scope CRUD | owner 创建 DIRECTORY/NONE、更新、归档；同 request_id 重放无重复记录；不同 body/revision 冲突；模型无写入口 |
| 路径冲突 | 不存在/非目录/符号链接、重复/双向嵌套根被拒；数据目录本身/祖先/子孙均报 SCOPE_ROOT_RESERVED；兄弟目录正常；源码仓库在不含运行数据时允许；NONE/旧 task/work 不被误拒；改根后的活动旧根仍被占用；两次竞争更新只有合法项成功 |
| 提案与兼容 | 主会话 fixture 把明确归属请求映射到 scope_id；DIRECTORY 在绑定根读写且无 task/work；NONE/无 scope 沿用临时目录；旧 journal 无新字段可读 |
| 单活动执行 | 同一 DIRECTORY 下同 tick 双 READY、DISPATCHING、WAIT_AUTH、WAIT_DECISION、CANCEL_REQUESTED 均阻塞第二项；前项确认停止后自动启动；同一 NONE 的不同任务可同时运行但不超全局 worker 限额；改 kind 不抹掉旧 DIRECTORY 占用 |
| 停止与未知 | 超时 shell 进入未知且受控进程退出后，另一同 Scope 执行可 shell；清理完成前不释放；新执行对同一未知文件仍被拒 |
| 根目录绑定 | 正在执行或待裁定时改根，read/write/shell/program/verify-write/产物均继续使用原绑定；排队旧根重新分配后显示 SCOPE_ROOT_CONFLICT |
| 接续与归档 | reuse 省略/null 继承 Scope，显式变更拒绝；归档拒绝新提案、阻塞排队项，已占槽项继续；原文件/任务/产物保留 |
| 笔记与预算 | `.secretary` 不存在时一次 write 授权完成目录与笔记创建，拒绝授权不创建；下一任务可见；NONE 无笔记；含伪系统指令/分隔符的笔记仍位于转义数据字段，不改变工具权限；大列表/大笔记截断且计入预算，重试保持快照 |
| 文件边界与 CAS | `..`、绝对路径、符号链接及根替换被拒；提交文件成为不可变 CAS，随后修改源文件不改变产物 |
| 四种裁定 | shell/program 的 APPLIED/NOT_APPLIED/PARTIAL/UNVERIFIED 状态和 effect 正确，回执含 actor/note/原证据；执行最终 FAILED，反馈含裁定内容 |
| 拦截与幂等 | 同执行未知 shell/program 跨 action 仍拦截，不同执行同目录/同程序不封锁；未知 file.write 跨执行仍拦截，包括历史绝对 resource；请求重放原结果，revision 冲突和非未知裁定明确拒绝 |
| 多操作与核验 | 第一项裁定后剩余未知仍可见；最后一项才终结；verify-write 成功同样收束，哈希不符不解除 |
| 真实重启窗口 | 子进程分别在裁定提交后/Execution 终态提交后 SIGKILL；重启补完且只一份 TaskResult、一条终结 Feedback；重复重启不增加 |
| 孤儿进程与启动窗口 | shell/program 写计数文件时 SIGKILL Core，重启后旧组停止前第二个同 Scope 执行不得启动；分别终止于 wrapper spawn 后/身份落盘前/许可发送前后，证明未登记命令不会运行、已登记命令可清理 |
| 四分支恢复 | 系统启动标识可靠变更、进程组明确不存在分别得到 STOPPED 且不发终止信号；身份匹配时 TERM → 两秒后重验 → 必要时 KILL → 复查；身份不符/EPERM/证据缺失保留占用并通知；启动标识缺失及其他主机数据不误判成重启 |
| 清理失败与误杀防护 | TERM 不退出时升级 KILL；两次信号之间组消失或身份变化则不发送旧定时器的 KILL；leader 先退出但组员仍运行不得放行；身份复用/权限拒绝/清理超时/旧记录缺身份时不盲杀、不释放，通知去重；先裁定 UNVERIFIED 仍不绕过停止检查 |
| 平台真实验证 | macOS 本机与 Linux CI 都以真实进程覆盖 Core SIGKILL、wrapper EOF 自行清理、受控组仍存活时 Core 的恢复清理、TERM 无效后升级及组员先后退出；身份复用和系统启动标识分支可另用确定性 fixture，不重启工作站制造测试 |
| TASK 模型恢复 | IN_FLIGHT 时 SIGKILL 后有界恢复；成功响应保存到 checkpoint 之间 SIGKILL 后零重发；已有工具结果不重复执行；重启不重置尝试次数 |
| 恢复负例 | PROGRAM、取消中、无可靠模型证据、损坏 checkpoint 不重跑；DISPATCHED 副作用先转未知等待裁定；纯模型三次耗尽终结反馈 |

执行命令：

```sh
npm run types:generate
npm run api:generate
npm run docs:generate
npx tsx --test "test_case/offline/issue16/*.test.ts" "test_case/offline/issue18/*.test.ts"
npm run verify
git diff --check
git diff --numstat
```

本地无 DSN 的 skip 单独报告；完整验收在配置专用 `SECRETARY_TEST_DATABASE_URL`、`SECRETARY_REQUIRE_PG=1` 的隔离环境/CI 执行。保留现有 AUD14 todo 的归属，不把它改成通过。证据记录在 `test_case/reports/issue16-18/`，首次失败原样保留；公开 PR 仅提交合成 fixture、脱敏结果与必要摘要。

## 6. 工作量、风险与回退

修订估计 5–8 人日：#18 裁定/收束约 1 日，TASK 恢复约 1–1.5 日，受控进程启动/停止与跨平台崩溃验证约 1–2 日，Scope/路径/派发约 1.5–2 日，合同与联合回归约 0.5–1.5 日。新增工作主要来自 B2 的真实崩溃窗口，不以“约 20 行”代替估算；两个 PR 分别审查和报告实际开销。

#18 的整理目标仍是生产源码净增不超过 200 行。裁定和共用收束优先替换旧分支；跨进程 TASK 恢复与 B2 启动/停止封装使超出目标的可能性上升，PR 分别报告裁定、模型恢复、进程管理三部分增减和理由。#16 的净增减单独统计；生成代码、测试、文档与手写生产源码分列，报告删除的重复路径及收束逻辑。

主要风险是重建模型请求改变身份、已有授权在新占槽顺序下失配、旧绑定目录被重新分配，以及重启清理误杀/漏杀进程。以上分别由原请求恢复、WAIT_AUTH/PROGRAM 回归、跨 Scope 根冲突和真实启动/停止窗口场景覆盖。共享目录下 bash 仍是当前本地用户权限，工作根约束不构成 OS 沙箱。

发布前对测试/目标数据目录进行可恢复备份。新版本保持读取旧 journal；不要求旧版本理解新 Scope 记录。若需回退程序版本，应停止新 Core、保留新 journal/CAS 和项目目录副本，再恢复版本匹配的旧数据备份；不得为降级删除已产生的 Scope 记录或自动撤销项目文件。代码先通过独立 PR 审查，再由 Master 安排合入/部署。

## 7. 执行记录

### Ayanami 审查处理（2026-10-12）

审查来源：Master 提供的 `review_20261012_fix-plan_issue16_18.md`。逐项以当前 main 源码和 Issue #16 正文复核；本节是处理决定，不代表 Ayanami 已复审通过。

| 项目 | 决定与核实依据 |
| --- | --- |
| B1 数据目录 | 采纳数据目录双向重叠拒绝、守卫和验收；不采纳附带的源码目录普遍禁用。纠正“此前不存在风险”的说法：原 bash 已可访问 cwd 外，新增规则防止普通项目根覆盖运行数据 |
| B2 孤儿进程 | 必须修复；补持久启动身份、先落盘后放行、有界清理、失败保留占用及通知。不能照搬只存 PGID 的实现建议，须覆盖 spawn 落盘窗口和身份复用 |
| N1 无重连恢复 | 采纳 Master 本轮转述：删除重连 wrapper，明确四种恢复分支；补两次信号分别核验、ESRCH/EPERM 区分与 POSIX 复用保证的适用范围。macOS 真实验证、Linux CI；保留 5–8 人日及三部分行数报告 |
| S1 推迟绑定 | 不采纳；与 Issue 创建时绑定的多处要求及派发前 RESOURCE_PRESENT 语义冲突，保留旧绑定冲突处理 |
| S2 NONE 并行 | 已由 Master 明确选择“仅 DIRECTORY 串行，NONE 可并行”；正文与验收已修改，实施前同步 Issue 合同 |
| S3 两个 PR | 采纳；#18 独立交付在先，#16 基于其合入后 main，共同验收后结项 |
| 小问题 1：mkdir | 纠正原计划；实际导入的 harness write / NodeExecutionEnv 已自动创建父目录，无须新增机制或推迟到 #17 |
| 小问题 2：resource | 采纳；写明规范物理绝对路径、历史格式依据、不改审批哈希及历史未知操作回归 |
| 小问题 3：笔记边界 | 采纳；复用 JSON 包的数据字段与固定 authority 标记，增加注入文本边界场景，不新造模板协议 |
| 小问题 4：行数 | 保留分项报告原则；B2 开销纳入估算，不把 200 行视为删减必要行为的理由 |

### 工作记录

- 2026-10-12：已读取 #7/#16/#18/#19/#20、核对远端 main 与前置合并记录，完成相关源码静态检查。
- 2026-10-12：#16、#18 已指派并发布 Codex 同批领取说明。
- 2026-10-12：联合计划完成，状态为待 Master 确认；本轮变更仅计划与索引，未实施功能或运行行为测试。
- 2026-10-12：`npm run docs:check` 通过（203 个已跟踪 Markdown、3092 个本地链接、0 错误）；另行检查尚未跟踪的新计划链接与代码围栏，通过。`git diff --check` 通过。
- 2026-10-12：按审查完成本次修订；已重新核对 HEAD/远端 main 仍为 cc1a976。本轮仅修改 fix 计划并同步复核副本，未实施生产代码、未运行进程终止或行为测试。
- 2026-10-12：修订后重新通过 docs:check 与 git diff --check；新计划单独通过链接、围栏、尾随空格及旧 NONE 串行条款残留检查。计划文件当前仍为未跟踪文件，docs:check 的已跟踪文件统计不包含它。
- 2026-10-12：核实 N1 与 POSIX 进程组/kill 语义后修订 B2 和验收矩阵；N1 来源为 Master 本轮消息，原审查报告文件尚未包含该条。仅修改计划，未执行生产代码或真实进程测试。

- 2026-10-12：Master 授权开始实施，完成验证并提交 PR/CI 后通知复核，先不合并。两个 PR 使用堆叠分支满足本轮要求。实施基线 cc1a976；本地首次完整 verify 日志单独保留。
