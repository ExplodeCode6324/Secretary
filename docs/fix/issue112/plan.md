# #112 实施记录

Master 已授权直接实施 #111 的首个修复项 #112，沿用完成复核的 `fix_20261112_world_model_scope` R5 方案。本项覆盖 World Store、统一接受入口、精确批量批准、角色与别名、画像/召回及 legacy genesis；Scope 导入与 Shared 分别保留在 #113/#114。

使用隔离 codex/ 分支，不修改持久敏捷实例。原主工作区文档搬迁不纳入本提交。合并和部署仍须 Master 单独授权。

验证要求：缺陷首次失败、批量原子性、角色保护、来源撤回、批准竞争/到期/崩溃恢复、Settings 分离、40 开发题与策略冻结后的 40 保留题、10k 性能、非空旧库导入、完整 verify、实际隔离启动、精确 HEAD 的 CI 与 Claude Opus 实施复核。自动化、真实 provider、原生 TUI 和 Master 人工验收分别记录，未执行项不得记为 PASS。

当前实施状态与证据将在代码冻结后更新。历史 SQL 专用测试保留在 `test_case/historical/offline/world-sql-pre112/`；被替代的 SQL/Settings 写入断言由 `test_case/offline/issue112/` 的 Store、批准、迁移和召回测试接替。旧 Settings 的独立摘要/崩溃测试和日志搜索测试继续执行。
