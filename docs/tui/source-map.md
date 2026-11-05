# TUI 需求来源与正式文档交叉表

来源固定为 [v1.7 / ed16e804](https://github.com/ExplodeCode6324/Secretary/blob/ed16e804d28c0b0048e37035349f1ff3f7982f38/docs/tui/implementation-reference.md)。后续六批裁定见 [当前行为表](acceptance.md#当前行为和来源)，优先于旧描述。此表说明文档落点，不替代行为验收。

| 来源 | 正式目标 | 分支及边界 |
| --- | --- | --- |
| C01 | [运行说明](run-and-test.md)、[API 清单](api-coverage.md) | 当前终端、独立 Core；不重选框架、不一次接齐 API |
| C02 | [分项标准](acceptance-criteria.md) AC01–02 | 双入口、根返回、尺寸和统一布局 |
| C03 | [分项标准](acceptance-criteria.md) AC03–04 | 消息、颜色、Markdown；流式和历史分别验 |
| C04 / U03 | [运行说明](run-and-test.md)与 AC06–09 | 50/50/200、4 MiB 是缓存，不是历史上限；锚点和跟随 |
| C05 | [运行说明](run-and-test.md)与 AC05–06 | CoT 继承，无普通日志新入口 |
| C06 / U06 / U09 | [运行说明](run-and-test.md)与 AC10–12、33 | Scope/Shared 排序计数；Shared 不是实体 Scope，目录独立 |
| C07 | [分项标准](acceptance-criteria.md) AC11、13 | 计划与执行分开；纯暂停排除、等待仍显示；单 Task 忙碌 |
| C08 / U07 / U08 | [运行说明](run-and-test.md)与 AC14–15 | 归档排除、查找、最近三轮；查询不改变业务状态 |
| C09 | [运行说明](run-and-test.md)与 AC16 | Main 事项、发起排序；不调用 viewed、不延长留存 |
| C10 / U02 | [运行说明](run-and-test.md)与 AC17–20、34 | 定向输入；APPROVED 移除不等 CONSUMED；普通草稿保护 |
| C11 / U04 | [运行说明](run-and-test.md)与 AC22–23、33 | 登记产物、当前文件；快照散列与当前字节分开 |
| C12 / U01 | [运行说明](run-and-test.md)与 AC24–25 | 手敲首字符、处理态禁命令、一次性纯文本 |
| C13 | [分项标准](acceptance-criteria.md) AC25–26 | Main/Task 普通草稿独立，无详情草稿 |
| C14 | [运行说明](run-and-test.md)与 AC27、32 | 多段原文，短文本 60 字素；Ctrl+V 像素 |
| C15 | [分项标准](acceptance-criteria.md) AC09、23、31 | 局部错误不写会话，不破坏草稿和已读内容 |
| C16 | [运行说明](run-and-test.md)与 AC29–31、34 | 精确取消、业务输入、退出 TUI 不停 Core |
| U05 / 第 7.3–7.4 节 | [运行说明](run-and-test.md)与 AC21、29 | 结构化重做/移除，旧执行明确拒绝，UNKNOWN 只读 |
| B01–B03 | [API 清单](api-coverage.md) | 历史及 Task browser 只读投影，不新增历史库 |
| B04–B06 | [API 清单](api-coverage.md) | 调度、事项和授权复用 Core；TUI 调用与测试调用分开 |
| B07–B08 | [API 清单](api-coverage.md) | 结构化产物与 Shared 独立目录；系统打开在本机 |
| B09 / 第 7.1 节 | [仍然有效的归档业务边界](implementation-reference.md#71-scope-归档-当前代码已经实现的含义) | 当前来源仍在旧参考文档，是暂不退役的原因之一；不级联 TaskPlan，不停止已开始执行，不扩范围 |
| B10 | [运行说明](run-and-test.md)与 AC21 | 原 FAILED 保留；直接关联重做成功才能消除对应提醒 |
| 第 9–10 节 | [完整分项标准](acceptance-criteria.md) | AC01–AC34 全部前置、动作、预期、失败判据和边界已吸收 |
| 第 11–14 节 | [历史来源](implementation-reference.md) | 批次、取舍和设计记录保留，不再作为未实施清单 |

每个 AC 的实际结果统一登记在 [组合账本](../fix/evidence/issue84-combined/acceptance.md)。原生、脚本化 Core 与真实 provider 证据分列，一条 API 成功不能把整个 AC 改为 PASS。跨项前置可复用同一对象；Master 总体反馈保留，缺单项记录不推翻该反馈。

`implementation-reference.md` 继续保留为历史设计来源。本次已吸收完整 AC 操作，但尚未宣告所有原生分支通过，历史 fix/证据也仍引用它。只有全部有效要求有正式目标、活引用修正且 Master 接受收口后，才考虑退役。

后续顺序：#84 与 Master 产品终验 → #103–#106 主动引导 → 按反馈迭代 TUI → Master 确认 UI 稳定 → #70→#71→#72→#73。#74 由 #70 真实数据决定。本页不授权实施下游项目。
