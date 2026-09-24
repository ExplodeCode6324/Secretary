# 仓库整理与路径迁移

根 README 是产品入口，`src` 是实现，`test_case` 以 offline / online / reports 三类保存测试，`docs` 保存其余文档。根 package.json、package-lock.json 和 tsconfig.json 是全仓工具入口。

| 旧位置 | 新位置 |
| --- | --- |
| demo_pi/pi_secretary/src、web、examples | src/pi_secretary 下对应目录 |
| demo_pi/pi_resource | src/pi_resource（固定子模块） |
| 根 json/contracts.schema.json | src/contracts/contracts.schema.json（运行时） |
| 根 schema/*.sql | src/schema/*.sql（运行时） |
| 根 state_machine/catalog.json | src/state_machine/catalog.json（运行时） |
| demo_pi/pi_secretary/test | test_case/offline/runtime |
| demo_pi/pi_secretary/audit | test_case/offline/audit；结果另放 reports |
| 真实模型验证脚本 | test_case/online |
| demo_pi/.demo-data | .demo-data（本地、不入 Git） |
| 原始设计目录 | docs/old；Go 实现相关旧设计丢弃 |
| BrainStorm | docs/BrainStorm_Baseline_v3.md |

完整逐文件记录见 [migration-map.json](migration-map.json)。运行契约从旧位置复制成独立维护的 src 文件；old 只用于追溯。生成类型使用 `npm run types:generate`，结构化文档使用 `npm run docs:generate`，从当前 schema / SQL 生成字段参考；生成结果不能证明所有预留字段已被运行时使用。

历史报告、指纹和 source-before 附件不改写为新版本的证据。原始设计内的旧命令不再作为可执行入口；Markdown 链接按新位置修正，删除文件的旧链接会标明已移除。外部快捷方式或已登记程序的绝对路径需要人工复核，不能修改历史 journal 来冒充原登记。
