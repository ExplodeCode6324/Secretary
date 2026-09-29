# 当前架构

```mermaid
flowchart TD
  TUI[TUI client] --> B[本机共享 backend]
  WEB[WebUI] --> B
  B --> APP[App]
  APP --> G[Settings 生效协调器]
  G --> H[Host 主会话]
  G --> W[World 可选]
  APP --> H[Host 主会话]
  APP --> S[Scheduler]
  APP --> W[World 可选]
  H --> MAIN[Pi Agent 主会话]
  H --> S
  S --> TASK[Pi Agent 执行者]
  S --> P[登记 Node 程序]
  S --> A[Authorization]
  W --> A
  W --> PG[(PostgreSQL wm)]
  H --> ST[(Store journal + objects)]
  S --> ST
  A --> ST
  W --> ST
```

## 模块与所有权

| 源码（src/pi_secretary/src） | 实际职责 |
| --- | --- |
| app.ts | 打开 Store，恢复授权与任务，创建 Host；pump 协调 World drain、tick、retire、反馈和主会话 |
| host.ts | 接收/领取输入、唯一主会话 loop、工具幂等、反馈承接、工作记忆整理 |
| scheduler.ts | 任务提案、workspace 初始化、触发、前置条件、并发执行、授权后续接、结果和归档 |
| authorization.ts | 操作准备、规则匹配、Master 决定、派发前复核、回执和未知作用恢复 |
| store.ts / lock.py | 契约校验、对象库、JSONL 事务、请求幂等和 OS 文件锁 |
| settings.ts / settings-memory.ts / settings-payload.ts | 草稿、批次生效、完整来源摘要、上下文重建与恢复 |
| world.ts | 迁移、World 变更、SQL 事务、证据与 outbox 桥接 |
| model.ts / transport.ts | fixture/live、双角色模型配置、请求/响应持久化、主会话增量观察 |
| preview.ts | 有界内存预览、正文与可见思考投影、独立版本号 |
| context.ts | 原始上下文、checkpoint、token 预估与来源元数据 |
| memory.ts / instructions.ts / task-prompt.ts | 承诺维护、用户说明、基础 prompt、执行交接协议 |
| backend.ts / ui-client.ts | localhost API、token、客户端状态与自动连接后台 |
| client-tui.ts / tui.ts / web.ts | 终端客户端、共享命令控制器、浏览器入口 |

Web 静态资源在 `src/pi_secretary/web`；人工程序示例在 `src/pi_secretary/examples`。根目录 npm scripts 是统一启动入口。

## Pi 集成

[src/UPSTREAM.json](../src/UPSTREAM.json) 锁定 Pi v0.87.0 和 commit。`src/pi_resource` 是 Git 子模块；Agent、Agent 类型、read/write 工具和 NodeExecutionEnv 直接导入其源码。模型传输依赖相同版本 `@earendil-works/pi-ai`，另使用 Chord 包。Secretary 未把上游整个 CLI 或任意扩展机制作为主会话权限入口。上游自带文档和测试随子模块保留，不是 Secretary 自有 docs/test 分类的副本。

## 运行时关系

一个数据目录由一个后台持有文件锁，多个 TUI/Web 客户端共享该实例。Host 串行处理主会话；任务默认最多两个执行者，任务 Agent 内部工具顺序执行。后台每 300ms pump；不同工作路径通过各自的 busy/running 标记避免重复进入。它不是分布式 worker 队列。

模型模式由 `SECRETARY_MODE` 选择。fixture 使用真实 Agent loop 加固定输出；live 使用 provider。World Model 无数据库配置时返回 UNAVAILABLE，主会话、任务和 JSONL 存储仍可独立运行。

## 主会话流式显示

`durableStream` 对主会话供应商事件保持单消费者，复制到延迟交付 Agent 的事件流，并将可见文本增量发送给 Host 的内存预览。完整响应仍先写入 ModelCall 与 journal，保存成功后 Agent 才能取得响应并执行工具。显示回调失败不改变执行结果；取消或超时会中止等待，保存失败不能放行响应。

预览不参与上下文、授权或任务决策。最多保留 8 个调用，每个调用最多 128 个文本块、32768 个字符；签名、redacted 块、工具参数不投影。按 session、loop、call 和块索引关联，最终 `main.message` 附带显示调用 ID，前端据此替换临时消息而不重复追加。预览只有内存副本，完整历史仍来自持久化消息。

`/api/stream` 使用经过同源、Bearer token 和 client 校验的 SSE，前端通过带 Authorization header 的 fetch 接收；每 100ms 合并发送变化快照、每约 10 秒发送心跳。快照自带独立版本，重连从当前快照继续；客户端不共享消费队列。慢客户端积压超过 512KiB 时断开以便重连，连接关闭清理定时器。`/api/state` 继续以 700ms 轮询更新持久状态、任务和授权。两个接口仅在 `thinking=1` 时投影可见思考字段。

前端按调用或消息 ID 复用节点，保留折叠状态，用户位于底部时才跟随滚动。显示偏好变更会使状态缓存失效，并阻止旧请求把已隐藏的思考重新写入页面；不经过全局 Settings 生效流程。

## 任务身份与执行轮次

主会话可自行推理、分析材料和解释结果；文件操作、外部动作和需要独立执行上下文的工作才交给任务执行者。对同一工作的修改，通过 task_propose 复用 Task 身份，按轮次创建独立 Execution。TaskPlan 保留最初提案与周期安排，Execution 的 proposal_ref 固定本轮目标、约束、验收、前提、截止时间及执行器。恢复旧 Execution 不等于创建接续轮次。

Scheduler 在单次 journal 提交中登记即时请求、回执和 parent 留存保护；tick 在单次提交中消费请求并创建执行。work 目录按 Task 共享，结果、checkpoint 与不可变产物按 Execution 保存。每个 Task 同时最多一个活跃执行或待执行接续；本阶段只接续最新终结执行，不提供历史分支、运行中追加要求或归档恢复。
