> 历史归档：设计阶段的原始设计或早期实现说明，和当前代码不构成证据对应。命令、路径与结论仅供历史追溯；当前入口见 [项目文档](../../../README.md)。

# 设计验证

在仓库根目录运行。Python 环境放在仓库外的临时目录，报告写入本目录。验证程序不读取应用凭据、不连接现有数据库、不运行 agent 或任务程序。

```sh
python3 -m venv /tmp/secretary-design-check
/tmp/secretary-design-check/bin/pip install -r demo_design/checks/requirements.txt
/tmp/secretary-design-check/bin/python demo_design/checks/validate.py --report demo_design/checks/static-report.json
python3 demo_design/checks/validate_postgres.py --pg-bin /path/to/postgresql/bin --report demo_design/checks/postgres-report.json
```

`--pg-bin` 由本机 PostgreSQL 安装位置替换。SQL 检查会创建临时 initdb 集群，仅监听临时 Unix socket，测试完成或异常时关闭并清理；不接受任意 DSN。用非 root 账号运行。需要 PostgreSQL 18 的 initdb/pg_ctl/psql。

验证范围：

- JSON Schema 元结构、严格日期/UUID、全部正反形状示例、单独路径拒绝、未知字段拒绝。
- 状态枚举一致、所有状态可达、终态不再有出边、每个转换有守卫和文档；图路径正反例。
- Markdown 本地文件链接、基线 hash、文档不含本机用户绝对路径。
- PostgreSQL 空库 DDL、种子谓词、事实查询、事务回滚、证据/类型/时间/FK/不可变/唯一性约束。

图路径测试只验证声明的转换边，不执行运行守卫。形状示例使用合成引用，不是已经导入的完整运行快照。SQL 测试直接操作临时库，不能证明应用仓储一定按事务协议写入，也不能证明授权、掉电恢复或模型行为。

本次实测汇总见 [REPORT.md](../../../../test_case/reports/design-checks/REPORT.md)，机器结果见 [static-report.json](../../../../test_case/reports/design-checks/static-report.json) 和 [postgres-report.json](../../../../test_case/reports/design-checks/postgres-report.json)。
