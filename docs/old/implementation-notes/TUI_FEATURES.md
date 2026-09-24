> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../README.md)。

# TUI 功能核对

本轮修正重点是让授权成为看得见、可直接操作的入口，而不只是存在命令。启动显示功能菜单；新授权自动展开完整卡片并显示 `/approve A1` / `/reject A1`。输入提示持续显示待授权与待决定数量。短编号在当前终端会话内稳定，重启后以重新展示的卡片为准。

| 功能 | 入口与行为 |
|---|---|
| 功能总览 | 启动菜单、`/menu`、`/help` |
| 主会话 | 直接输入消息；`/status`、`/history` |
| 授权列表与详情 | 自动卡片、`/auth`、`/approval A1` |
| 批准、拒绝、撤销 | `/approve A1`、`/reject A1`、`/revoke A1`；保留展示版本与摘要校验 |
| 工作决定 | 自动显示问题、选项、影响；`/answer D1 <回答>`，来源记为 MASTER |
| 任务列表、详情、取消 | `/tasks`、`/show E1`、`/cancel E1` |
| Agent 任务 | `/task <目标>`；也可让主会话提交提案 |
| 定时、周期、材料和约束 | `/task-json <JSON>`，沿用 Scheduler 提案校验 |
| 程序选择与执行 | `/programs`、`/program P1 <目标>` |
| 人工程序登记 | `/register-example`、`/register <JSON>` |
| 未知操作核验 | `/operations` 获取操作 ID，`/verify <id>` 只读核验文件写入 |
| 授权规则 | `/rules`、`/rule <JSON>` |
| World Model | `/world`、`/world-read <subject-id>`、`/world <变更 JSON>`；需配置 PostgreSQL |
| 上下文整理与恢复 | `/compact`、`/resume` |
| 退出 | `/quit`、Ctrl+C；释放宿主与文件锁 |

## 验证

- 实际终端进程中：登记程序 → 选择 P1 → 等待授权卡片 → 输入 `/approve A1` → 程序成功执行 → 退出并重新打开持久化存储。
- Controller 与真实 Scheduler 集成：批准前文件不存在，批准后程序完成；第二个请求拒绝后没有执行产物。
- 陈旧展示版本被拒、未展示请求不能批准、聊天文本不能授权、终端控制字符被清除。
- 工作决定短编号可回答，保存 MASTER 来源；恢复后 agent 完成任务。
- 程序/规则/操作/高级任务入口可访问；未配置数据库时 World Model 明确报不可用，不伪造结果。
- 本次全部离线回归 28 项通过，PostgreSQL 项在通用测试中跳过。没有重新消费真实模型 API 配额，也不把终端入口检查等同于重新验证全部数据库语义。

原始检查结果见 [runtime.tap](../../../test_case/reports/pi/runtime.tap)。真实模型链路历史证据另见 [LIVE_REVIEW.md](../../../test_case/reports/implementation/LIVE_REVIEW.md)。

## Context 与消息颜色

启动、`/status` 和主会话快照更新时展示 Context 使用条、估算 token 数、模型窗口上限、占比、输出预留以及待装入输入数。数字沿用当前运行时的快照估算，不是供应商实测 token；待装入输入单列，尚无快照时不显示虚假的 0% 使用量。相同数值不反复刷新。

同一组柔和配色：Master 米色（256 色 223 / #FFD7AF）、Secretary 浅蓝（153 / #AFD7FF）、系统/任务回传灰青（152 / #AFD7D7）、授权浅黄（229 / #FFFFAF）。历史消息按来源展示，任务回传不会误标为 Master。颜色只由 TUI 添加，消息中的终端控制序列仍被移除；非交互输出使用纯文本。普通命令尊重 `NO_COLOR` / `TERM=dumb`；双击启动器显式设置 `SECRETARY_COLOR=256`，保证交互终端启用兼容色彩。新的 TUI 与网页双开方式见 [UI_DUAL_REVIEW.md](../../../test_case/reports/implementation/UI_DUAL_REVIEW.md)。
