# 仓库与文档维护

| 路径 | 内容 |
| --- | --- |
| README.md | 产品入口、启动方法和当前开发路线 |
| src/pi_secretary/src | Core、Host、Scheduler、Store、Settings、World 与模型适配 |
| src/pi_resource | 固定版本 Pi 子模块 |
| src/contracts、src/schema、src/state_machine | 内部合同、SQL 与状态目录 |
| docs 顶层手册 | 当前实现、运行与测试说明 |
| docs/api/v1 | 公开 schema、操作表、生成文件、客户端示例与验证记录 |
| docs/data、docs/database.md | 自动生成的内部字段和 SQL 参考 |
| docs/fix | 按日期保存的计划与实施记录 |
| test_case/offline、test_case/online | 当前离线回归和显式真实模型验证 |
| test_case/reports、test_case/historical | 带版本的测试结果与历史探针 |
| docs/old、docs/BrainStorm_Baseline_v3.md | 历史设计 |

根 package.json、package-lock.json 和 tsconfig.json 是全仓工具入口。本地数据默认位于 `.demo-data`，通过环境变量可选择其他目录。

## 文档更新

顶层手册描述当前 main 实现；README 记录后续顺序。字段页执行 `npm run docs:generate`，内部类型执行 `npm run types:generate`，公开类型与 OpenAPI 执行 `npm run api:generate`。详细行为写在对应手册，生成页集中提供字段、类型和约束。

计划使用 `fix_YYYYMMDD_issueN_具体功能描述.md`，无 Issue 时省略 issueN。工作在同一秘书 Core 仓库中以分支区分，计划与执行记录一起保存在 docs/fix。格式见[计划索引](fix/README.md)。

历史计划和报告保留当时的版本、失败与结论；目录标明其历史身份。当前行为变化更新现行手册，原始证据继续用于追溯。

## 历史路径

早期 demo_pi/pi_secretary 已迁入 src/pi_secretary；测试迁入 test_case，运行合同迁入 src/contracts、src/schema 和 src/state_machine。完整映射见 [migration-map.json](migration-map.json)。映射为 null 的附件在本 checkout 中不可解析，来源清单见 [unavailable-evidence.json](unavailable-evidence.json)。

旧设计目录中的命令属于原版本。外部快捷方式和已登记程序保留的绝对路径，在目录迁移时按实际运行位置检查。
