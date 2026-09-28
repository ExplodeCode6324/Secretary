# 文档与代码核对记录

日期：2026-09-28。范围是仓库自有 Markdown；第三方 `src/pi_resource` 不作为 Secretary 规范修改。逐文件范围及内容摘要哈希见 [清单](documentation-inventory.json)。

## 当前规范

| 文档 | 对照实现与核对结论 |
| --- | --- |
| README、docs/README | World 管理入口、草稿与摘要重建流程、当前/历史文档边界；保留原有路线图修改 |
| settings-activation | settings.ts、settings-memory.ts、world.ts、backend.ts；阶段、回执恢复、CAS、完整来源、容量失败、API 与限制一致 |
| architecture、data-flow | app/host/scheduler 的协调与 gate；停止领取工作但继续可靠接收输入，既有异步任务不重启 |
| state-machines | catalog.json 与 Settings 阶段转换；目录是文档，不宣称全局自动执行全部守卫 |
| data-model、persistence | Store/journal 与 PostgreSQL 两个持久化域；未宣称跨域原子事务，已提交未重建保持阻塞 |
| database | 001/002/003 SQL 与 World.migrate；版本 3、不可变批次回执及显式迁移，与生成器同步 |
| data 全部生成页 | contracts.schema.json 为字段权威；新增四类设置结构与可选恢复字段，重新生成并检查可复现性 |
| interfaces | backend 管理接口与普通 TerminalController 区分，模型工具不获得 Master 专属写权限 |
| memory-and-prompts | Context/MainPromptSnapshot、承诺台账与完整来源；保留 wm_fact_versions 尚未填充的事实 |
| operations | 现用服务需显式停机/备份/迁移；运行配置恢复约束、两种整理输出预算区别 |
| philosophy | 事实/历史、授权与知识边界；程序登记不等于执行许可 |
| testing、test_case 索引与 offline/online 索引 | 默认回归、数据库 skip 条件、隔离 runner、真实模型短探针及长期回归待建设范围 |
| repository-layout | 新规范与 fix 计划路径，不改历史迁移事实 |
| fix 计划、本次报告 | 标明实施前基线与最终进度，保留失败尝试；证据等级与最终代码对应 |

## 历史范围

`docs/old`、BrainStorm、historical 测试说明、既有审计与实施报告按历史原件保留。已核对索引中的归档范围和链接；其中旧接口或旧结果不作为当前行为声明，也不批量改写为此次通过。当前变更发现的接口差异在新规范中说明。

## 可重复检查

- `npm run types:generate`、`npm run docs:generate`：重复生成后 contracts.ts、docs/data 与 database.md 内容哈希一致，结果见 [生成检查](generation-check.json)。
- `npm run docs:check`：所有自有 Markdown 链接及已有隔离规则检查，结果见 [链接检查](docs-check.json)。链接通过不替代上表的行为核对。
- 修改/新增的运行实现与测试 TypeScript 格式检查通过；原有压缩排版的 audit/world-extra.test.ts 保持局部修改，不进行无关重排。
- `npm run check`、Web JavaScript 语法与 `git diff --check` 通过。未将第三方资料、历史设计或一次真实模型结果当作当前全面正确的证明。
