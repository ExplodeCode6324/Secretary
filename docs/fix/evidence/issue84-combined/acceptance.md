# #84 组合验收账本

> 最新终审：Master 已授权「除已明确略过项外，无未完成验证则最终检查后合并；有缺口继续补验」。最终 34 项证据与剩余说明的逐项核对见 [最终核对](final-audit.md)，优先于下方历史“暂不收口/无合并授权”时点记录。R11 Core 补验和 CI 已通过；两条 B09 归档推断已补实际 Core 测试。R12 另找出原 R7 的非空承诺恢复和提取幂等漏验，已继续补入恢复/重启与 STALE 实测，详见最终核对。最终精确 HEAD 的 CI/Claude 及合并结果追加 PR。历史 FAIL/NOT_RUN 不抹除，不伪装为新增原生 PASS。


本账本为候选提交逐项登记结果。此前各批证据按原范围引用。新验收由执行人补记日期、候选 Core/TUI SHA、环境、对象 ID、实际输入及观测、证据位置和 Master 对差异的裁定。未执行的组合检查保留 NOT_RUN。

当前正式分支定义已吸收到 [AC01–AC34 分项标准](../../../tui/acceptance-criteria.md)，[来源交叉表](../../../tui/source-map.md)保留六批裁定和历史范围。下方旧行及 u2 节是历史记录；最新 r8 结果见文末，不能以新 API 子项通过覆盖尚未执行的原生分支。

2026-11-05 Master 在候选 `79c4ae798ebe1ed29d1ef881e9ee37bb489afa39` 的无凭据彩排域报告「Shared-B 打开失败」「彩排任务中重做部分失败」「其他验收项成功」。其他已执行项登记为 Master 报告通过；此报告不覆盖交接文档明确未准备的边界样例，也不覆盖真实模型验收。尚未取得逐项步骤及 Terminal 版本、字体、尺寸记录，下面未逐项映射的 NOT_RUN 表示本账本尚无独立分项记录，不否定 Master 的总体反馈。

重做原执行 `db41191c-481a-440f-a313-0fc80c54fdeb` 正确关联新执行 `0a2202a6-60ec-4164-9ee1-7164d6d0ae1d`。新执行实际成功读取预置字节并写出产物，但脚本化模型把写入回执的 `error: null` 误判为读取错误，提交了 FAILED。修复只检查与 read 调用 ID 对应的回执及预置字节，并保留写入失败判断。新增测试通过真实 Core、模型适配器及脚本 SSE 复现修复前失败，修复后验证新执行成功、产物散列和直接父失败处置，旧 FAILED 保留。该测试不是付费模型证据。

Shared-B 当前文件及登记散列匹配，Core 查询、TUI 路径解析、文件安全检查和系统 open 调用均通过。Master 随后确认「现在是 ok 的，第一次尝试是失败的」，并表示后续验收时尝试复现。登记为后续打开 USER_REPORTED_PASS，首次异常仍未取得错误文本、未定位，保留观察，不改动产品打开逻辑。原始诊断存于忽略目录 `.demo-data/issue84/logs/`。TUI 启动命令另补 `SECRETARY_MODE=live`，与本验收服务的 API 模式一致；`rehearsal` 仍不请求真实模型。

| 批次 | 最终 PR | 关闭事件 |
| --- | --- | --- |
| #82 | [#95](https://github.com/ExplodeCode6324/Secretary/pull/95) | [COMPLETED](https://api.github.com/repos/ExplodeCode6324/Secretary/issues/events/35163237921) |
| #91 | [#96](https://github.com/ExplodeCode6324/Secretary/pull/96) | [COMPLETED](https://api.github.com/repos/ExplodeCode6324/Secretary/issues/events/34760550187) |
| #83 | [#97](https://github.com/ExplodeCode6324/Secretary/pull/97), [#98](https://github.com/ExplodeCode6324/Secretary/pull/98) | [COMPLETED](https://api.github.com/repos/ExplodeCode6324/Secretary/issues/events/35163244961) |
| #92 | [#99](https://github.com/ExplodeCode6324/Secretary/pull/99) | [COMPLETED](https://api.github.com/repos/ExplodeCode6324/Secretary/issues/events/35163252142) |
| #93 | [#100](https://github.com/ExplodeCode6324/Secretary/pull/100) | [COMPLETED](https://api.github.com/repos/ExplodeCode6324/Secretary/issues/events/35163260225) |
| #94 | [#101](https://github.com/ExplodeCode6324/Secretary/pull/101) | [COMPLETED](https://api.github.com/repos/ExplodeCode6324/Secretary/issues/events/35215369084) |

| AC | 验收对象 | 批次证据入口 | #84 实际观测与裁定 |
| --- | --- | --- | --- |
| AC01 | 真实终端 启动 双入口与阅读位置恢复 | [#82](../issue82-rebuild/acceptance.md), [#83](../issue83-task-browser/acceptance.md) | NOT_RUN |
| AC02 | 窗口尺寸与页面容量 | [#82](../issue82-rebuild/acceptance.md), [#92](../issue92-attention/acceptance.md) | NOT_RUN |
| AC03 | 消息类型 颜色与分割线 | [#82](../issue82-rebuild/acceptance.md), [#91](../issue91-main-history/acceptance.md) | NOT_RUN |
| AC04 | Markdown 呈现 | [#82](../issue82-rebuild/acceptance.md) | NOT_RUN |
| AC05 | CoT 全消息开关与跨视图继承 | [#91](../issue91-main-history/acceptance.md), [#83](../issue83-task-browser/acceptance.md) | NOT_RUN |
| AC06 | CoT 阅读锚点 游标恢复与不补写日志 | [#91](../issue91-main-history/acceptance.md) | NOT_RUN |
| AC07 | 近期启动 连续上滚与缓存淘汰后重读 | [#91](../issue91-main-history/acceptance.md) | NOT_RUN |
| AC08 | 新消息不自动跳转 | [#91](../issue91-main-history/acceptance.md) | NOT_RUN |
| AC09 | 历史读取失败 游标失效与恢复 | [#91](../issue91-main-history/acceptance.md) | NOT_RUN |
| AC10 | Scope 分组 排序与计数 | [#83](../issue83-task-browser/acceptance.md) | NOT_RUN |
| AC11 | 计划与各执行状态 | [#83](../issue83-task-browser/acceptance.md), [#93](../issue93-failure-handling/acceptance.md) | NOT_RUN |
| AC12 | Shared Scope 逻辑分组与归档计数 | [#83](../issue83-task-browser/acceptance.md) | NOT_RUN |
| AC13 | 同一 Task 不并发执行 | [#83](../issue83-task-browser/acceptance.md) | NOT_RUN |
| AC14 | 历史 ID 查询只定位并排除归档 | [#83](../issue83-task-browser/acceptance.md) | NOT_RUN |
| AC15 | taskdetail 与最近三轮真实 Agent 对话 | [#83](../issue83-task-browser/acceptance.md) | NOT_RUN |
| AC16 | Main 活动区 先后顺序与已看颜色 | [#92](../issue92-attention/acceptance.md), [#93](../issue93-failure-handling/acceptance.md) | NOT_RUN |
| AC17 | 上键编辑边界和事项选择 | [#92](../issue92-attention/acceptance.md) | NOT_RUN |
| AC18 | Main 定向回答 批准完成与原稿恢复 | [#92](../issue92-attention/acceptance.md) | NOT_RUN |
| AC19 | Task show 与普通 Task 输入区分 | [#92](../issue92-attention/acceptance.md) | NOT_RUN |
| AC20 | 目标失效 报错并自动返回 | [#92](../issue92-attention/acceptance.md) | NOT_RUN |
| AC21 | 失败行委托主会话 真实处置与状态刷新 | [#93](../issue93-failure-handling/acceptance.md) | 原失败保留；758fb875 新任务单步重做经 Master 原生复测 PASS，Core 独立验证 PASS；真实 provider 待执行 |
| AC22 | 产物末尾列表与当前文件 | [#94](../issue94-delivery/acceptance.md) | Shared-B 首次失败，后续 Master 确认可打开；首次异常待复现 |
| AC23 | open 不存在路径 | [#94](../issue94-delivery/acceptance.md) | NOT_RUN |
| AC24 | 命令大小写 作用域与处理状态禁用 | [#82](../issue82-rebuild/acceptance.md), [#91](../issue91-main-history/acceptance.md), [#83](../issue83-task-browser/acceptance.md), [#92](../issue92-attention/acceptance.md), [#93](../issue93-failure-handling/acceptance.md), [#94](../issue94-delivery/acceptance.md) | NOT_RUN |
| AC25 | 首字符规则与一次性纯文本 | [#82](../issue82-rebuild/acceptance.md) | NOT_RUN |
| AC26 | 独立草稿与非空输入限制 | [#82](../issue82-rebuild/acceptance.md) | NOT_RUN |
| AC27 | 多段粘贴的真实内容 | [#91](../issue91-main-history/acceptance.md) | NOT_RUN |
| AC28 | macOS 中文输入 换行 补全与终端预检 | [#82](../issue82-rebuild/acceptance.md), [#83](../issue83-task-browser/acceptance.md) | NOT_RUN |
| AC29 | 显式取消目标与真实反馈 | [#93](../issue93-failure-handling/acceptance.md) | NOT_RUN |
| AC30 | 退出 重开与后台持续运行 | [#82](../issue82-rebuild/acceptance.md), [#93](../issue93-failure-handling/acceptance.md) | NOT_RUN |
| AC31 | UI 操作不进入会话历史 | [#82](../issue82-rebuild/acceptance.md), [#91](../issue91-main-history/acceptance.md), [#83](../issue83-task-browser/acceptance.md), [#92](../issue92-attention/acceptance.md), [#93](../issue93-failure-handling/acceptance.md), [#94](../issue94-delivery/acceptance.md) | NOT_RUN |
| AC32 | 图片直接粘贴与失败保留 | [#94](../issue94-delivery/acceptance.md) | NOT_RUN |
| AC33 | Shared 逻辑归组 独立目录与产物交付 | [#83](../issue83-task-browser/acceptance.md), [#94](../issue94-delivery/acceptance.md) | 两份产物登记与当前字节已核对；Shared-B 后续打开 USER_REPORTED_PASS，保留首次异常 |
| AC34 | 未提交时 Esc 退出处理 | [#92](../issue92-attention/acceptance.md) | NOT_RUN |

原始逐项前置、动作及失败判据见 [v1.7 固定版本](https://github.com/ExplodeCode6324/Secretary/blob/ed16e804d28c0b0048e37035349f1ff3f7982f38/docs/tui/implementation-reference.md#10-可直接执行的验收操作)。AC08 以 #91 后续跟随裁定为准。AC28 的复制验收含已交付的鼠标松开复制。#94 最终记录见 [PR #101](https://github.com/ExplodeCode6324/Secretary/pull/101#issuecomment-6652193797)。此前 /open report.txt 异常派发的原因仍未确定。

## 2026-11-05 重做复测与证据边界

Master 在 `758fb875fdcf10f7a7b342b56d03318cdf78e7a8` 确认重做复测成功。新失败 Task 为 `01546734-c028-4f5b-9c62-7210d54e6de4`，原执行 `34d53977-d123-4b6b-a4fc-79d78e7c3979` 真实读取缺失文件后 FAILED；预置 13 字节 `ISSUE84-REDO\n` 后，原生失败行重做产生唯一直接后继 `a89ba2b6-39d6-4f9c-98ae-604c0db68519`，SUCCEEDED。Codex 核对后继自己的 SUCCEEDED/APPLIED 写入 Operation、登记产物、实际字节与 SHA-256 `b4a69797d1c4a0de5428c053d8d40289d097967f2e46fd30a66aad79bbb4f82f`，原执行仍 FAILED，直接父处置为 REDO_SUCCEEDED。证据类别为 USER_REPORTED_NATIVE + SCRIPTED_MODEL_CORE，不能替代真实 provider。原始核对在忽略目录 `.demo-data/issue84/diagnosis-20261105/native-redo-pass.json`。

其他 NOT_RUN 行的共同原因：尚无足以逐分支映射的本次原生操作记录；不把 Master 总体通过反馈扩展为未准备样例的通过。各行前置、输入、期望及失败判据绑定上文 v1.7 固定版本的 AC 同号条款。原生来源候选为 79c4ae7，重做复测为 758fb875；未执行行没有测试 SHA。后续自动化、Core API、真实 provider 结果必须声明证据类别，不能覆盖终端键位、布局或真实剪贴板操作。最新候选的冻结后 CI/复核结果追加 PR #102。

| 未决项 | 当前证据与下一步 | Master 裁定 |
| --- | --- | --- |
| Shared-B 首次打开失败 | 后续原生打开成功；若复现记录精确提示、时间及查看器是否已运行 | 保留观察，按 Master 后续反馈 |
| 原生分项记录及环境 | 总体报告通过；Terminal 版本、字体、行列及逐分支记录未捕获 | 终审确认范围 |
| 边界样例 | 归档/歧义/纯暂停、UNKNOWN、旧失败拒绝、精确取消、4 MiB、overflow、四轮 Agent 的自动化证据按原范围引用；本次未建立完整原生样例域 | 不自动判 PASS |
| 原生图片到真实 provider | 新真实域按清单操作并核对随机标记；API 导入仅证明 API 路径 | 等待新记录 |
| 实现参考文档退役 | 仍保留唯一 AC 分支定义及未决原生引用 | 继续保留 |

## u2 已保存的真实结果与续验阻塞（2026-11-05）

本节补记交接前已经执行的结果，本轮只读核对，未重新运行 provider。候选 Core/TUI `0899929f630df064940c42342c8fd605a4816dff`，observe 策略，Main 90K／输出 8192／wire guard 100K；不代表生产默认窗口消耗或原生终端验收。原始文件均在 Git 忽略的 `.demo-data/issue84/runs/u2/live/`。后续生产代码变化后，必须按 R7 在新域复验；本节保留历史事实。

| 对应分支 | 已保存结果（REAL_PROVIDER_CORE_API） | 尚未证明 |
| --- | --- | --- |
| Main 连续对话前提 | `automatic-probe-1793891463764.json` PASS，probe 与 followup 为两个实际输入 | AC01 原生导航/阅读位置等 |
| AC32 图片模型链路 | `automatic-vision-1793891490891.json` PASS，原图/导入/出站 SHA 一致、随机图标记识别；非原生 | Ctrl+V、READY、原生失败保稿 |
| AC22/AC33 产物和独立目录 | `automatic-shared-1793891539487.json` PASS，两个真实 Task 的各自 report.txt 为不同字节；Task/执行见 HANDOFF | 新轮原生当前文件打开、布局、全部 Shared 分支 |
| AC18/AC19 定向问题链路 | `automatic-question-1793891601200.json` PASS，Decision `d3219765-7ddc-48bf-8a4e-4f01cb63737a`，回答 `/M ISSUE84-AUTOMATIC-ANSWER` 原样送入执行 `9b969482-8d06-484f-81a6-ff86be42433a` | 事项选择/普通草稿恢复/Task show 的本轮原生手势 |
| AC18 授权后执行 | `automatic-approval-1793891644758.json` PASS，Authorization `7cdf1634-9c3f-4fc6-aae2-ee63e890e14e` 被 CONSUMED，Task 写入成功 | 原生 APPROVED 即移除、中立 Enter、排序等 |
| AC21 真实失败→REDO | NOT_RUN；授权后 Main 容量阻塞，未创建本轮缺源失败 Task | 实际 provider 唯一直接重做；旧 scripted/native 结果不替代 |
| AC08/AC27 原生交错 | 本轮 NOT_RUN | 多段粘贴字节、显式跟随/上滚被动到达 |

容量阻塞保留：Main `CAPACITY_BLOCKED`，SCHEDULER Input `3f7b0e2e-02ab-40b5-bfdb-7750455f39c3` 仍 CLAIMED；旧摘要经一次显式恢复提交，仅覆盖序列 32，最新已处理输入为 318。原先 EMPTY_WORKING_MEMORY 与非法 tier 错误未删除。服务已停止，不能沿旧人工步骤直接发送。诊断及待批准修复见 [原总体计划 R7](../../fix_20261105_issue84_combined.md#r7--工作记忆恢复缺陷已定位实施待-master-批准)。新候选真实重做、原生图片及产品终验仍待执行；以上各行均不宣告对应整项 AC 通过。

## r8：组合缺陷独立验收后继续主线（2026-11-06）

产品/Core/TUI SHA `1ebf5cd9c54c87f08ec1c0282d04b761d8a9e45c`。macOS 15.8.2 arm64、Node 22.22.0、pi-tui 0.87.0；安装的 Terminal 为 2.14，字体/字号/行列与本轮原生手势尚未捕获。新空域 `.demo-data/issue84/runs/r8/live`，Session `2359ab4f-686d-4fc9-ab38-6997d661e442`，隔离数据库 `secretary84_r8_live`。原 u2 及其 40 次历史用量不变，只导入带散列的账本。observe 保留 90K/8192/100K 验收配置，不代表生产默认消耗。

独立缺陷门槛先完成：定向 182/182、本机完整 verify 1013/1013、CI Linux/macOS/aggregate 全绿；分离故障域、正常 dry/calibration 和 preflight 通过。真实 probe/followup 后自然提交有效 MINIMAL 摘要，无虚假进行中目标或义务、无显式 compact。详细范围与 R9 源码复核见 [复核记录](plan-review.md)。

| 分支 | r8 实际结果（均为 REAL_PROVIDER_CORE_API，非原生） | 未覆盖 |
| --- | --- | --- |
| Main 连续输入 | probe/followup PASS，初次自然摘要覆盖序列 21 | AC01 导航、物理键位 |
| AC32 图片识别链路 | PASS；图像 SHA `78f0ecc3c8c9cfaff30b38b971f716978830eb51042f394d59ff4bcc555a560a`，真实模型回报未写入提示的随机标记 | Ctrl+V、READY、失败保稿 |
| AC22/AC33 产物/独立目录 | Shared-A Task `db2ebb58-4a84-418e-826e-e5db4860b6e1`、Shared-B `91b8d967-1784-44f6-8ca5-7dd695aaa0c5` 均 SUCCEEDED；各自 report.txt 字节 A/B、登记散列一致，scratch.txt 未登记 | 原生分组、当前文件打开、首次异常复现 |
| AC18/AC19 定向回答 | Decision `7571b276-3179-4013-bfab-b89bffb38519` ANSWERED，`/M ISSUE84-AUTOMATIC-ANSWER` 原样送入 execution `b98f2205-6557-4d28-aeea-e1965b4f2cfe`，SUCCEEDED | 事项选择、普通草稿、Task /show 手势 |
| AC18 授权执行 | 真实 provider 授权子分支 PASS（一次记录在案的 REDO 后）。首次 Agent 生成禁止的 bash，被验收适配器拦截，未执行、无授权，首次仍记 FAILED。保留 `4e375038-5734-43b5-8cac-9ffafe258651`；唯一后继 `6d5d3061-8d6c-433b-9e05-1c7566fb231b` SUCCEEDED，Authorization `b6342bce-ef7f-48bb-a3de-c0b83d8a83d2` CONSUMED，approval.txt 精确字节正确；allowlist 未放宽。授权依据和明确 Main 意图见文末 D1 | 原生中立 Enter、APPROVED 即移除等仍按原分项证据 |
| AC21 缺源失败→直接重做 | PASS。Task `8343a41a-2ffe-4f15-9565-fa54fcc88dbf`：`72c87038-1b14-4d39-a4ae-ab4af670eb1e` 的实际 read 返回 ENOENT；散列验证 checkpoint 后才预置 13 字节。唯一直接后继 `a2c49b52-0bd4-4ae4-ae2b-df4b35d13517` SUCCEEDED，其自身成功 write Operation、登记产物及当前文件均匹配 SHA `b4a69797d1c4a0de5428c053d8d40289d097967f2e46fd30a66aad79bbb4f82f`；原 FAILED 不变，处置 REDO_SUCCEEDED | 本轮原生失败行手势；其他失败分支仍按各自来源 |
| AC08/AC27/AC32 原生组合 | Master 报告 r8 交接步骤全部通过；两段粘贴、图像像素/实际出站及随机标记经 Core 只读核对通过，详见文末 | 报告覆盖实际交接步骤，不扩大至未准备边界 |

两个需要保留的实际观察：Shared 结束后的 `next matters` 曾因后台尚未静止被拒绝；问题场景因此仍记在 shared phase，用实际 scope/ModelCall/对象 ID 归属，不改写原账本。后续明确等空闲、核对 PHASE 后才推进。另有并发状态变化使一次真实摘要 STALE，冷却后自然收敛；STALE 请求和用量单列，不当作免费或成功摘要。禁止工具请求的用量同时保存在验收账本和 FAILED ModelCall 的响应中；仅后来 Agent 合成的错误消息显示零，不能据此扣掉真实用量。

所有路径原始结果为忽略目录 `runs/r8/live/automatic-*.json`，checkpoint/journal/objects 可散列复核。增强的本地 driver 在补源前检查真实 read 错误，未修改产品或正式候选。用量报告是按时点生成的 `TOKEN-USAGE.md` / `token-usage.json`；后续人工调用继续累计，最终数字写入 PR 终审记录。原生及整项 #84 均不因这些 API 子项通过而自动 GO，PR 保持 draft，合并/关闭另需 Master 授权。

## r8 原生收口与复核补证

Master 报告「验证完成，全部验证项通过」，随后确认手敲首句和额外空行均为其实际输入。此报告覆盖 r8 交接中的 Ctrl+V→READY→实际模型、手敲/粘贴/手敲/粘贴、显式跟随后主动上滚及两份 Shared 当前文件打开。终端行为属于 USER_REPORTED_NATIVE；下列持久化事实由 Codex 独立只读核对。完整记录见 [PR 收口证据](https://github.com/ExplodeCode6324/Secretary/pull/102#issuecomment-6665234271)和[最终 CI/运行核对](https://github.com/ExplodeCode6324/Secretary/pull/102#issuecomment-6665306234)。

- Input `dfc8fc77-67da-4360-a060-6bfa10201dfe` HANDLED。两段预声明粘贴原文逐字保持且顺序正确；payload SHA `2e3a3fab711c665889df2cd67b60b21780a421eb023d77b10a53fcbb3e158894`。首轮固定全文比较失败的日志保留：Master 主动改了手敲首句及空行，确认后按实际输入裁定，不改写原期望来伪造通过。
- 附件 `58e6d821-685c-49bd-82a3-dad17cacfd01` 为 760×200 PNG。剪贴板重编码使文件 SHA 改变，解码 RGBA 像素与准备图完全一致，像素 SHA `2f9c127aa0276763ea0331f702c3ee4e015ac46b8b0c56c5f4ec43240f3de315`。导入和实际出站 SHA 均为 `ae48069060e75bcb415efa72b02f857f28f27ec2cc89c8a76cb3efb12071d069`；ModelCall `427744f0-6ddb-425f-be68-421c0c1d6c19` 的请求证据已还原校验，模型回报正确随机标记，提示中未包含答案。
- 两份 Shared 文件仍分别为 A/B 精确字节，登记散列一致。原生阶段只有上述一条 MASTER Input，导航和 `/open` 未成为额外 Main 消息。首次打开历史异常本次未复现，不据此宣布其根因已修复。
- 最终 Session IDLE，18 个 Input 全部 HANDLED，covered 684 等于最新已处理序列；12 个提取任务 SUCCEEDED。真实域只观察到 IDLE/RUNNING，无 CAPACITY_BLOCKED 或 RECOVERY_BLOCKED。两个原 FAILED 分别是工具拦截和预期缺源文件，均保留成功直接后继。
- 已知环境为 macOS 15.8.2 arm64、Node 22.22.0、pi-tui 0.87.0、安装的 Terminal 2.14；实际字体、字号、行列为 NOT_CAPTURED，不虚构值。Core 产品 SHA 为 `1ebf5cd9`，后续 TUI 所在文档提交的生产代码完全相同。

### D1–D3 处置

D1：授权子分支在一次记录在案的 REDO 后 PASS，首次仍 FAILED。依据已批准 observe 修订的「每个阻塞条件至多一次有理由且记日志的恢复」及 Master 本轮继续修复、独立验收和原主线的指示，Codex 在停止并诊断拒绝后，于 17:32:30 UTC 明确提交新的 Main 结构化意图 `9a4ff54d-ae5b-4560-a0b1-800ed3c2cb3d`。这不是产品自主重试，也不冒充 Master 当时亲手操作；原要求和 allowlist 未改变。Claude R10.1 接受该依据与单次执行边界。

D2：本地忽略 driver 的版本归属已保存。V1（probe/初次 idle/vision/Shared）SHA `fab07f3b056a556c68a3f6118dbb18f88ac97faf1d000d9a0509ddc182785528`；V2（question/首次 approval/早期 idle）SHA `b53ce61f62e686435a4c2ef742a36b8f978bfd85309e25ca1005ef74c8157c09`；V3（approval recovery/真实缺源 REDO/后续 idle）SHA `a963be1cfed66b6918e2c2e62691b24af5d6ac17b9f54004e0d542bf289a4a7b`。这些散列是事后存档；V1/V2 由两次已记录编辑逆向重建，V3 与当前文件相同，不能冒称执行时源码签名。实际结果另由持久 Core checkpoint、Operation 和产物支持。

D3：用量报告自身已标注 question 的 shared phase 归属，以及输入包含缓存未命中、缓存读和缓存写；推理已包含在输出中。禁止 bash 的响应实际为 2164 输入/49 输出，其中缓存读 1280；FAILED ModelCall `d85db2ff-7eef-42ea-9d03-3fb5691b4212` 的响应对象 SHA `708dbd5e9b289581dff767799d100f4e80d63fecd83c2b4bfcd8a912db579855` 保存这些非零用量。仅 Agent 后续合成 MODEL_TRANSPORT_LOCAL 错误显示零；没有证据表明 Core 丢了该响应的用量。该 bash 未执行。

原生后快照：新 78 次物理请求，486,356 输入 + 66,848 输出 = 553,204 token；旧 40 次/253,380 token 不变；混合累计 118 次/806,584 token，未知用量 0，对账 PASS。新估算 USD 0.08559084、累计 USD 0.103584438，不等于账单。这是 90K/8192/100K 验收配置，不是生产默认消耗。运行后续若有新请求应重算快照。

### Master 全账本终审边界

本轮原生步骤已通过；Master 在看到下列具体边界后明确选择「先补验部分缺口，暂不收口」。Master 随后选定「先补可自动验证的 Core 边界」，并表示另两个原生样例在之前使用中未见问题、可以略过。本轮只补自动化 Core；该略过决定不等于新增原生逐分支通过，也不补齐未捕获环境。没有合并/关闭授权。补验来源及结果见 [Core 边界补验](core-boundaries.md)。

| 边界 | 已有依据与限制 |
| --- | --- |
| 未准备的原生子分支 | 归档/歧义/纯暂停、UNKNOWN、旧失败拒绝、精确取消、4 MiB/淘汰、overflow、四轮 Agent 等沿用各批证据和 Master 早先总体反馈；未伪装为本轮逐项原生通过 |
| 原生环境与 driver 来源 | 字体/字号/行列未捕获；V1/V2 driver 事后重建的局限见 D2 |
| 授权单次恢复 | Codex 按已批准恢复范围提交明确 Main 意图，首次拒绝保留，见 D1 |
| 提示和记忆 | 新提示明确「仅本轮」，未证明未标注指令的语义分类；后续提取的 OPEN 承诺仍遵循既有 `notification.presented`/明确 resolve 合同，初次 MINIMAL 不代表全部后续承诺自动完成 |
| 观测配置与计费 | 非生产默认窗口，question phase 标签保留，费用是估算，见 D3 |
| 历史异常与参考文档 | Shared-B 首次打开和旧 `/open` 路由根因未明；B09 仍是当前归档边界，旧参考文档继续保留，退役延期 |

精确产品提交本地 1013/1013、定向 182/182 均通过；文档提交 `e73e7de7` 的 [CI 42076981001](https://github.com/ExplodeCode6324/Secretary/actions/runs/42076981001) Linux/macOS/aggregate 成功。Claude R10.1 确认该提交无实现/文档阻断，可交 Master 裁定；本次最终账本同步后的精确 SHA、CI 和复核结论追加 PR，避免仅为状态再造提交。
