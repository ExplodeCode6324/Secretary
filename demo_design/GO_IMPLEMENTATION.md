# Go Demo 实现交接

独立 Go 实现已落在 [`../demo_src_go`](../demo_src_go/README.md)。本目录原有文档继续作为设计规格，不能把先前的静态/SQL 检查报告当成本次运行证据。

- [复核入口与证据](../demo_src_go/REVIEW.md)
- [代码与设计对应、接口收敛和当前边界](../demo_src_go/ARCHITECTURE.md)
- [启动、停止、人工程序登记和验证](../demo_src_go/README.md)

BrainStorm 基线没有修改。Go 源码使用本仓库 canonical JSON Schema、状态图与 PostgreSQL migrations 的内嵌副本，运行时不会读取 `demo_pi` 或引入其他 agent 实现代码。

2026-09-22：按 Master 要求将交互改为 TUI。`secretary tui` 连接本地协调后台，启动入口不再打开浏览器。详见实现目录 README 和 ARCHITECTURE。
