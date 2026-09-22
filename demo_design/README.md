# Go Demo 实现设计

本目录定义将 BrainStorm 落地所需的模块、函数边界、调用顺序与验收场景。Go 运行实现与证据现见 [实现交接](GO_IMPLEMENTATION.md)；本目录原有检查报告仍只代表设计验证。新增字段、状态与默认策略均是本次供 Master 复核的实现提案，不能反向视为 BrainStorm 已确定的细节。

建议阅读顺序：

1. [复核入口](REVIEW.md)：与 BrainStorm 的对应和需要重点复核的选择。
2. [状态机总览](../state_machine/README.md)：总体流转、模块归属和提交边界。
3. [模块与文件](GO_LAYOUT.md)：Go 目录、具体函数与依赖。
4. [接口](API.md)、[流程和验收](SCENARIOS.md)：模块如何衔接。
5. [持久化协议](PERSISTENCE.md)：JSON 可靠写入、崩溃恢复及 PostgreSQL 交接。
6. [配置与范围](DECISIONS.md)、[实施顺序](IMPLEMENTATION.md)。

数据定义入口：[World Model](../schema/README.md)、[JSON 契约](../json/README.md)。同一规则的定义位置以这些入口为准；函数签名不重新定义领域规则。

验证入口：[检查说明](checks/README.md)。JSON Schema 结构验证、状态图检查和 SQL 约束验证都是设计验证；不能证明尚未实现的权限入口、Go 状态迁移、掉电恢复、模型质量或实际任务执行正确。
