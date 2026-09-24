# 提示词与工作记忆

## 三类模型上下文

主会话使用 [instructions.ts](../src/pi_secretary/src/instructions.ts) 的 BASE_SYSTEM 与 Master 自定义说明。执行 Agent 使用 [task-prompt.ts](../src/pi_secretary/src/task-prompt.ts) 的专用 system prompt 和 `secretary.agent-task.v1` JSON 包。整理模型由 Host 构造摘要上下文。三者不共享任意可编辑 system prompt。

Web「Secretary 说明」保存 UserInstructions 单例：最多 2000 个 Unicode 字符，拒绝部分控制字符，revision CAS 防止覆盖并发编辑；同文保存不增版本，空文关闭自定义部分。没有模型工具修改此设置。

Host 领取输入时保存 MainPromptSnapshot，包含完整 system 消息、工具声明、基础 prompt 版本、说明版本与 system hash。修改说明只影响下一轮；中断恢复使用原快照。Context 保存 CHECKPOINT / MODEL_REQUEST、input_ids、记忆版本、pending tool IDs 和原始上下文对象。`wm_fact_versions`、`omitted_refs` 等当前构造为空，不能据字段存在宣称完整 World 版本追踪。

## Consciousness

自动整理由原文字节阈值触发，默认 32768；`/compact` 可手动运行。Host 整理旧事项、新增事件、原始输入、工具摘录与当前任务状态。工具长输出保留原件引用，原始用户输入不通过摘要伪装成完整历史。

候选提交需满足输入和版本边界；期间新增输入或版本变化会得到 STALE。最多两次尝试，第二次缩短工具摘录并提高预算，仍受模型输出上限约束；失败保留旧记忆和全部未覆盖原文，同来源自动重试受抑制。输出截断有独立错误提示。

commitments 是宿主管理的承诺记录，含稳定 ID、原文、状态、来源与处理凭证。摘要遗漏不删除承诺；狭义结果汇报承诺只有匹配任务结果与来源之后的 SENT 通知才可自动完成。一般承诺由 `/memory-resolve <完整ID> <COMPLETED|CANCELLED> <说明>` 明确处理。

Context 用原始字节数 / 3 估算 token，并预留 4096；这是容量保护的启发式估计，不是 provider 的真实计费 token。摘要语义质量和长期承诺维护仍需要 online 日常回归衡量。
