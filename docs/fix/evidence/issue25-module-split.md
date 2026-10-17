# Issue #25 PR A 拆分证据

基线：`92ef15ee13e22b0ee61dc12985b707cc08bc954f`。

- 原方法体经 TypeScript AST 比对无业务逻辑差异；仅允许 helper 别名、类型名、格式变化。
- 40 个公开方法在 TypeScript checker 下双向类型兼容；构造参数、现有导出与持久格式保持不变。
- 所有当前离线测试文件保持零修改；拆分前 verify：649 pass / 0 fail / 0 skip / 0 TODO，包含独立 PostgreSQL。
- 新模块使用类型依赖与实例动态回调，状态仅留在 Host/Scheduler。编译后 import 检查确认职责模块之间无运行期导入环；共用函数由底层工具模块提供。
- 初次拆分类型检查发现两个全局 helper 与新函数同名、两处共享 helper 未导入及一个类型依赖遗漏；补齐别名、底层 helper 和类型后通过。
- 源码从 4708 行变为 5915 行，净增 1207 行；增加量来自显式委派、类型依赖、状态访问器及分文件 import，业务方法体不变。

| 文件 | 行数 |
| --- | --- |
| host.ts | 414 |
| scheduler.ts | 404 |
| host-context.ts / scheduler-context.ts | 63 / 68 |
| main-loop.ts / main-tools.ts | 700 / 446 |
| context-assembly.ts | 241 |
| memory-maintenance.ts / memory-summary.ts | 353 / 395 |
| task-planning.ts / task-triggers.ts | 702 / 489 |
| execution-runner.ts / executor-tools.ts | 523 / 301 |
| effects.ts / execution-recovery.ts | 406 / 299 |
| retention.ts | 83 |
| execution-utils.ts / main-tool-result.ts / executor-invocation.ts | 13 / 4 / 11 |

## 运行期依赖方向

Host → main-loop/main-tools/context-assembly/memory-maintenance/memory-summary；Scheduler → task-planning/task-triggers/execution-runner/executor-tools/effects/execution-recovery/retention。子模块通过类型化 context 动态回调原实例；context 文件只有类型导出。execution-utils、main-tool-result、executor-invocation 不依赖组合根。

完整拆分后验证及冻结提交的 CI/reviewer 结论追加到 PR。
