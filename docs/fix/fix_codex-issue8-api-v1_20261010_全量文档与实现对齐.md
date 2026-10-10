# Core API v1 全量文档与实现对齐

状态：**DOCS_UPDATED / CHECKED / WAITING_FOR_MASTER_REVIEW**。Master 已确认前次实现完成复审，本轮授权根据当前代码修订全部自有文档；沿用 `codex/issue8-api-v1` / PR #15，不合并、不关闭、不部署。

实现基线：`aa47ad5a2c74e788cfcdff3e9c8c52310bb4a0a5`；main 为 `38daab6cbbccf9f6a85071ff5933eaa198d77de8`。本轮只修改文档、文档可用性索引及生成器的说明文字，业务代码、公开/内部 schema、SQL、测试和运行依赖不变。

## 范围与处置

本轮对自有文档做全量分类核对，生成页从现行 schema/SQL 重建；上游 Pi 子模块文档不归本仓库重写。修订前193份 Markdown，补齐4个内部数据页并新增本文后共198份。

| 类别 | 数量 | 处置 |
| --- | ---: | --- |
| 当前说明与测试入口 | 23 | 逐项核对启动/接口/数据/记忆/测试/路线，修正过时行为；已有准确的专项测试说明保留 |
| 内部字段索引、87个定义页与数据库 | 89 | 重生成，新增4种持久记录；生成器同步说明内部合同与客户端DTO的区别 |
| 原始设计与 old | 50 | 核对历史身份及引用，保留原设计，不假称已实现 |
| 历史计划与实施记录（含本文） | 13 | 明确历史阶段与当前状态，保留原批准范围、失败、结果 |
| 历史测试报告 | 22 | 补充版本适用范围；原结果不改，缺失附件保留路径并标明不可用 |
| 历史探针 README | 1 | 现有历史边界正确，保留 |

另核对 API schema、operations、examples 和 OpenAPI；公开59项操作为36 GET/23 POST，去重使用47种请求/响应DTO。逐一比对23项POST与实际路由声明。公开合同和生成TS结果保持不变。

## 主要修订

1. [架构](../architecture.md)改为 Core/认证HTTP/ApplicationService/领域模块，移除旧双UI和SSE已可用的表述；保留读投影与持久化性能边界。
2. [运行手册](../operations.md)改为准确的 Core CLI，区分普通 `.demo-data` 与 live wrapper `.demo-data/interactive-live`；live停止须匹配模式/目录，旧双击停止器和 `--migrate` 不适用。
3. [接口](../interfaces.md)、[数据流](../data-flow.md)、[数据所有权](../data-model.md)、[状态机](../state-machines.md)与[持久化](../persistence.md)补充ApiCommand、身份、纯查询、viewed、长命令UNKNOWN、CAS产物和独立验算的边界。
4. [设置](../settings-activation.md)更换全部旧HTTP入口，明确共享草稿/CAS、World目录分页及有效50项领域上限；[记忆](../memory-and-prompts.md)更换终端入口并区分内部预算与公开读模型。
5. [测试策略](../testing.md)区分当前API回归、三项旧UI跳过、遗留浏览器/PTY探针、数据库与online证据；不把历史UI/模型结果记作本次重跑。
6. [客户端规范](../native-client-design-v0.3.md)保留13pt正文和200pt旁栏设计，明确#8后端已实现、SwiftUI尚未实现；README路线反映旧协议已经退出新版Core。
7. 旧49项文档错误对应16处附件链接和33个迁移目标。通过[可用性清单](../unavailable-evidence.json)保留原目标，改成不可用标注与空迁移目的地，不伪造报告，也不改检查器。

## 需要复核的实际实现边界

以下是源码现状的文档化，没有借文档任务修改业务：

- 当前API没有Notification presented/已读命令；旧控制器写SENT的规则仍在源码，Core不加载它。查询通知内容不生成送达回执，依赖SENT的自动承诺完成不能凭GET成立。
- 当前公共session未提供旧UI完整容量面板；不能把内部预算记录说成已公开的capacity接口。
- 短ApiCommand通常保持ACCEPTED，业务成功读领域资源；长命令异常/中断为UNKNOWN，不能凭schema有FAILED就声称走该分支。
- DraftCommand结构允许最多100个edits，领域SettingsPayload仍限制50个；实际批次遵守更严格上限。本轮不修改合同来掩盖差异。
- 提交产物和独立验算分离，产品verified_by仍为NOT_VERIFIED；shell产物可能没有producing_operation_id，须结合回执与下载内容追溯。

## 验证

- `npm run docs:generate`：87项内部定义与SQL文档；重复生成一致。
- `npm run api:generate`：OpenAPI与TS DTO重复生成一致，公开合同未改变。
- 91份生成文件重生成后SHA-256不变；生成器Python语法检查通过。
- `npm run docs:check`：全部自有Markdown及迁移目的地检查通过，0错误（原49项均有明确处置）。
- `npm run check`：通过。`npm run test:api`：32项中30通过、2项PG条件跳过、0失败；本轮未启动数据库或重跑全部runtime/Issue2–5。
- 268份业务源码、schema/SQL/状态目录、非Markdown测试、依赖、公开合同与检查器基线文件SHA-256未变。文档生成器只修改说明文本；前次真实模型捕获的57项源码清单中，只有该生成器不同，另外56项仍匹配。原始运行清单不重签为新提交。
- 历史报告数值、源码指纹和失败结论保留；私密证据未发布。本轮真实模型调用0次，无设备操作或部署。

复核从[文档索引](../README.md)、运行手册、API合同和本节实现边界开始。通过本轮文档复核后是否合并仍由Master决定。
