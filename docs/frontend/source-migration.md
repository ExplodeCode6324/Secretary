# 来源迁移与能力归属

[Current Frontend Spec](README.md)

盘点基线：Core `5f73c23`，设计 `8cdb9219bed9493147ba10f7d47423df56cbcc44`。对仓库 Markdown 检索 SwiftUI、PhaseUI、native-client-design、secretary_macos、FE-00～07；本次不把上游 Pi 的通用前端文档纳入 Secretary 规范。逐文件命中及分类保存在[盘点清单](../fix/evidence/issue61-phaseui/source-inventory.md)。历史原文、失败与结项证据保留，不追改为新版本通过。

| Source | 实际状态 / 保留 | 废弃或更新 | 新归属 |
| --- | --- | --- | --- |
| README.zh-CN.md、docs/README.md、生成译文 | 当前导航；保留 Core/设备范围 | #58 进行中旧描述、缺少现行入口 | frontend/README.md |
| src/secretary_desktop/README.md、语言视图 | 保留运行/桥接/测试说明 | FE-00/01 标题和当前状态改为 FE-02 | architecture-and-flows.md |
| docs/old/native-client-design-v0.3.md | 历史；保留草稿、回执、关联、通知、视口条款 | SwiftUI/Xcode、pt、旧配色/导航不再约束实现；正文保留并加 superseded 提示 | architecture / components |
| docs/old/、BrainStorm、旧概念图 | 历史/概念；保留出处 | 不作为现行视觉依据 | historical index / v1.0 |
| docs/api/v1/*verification.md、fix/archive、既有 evidence | 原版本验收；保留失败和 NOT_TESTED | 不改写结论，不作为新视觉通过 | acceptance.md 引用版本证据 |
| docs/operations.md 与译文 | Core 运行要求仍有效 | 仅补现行前端导航 | frontend/README.md |
| 设计 v1.0 的代码/规范/截图 | 唯一权威视觉来源 | 本地假发送/人工状态不当业务合同；应用 R1 明确覆盖项 | phaseui / components |
| #57、#62～#66 | 保留分期及前置 | 现行链接、macOS 范围与 #62 名称/快捷键说明 | 同一个 frontend 入口 |

## 能力映射

以下 API 路径已对照 operations.json；“Core 已有”不代表 UI 已接入。每个功能按真实实现定位，未实现位置留空，不能填原型人工记录。

| Capability | Core API / source | UI baseline / owner |
| --- | --- | --- |
| Conversation / draft / outbox / anchor | `GET /api/v1/timeline`, `POST /api/v1/messages`; `Connected.svelte`, `storage.rs` | FE-02 minimal; #63 full page |
| Tasks / executions / authorization | `GET /api/v1/tasks`, `GET /api/v1/executions/{id}`, `POST /api/v1/authorizations/{id}/decision`; `Work.svelte` | FE-02 minimal; #64 full page |
| Result / artifact save | `GET /api/v1/artifacts/{id}`, `GET /api/v1/artifacts/{id}/content`; `Results.svelte` | FE-02 minimal; #66 full library |
| Scope / decisions | `GET /api/v1/scopes`, `POST /api/v1/decisions/{id}/answer` | Core supported; full UI #64 |
| Memory / World | `GET /api/v1/memory/summary`, `GET /api/v1/memory/commitments`, `GET /api/v1/world/facts` | Core supported; UI #65 |
| Settings | `GET /api/v1/settings`, `POST /api/v1/settings/draft`, `POST /api/v1/settings/apply` | Core supported; UI #65 |
| Notifications | `GET /api/v1/notifications`, `POST /api/v1/notifications/{id}/presented`, `POST /api/v1/notifications/{id}/read` | Core supported; UI / OS presentation #66 |
| Devices / Portable / EVENT / remote tools | #6 / #11–#14 | FROZEN; empty placeholders |
| Motion gallery / example tasks / concept images | Static v1.0 only | Visual reference, no business capability |

## R1 裁定与继承条款

Master 已确定：v1.0 唯一视觉权威；空白助手名 `Secretary`；Cmd+Enter 发送、Enter 换行；保留域隔离草稿/阅读位置；未实现功能留空；状态色按 v1.0。补充中央伸缩/固定侧栏、选中行色块融合、分隔线顶格、全对象三帧覆盖和分隔线随机触发。左栏文字/已有按钮间线的扩展与性能比较属于 #62 试验。以上明确裁定覆盖原型的固定 PERRI、本地 Enter 发送和每次接近播放等示例行为。

旧 v0.3 的有效交互要求已转换为框架无关条款：草稿/阅读位置和先持久化再清空、稳定 request_id 与回执/未知结果、实体 ID 关联/定位、通知 presented/read 和历史水位，见架构与流程。旧 SwiftUI、Xcode、固定 pt/配色及 VoiceOver 唯一验收方式不再是门槛；macOS 可继续用 VoiceOver 检查可访问性，但以行为为验收标准。

[architecture and flows](architecture-and-flows.md) · [historical v0.3](../old/native-client-design-v0.3.md) · [API operations](../api/v1/operations.json) · [R1 plan](../fix/fix_20261021_issue61_PhaseUI现行规范.md)

## PhaseUI implementation candidate (#62)

The production component mapping and explicit adaptations are recorded in the [component contract](../../src/secretary_desktop/src/phaseui/README.md) and [implementation evidence](../fix/evidence/issue62-phaseui/summary.md). The frozen design remains the authority; candidate evidence does not replace Master acceptance. Resource comparison uses [the PhaseUI harness](../../src/secretary_desktop/scripts/phaseui_measure.py), separately from the historical FE-00 measurements.
