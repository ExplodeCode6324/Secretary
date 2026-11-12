# Secretary 敏捷迭代专用实例

用户称为 Master，Master 是全局决策者。

- 唯一敏捷实例目录：`/Users/muy/Desktop/secretary-agile`。
- 专用敏捷迭代分支：`agile`。本目录始终在此分支工作。
- **只有获得 Master 明确许可，才能把 agile 并入 main；不得自动合并、直接推送 main 或重写基线。**
- 当前代码基线：2026-11-12 经 Master 授权同步的 main `c94daf29c379dad99921b09142ad36eac2db2aa5`（PR #117）。历史标签 `baseline-20261108-agile` 与 `baseline-20261108-pre-agile` 保持不动。
- 所有新的敏捷 fix 计划统一放在 `docs/fix/fix_20261108start_敏捷迭代专题/`，覆盖一般工作流的默认计划路径；历史 `docs/fix/` 全量保留。
- 本目录是唯一专用实例，不建立多轮次、rehearsal、隔离验收或临时替代实例。不运行会另建 Core 实例的历史在线验收脚本。
- 2026-11-09 Master 明确要求：从现在起持续运行，不设实例级总请求预算、工具调用总额或运行截止时间，不在验收结束后停机。仅敏捷变更时允许短暂停机，完成后立即恢复。单请求模型容量与故障重试规则不属于实例总额度。
- 用户级 launchd 服务 `com.secretary.agile` 登录自启并常驻守护，每 30 秒检查同一 Core/PostgreSQL；caffeinate 防空闲睡眠。维护停机使用 `npm run stop` 写入 `.local/maintenance.json`，完成后 `npm start` 清除维护标记并恢复。不得留下维护标记而结束工作。
- 敏捷期间全量保留数据：`data/core/`（journal、CAS、任务工作区、日志）、`data/postgres/`、`data/tui/`、外部 Scope 工作目录、附件、恢复材料、配置和凭据；不得 reset、清库、覆盖、裁剪、git clean -fdx 或按轮换目录。
- 重启/升级只使用同一数据域与数据库。备份必须是完整可恢复副本，不启动备份为另一测试实例。必要的数据迁移先说明影响并请 Master 决策。
- `data/` 和 `.local/` 私有、Git 忽略。不得把密钥、Core token、原始私有对话提交到 GitHub。
- 使用根目录启动/停止 command 或 `npm run agile -- start|status|stop|tui`。标准 start/stop/tui 同样路由本实例。
- 当前运行日志及部署验证保存在 `.local/`。源码静态检查可用；不能把敏捷数据库交给会清理数据库的测试 helper。
- 历史文档中的“新建隔离测试实例”不适用于本敏捷实例；遇到冲突以 Master 的本次要求为准。
