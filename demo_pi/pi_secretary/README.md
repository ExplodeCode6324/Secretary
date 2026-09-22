# pi_secretary

Secretary 的可运行验证原型。模型循环直接从 `../pi_resource/packages/agent/src/agent.ts` 导入；执行端的 read/write 和 Node 文件后端也复用 Pi 源码。Secretary 自己实现输入队列、可靠提交、调度、统一授权和资料交接。

## 启动与复核

在 `demo_pi` 目录运行 `npm start`，打开 `http://127.0.0.1:4317`。将启动信息所指向的 `master.token` 文件内容填入页面的访问密钥框。默认运行数据保存在 `demo_pi/.demo-data`，已排除出 Git。

1. 发送普通消息，检查主会话回复与持久化。
2. 离线模式发送 `task: 整理一份测试报告`，查看任务、结果与主会话反馈。
3. 人工登记示例程序，再在页面选择它创建任务；批准前不会启动，批准后产生真实程序输出与 `report.json`。
4. 停止应用后重新启动，原会话、输入、任务和日志仍在。强制中断后的未知作用保持停止，不能把“重启”当成重试。

`Ctrl+C` 停止应用。服务只绑定本机回环地址。主会话忙碌、暂停或整理工作记忆时，独立授权界面仍能驱动任务。

## 人工程序登记

程序登记由 Master 执行，主会话没有登记工具。在 `demo_pi` 中可以用以下本地 CLI：

```sh
npm run register-example
```

CLI 读取同一 data root 的 Master key，向正在运行的本机应用登记 `pi_secretary/examples/report.mjs`，不输出密钥。程序协议为 stdin 接收 JSON，stdout 输出符合登记结果 schema 的 JSON，stderr 保存过程记录。示例程序将文件写入该 task 的 workspace。

本原型的程序后端运行人工登记的 Node 脚本，启动时核对登记版本与入口文件 SHA-256。授权界面展示版本、代码摘要、参数及整体执行范围；内部动作以该程序的整体执行为授权单位。`supports_resume=false`，不把程序日志当作任意现场的恢复能力。

## 真实模型模式

设置 `SECRETARY_MODE=live`、`SECRETARY_PROVIDER`、`SECRETARY_MODEL`，以及对应 Pi provider 的凭据环境变量，再运行 `npm start`。模型标识必须在固定 Pi 版本的模型目录中存在。凭据不会写入本仓库；本轮未调用真实模型，未验证具体 provider 的账号可用性。

不同任务默认最多 2 个执行者，可通过 `SECRETARY_MAX_WORKERS` 调整。每个 loop 最多 20 次模型调用，单次传输设置 120 秒中断信号。主会话只注册 MemoryUtil/TaskControl/MasterInteract 对应的六个工具。执行 agent 注册 Pi read/write 和普通工作决定工具；写入经过 Scheduler 最终授权检查。没有直接给主会话注册 Pi bash 或任意扩展加载入口。

默认上下文容量取模型元数据，预留 4096 tokens；字节估算用于预先阻塞，最终 token 消耗仍由 provider 决定。`SECRETARY_COMPACTION_BYTES` 控制宿主自动安排整理的原文长度阈值，默认 32768 bytes。保留未承接原文；整理模型输出按事项形成工作记忆。离线 fixture 不证明摘要质量或压缩效果。

## World Model

设置 `SECRETARY_DATABASE_URL` 指向**为这个 demo 专门准备的数据库**，首次运行：

```sh
npm start -- --migrate
```

该开关只在 wm.schema_version 不存在时应用项目 `schema/001_world_model.sql` 和 `002_predicates.sql`。不修改别的 schema，不自动清空数据库。不要将原型接到有业务数据的数据库。

World Model 未配置时，对应工具明确返回 UNAVAILABLE；其他模块仍可独立运行。实体/来源登记、事实新增/更正/撤回、冲突投影、版本 CAS、提交回执和 outbox 都由 PostgreSQL 后端执行。所需授权通过同一 Scheduler，PostgreSQL 不保存授权规则。

## 数据与恢复

`Store` 对所有持久化记录执行项目 JSON Schema 校验，单个 JSONL 帧包含跨对象变更与日志。对象先落盘并同步，再同步 journal 后确认接收。系统文件锁由小型 Python fcntl helper 持有，进程管道关闭后由 OS 释放，不以 PID 文件冒充互斥。

Context 原始字节、工具输入输出、程序 stdout/stderr 和结果对象按内容摘要保存。`workspaces/<task_id>` 的工作文件可变，证据/Context 对象不可变。复载校验 hash；原件缺失或日志中段损坏会阻塞恢复。

详情查询刷新短期留存，列表查询不刷新；候选 48 小时只作用于已终结、没有待处理工作的执行。退出后仍保留历史对象。当前未实现历史 GC、日志分段和快照加速，因此日志会随使用增长。

## 验证

```sh
npm run check
npm test
python3 pi_secretary/scripts/test-postgres.py --pg-bin /path/to/postgresql/bin
```

普通测试不调用真实模型。PostgreSQL 测试脚本自己创建临时集群，执行真实 TypeScript 仓储，再停止并清理；不连接应用数据库。具体结果和运行边界见 [REVIEW.md](REVIEW.md)。
