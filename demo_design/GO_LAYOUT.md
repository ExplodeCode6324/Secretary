# Go 模块、目录、文件与函数

下面是计划中的 Go 源码树，不表示这些文件已经实现。一个 module、一个应用入口，按职责分 internal 包；不拆微服务。领域结构与 JSON 契约一一对应，字段使用 `json` tag；UUID 用具名字符串类型，时间统一 time.Time，版本/序号用 int64 并遵守 JSON 数值上限。可扩展 value/参数用 json.RawMessage，读取后仍按登记 schema 校验。数据库实现建议 pgx，具体版本实现时固定在 go.mod。

```text
cmd/secretary/main.go
internal/app/{app.go,bootstrap.go,shutdown.go}
internal/config/config.go
internal/domain/{ids.go,records.go,events.go,errors.go,transitions.go}
internal/store/{store.go,journal.go,objects.go,snapshots.go,replay.go,lock.go}
internal/ingress/service.go
internal/session/{host.go,loop.go,recovery.go}
internal/contextbuild/{builder.go,budget.go,codec.go}
internal/consciousness/{service.go,validate.go}
internal/memory/service.go
internal/scheduler/{service.go,initialize.go,trigger.go,preconditions.go,dispatch.go,
                    feedback.go,decisions.go,control.go,retention.go,reconcile.go}
internal/authorization/{service.go,rules.go,gate.go}
internal/executor/{manager.go,agent.go,program.go,checkpoint.go,receipts.go}
internal/registry/{service.go,validate.go}
internal/worldmodel/{service.go,repository.go,postgres.go,catalog.go,query.go,outbox.go}
internal/operationlog/{service.go,archive.go}
internal/interaction/{service.go,delivery.go}
internal/transport/{server.go,master.go,worker.go,tools.go,middleware.go}
internal/adapter/{model.go,channel.go,tools.go}
internal/clock/clock.go
migrations/worldmodel/{001_world_model.sql,002_predicates.sql}
internal/tui/                # TUI 终端客户端，主会话与授权区域共享界面
programs/                    # 人工登记程序的源代码/文档，不放运行状态
configs/example.json          # 只存非秘密示例；DSN/凭据从环境或秘密存储读取
```

## 依赖方向

transport/app → domain services → store 或 worldmodel.Repository；所有包可依赖 domain。domain 不依赖数据库、模型、HTTP、Scheduler 或宿主。executor 通过宿主 gateway 申请实际动作，不直写 Scheduler 状态。MemoryUtil 是主会话工具组合；World Model 是其一个后端，授权仍由统一 authorization 服务处理。

跨域提交使用 store.Commit 接受已验证的变更批次。各服务不能相互私写对象；组合服务先构建 candidate view，再提交。长时间模型调用/进程等待/网络不持有 store 写锁或 PG 事务。所有读结果是不可变快照，避免 goroutine 共用可变指针。

## 公共签名约定

下表为函数级设计签名，`ctx` 指 Go context.Context，`d` 指 domain 包；函数默认返回最后一个 error。ID、Revision 等为 domain 具名类型。Snapshot/View 只读；MutationBatch 对应 JournalTransaction 待提交内容。Go 的 context.Context 只用于取消/截止时间，与模型 Context 不是同一种对象。

| 文件 | 核心函数/方法签名与职责 |
| --- | --- |
| cmd/secretary/main.go | `main()`：解析 serve、program validate/import、world migrate、check-data 子命令；不写业务规则 |
| app/app.go | `New(cfg Config, deps Dependencies) (*App,error)`；`Run(ctx) error`：组装单一 Store、Scheduler、Host、HTTP 与 outbox worker |
| app/bootstrap.go | `Recover(ctx) (RecoveryReport,error)`：取得所有权、重放、核验 PG 桥接与在途操作，成功才开始分派 |
| app/shutdown.go | `Drain(ctx) error`：停止新分派、保存边界、停止可停止 worker、关闭 writer；超时报告未决作用 |
| config/config.go | `Load(path string) (Config,error)`；`Validate(Config) error`：交叉检查预算、根路径、秘密引用与正数上限 |
| domain/records.go | 定义 JSON 契约的 Go 类型与枚举；`ValidateShape(v any) error`：严格版本/未知字段/时间格式，随后进入服务语义校验 |
| domain/transitions.go | `Transition(machine,from,event string, facts GuardFacts) (TransitionResult,error)`：纯函数验证 catalog 中边；不执行 I/O |
| domain/events.go | `NewEvent(kind string, scope Scope, payload ObjectRef) Event`：固定事件类型与因果关联；event_type 注册表见 [API](API.md) |
| domain/errors.go | Typed errors：Invalid、Conflict、NotFound、Retired、Unavailable、RecoveryBlocked、OutcomeUnknown；不把未知当可重试失败 |
| store/store.go | `View() View`；`Commit(ctx, expected []Version, batch MutationBatch) (CommitReceipt,error)`：单写串行/CAS/跨对象验证；只在 Sync 后成功 |
| store/journal.go | `AppendAndSync(ctx, txn JournalTransaction) (FrameReceipt,error)`；`Scan(ctx) (VerifiedFrames,error)`：校验链/序号/checksum/尺寸 |
| store/objects.go | `Put(ctx, src io.Reader, media string) (ObjectRef,error)`；`OpenVerified(ctx, ref ObjectRef) (io.ReadCloser,error)`：精确字节、长度、散列与根路径检查 |
| store/snapshots.go | `WriteGeneration(ctx, view View, anchor FrameReceipt) error`；`LoadGeneration(ctx) (Snapshot,error)`：仅缓存，可从 journal 重建 |
| store/replay.go | `Replay(ctx, frames VerifiedFrames) (View,error)`：纯状态恢复，不外调；`CheckReferences(ctx, view View) error`：必要对象缺失则阻塞 |
| store/lock.go | `AcquireOwner(ctx) (OwnerLease,error)`；`Close() error`：本地独占锁，持久化 epoch；不使用 PID 文件充当互斥 |
| ingress/service.go | `Accept(ctx, principal Principal, raw []byte) (CommandReceipt,error)`：保存原始请求、去重并提交 Input；`DeliverFeedback(ctx, id ID) error`：反馈与 inbox 同帧 |
| session/host.go | `Wake(ctx) error`；`RunPending(ctx) error`；`ClaimBatch(ctx) (LoopCheckpoint,error)`：唯一逻辑主会话；新输入不覆盖已认领批次 |
| session/loop.go | `Step(ctx, loopID ID) (StepResult,error)`：构建 Context→保存调用意图→完整响应→按工具序列处理→保存结果；`Finish(ctx, loopID ID) error`：只标该批输入已处理 |
| session/recovery.go | `Resume(ctx, checkpoint LoopCheckpoint) error`：跳过已完成工具，未明操作先核验；已 CLAIMED 输入不重新从第一步执行 |
| contextbuild/builder.go | `BuildMain(ctx, request BuildRequest) (d.Context,error)`；`BuildTask(ctx, checkpoint *d.Checkpoint, additions []d.Message) (d.Context,error)`：固定一次调用的实际输入 |
| contextbuild/budget.go | `Measure(raw []byte, profile ModelProfile) (TokenEstimate,error)`；`CheckRequired(Budget) error`：必要原文不足时返回容量阻塞，不自动裁掉 |
| contextbuild/codec.go | `Encode(snapshot ModelInput) ([]byte,error)`；`LoadExact(ctx, ref ObjectRef, profile ModelProfile) (ModelInput,error)`：保留扩展块，兼容检查；新材料附加形成新快照，不改旧字节 |
| consciousness/service.go | `ShouldMaintain(view View, budget Budget) bool`；`Start(ctx, source FixedSource) (ID,error)`；`CommitCandidate(ctx, jobID ID) error`：宿主直接安排，不创建 Scheduler task |
| consciousness/validate.go | `ValidateCandidate(job CompactionJob, candidate Candidate, current Consciousness) (Coverage,error)`：revision、引用、完整交互、未处理输入与部分承接检查；不声称能证明语义无遗漏 |
| memory/service.go | `Read(ctx, request MemoryReadRequest) (MemoryReadResult,error)`；`ProposeChange(ctx, raw []byte) (CommandReceipt,error)`：统一主会话工具，写入只提案 |
| scheduler/service.go | `Propose(ctx, raw []byte) (CommandReceipt,error)`；`Query(ctx, q TaskQuery) (TaskQueryResult,error)`：提案验证、幂等与详情查询 TTL 原子刷新 |
| scheduler/initialize.go | `Initialize(ctx, taskID ID) error`：按已保存 task_id 建目录和 manifest；失败保留 INIT_FAILED；重复调用校验已有归属 |
| scheduler/trigger.go | `Due(plan TaskPlan, now time.Time) ([]Occurrence,error)`；`RecoverMissed(ctx, planID ID) error`：稳定 occurrence key、遗漏策略、重叠与 next_due 同帧推进 |
| scheduler/preconditions.go | `Check(ctx, plan TaskPlan) ([]ConditionResult,error)`：登记检查器验证设备/依赖/资源；UNKNOWN 不能当 MET |
| scheduler/dispatch.go | `PrepareDispatch(ctx, executionID ID) (Dispatch,error)`；`Launch(ctx, dispatchID ID) error`：先保存分派再启动，attempt 稳定，接续先核对旧 worker 已退出或可接管 |
| scheduler/feedback.go | `SaveProgress(ctx, progress Progress) error`；`FinishExecution(ctx, result TaskResult) error`；`SelectFeedback(plan TaskPlan, event Event) (*Feedback,error)`：证据先保存，终结与反馈同帧 |
| scheduler/decisions.go | `Ask(ctx, request DecisionRequest) (ID,error)`；`Answer(ctx, command TaskControlCommand) error`：Scheduler 持有问题，主会话/普通 UI 只能给普通工作决定 |
| scheduler/control.go | `Apply(ctx, command TaskControlCommand) error`；`FollowUp(ctx, proposal TaskProposal) (CommandReceipt,error)`：取消请求不当完成，终结执行不复活 |
| scheduler/retention.go | `TouchDetail(ctx, executionID ID) error`；`Eligible(view View, now time.Time) []ID`；`Retire(ctx, id ID) error`：manifest 验证与最终 CAS，正在被详情访问则退出候选失效 |
| scheduler/reconcile.go | `Reconcile(ctx) (ReconcileReport,error)`：核对 worker/操作/计划遗漏；只有有证据时从 UNKNOWN 转出 |
| authorization/service.go | `Request(ctx, operationID ID) (AuthorizationStatus,error)`；`Decide(ctx, principal MasterPrincipal, cmd ApprovalCommand) error`：只有认证 UI 可批准 |
| authorization/rules.go | `Match(ctx, action ActionScope) (RuleMatch,error)`；`ReplaceRule(ctx, principal MasterPrincipal, raw []byte) error`：登记动作、规范化资源、参数约束、版本/时效检查 |
| authorization/gate.go | `AcquireDispatch(ctx, operationID ID) (DispatchPermit,error)`：最终检查后原子消费一次批准/固定规则版本与 DISPATCHED；permit 内部类型不能由模型构造 |
| executor/manager.go | `Start(ctx, dispatch Dispatch) (WorkerIdentity,error)`；`Inspect(ctx, identity WorkerIdentity) (WorkerStatus,error)`；`Cancel(ctx, identity WorkerIdentity) error`：取消等待实际退出/回执 |
| executor/agent.go | `RunAgent(ctx, dispatch Dispatch, gateway Gateway) error`：按 profile 注册受控工具、完整 context 持续保存；等待时可 checkpoint 后退出 |
| executor/program.go | `RunProgram(ctx, inv ProgramInvocation) (ProgramResult,error)`：exec.Command 参数数组，固定版本/代码摘要；保存 stdout/stderr/退出码与关键输入环境 |
| executor/checkpoint.go | `Save(ctx, executionID ID, state WorkerState) (Checkpoint,error)`；`Restore(ctx, checkpointID ID) (WorkerState,error)`：完整 agent context 或程序自定义 resume；不假装程序日志可恢复任意现场 |
| executor/receipts.go | `Accept(ctx, principal WorkerPrincipal, receipt WorkerReceipt) error`：attempt/epoch 核对；过期进程回执进入证据核验，不授予新操作权 |
| registry/service.go | `Import(ctx, principal MasterPrincipal, raw []byte) (ProgramRegistration,error)`；`Enable/Disable(ctx, id ID, expected Revision) error`：人工入口，保存登记版本 |
| registry/validate.go | `ValidateRegistration(ctx, r ProgramRegistration) error`；`ValidateInvocation(ctx, inv ProgramInvocation) error`：路径、代码摘要、参数/结果 schema、恢复声明与能力清单 |
| worldmodel/service.go | `Propose(ctx, change WorldChangeOrCatalog) (WorldCommand,error)`；`ApplyAuthorized(ctx, commandID ID) error`：调用统一 gate；PG 回执决定结果 |
| worldmodel/repository.go | Repository 接口：`Apply(ctx, change WorldChangeOrCatalog, requestHash Digest) (WorldReceipt,error)`；`Receipt(ctx, changeID ID) (*WorldReceipt,error)`；`Query(ctx, q WorldQuery) (WorldReadResult,error)` |
| worldmodel/postgres.go | `ApplyFactTx(ctx, tx Tx, change WorldChange) (WorldReceipt,error)`：slot 锁、revision、证据、冲突、receipt、outbox；全部 SQL 参数化 |
| worldmodel/catalog.go | `ApplyCatalogTx(ctx, tx Tx, change WorldCatalogChange) (WorldReceipt,error)`：创建/修订实体及登记来源；名称仅检索标签，事实更正仍留依据 |
| worldmodel/query.go | `QueryPage(ctx, q WorldQuery) (WorldReadResult,error)`：事实有效时间、知识查询时间、冲突与来源；不因最新自动判真；稳定排序与游标 |
| worldmodel/outbox.go | `ExportPending(ctx) error`；`ReconcileCommand(ctx, id ID) error`：PG→journal 以 event_id 去重；记录完成后标 exported |
| operationlog/service.go | `Read(ctx, query LogQuery) (LogPage,error)`；`GetOriginal(ctx, ref ObjectRef) (io.ReadCloser,error)`：通过已提交 journal 投影读取，读历史不刷新 Scheduler TTL |
| operationlog/archive.go | `BuildManifest(ctx, executionID ID) (ArchiveManifest,error)`；`VerifyManifest(ctx, manifest ArchiveManifest) error`：检查任务原始记录和所有对象后允许退休 |
| interaction/service.go | `Queue(ctx, sessionID ID, message ObjectRef) (Notification,error)`：仅普通通知；回复也先持久化再展示 |
| interaction/delivery.go | `Deliver(ctx, id ID) error`；`ReconcileDelivery(ctx, id ID) error`：投递键稳定，结果未知不盲重发 |
| transport/server.go | `NewHandler(deps Services) http.Handler`：路由、限制体积、错误映射和版本 |
| transport/master.go | `PostInput`、`PostApproval`、`GetApprovals`、`PostRule`：固定身份入口，审批展示独立于主会话 loop |
| transport/worker.go | `PostReceipt`、`PostOperation`、`PostCheckpoint`、`PostResult`：受限 worker 路由；不能接受批准或任意状态覆盖 |
| transport/tools.go | `MemoryRead`、`MemoryProposeChange`、`TaskPropose`、`TaskQuery`、`TaskControl`、`MasterInteract`：仅暴露主会话允许工具；返回继续本轮 loop |
| transport/middleware.go | `AuthenticateMaster`、`AuthenticateWorker`、`CheckOrigin`、`DecodeStrict`：不从 JSON actor 字段获得身份 |
| adapter/model.go | Model 接口：`Complete(ctx, rawContext []byte, profile ModelProfile) (CompleteResponse,error)`；`CountTokens(...)`；部分流仅供展示，不执行其中工具 |
| adapter/tools.go | ToolBackend 接口：`Validate`、`Execute`、`InspectEffect`；只有 gateway 签发的内部 permit 才可执行；不能核验则 UNKNOWN |
| adapter/channel.go | Channel 接口：`Send(ctx, deliveryKey ID, body []byte) (DeliveryReceipt,error)`；`Lookup(ctx,key ID)`；没有 Lookup 能力要显式报告限制 |
| clock/clock.go | Clock 接口 `Now() time.Time`、`After(d time.Duration)`：为调度/过期测试注入时钟，不作为权限证据 |

## goroutine 与边界

应用维持一个提交协调器、一个主会话 loop runner、最多一个可提交的整理 job、Scheduler 触发扫描、按 max_workers 限制的执行管理，以及 outbox/通知投递队列。goroutine 数量不是持久化状态；唤醒 channel 只是提示，漏掉提示也要由 durable inbox 扫描继续处理。

进程取消和超时只发出停止请求。`context.CancelFunc` 不等待工作结束，见 [Go 文档](https://pkg.go.dev/context#CancelFunc)。worker 是否停止、作用是否发生须通过 receipt 或核验判断。

测试文件与被测文件同包或相邻 integration 目录。优先覆盖 crash boundary、并发 CAS、未知结果、防重分派、审批权限与 context 字节相等；无需为普通 getter 增加镜像测试。
