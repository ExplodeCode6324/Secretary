# Issue 79 计划复核记录

- 基线：`1e450d4f4c32d2376cd0d4451078048549bc5c58`；分支 `codex/issue79-retire-tauri`。
- 计划：[中文 R2](../../fix_20261023_issue79_Tauri退役.md) · [English R2](../../fix_20261023_issue79_Tauri退役.en.md)。
- Reviewer：浏览器 Claude；提交前 UI 已核实 `Opus 5.5 Extra`。
- 同一会话：https://claude.ai/chat/2076c967-88f1-4ae5-9009-ac401c696376 。
- R1 发送：2026-10-23 19:06:48 +08:00；首次读取不得早于 19:16:48。
- 内容：完整英文计划、仓库和 Issue URL；请求区分独立检查与 Codex 提供的证据。
- 原始资料（Git 忽略）：`.demo-data/issue79-review/r1-request.txt`、`r1-request-plan.md`、`r1-sent-at.txt`、`model-before-r1.png`。
- R1 结论：CHANGES_REQUIRED；首次等待满十分钟后读取并保留原始 AX 回复/截图（准确时间见 r1-read-at.txt）。
- R2 于 19:19:40 +08:00 发送完整修订英文计划，同一会话；下次读取不早于 19:24:40。R2 结论 PASS，实施未获批、未执行。

原始日志不提交；本记录只记脱敏结论与处置。Claude 计划复核不等于实施验证或 GUI 验收。协调会话批准后才实施；准确 HEAD 合并须另行授权。

## 计划阶段本地检查

- `npm run docs:check`：PASS；623 份 tracked Markdown、8474 条本地链接，无错误；119 个本地化来源、357 份输出保持同步。
- API 清单：当前 82 项（GET 50 / POST 32），method/path 集合完全一致、无重复，TUI 已用 0。
- `git diff --cached --check` 首次发现计划四处 Markdown 行尾空格；仅移除空格后 PASS，未改变已发送 R1 内容。首份 docs 检查日志保留于 `.demo-data/issue79-review/docs-check-plan-first.log`。
- 只读基线清单：143 个客户端 tracked 文件、89 个 Core/API/契约保护文件 blob、119 处受影响 Markdown 链接；原始清单 `.demo-data/issue79-review/baseline-inventory.json`。
- 本阶段未运行业务测试，未删除客户端、构建物或状态，未更改 Core 实现。

## R1 处置

| 意见 | 核对与处置 |
| --- | --- |
| B1 本地状态遗漏 | 采纳：源码核实 native-test identifier、delivery.lock、localStorage；加入双 identifier 候选、孤立 profile、只读 SQLite 元数据签名、专属 WebKit/cache 处置。位置是候选，不声称本机存在。 |
| B2 树外 fixture | 采纳：git grep 核实 seed-artifact.ts 唯一调用来自 reliability.rs:535，计划纳入删除；双向依赖表明确 Core/契约/混合测试根保留。 |
| B3 旧 FE Issue 接管 | 采纳：需求 §10.4 属交付条件；准备六份[具体评论草案](legacy-issue-drafts.md)，待协调批准/发表，未完成列为交付待办。 |
| 可选边界建议 | 采纳：混合 .demo-data 证据/Core 根默认保留；detached Core 不停止；不搜用户下载目录、外部 app 副本、toolchain；Core ClientRegistration/通知记录保留；TUI 需求加日期状态说明。 |
| 颜色与后续可靠性 | 颜色明确来源于 Master 本任务要求；保留独立短文档便于 TUI 查找，green/wash 有意不继承。补[历史可靠性索引](reliability-handoff.md)，不保留可执行旧测试。 |
| 通用化建议 | 不在 #79 新建通用导航配置框架/永久 API 检查机制；按当前入口改 checker，执行明确集合校验。已将这个取舍交回 R2 复核。 |

R1 reviewer 在其环境克隆并检查基线源码、双向引用、配置/存储/文档/契约；执行 localizer check（通过）、checker（其缺子模块的克隆报子模块链接问题）、临时删除模拟（61 个预期文档耦合错误）和 API 清单核对。其未跑业务测试/npm scripts，未访问本机状态；本地工作区、授权和颜色要求由 Codex 提供。不要将 reviewer 临时环境失败记为本仓库业务回归。

原始 R1：`r1-response-ax.txt`、`r1-response.png`、`r1-read-at.txt`；R2：`r2-request.txt`、`r2-request-plan.md`、`r2-sent-at.txt`，均在 `.demo-data/issue79-review/`。

## R2 结论与执行备注

Claude 于同一会话给出 **PASS**：R2 可交协调会话决定实施，B1/B2/B3 已关闭，无新阻塞。读取时间和完整原始回复见 `.demo-data/issue79-review/r2-read-at.txt`、`r2-response-full-ax.txt`，截图 `r2-response.png`。R2 reviewer 复查其 `1e450d4` 克隆中的需求映射，并通过摘要抓取看 #66；本轮未跑测试或脚本，未看到本地中文计划/附件，其判断对象是完整粘贴的英文 R2。

以下按 reviewer 的非阻塞建议落入执行备注，R2 正文保留为实际受审版本：

1. 已用 GitHub connector 逐项核实 #62–#67 **正文**：六项均已有 2026-10-23 Master 冻结/承接说明，明确继续 open、旧任务未完成并映射新路线。因此需求 §10.4 的接管标注已有事实依据；不得因为没有新评论而重复发表。六份草案保留为可选补充，协调可认定现有正文已满足此项；如仍需增补，由协调明确授权后执行。
2. 接管说明检查放在 MERGE_READY **之前**，不是合并后的清理事项。检查现有正文/记录可满足，不强制新增评论；如出现缺失/冲突则协调先解决或明确重新分工。
3. #66 草案明确 Portable 继续不属目标；旧 Tauri 应用内/系统通知 UI 不迁入新 TUI，Core MACOS_NOTIFICATION push target 保留。#67 明确旧 GUI 真实终验由 #84 macOS 终端真实使用验收替代，不是通过。
4. 本计划列明保留的 `.demo-data/issue58`、`issue59-native`、`issue60`、`issue62`、`issue63` 内不删除任何内容，包括历史 fixture 的 `issue59-native/fixture/client.sqlite`。这些混合历史证据根不属于本次批准后自动清理对象；不新增备份或迁移，也不把它们用于新 TUI。若后续确需处置，交协调明确界定。
5. SQLite 采用只读元数据方式（如 mode=ro），遇 WAL 导致签名不可无写入读取时保留待裁定，不改用读写打开。
6. 核实归属且旧 app 退出后，偏好域用 `defaults delete <identifier>` 清除，避免仅 unlink plist 被 cfprefsd 回写；实施前核实准确域，未知域不操作。
7. `secretary-desktop-spike` 可作为未打包 tauri dev 的 WebKit/cache **只读候选**；必须先证实专属再处置，不凭名字直接删除。
8. 原 reviewer 称 reliability.rs 有 38 个命名用例；本地本次只读提取到 31 个 `#[test]` 函数，附件按实际函数与行号列出，不沿用未复现计数；这不是测试执行结果。

R2 本地 docs 检查 PASS：625 份 Markdown、8476 条本地链接；119 个本地化来源、357 份输出同步。method/path 集合仍为 82 项，0 已用。固定提交的 Secretary 链接目标用 git cat-file 核实。无业务测试、状态清理、业务代码改动、push 或 PR。

## 待协调批准

批准 R2 中英文计划及本节执行备注后，才开始 #79 实施、验证和 PR/CI。颜色与可靠性索引均仅文档，#80–#84 未开工。当前六项旧 Issue 正文已标注，建议复用现有证据，不发表重复评论；请协调在批准时确认这项交付处置。后续达到 MERGE_READY 再请求准确 HEAD 合并授权。

## 协调实施批准（2026-10-23）

协调会话明确批准从计划提交 `4299bf027732b86cfdd68fb682a30895ccc22021` 开始实施 R2，并批准以上八项执行备注，澄清优先。授权本项清理、验证、push/PR、CI、同一 Claude 会话准确 HEAD 复核，不授权 merge。协调已独立核实 #62–#67 现有正文并认定接管门禁满足；不发表重复草案，不关闭旧 Issue。执行结果见[实施记录](implementation.md)。
