# Issue #81 计划复核与批准交接

日期：2026-10-24（Asia/Hong_Kong）。状态：CLAUDE_PLAN_PASS / WAITING_COORDINATOR_APPROVAL。仅计划阶段，不代表实现、CI 或产品验收通过。

[中文 R3](../../fix_20261023_issue81_附件闭环.md) · [English R3](../../fix_20261023_issue81_附件闭环.en.md)

基线 `560a9cc294c1c047dd91a559450603b7b1a68db0`；分支 `codex/issue81-attachments`。同一 Claude 会话全程 Opus 5.5 Extra，每次提交前核实 UI。每轮首次十分钟后读取；R1 十分钟时尚在执行，按五分钟间隔再次读取。无模型/账号异常，无 Hermes fallback。

| 轮次 | 提交时间（香港） | 计划提交 | 结论及处置 |
| --- | --- | --- | --- |
| R1 | 2026-10-23 23:38 | 958030379f5f60f430c3b732eb6f50a227942d13 | CHANGES_REQUIRED：八项阻塞。修订图片预算、驻留、每轮存储、失败退出、CAS损坏语义、消费者/来源、导入恢复、macOS路径。 |
| R2 | 2026-10-24 00:04 | 48ddd94ced083b78e23620dc942310ce97309140 | CHANGES_REQUIRED：四项剩余阻塞。明确单帧撤回、真实CallState和无助手输出限制、撤回下游过滤、统一形态认证及逐site处置。 |
| R3 | 2026-10-24 00:21 | 8ab09a54eff27b1a429a45894b90029370d16a91 | PASS：全部阻塞关闭，仅计划可执行性；协调批准仍必需。 |

Claude 的独立证据是基线源码阅读、rg/grep、API计数和预算算术；未运行 tsc、测试或 Core。其 npm registry 不可达，因此 adapter 依据release源码，不声称独立验证安装dist。Codex核对本地安装包的omission转换，并完成文档、本地化、链接、空白及API表检查；未运行实施测试、真实provider或终端验收。

采纳上述12项阻塞的必要修订；保留独立AttachmentImport以明确容量预留；不把8192认作所有真实模型通用安全上界，改为fixture值+明确部署profile，Claude R2认可。保留K=0为待协调裁定的首版政策；没有默认为已批准。PASS后仅统一持久化措辞、注明withdrawal Context字段，记录stale IN_FLIGHT及自动重试限制；不新增撤回已产生助手输出loop的能力。

## 协调须裁定的具体方案

- 四个新操作：导入、附件metadata、content、受保护Input撤回；WITHDRAWN终态、附件单独loop和原子checkpoint。实际operations仍82；实现提案为86，新TUI消费者仍0。
- PNG/JPEG+sharp完整解码；5MiB/文件、4096单边/4,194,304像素、4附件/10MiB每消息；1GiB逻辑预留和10,000导入身份；正式及未绑定内容保留，无通用GC。
- K=0：图片在当前处理loop完整驻留，HANDLED后新loop为认证metadata；紧邻追问不会自动重送像素，owner需显式重送attachment ID。可以批准此限制，或在实施前选择其他有界策略。
- 真实vision profile绑定provider/api/model/baseUrl及有依据的图像token ceiling；未配置时明确拒绝图片发送。每轮aggregate证据dehydrate，单消息CAS保留完整原件表示。
- live smoke使用何种已配置图像模型/endpoint；若无法提供，是否接受contract-only合并/结项，或保留Issue open。离线真实adapter捕获不能代替真实识图与终端体验。

#80的两个恢复问题仍由协调单独跟踪；若阻断#81验收，保留证据交协调，不擅自修复或豁免。#80索引状态按已裁定更新为PR86合并/main CI通过，历史记录不改写。

原始请求、AX回复、模型/结果截图、时间戳和检查日志位于本仓库Git忽略目录 `.demo-data/issue81-attachments/review/`；不提交原始会话。R3 PASS截图文件为 `r3-pass.png`，完整原始回复为 `r3-response-10m-ax.txt`。下一阶段复用同一review会话，最终实现仍需准确HEAD的Claude复核、Linux/macOS CI及协调明确合并授权。

## 10. 协调实施审批（2026-10-24）

协调已获Master授权代行本批计划审批，并批准在952bfa0de5dd3e8859d5a59d369e771dcf1a07ce上实施R3、测试、推送PR及准确HEAD复核；合并仍须单独授权。本节取代此前“待批准”的当前状态，保留旧记录作为历史。

- 批准四端点、独立AttachmentImport容量账本、WITHDRAWN、附件独立loop、单帧撤回及5b/5c全部消费者迁移。仅无助手输出、无未决/已执行工具效果的窗口可撤回整个输入。死进程IN_FLIGHT仍拒绝，不改恢复政策。
- 批准PNG/JPEG、锁定sharp、5MiB/文件、4096单边、4,194,304像素、4图/10MiB每消息、1GiB逻辑预留、10,000导入身份、24MiB wire。公开原始EXIF随图传输，保留unbound内容，无通用GC；降低配置不得破坏旧内容。
- 批准K=0以保持有界预算及长期会话可用性；当前loop/冻结恢复保留像素，HANDLED后的新loop明确显示无像素，owner以ready ID重送。自然追问未验收，后续简洁重用入口由协调交接#82/#83。
- 批准aggregate dehydrate/exact hydrate及全部reader核验；纯文本identity、policy_id及历史aliases逐字节兼容。
- 本项以Core契约退出：两种实际安装adapter到loopback HTTP完整capture及全部R3门槛必需。不调用真实provider、不改生产配置；真实识图NOT_TESTED。真实模型无匹配profile时ATTACHMENT_BUDGET_UNCONFIGURED，不套用8192。profile须实际用于admission/dispatch/replay并有部署文档。真实profile选择和合成图live smoke交#84，须在人体验前完成或明确报告阻塞。
- 完成准确HEAD Claude PASS、PR/Linux/macOS/main CI及Issue条件后，协调接受契约结项边界。新增实质范围先交协调；#80恢复问题若阻塞保留首次失败，不暗修。继承数据、进程及393个untracked不动。

继续使用同一Claude Opus5.5 Extra会话，首读10分钟/随后5分钟；账号或模型异常请Master裁定fallback。当前实施证据尚未产生。
