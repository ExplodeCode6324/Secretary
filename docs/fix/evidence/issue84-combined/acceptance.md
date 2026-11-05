# #84 组合验收账本

本账本为候选提交逐项登记结果。此前各批证据按原范围引用。新验收由执行人补记日期、候选 Core/TUI SHA、环境、对象 ID、实际输入及观测、证据位置和 Master 对差异的裁定。未执行的组合检查保留 NOT_RUN。

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
