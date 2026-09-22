# 存储封装字段

领域记录定义在 contracts.schema.json；存储格式单独定义在 [storage.schema.json](storage.schema.json)，不参与模型工具输入。

| 对象 | 字段及用途 |
| --- | --- |
| Frame | payload_b64：JournalTransaction 的原始 JSON 字节；sha256：解码后字节校验和。必须严格 base64 解码，contentEncoding 不是自动验证保证。 |
| SnapshotManifest | schema_version、generation_id、journal_sequence/digest：快照覆盖边界；owner_epoch：写入者代次；objects：各对象类型/ID/revision/完整快照引用。 |
| SnapshotEntry | object_type、object_id、revision、snapshot；对象类型与快照 record_type/id/revision 必须相符，ID 不得重复。 |
| WorkspaceManifest | schema_version、task_id、created_at；可重复初始化，但已有 task_id 不一致时禁止覆盖。 |
| ExecutionManifest | schema_version、task_id、execution_id、checkpoint_id/result_id（尚无时 null）、objects；从权威 journal 重建的执行资料索引。 |
| CURRENT | UTF-8 文件，只含 generation UUID 和行尾换行；目标不存在则使用 journal 重建，不能创建空白状态。 |
| owner.lock | OS 文件锁载体，不把其中 PID 文本当作权威；当前 epoch 来自可靠提交。 |

所有 ObjectRef 的根目录由服务语境固定：证据/Context/状态对象均相对 data_root；workspace 字段相对 workspace_root。严禁根据输入临时选择根目录。存储迁移保持旧版本只读可识别，升级需显式工具完成；未知版本不能猜测读取。

Source/World/Context 中的完整原始内容可为 JSON、文本或二进制；ObjectRef 不将 JSON 重新排序序列化后冒充原字节。对象校验与 file Sync 顺序见 [PERSISTENCE.md](../demo_design/PERSISTENCE.md)。
