# Test case

- [offline](offline/README.md)：无真实模型 API 的运行回归、隔离 PostgreSQL 测试和历史探针。
- [online](online/README.md)：显式调用真实模型的链路、说明与记忆探针。
- [reports](reports/README.md)：历次 test report 和原始证据，本次整理报告单独保存。

入口统一从仓库根目录运行；完整范围、证据边界及 online 日常稳定性回归规划见 [测试策略](../docs/testing.md)。Online test 需要后续优化，现有短链路不能替代持续日常使用回归。
