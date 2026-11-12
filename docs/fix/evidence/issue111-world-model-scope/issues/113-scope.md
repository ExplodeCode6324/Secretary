总跟踪：#111；与 #112 共用内部 journal_apply 合同。常规迭代，当前仅登记；对应完整 R5 计划 §2、§8–10。

## 问题与预期

Main 当前没有 Scope 创建/导入工具，无法将用户指定目录变成可委托的 Scope。可以强制每次批准，但不应直接缺失接口。新增 Main-only scope_import 与只读 scope_query；批准前 Scope 不可见，批准后有持久可查询结果。

## 范围与约束

- 首版支持新逻辑 NONE Scope 或导入已有 DIRECTORY；参数含名称/描述/kind/root_path/notes_path/default_write，DIRECTORY 默认 ask。不新增任意目录创建、递归发现或模型修改/归档 Scope；owner 已有编辑接口保留。
- 提案必须引用当前 loop、同 session、未撤回且无附件的真实 Master 事件；失败反馈/环境通知不能自行提案。只读 query 分页列 Scope、按 ID 查询及查询本 session 导入状态。
- action=scope.import，精确规范化参数及目录 identity 显示在授权中；逐次 owner 明确批准，禁用 match/remember/通配及持久绕过规则。Main/Task 没有批准工具。24 小时到期，历史保留。
- admission 与最终同步提交前均验证物理绝对目录、祖先无 symlink、Core 数据不重叠、活动/忙 Scope 不冲突、安全 notes 相对路径、device/inode 未变。参数/目录改变不能沿用原批准；不夸大文件系统 TOCTOU 保证，说明 macOS /tmp、/var 等 symlink 路径限制。
- 确定性 Scope ID 绑定 Operation。受限 AUTHORIZED --journal_apply--> SUCCEEDED 同帧完成批准 grant 消耗、revision-1 Scope、Operation/result、确定性 completion Input；每记录只改一次，最终检查到 commit 无 await。不走外部效果 DISPATCHED/RESULT_UNKNOWN；scope/world 分别有整帧 guard，不能扩散到外部动作。
- 确定失败同帧取消 Operation(effect NOT_STARTED)、撤销或真实到期 grant、写原因与结果 Input，无 Scope。owner_epoch/撤回/拒绝/撤销/到期/应用竞争由 revision 串行化。已消耗成功不能被事后撤销倒回。
- 每次 pump 和启动协调在线到期与终态缺通知；拒绝/撤销后 crash 可补通知，稳定 dedupe key scope-import-result:<operation_id>。HOST 决定如实记录，不伪装 Master 撤销，保留原 approver。
- 结果使用 ENVIRONMENT Input + HOST actor；只唤醒一次独立 Main 读/查/报告轮，明确其模型调用成本。按原输入位置隔离，不能与新 Master turn 合批；通知不是 Master 授权，不能新导入、写 World 或委托 Task。后续新 Master turn 才能使用新 Scope 委托。
- 失败动作工具限制改明确 allowlist，新变更工具默认不可用；结果通知同样只读 allowlist。逐项检查来源投影、摘要/抽取、历史、搜索、时间线/attention 和附件出处，不能把 ENVIRONMENT 升格 Master 或落 SCHEDULER actor。

## 验收

- [ ] Main 从提案、TUI 具体参数批准、成功查询到下一 Master turn 委托形成真实闭环；批准前无 Scope。
- [ ] 拒绝、撤销、24h 到期、根目录替换、重叠、参数变更、证据撤回、STALE_OWNER 均无错误 Scope 或额外授权消费。
- [ ] 同 ID 重试返回原结果，改内容拒绝；在关键提交前后 crash/restart 不重复建 Scope，不丢终态，在线到期不只靠重启。
- [ ] 结果通知一次、独立只读报告，不能自主建任务/写 World；新 Master turn 和结构化失败路径分别回归。
- [ ] 真实终端批准/详情与 API、来源日志一致；分页覆盖超出 prompt 限制的 Scope。
- [ ] 隔离测试、完整 required checks、构建启动及 #111 组合验收完成；NOT_TESTED 单列。

本项不是通用 EVENT 调度器或设备事件平台，不扩大 #6/#12 的范围。使用常规功能分支，禁止改动正在运行的敏捷实例。
