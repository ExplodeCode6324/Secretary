# Issue #27 文档重写证据

基线：`b4f6201c9440c06782d9ebee30b076abc199071a`。范围为 Core 手写现行文档；Master 已批准计划，PR/CI 与 Hermes 通过后交终审，先不合并。

## 行数

统计物理行数（含空行），范围为 `docs/*.md` 和 `docs/api/v1/*.md`，排除 BrainStorm、生成 database、原生历史设计与两份历史验证报告。迁移导航计入现行文档，根 README、fix 计划/证据及归档单列。

| 文档 | 改写前 | 改写后 |
| --- | ---: | ---: |
| docs/README.md | 25 | 19 |
| architecture.md | 68 | 64 |
| data-flow.md | 50 | 82 |
| data-model.md | 40 | 3 |
| interfaces.md | 54 | 0 |
| invariants.md | 0 | 57 |
| memory-and-prompts.md | 83 | 69 |
| operations.md | 116 | 121 |
| persistence.md | 55 | 0 |
| philosophy.md | 23 | 0 |
| repository-layout.md | 34 | 0 |
| settings-activation.md | 62 | 0 |
| state-machines.md | 65 | 3 |
| testing.md | 110 | 0 |
| api/v1/README.md | 145 | 87 |
| api/v1/push.md | 66 | 54 |
| 合计 | 996 | 559 |

首轮减少 437 行（43.9%）。数据流增加四张图，不变量增加代码/测试索引；运行手册保留实际管理、备份与验证步骤。删去页面的现行内容并入五份手册和 API，未转移到统计范围外的现行页面。

## 随机不变量抽查

Codex 使用 Python `random.Random(20261018).sample(range(1,19),5)`，得到 3、7、8、11、14，逐项读实现及断言：

| 条目 | 核对证据 | 结果 |
| --- | --- | --- |
| 3 CAS | Store.bytes/read 验证 SHA-256/长度；issue24/store 的 missing/short/symlink 在 commit 拒绝，同长损坏在 bytes 拒绝 | 范围准确，区分引用元数据与正文读取 |
| 7 未知效果 | settleUnknownExecution 检查 unknown 列表与 processStopped；issue18/resolution 裁定后仍等待进程，runtime/shell 重跑后 proof.txt 仍只有一次写入 | 未知效果与进程停止分别处理 |
| 8 启动门控 | launchProcess 收到 ready 后先 commit 进程身份，再返回 start；issue18/process-protocol 覆盖启动前取消及缺少结果帧 | 身份持久化与启动顺序一致 |
| 11 命令幂等 | ApplicationService 按 owner/路径/body 绑定，恢复 RUNNING 为 UNKNOWN；issue8/admission-boundary 覆盖拒绝前无提交、提交后错误仍返回原回执、冲突不改原回执 | 受理与业务结果区分准确 |
| 14 Settings | Settings 先 batchReceipt/applyBatch/export，再一起 commit 记忆、Context、有效说明及 APPLIED；runtime/settings 的 PG 提交后 SIGKILL 用例确认同批次只创建一次实体 | 两存储使用回执衔接 |

## 归档与链接

- 基线 docs/fix 的 50 个文件（33 计划、16 evidence、README）全部迁至 archive；逐文件比较，Markdown 仅链接目标变化，其他文件字节完全相同。
- 原生历史设计迁至 docs/old，修正外部入链；生成器固定引用的 data-model/state-machines 保留三行导航。
- docs:check 首轮通过：232 Markdown、3,412 本地链接；另查本次相关 Markdown 章节锚点，修正历史 streaming 报告的两处旧标题后无错误。
- 原始 BrainStorm、生成 docs/data/database、公开 JSON 合同、生成 DTO、运行源码与生成机制未改；运行源码净增减为 0。

## 验证与复核

完整 `npm run verify` 使用临时 PostgreSQL 18.6 独立集群。文档冻结后的测试汇总、最终提交 SHA、Hermes 合并条件复核和 CI 结果统一追加到 [PR #55](https://github.com/ExplodeCode6324/Secretary/pull/55)。原始运行日志保存在 Git 元数据目录，不提交。

## Hermes 实现复核

第三轮结论为 PASS_PENDING_CI，无阻断项。以 `sha256("issue27-inv-"+N)` 排序独立抽取 14、10、1、13、6，与实现一致，文风通过。采纳修订：接续条件按 continuationParent 的非 RETIRED 判定写为“未归档”；不变量 6 补派发前规则失效测试，10 补共享路径校验器测试并明确工具接入从代码核对。新增归档 index，完整列出 33 项计划，保留原 README 正文。

最终文档静态检查：docs:check 通过（234 文件、3,450 本地链接），改动相关章节锚点无错误，diff --check 通过。根 README 33 行、docs/fix 入口9行，独立于现行手册统计。
