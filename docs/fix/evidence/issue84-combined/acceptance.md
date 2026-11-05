# #84 组合验收账本

本账本为候选提交逐项登记结果。此前各批证据按原范围引用。新验收由执行人补记日期、候选 Core/TUI SHA、环境、对象 ID、实际输入及观测、证据位置和 Master 对差异的裁定。未执行的组合检查保留 NOT_RUN。

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
| AC21 | 失败行委托主会话 真实处置与状态刷新 | [#93](../issue93-failure-handling/acceptance.md) | NOT_RUN |
| AC22 | 产物末尾列表与当前文件 | [#94](../issue94-delivery/acceptance.md) | NOT_RUN |
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
| AC33 | Shared 逻辑归组 独立目录与产物交付 | [#83](../issue83-task-browser/acceptance.md), [#94](../issue94-delivery/acceptance.md) | NOT_RUN |
| AC34 | 未提交时 Esc 退出处理 | [#92](../issue92-attention/acceptance.md) | NOT_RUN |

原始逐项前置、动作及失败判据见 [v1.7 固定版本](https://github.com/ExplodeCode6324/Secretary/blob/ed16e804d28c0b0048e37035349f1ff3f7982f38/docs/tui/implementation-reference.md#10-可直接执行的验收操作)。AC08 以 #91 后续跟随裁定为准。AC28 的复制验收含已交付的鼠标松开复制。#94 最终记录见 [PR #101](https://github.com/ExplodeCode6324/Secretary/pull/101#issuecomment-6652193797)。此前 /open report.txt 异常派发的原因仍未确定。
