# 前端验收矩阵

[Current Frontend Spec](README.md)

状态分开记录：OBSERVED 表示本轮实际浏览器观察；INHERITED 表示既有版本证据；NOT_TESTED 表示尚未执行；PENDING_MASTER 表示等待本人美学/文档复核。#61 为文档验收，不能把浏览器原型或 FE-02 的技术通过升级为 #62 的视觉通过。Linux 桌面全部 deferred / NOT_TESTED，Core Linux CI 不受影响。

## 现有证据

| 范围 | 证据与结论 | 状态 |
| --- | --- | --- |
| v1.0 原型，464×671 窄视口 | 深浅色、发送本地示例、右栏覆盖/收起、任务行展开、产物 dialog/Escape 焦点返回、三帧冻结及恢复，见 R1 计划 | OBSERVED |
| 冻结 v1.0 发布 | 原仓库宽/窄截图与生命周期检查；保留其平台和测试边界 | INHERITED |
| FE-02 真实桥接 | PR #75 已合并；真实对话、任务/授权/结果/保存及 IME 的版本证据不代表完整 PhaseUI | INHERITED |
| 本文档集 | R1 计划已批准，整合文档待 Master 终审；没有部署 | PENDING_MASTER |

[R1 observation](../fix/fix_20261021_issue61_PhaseUI现行规范.md) · [v1.0 validation](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/preview/v1.0/VALIDATION.md) · [FE-02 evidence](../fix/evidence/issue60-desktop-live/README.md) · [PR #75](https://github.com/ExplodeCode6324/Secretary/pull/75)

## macOS 后续验收（均未在 #61 执行）

| 场景 | 通过条件 | 阶段/状态 |
| --- | --- | --- |
| 宽度与缩放 | 实际 Tauri 窗口在1100/850/600断点两侧及100/125/150/200%缩放；中央伸缩、侧栏固定/按档切换、线条接边，内容可读可操作 | #62 / NOT_TESTED |
| 深浅色与名称 | v1.0 颜色/状态色，选中行融入主体；空白名 Secretary，长名可获取全文 | #62 / NOT_TESTED |
| 全组件状态 | 按钮、输入、目录、任务/产物行、弹层覆盖适用的交互和业务状态；失败与 disabled 不伪装成功 | #62～#66 / NOT_TESTED |
| 系统 IME | 中文候选确认/取消、鼠标发送、切窗、组合后独立 Cmd+Enter；每项三次，零误发、有效提交一次；Enter 换行 | #62/#63 / NOT_TESTED |
| 键盘/辅助技术 | Tab/Shift+Tab、Enter/Space 激活、弹层 Escape/焦点返回；可访问名称与状态朗读；临时层不重复朗读 | #62 / NOT_TESTED |
| 动效 | 三帧分镜与自然播放，快速反复触发/移出/失焦/禁用/卸载，头像及分隔线覆盖；reduced-motion/关闭不补播 | #62 / NOT_TESTED |
| 阅读连续性 | 跨页草稿/ID锚点、历史分页、文本选择/复制、流更新不抢位置，显式跳到最新 | #63 / NOT_TESTED |
| 真实业务 | pending/成功/失败/离线/陈旧/未知结果，审批冲突、产物保存/取消、通知 presented/read；真实对象与回执一致 | #63～#66 / NOT_TESTED |

## 三帧性能评估（#62）

同一构建比较关闭装饰、v1.0 完整三帧覆盖、三帧加左栏文字/已有分隔线三组；设备、数据、窗口、DPR、主题、操作序列相同，每组至少三次。固定随机种子用于可比测量，再以自然随机检查观感。场景包括空闲、单控件、快速跨控件/导航、输入/滚动、固定 fixture 消息流同时触发动效。

记录主线程构建/更新、输入到下次绘制/点击反馈 p50/p95、帧间隔/长帧、长任务及可得的绘制/合成指标；记录包含 WebView 的相关进程 CPU、内存峰值与回落，以及效果/节点/timer 清理。GPU/能耗工具不可得时标 NOT_TESTED。报告绝对值与相对关闭动效基线的差值，对照 FE-00/02 响应证据，不凭节点数估算性能比例。

在真实 macOS Tauri 窗口检查三帧可辨、文字可读、光标/选择稳定和可打断；Master 判断美学及可感知卡顿。发现瓶颈先优化构造、复用与清理，保留三逻辑帧。浏览器预览不能代替原生性能验收；本次没有执行该测量或付费模型调用。

[measurement entry](../../src/secretary_desktop/scripts/measure.py) · [v1.0 cost analysis](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/TAURI-MOTION-COST.md)

## PhaseUI implementation candidate (#62)

The production component mapping and explicit adaptations are recorded in the [component contract](../../src/secretary_desktop/src/phaseui/README.md) and [implementation evidence](../fix/evidence/issue62-phaseui/summary.md). The frozen design remains the authority; candidate evidence does not replace Master acceptance. Resource comparison uses [the PhaseUI harness](../../src/secretary_desktop/scripts/phaseui_measure.py), separately from the historical FE-00 measurements.
