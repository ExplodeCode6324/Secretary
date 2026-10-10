# 仓库整理与路径迁移

根 README 是产品入口，`src` 是实现，`test_case` 以 offline / online / reports 三类保存测试，`docs` 保存其余文档，`docs/fix` 保存每次更新计划及实施进度，命名为 `fix_yyyymmdd_具体功能描述.md`。根 package.json、package-lock.json 和 tsconfig.json 是全仓工具入口。

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

可用迁移目标见 [migration-map.json](migration-map.json)。值为 null 表示此 checkout 没有可解析目标；本次确认缺失的原目标与旧来源逐项保存在 [unavailable-evidence.json](unavailable-evidence.json)，不能把 null 解读成附件从未存在。运行契约从旧位置复制成独立维护的 src 文件；old 只用于追溯。生成类型使用 `npm run types:generate`，结构化文档使用 `npm run docs:generate`，从当前 schema / SQL 生成字段参考；生成结果不能证明所有预留字段已被运行时使用。

历史报告、指纹和 source-before 附件不改写为新版本的证据。原始设计内的旧命令不再作为可执行入口；Markdown 链接按新位置修正，删除文件的旧链接会标明已移除。外部快捷方式或已登记程序的绝对路径需要人工复核，不能修改历史 journal 来冒充原登记。


## 当前文档维护边界

- 根 README 与 docs 顶层手册以当前 Core API v1 代码为准。API schema/operations 是公开合同，OpenAPI/TS DTO 由 api:generate 生成；修改文档不随意改变线上合同。
- docs/data 与 database.md 由 docs:generate 生成，覆盖当前内部 schema 的87项定义与现行SQL；包括新增CoreIdentity、AssistantProfile、ClientRegistration、ApiCommand。生成说明同时维护在脚本，避免下次生成恢复旧入口。
- docs/fix 保留每轮计划、批准范围、失败及执行记录，顶端说明其历史身份。旧计划中的 NOT_IMPLEMENTED 或等待批准不是当前全局状态。
- docs/old 和 BrainStorm 是原始设计，已逐页标注历史；不改写原设计成当前代码，也不混用旧schema或状态catalog。
- test_case 的入口README说明当前套件，带日期报告保留原内容与版本，仅补充适用范围及缺失附件标注。上游src/pi_resource的文档归上游维护，不纳入自有文档重写。

此前文档检查的49项问题为16处缺失附件链接和33个缺失迁移目标。现保留原路径的可用性清单，取消误导性可点击链接，并将当前无法解析的迁移目标标为空；未新建虚构附件，未修改检查器或原测试断言。私有证据、原始live请求和凭据不为修复链接而重新公开。
