# 工具与接口

## 主会话工具

| 工具 | 当前功能 |
| --- | --- |
| task_propose | 提交新任务或同任务接续，选择已有 Scope |
| task_query | 查询任务、执行、结果及接续条件 |
| task_control | 取消请求或执行、回答工作决定 |
| memory_read | 读取 consciousness、World 或日志；日志可按 event_id 读取，默认取最近 30 条 |
| memory_propose_change | 提出 World 变更，经授权进入 Settings 应用流程 |
| MasterInteract | 创建面向 Master 的通知 |

参数定义位于 [Host](../src/pi_secretary/src/host.ts)。主会话每轮固定说明、工具和可选 Scope 快照。Scope 名单最多 64 项、8 KiB；共享笔记作为最多 8 KiB 的任务材料传给执行者。

## 执行工具与程序

Agent 使用 `read`、`write`、`bash`、`request_decision` 和 `submit_result`。read/write 根据 Execution 绑定根解析相对路径；write 经授权派发。bash 以当前系统用户在绑定目录启动，具有该用户的文件和网络权限。工作决定由 Master 回答；作用许可由 Authorization 处理。

shell 默认超时 120 秒，可设为 0.1–3600 秒；stdout、stderr 各限 4 MiB。正常退出保存 exit_code；超时、信号退出、输出超限或结果缺失进入未知结果处理。子进程使用限定环境变量集合。

登记程序通过 `POST /api/v1/admin/programs` 提交 Node 入口、名称和 request_id。执行前检查登记 revision 与代码 SHA-256；stdin 输入 ProgramInvocation JSON，stdout 输出 ProgramResult JSON，stderr 保存日志。许可覆盖整次程序执行，当前 `supports_resume=false`。

`submit_result` 包含每项验收评估、局限和 artifacts 数组。产物文件从绑定目录读取后保存为 CAS 对象，可由 API 下载固定版本。

## 同任务接续

`reuse_task_id` 与 `parent_execution_id` 同时提供时，在原任务排队一次即时执行。parent 为最新已结束且仍为 HOT 的执行；活跃执行、排队请求、到期周期工作或未知操作会影响可接续状态。只传 parent 则创建引用旧材料的新任务。

`goal` 是本轮完整目标。constraints、acceptance_criteria、deadline 省略或 null 时继承 parent；显式数组替换原字段，acceptance_criteria 至少一项。执行器与 Scope 沿用任务选择；更换它们时创建新任务。PROGRAM 接续保留程序版本和参数，更新本轮目标。接续采用即时请求，不带 at/interval_seconds。

回执关联 request_id、task_id、occurrence_key、proposal_ref 和 execution_id；排队期间 execution_id 为 null。`task_query` 分别支持 task_id 或 execution_id，提供基线、实际要求、结果、产物及可接续原因。用户打开详情可通过 `executions/{id}/viewed` 延长 HOT 留存。

## Core API

本机客户端使用 [API v1](api/v1/README.md)，完整方法和字段见[操作表](api/v1/operations.json)与[schema](api/v1/schema.json)。主要资源包括对话、Scope、任务、审批、决定、记忆、Settings、World、产物、关联内容和待处理摘要。

owner 可以创建、修改、归档 Scope，核验文件写入，或以 APPLIED / NOT_APPLIED / PARTIAL / UNVERIFIED 裁定未知 Operation。裁定保存说明和操作者，并在进程已停止、全部未知项已处理后收束 Execution。

显示名通过 `assistant/profile` 更新；有效说明通过 Settings draft/apply 更新。当前所有 GET 为读取，执行访问有独立 viewed 命令。通知展示回执、可靠同步、设备和附件上传的客户端合同安排在后续路线。

## Scope 授权策略与持久规则

`file.write` 在 Execution 绑定根内默认通过 `builtin:workspace-write`。DIRECTORY Scope 可设 `default_write=ask`；此开关在准备与派发时读取，只关闭默认写入，已授予的有效用户规则继续生效。临时 workspace 默认放行。未知结果、文件版本、取消和执行身份检查保持优先。

简单只读命令经固定命令/选项表及根内路径检查，通过 `builtin:readonly-shell` 以记录的 argv 直接启动；引号用于分词，glob 按字面传给工具。控制字符、根外路径、未知选项及 Git worktree/gitfile、alternates 形式回到审批。Git 配置了 filter 时回审批，其他情况下禁用外部 diff/textconv、pager、fsmonitor；rg 禁用用户配置。目录读取允许 `.`，写入不能以根本身为目标。具体首期表在 `shell-policy.ts`，扩充须代码审查。

用户 shell 规则按完整 token 前缀匹配 cwd 范围，执行与单次批准同用 bash；它可以授予有副作用的操作，不是文件或网络沙箱。未引用的展开、注释与复杂 shell 不可记住。旧参数哈希规则仍精确匹配；新规则支持文件目录前缀、shell 命令前缀及登记 program_id。

规则派发前失效以 RULE_CHANGED 取消尚未派发的操作。仅这种 NOT_STARTED 取消可在之后的实际工具调用创建确定性后继；旧操作不改写，后继以 retry_of 关联并重新授权。拒绝/撤销/未知结果不自动重建，重复调用与重启复用同一后继。
