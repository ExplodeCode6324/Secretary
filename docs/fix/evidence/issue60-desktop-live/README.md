# Issue #60：计划复核与实施证据

当前范围：fix；Master 已批准实施。基线 main `a4a9a33b1f3e57b356db96d9db69f08a09def68d`。

- [中文计划](../../fix_20261020_issue60_最小桌面真实模型链路.md)
- [English plan](../../fix_20261020_issue60_最小桌面真实模型链路.en.md)
- Reviewer：浏览器 Claude **Opus 5.5 / Extra**，界面已核验；全程英文。
- [同一复核会话](https://claude.ai/chat/3de6f59f-0769-44ee-adc9-d32114884c0d)，发送仓库地址及完整英文计划，未要求访问本机文件。
- 原始文件沿用前次 Hermes 的 `/tmp/secretary-issue59-hermes/` 结构，本次为 `/tmp/secretary-issue60-claude/plan-rN-request.md`、`plan-rN-report.txt`。该目录在仓库外；公开证据只记脱敏结论与处置。
- Claude R1 声明成功克隆并检查到同一基线；未完成依赖安装/运行测试，因此源码判断与实际运行证据分开。

| R1 意见 | Codex 评估与 R2 处置 |
| --- | --- |
| B1：两帧队列与每秒消费不匹配，空闲也会溢出重连、清空预览 | 源码独立确认。明确先修 latest transient mailbox，独立轻量 250ms 读取，有界持久提示溢出走追赶；真桥实际 cadence 至少 10 秒回归。 |
| B2：timeline 含 in-flight 行，API 丢失 running/truncated，call_id 不能证明持久最终态 | 源码确认。增加源自 row.source 的兼容 persistence 元数据及瞬态状态；独立 journal main.message/display_call_id 作最终态判据。 |
| B3：切换 subscribe 会清 cache/cursor 并重验已受理 outbox | 源码确认。选择固定基础订阅与直接详情 query；选中项变化不调用 subscribe，以已存在持久 cursor 合并刷新；测试无滚动/回执状态回退。 |
| B4：live 没有公开改 revision/hash/expiry 的入口 | 接受验收重界定：真实 stale 用第二公共 API 客户端拒绝同一授权；hash mismatch 为 harness 合成；自然 live 时间到期 N/A、fixture 覆盖处理。不修改 live Store、不新增 expiry 功能。该边界明确交 Master 随计划批准。 |
| B5：普通 Release 不接受测试 app-data override | 明确真实 app-data 下唯一测试 profile 的具体添加/清理方案，保留现有项，原子比较更新，发现并发修改停止；计划批准包含该可逆配置变更。 |
| B6：独立 Core 下预算承诺没有硬执行机制 | 使用测试独立 launcher 导入生产 App/serveCore，两角色真实 provider stream 共用调用前限额；每场景 12 次/10 分钟、全局 48 次/40 分钟、4096 输出 token、并发 1、开始间隔 20 秒，retry/后台调用计入；另有 watchdog/ModelCall 对账。 |

非阻塞建议：明确数值响应门槛；viewed 和通用 AnswerCommand 后置；pending 从持久 outbox 恢复；message ID 锚点；默认保存名清洗；关联缺失如实显示；oversize approval 禁用；检查无旧接口/TUI 旁路。

| 轮次 | 结论 | 当前状态 |
| --- | --- | --- |
| R1 | CHANGES_REQUIRED，6 项阻塞 | 已评估并同步中英文计划 |
| R2 | PASS | 六项阻塞均解决；五条实施注意事项已接受并纳入两版计划 |

计划阶段验证：`npm run docs:check` 通过。Master 实施批准已收到；Master 技术 GO/NO-GO 仍 PENDING。


R2 附带事项：完整候选 profiles 按原生规则预校验（16 项/16 KiB/0600、ID 字符和路径约束）；新命令权限/清单完整登记；第二客户端用 request_id/ApiCommand 归因；adapter 支持性预检查；修改后测空闲 CPU。均已写入两版计划，不是额外阻塞。

复核依据：Claude R2 重新检查少量 App/model/profile/manifest 源码，没有安装或运行测试。该 PASS 仅证明计划可执行，不代表实现通过或 Master GO。原始 R1/R2 报告与 R2 PASS 截图均已存 `/tmp/secretary-issue60-claude/`。

## 实现与本地验证（2026-10-20）

桌面增加消息/任务/执行/Result/Artifact 与一次性批准、拒绝入口。基础订阅固定；详情按选择与持久 cursor 刷新。API Message 增加可选 persistence、preview_status、truncated；旧客户端仍可读取。Rust 将高频瞬态放入单槽 mailbox，持久变更仍追赶；草稿与 outbox 入队不等待网络锁。未解决的同授权提交在 SQLite 事务内去重。保存对话框使用清洗后的产物名，保存仍验证完整性。

| 验证 | 结果 |
| --- | --- |
| `npm run verify` | 657 tests：616 PASS，41 按环境跳过，0 FAIL；类型与文档检查通过 |
| 桌面 `check` / `test` | 0 errors / warnings；TypeScript 与 Python 测试通过 |
| Rust 全量测试 | 27 PASS、1 原有 ignored；含实际 10 秒消费 cadence、30 秒 SSE、跨连接授权去重 |
| native-test / Release build | 均成功；Release 保持固定 app-data 与无全局 Tauri test API |
| 真实对话 | WKWebView 捕获 13 个不同内容帧，随后 persistence=durable；独立 journal 校验无重复 display_call_id |
| 免审批写入 | 模型仅用 write/read，精确内容及尾换行匹配；任务 SUCCEEDED，原生窗口显示 Result 与 Artifact |
| 查看参数后批准 | 精确命令/cwd 检查后由桌面批准；授权一次 CONSUMED，marker 一行，真实结果 SUCCEEDED |
| 拒绝/冲突 | 桌面拒绝真实操作；另一次由第二公共 API 客户端 REJECT，旧意图及错误 hash 均 APPROVAL_CONFLICT、无成功请求回执、无 marker |
| SSE 恢复 | 测试 launcher 仅销毁 SSE 连接；Core PID 不变、mailbox epoch 更新，等待授权的真实执行继续可读 |
| 客户端生命周期 | 一个真实执行在客户端已退出时仍 RUNNING（11:20:12 UTC），11:20:46 成功，11:21:04 才重开；同 execution ID、一次授权消费、一行 marker |
| 延迟 | Core SIGSTOP 时 50 个输入样本 p95=15ms，本地排队反馈 37ms；轻量 IPC p95=3ms（含驱动开销） |
| 普通 Release 保存/IME | PASS：系统保存框取消后再保存，文件 9 bytes 且 SHA-256 与源一致；真实中文候选、emoji、多行及 2412 字草稿，0 次意外发送 |
| Master 技术 GO / 合并 | PENDING；未合并 |

原始日志、截图、journal 审计和预算账本仅存仓库外 `/tmp/secretary-issue60-claude/` 与忽略目录 `.demo-data/issue60/`。包含失败尝试：原两帧瞬态队列 cadence 回归失败；master 角色误标导致验收误判；启动器仅在迭代器结束释放预算，遗漏只调用 result() 的后台消费者；批准恢复断言最初遗漏合法 DISPATCHING 状态。均保留日志并修正。最终批准测试通过；第一次生命周期记录独立证明 Core 在客户端缺席时完成。

Main 的部分后台记忆提取暴露基线 `CAPACITY_OUTPUT_LIMIT_CHANGED_BY_ADAPTER`，在出站前拒绝；未绕过检查、未换 provider。桌面如实展示失败，后续业务链路仍完成。预算按 admission 保守计数（包括这些本地拒绝），不把它们当成已发送的付费 HTTP 调用。重启/隔离新场景沿用账本，不重置全局计数、开始间隔或截止时间。模型为 opencode-go / deepseek-v4.1-flash（Main）及 gpt-5.6-luna（Task），与 Claude reviewer 无关。目前累计 42 次保守 admission（全局上限 48），其中 40 次有 usage；已报告 token 合计 146131。缺失 usage 不补估值。调用已静止，独立 watchdog 仍限制整个运行窗；停止时间在终审记录补充。

## 重现入口

`src/secretary_desktop/scripts/live-core.ts` 是测试 launcher，导入生产 App.open / serveCore；不属于正式 Core 启动合同。使用独立 `secretary_issue60_*` PostgreSQL 库、`.demo-data/issue60/<run>/` 私有目录及 scratch Scope。凭据文件是已授权的私有 JSON（main/task），只在进程中读取，不写入页面/配置/日志。角色 provider/model 必须显式配置。

```sh
ISSUE60_RUN="$RUN" SECRETARY_CREDENTIALS_FILE="$PRIVATE_KEYS" \
SECRETARY_DATABASE_URL="$ISOLATED_DATABASE" \
SECRETARY_MAIN_PROVIDER=opencode-go SECRETARY_MAIN_MODEL=deepseek-v4.1-flash \
SECRETARY_TASK_PROVIDER=opencode-go SECRETARY_TASK_MODEL=gpt-5.6-luna \
node --import tsx src/secretary_desktop/scripts/live-core.ts
```

先在 run 下写 `scenario.json`，name 为 conversation/allow/approve/reject/stale/recovery 之一。预算 12/场景、48/总计，10/40 分钟、4096 输出 tokens、并发一、调用间隔 20 秒，含重试与后台调用；SIGUSR1 仅供测试中断 SSE，SIGTERM 停止本次 Core。不要并行运行多个花费预算的 launcher；新隔离场景继承此前 calls.json。调用上限后的拒绝会影响 Main 的继续运行，应保留记录并停止该场景，而不是重置预算。

```sh
SECRETARY_DESKTOP_TEST_DATA="$RUN" BRIDGE_TEST=1 \
NATIVE_SPEC=./tests/workflow.native.ts npm run test:native --prefix src/secretary_desktop
```

其余 native specs：approval（实际参数审批与关闭前屏障）、recovery（原 profile 恢复/结果/闲置详情请求/IPC）、stale（第二客户端拒绝、错误 hash、SSE）、responsiveness（Core 暂停时输入及排队）。恢复验收应先记录客户端进程不存在且执行尚未完成，再等 Core 独立完成，最后重开；已提前完成不能计作该验收。
