# 现行前端规范

版本：FE-DOC R1，2026-10-21。Master 已批准 R1 计划及设计裁定；本文档集待 Master 终审。#61 合并且 Master 明确确认后，#62 才可开始。

这是仓库唯一的现行前端规范入口；各语言版本表达同一规范。冻结 v1.0 是唯一权威视觉来源：**如果不确定，就翻 v1.0 的设计，先按它的来，后续按 Master 意见调整。**

[v1.0 · UI-DESIGN.md](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/UI-DESIGN.md) · [v1.0.0 · source](https://github.com/ExplodeCode6324/secretary-phase-ui-design/tree/8cdb9219bed9493147ba10f7d47423df56cbcc44)

- [架构与流程](architecture-and-flows.md)：真实桌面、桥接、Core 和能力边界。
- [PhaseUI 视觉](phaseui-design.md)：颜色、布局、字形与动效来源。
- [组件与状态](components-and-states.md)：构造、三帧、取消与输入语义。
- [验收矩阵](acceptance.md)：当前证据、后续原生检查及性能评估。
- [来源迁移](source-migration.md)：历史条款、能力映射与 R1 裁定。

当前实现基线为 `5f73c23`（FE-02 / PR #75），具备最小真实业务链路；完整视觉组件属于 #62，对话、任务、记忆/设置、产物/通知页面分别由 #63～#66 完成。当前仅验收 macOS；Linux 桌面 deferred / NOT_TESTED，不阻塞路线，Core Linux CI 保持不变。

本次 #61 只整合文档。Master 已撤回真实部署要求：不启动部署，不提前实现 #62。运行入口见[桌面说明](../../src/secretary_desktop/README.md)，历史材料见[历史索引](../old/README.md)。
