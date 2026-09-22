# Pi Secretary 实现复核

本轮交付是可运行的实现验证原型。BrainStorm v3 与根目录的状态机、JSON、World Model schema 仍是设计依据；本页明确实现路径和验证边界。

## 源码复用

Pi 官方源码放在 `../pi_resource`，以 submodule 固定在 v0.87.0 / `16787ad5b2dc748047f314ca1bfe7708f30f54f3`。直接导入 Agent、agent loop、read/write 工具和 Node 文件后端；模型传输使用同版本 Pi AI 包。上游源码未修改。Secretary 的持久化、调度和授权由外层组合实现。

为直接复用 Pi 源码，此原型采用 TypeScript。根目录 demo_design 的 Go 目录规划未被当作已实现代码。

## 设计与实现对应

| 职责 | 实现位置 | 本轮行为 |
|---|---|---|
| 唯一主会话与输入驱动 | src/host.ts、app.ts | 接收与处理要求一起持久化；忙碌时保留新输入；宿主驱动 Pi loop |
| Context 与模型交接 | src/context.ts、transport.ts | 保存原始消息、不可变对象及调用记录；模型结果保存后才执行工具 |
| Consciousness | src/host.ts | 宿主安排无工具的独立整理调用，固定材料范围、版本检查；保留原件，不产生新输入 |
| Scheduler | src/scheduler.ts | 初始化 task workspace；计划与执行分离；即时、定时和固定间隔任务；前置条件、等待决定、取消、反馈和短期回收 |
| 执行端 | src/model.ts、scheduler.ts | 新 Pi Agent 可装入保存的 Context；人工登记 Node 程序按版本与代码摘要执行 |
| 授权 | src/authorization.ts、server.ts | 规则匹配或独立 Master 界面批准；参数与范围绑定；最终分派前检查；主会话没有授权工具 |
| Operation Log / Task Log | src/store.ts | 原文对象、带摘要的提交帧、任务日志与跨对象提交；写入后 ACK；历史不随 Scheduler 回收删除 |
| World Model | src/world.ts | 使用根目录 PostgreSQL schema；事实与来源、冲突、版本检查、提交回执、outbox |
| 主会话界面 | web/index.html | 消息、任务详情、授权原文及普通工作决定；显示离线/真实模型模式 |

持久化结构通过根目录 JSON Schema 校验。模型输出仍是提案；授权与状态事实由宿主和 Scheduler 检查。后续处理创建新执行，不把已完成执行改回运行中。任务结果与证据先保存，随后才向主会话投递简要反馈。

## 已执行验证

环境：Node.js 22.22.0、PostgreSQL 18.6；模型模式为 OFFLINE_FIXTURE。

| 检查 | 结果与证据 |
|---|---|
| TypeScript 严格检查 | npm run check 通过 |
| 离线运行测试 | 17 通过、0 失败；普通测试中的 PostgreSQL 项跳过，另行真实执行。见 [runtime.tap](reports/runtime.tap) |
| PostgreSQL 独立集成测试 | 临时真实数据库中 1 通过、0 失败。见 [postgres.tap](reports/postgres.tap) |
| 启动检查 | 实际启动服务、读取页面、认证提交输入并完成 Pi task。见 [cli-smoke.json](reports/cli-smoke.json) |
| 格式检查 | npm run format:check 通过 |
| 生产依赖审计 | 0 已报告漏洞。见 [dependency-audit.json](reports/dependency-audit.json) |

测试覆盖真实 Pi 工具循环、主会话忙碌时的新输入、批准前不写入/不启动程序、拒绝批准、同批后续工具停止、真实子程序输出、结果未知不重复、任务回收与历史保留、原始对象缺失、文件锁、日志损坏，以及不同进程在 SIGKILL 后恢复已确认输入与原始 Context。另覆盖主会话模型等待期间 Scheduler 仍能执行已批准任务。数据库测试覆盖授权、事实冲突、版本检查、回执与 outbox 重放。

## 复核边界

- 这不是全部状态机迁移的完成证明。模块实现了上述闭环，没有对全部 131 条设计迁移逐条覆盖；部分契约（如独立 WorkerReceipt）尚未作为单独运行对象生成。
- Agent 执行者当前是同一宿主中的独立实例；程序是实际子进程。已验证跨进程重载 Context，但尚未部署独立常驻 Agent worker 服务。
- 真实 provider 调用、模型任务完成质量、Consciousness 摘要质量和长期真实使用未验证。离线 fixture 产生确定回复，不证明这些能力。
- 执行 agent 的工具集为 read/write 与普通工作决定；程序后端为人工登记的 Node 脚本。外部设备、环境推送、任意语言程序适配器未接入。
- 支持已完成执行依赖、本地 workspace 资源和登记的 local 设备条件。后续任务目前创建新 task；同计划复用接续入口尚未提供。程序不支持通用现场恢复。
- 未知作用保持停止。文件写入提供只读结果核验；任意程序的未知结果仍需人工核查，没有自动重复执行。
- 共享 workspace 是组织方式，不是操作系统隔离。程序按整体执行授权，运行权限属于当前用户；没有实现复杂的任务进程沙箱。
- 当前日志没有轮转、历史 GC 和恢复快照加速。验证包含进程中断，不包含断电或硬件持久化故障实验。

启动、模型配置、数据库初始化与人工程序登记见 [README.md](README.md)。建议先在默认离线模式复核消息→任务→授权→执行→反馈→重启恢复，再接入真实模型进行下一阶段验证。
