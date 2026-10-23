# 本地图片附件

所有附件接口沿用本机 owner 认证与数据域。只接受静态 PNG/JPEG，按原始字节验证格式并完整解码；拒绝动画、MPO、尾随字节和其他格式。不转换、不缩放、不移除 EXIF：原始元数据（可能包括位置）随原图传给所选 provider。

## 导入与消息

先提交 POST `/api/v1/attachments/import`，冻结 request_id、绝对 source_path、expected_sha256、十进制字符串 expected_bytes 和展示 name。路径可经过符号链接目录，但最后一项必须是普通文件，不能是符号链接。Core 不删除源文件。

202 只表示预留已持久化。轮询 GET `/api/v1/requests/{id}`，仅在 COMPLETED 且 result 返回 attachment_id 后才可删除客户端临时文件。导入独立队列从 QUEUED 直接到 COMPLETED 或 FAILED，不走通用 RUNNING/UNKNOWN。IO 结果不确定时保留 QUEUED 与容量，可能返回 ATTACHMENT_IMPORT_RETRY_REQUIRED；修复 IO 后重启恢复，重用原 ID 和完整 body。

随后 POST `/api/v1/messages` 使用不同 request_id、text 和有序 attachment_ids。允许纯图 text=""，不允许仅空白正文；重复附件 ID 被拒绝。复用 ready ID 可显式重送图片。同 ID 修改任何已提交字段均冲突。源文件删除或替换后，已完成导入仍使用固定 CAS 原件。

GET `/api/v1/attachments/{id}`、timeline 和消息内容只返回轻量元数据；显式 GET `/api/v1/attachments/{id}/content` 返回校验过的原始二进制，带长度、ETag、no-store 和 nosniff，不支持 range。运行时内容损坏返回 410 ATTACHMENT_UNAVAILABLE；重启时缺失或截断的持久引用会使 Store.open 失败。

列表与消息内容中的 availability 只检查 CAS 文件存在、类型和长度，不证明摘要正确。GET `/api/v1/attachments/{id}`、二进制读取、消息准入和模型发送仍完整核验内容。

## 部署与预算

默认限制如下，可通过 SECRETARY_ATTACHMENT_ 加大写字段名的环境变量降低，不能超过下表。降低配置不删除旧内容；pending 导入保留受理时的验证上限。容量满时只拒绝新导入，不禁止发送已有附件。相同内容的新导入身份仍独立计费；失败身份计数保留，CAS 可能已写入时保留字节预留。无自动清理、年龄过期或 unbound 删除。

| Field | Default |
| --- | ---: |
| `file_bytes` | 5242880 |
| `side` | 4096 |
| `pixels` | 4194304 |
| `message_count` | 4 |
| `message_bytes` | 10485760 |
| `reserved_bytes` | 1073741824 |
| `import_count` | 10000 |
| `wire_bytes` | 25165824 |

SECRETARY_VISION_BUDGET_PROFILES 是 JSON 数组，默认 []。每项必须精确匹配 provider、api、model 和规范化 baseUrl，并提供 version=1、正整数 tokens_per_image、max_side、max_pixels 及非空 source 依据。真实模型上限由部署者根据 provider 文档选择；8192 仅用于离线 fixture，不是通用默认值。未匹配时 capabilities.attachments.allowed=false，发送返回 ATTACHMENT_BUDGET_UNCONFIGURED；不支持图片的模型返回 ATTACHMENT_MODEL_UNSUPPORTED。

该 profile 同时约束准入、发送、最终 adapter payload 与冻结请求重放；最终图片的顺序、MIME 和摘要须与输入一致。token 估算移除 base64 副本后逐图增加上限，wire 上限独立检查。纯文本 identity 和 policy_id 保持原值。aggregate 证据保存版本化 CAS 引用，读取时验证原始 JSON 摘要并精确复原，单消息 CAS 保留完整内容。

K=0：图片在当前 handling loop、工具迭代和冻结重放中完整保留。HANDLED 后的新 loop 只保留明确写明“本请求无像素”的认证元数据；紧邻追问不会自动重送图片，owner 必须显式复用 ready ID。摘要只读取正文和未识图元数据，承诺提取只读取原始正文；图片来源不能仅凭 input.accepted 被当作 MASTER 事实。

## 撤回与恢复

POST `/api/v1/inputs/{id}/withdraw` 使用新的 request_id 与 expected_revision，撤回整个附件输入（含正文）。要求宿主及维护空闲；CLAIMED 还要求被阻塞、独占同一 loop、无助手输出、无 IN_FLIGHT/RESPONSE_SAVED、无未决或已执行工具效果。否则 409 WITHDRAWAL_UNSAFE。安全撤回在一帧提交 Context/Input/Session/事件/ApiCommand；通知仅进入一个后续 loop，历史永久标记 withdrawn。

撤回输入不进入新的摘要、承诺、搜索命中或 World 证据；发布旧候选前重新检查，搜索索引滞后也执行当前撤回过滤。审计原件仍保留。死进程留下的 IN_FLIGHT 不允许撤回，须恢复先前受支持部署并沿用既有恢复；不改变 #80 恢复政策。

FAILED/INTERRUPTED 的 error/aborted 空诊断不属于实际助手输出：仅当所有 text/thinking 逐字节为空且无工具或未知块时，才可在其余安全条件满足后撤回。新 checkpoint 移除该 loop 的尾随空诊断，原 call/response/event 保留；不代表 provider 未执行或未计费。任何非空正文、思考、空白或工具仍拒绝。

MPF 检查也会拒绝部分手机生成的 HDR gain-map JPEG。首版不转换 HDR 或 HEIC；#83/#84 需要向用户说明这一格式边界。

## 依赖与验证边界

sharp 固定为 0.35.5（Apache-2.0）；lockfile 包含 Linux/macOS 的原生可选依赖。libvips 及其组件的许可证以安装包内 LICENSE/README 为准，分发须保留相应声明。Portable 打包不在本项范围。Core 契约通过真实安装 adapter 的本机 HTTP fixture 验证；真实 provider 识图为 NOT_TESTED，由 #84 准备 profile 和合成图 smoke。新 TUI 消费与真人终端体验尚未验收。
