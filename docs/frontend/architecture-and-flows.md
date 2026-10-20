# 架构与流程

[Current Frontend Spec](README.md)

Svelte/TypeScript 负责阅读、编辑和可重建视图；Tauri Rust 负责受限 IPC、本机发现、HTTP/SSE、凭据与持久缓存/outbox；独立 Core 负责 Host、Scheduler、任务、授权与业务数据。页面不持有 bearer，不直接连接 Core，也不复制 Core 状态机。

```text
Svelte → bridge.ts → Tauri IPC → Rust bridge / SQLite → Core API
Svelte ← projection ← cache + cursor / transient mailbox ← HTTP + SSE
```

[main.ts](../../src/secretary_desktop/src/main.ts) · [Connected.svelte](../../src/secretary_desktop/src/Connected.svelte) · [bridge.ts](../../src/secretary_desktop/src/bridge.ts) · [Rust bridge](../../src/secretary_desktop/src-tauri/src/bridge.rs) · [storage](../../src/secretary_desktop/src-tauri/src/storage.rs) · [sync](../../src/secretary_desktop/src-tauri/src/sync.rs)

普通启动显示 FE-02 连接窗口；选择已配置 profile，连接或明确启动 Core。关闭窗口只结束客户端；停止 Core 是独立的确认操作。`SECRETARY_STUDY=1` 显示合成 study，不能用它证明真实业务或完整 PhaseUI。Release 使用内嵌资源，开发 Vite 服务不代表生产部署。

发送顺序：保留编辑文本 → 保存带版本草稿 → 在本地事务中持久化原 request_id/命令并清除对应草稿 → UI 清空仍匹配该版本的输入 → 网络提交和回执对账。排队、HTTP 202、命令回执与任务完成分别展示；未知结果不自动重发成新请求。保存或入队失败保留文本。Cmd+Enter 发送，Enter 换行，IME 组合与候选确认不触发发送。

持久快照、增量 cursor 与瞬态预览分开处理；瞬态不能被当作已提交历史。同数据域/实例断线可保留最近文本并标重连，持久消息到达后按身份替换；切域不混用旧数据。跨页保留域隔离草稿及消息 ID/偏移阅读锚点，普通滚动不改变关联范围。加载更早消息不抢阅读位置，“跳到最新”是显式动作。

导航按 v1.0 的对话、任务、记忆、产物、待处理、设置组织；动效画廊是开发复核入口。右栏保留正在进行、近期产物、快捷操作的位置，未实现功能留空占位。通过服务端实体 ID 定位关联，定位失败说明原因；不以名称猜测关系。助手名空白回退 `Secretary`，不显示“主会话”。

通知继承既有 presented/read 合同：初始同步水位以前的通知只进入列表，实际显示后按 client_id 上报 presented；read 单独提交且全局共享。持久展示记录抑制重启重复弹出；截断内容按前缀展示，不把截断 JSON 当完整对象解析。这些是后续通知 UI 的要求，FE-02 尚未交付完整通知页面。

[API operations](../api/v1/operations.json) · [API contract](../api/v1/README.md) · [workflow.ts](../../src/secretary_desktop/src/workflow.ts) · [Work.svelte](../../src/secretary_desktop/src/Work.svelte) · [Results.svelte](../../src/secretary_desktop/src/Results.svelte) · [Capability map](source-migration.md)
