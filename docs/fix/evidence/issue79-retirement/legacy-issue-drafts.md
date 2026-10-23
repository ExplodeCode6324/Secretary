# 旧 FE Issue 路线接管评论草案

状态：2026-10-23，#79 R2 计划附件；**尚未发表**。以下六份为待协调会话批准/发表的具体内容。保留原 Issue 状态，不关闭、不宣称旧 GUI 验收完成；已核实六项 Issue 正文均有 2026-10-23 冻结及承接说明；以下仅作可选补充，不因没有评论而重复发表。发表前同时复核正文和评论。总路线 [#57](https://github.com/ExplodeCode6324/Secretary/issues/57)，当前 [TUI 需求基线](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/docs/tui/requirements-and-backend-plan.md)。

## #62

Master 已决定冻结 Tauri/PhaseUI 路线，由 #79 直接退役旧客户端，新 TUI 按 #80–#84 推进。PR #77 的既有合入事实保留；本 Issue 的视觉微调、最终资源/感知性能、系统拼音 IME、VoiceOver、系统滚动条偏好组合等尚未完成验收，不能因停止旧 GUI 工作记为通过。新 TUI 只承接需要的交互质量和经明确要求保留的颜色参数，不承接完整 PhaseUI 实现或复杂动效。新 macOS 真实可用验收由 #84 独立完成。历史证据仍按原提交和原状态追溯。

## #63

Master 已决定冻结旧 GUI，#79 退役 Tauri/Svelte；PR #78 已合入事实及原证据保留。共享 Core 的空异常回复状态行、length 活动终态问题由 #80 承接。新客户端可靠发送、同步、阅读恢复和有界自动补读由 #82 建设，实际终端/真实使用验收由 #84 完成；不复制旧 Svelte 实现。旧最终真实模型长正文阅读仍为 NOT_ACCEPTED，系统拼音 IME 为 NOT_TESTED，VoiceOver 和最终视觉/感知性能仍待验收；不以退役改写这些事实。原调用账本与失败归因保留，不据此授权新的模型调用。后续需求以 #57 的 TUI 路线为准。

## #64

本 Issue 的旧 Tauri Task/Scope/审批页面路线冻结，旧客户端由 #79 退役。Task 显式对象操作、必要审批/决策需求由新 TUI #83 在其确定范围内承接，依赖 #82 基础客户端并由 #84 验收；Scope 等现有 Core API 继续保留，但未用接口不自动要求补完整菜单。旧 GUI 页面未交付/未验收部分继续如实记为未完成，不以新路线建立或旧代码删除代替验收。具体实现以 #57 的 TUI 需求为准。

## #65

旧 Tauri Memory/World/Settings 页面路线冻结，#79 仅负责旧客户端退役。Core 的相关 API、数据与管理能力继续保留；新 TUI 首版按 Main/Task 实际闭环选用接口，不承诺本 Issue 的完整页面或任意记忆编辑/模型热切换。#82–#84 的每项交付会维护 API 已用/未用清单及原因，未用功能保留为明确范围记录。旧 GUI 未完成项不记为已验收；后续扩展由 #57 路线另定。

## #66

旧 Tauri 产物/通知/生命周期页面路线冻结，#79 退役旧客户端但保留 Core 产物、推送/通知及独立后台能力。新 TUI 必需的客户端/后台生命周期由 #82 承接，产物外部打开等必要功能由 #83 承接，#84 验收。旧 Tauri 应用内/系统通知 UI 不迁入新 TUI，Core 的 MACOS_NOTIFICATION 推送目标继续可用；Portable 继续不属目标。Core API 的保留不等于新界面已实现。旧 GUI 的未交付/未验收状态保留，按 #57 的 TUI 需求推进。

## #67

旧 Tauri 真实使用终验路线冻结，#79 退役旧客户端；本 Issue 不因停止 GUI 工作而视为验收通过。新的终验由 #84 对 macOS 实际终端和 Main/Task 日常使用独立完成，前置为 #80–#83 的对应交付。Linux TUI deferred/NOT_TESTED，Core Linux CI 仍保留。原定性能优化等待 #84 经 Master 真实可用终验，随后 #70→#71→#72→#73；#74 依 #70 数据决定。旧 GUI 的失败、NOT_ACCEPTED、NOT_TESTED 记录保留为历史证据，不能替代新 TUI 验收。
