# 通用 Demo 设计

本目录定义 BrainStorm 落地所需的模块职责、调用边界、持久化协议和验收场景，不绑定具体实现语言。新增字段、状态与默认策略是待复核的实现提案，不反向视为 BrainStorm 已确定的细节。

建议阅读顺序：

1. [复核入口](REVIEW.md)：基线对应与重点选择。
2. [状态机总览](../state_machine/README.md)：模块归属和提交边界。
3. [接口](API.md)、[流程和验收](SCENARIOS.md)：模块衔接。
4. [持久化协议](PERSISTENCE.md)：可靠写入、恢复及 PostgreSQL 交接。
5. [配置与范围](DECISIONS.md)、[实施顺序](IMPLEMENTATION.md)。

数据定义以 [World Model](../schema/README.md) 和 [JSON 契约](../json/README.md) 为准。验证入口为 [检查说明](checks/README.md)；结构、状态图和 SQL 检查不能证明运行守卫、掉电恢复、模型质量或实际任务执行正确。
