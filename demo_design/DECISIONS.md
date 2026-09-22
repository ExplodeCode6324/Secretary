# 实现选择与未定参数

| 项目 | 本次建议 | 与基线/复核的关系 |
| --- | --- | --- |
| 部署 | 单机、单用户；一个应用协调进程和按需 worker，TUI 客户端连接本地协调后台 | 不增加独立输入、整理或持久化服务；主会话模型进程可退出 |
| 存储 | World Model 使用 PostgreSQL；其他数据为 JSON、JSONL 和原始字节对象 | 接受 Master 的划分；JSON 仍需文件事务与可靠恢复，不等于纯内存 |
| JSON 写入 | 全应用一个 journal writer，多个域对象可在同帧提交 | 避免输入、反馈、授权各自写文件造成不一致；不是新增数据库 |
| 任务并发 | 同一计划串行；不同任务受 max_workers 控制 | overlap_policy 明确 QUEUE/SKIP，禁止模型临时猜测 |
| 执行资料 | 固定 task workspace、独立 execution manifest、不可变证据对象 | 支持原 context 复载；共享目录不声称权限隔离 |
| 授权 | UI 当前请求的一次批准；持续规则另行由 Master 确认 | 默认没有通配放行规则，主会话不能新增授权 |
| 短期保留 | 候选 retention_seconds=172800 | 48h 不是最终值；语义在 JSON J10 和 Retention 状态机 |
| 触发 | IMMEDIATE、AT、INTERVAL；EVENT 只为已登记来源留契约 | INTERVAL 采用固定 UTC 秒周期；日历 cron/节假日/DST 规则暂不实现 |
| 遗漏触发 | 提案缺省可填 REPORT_ONLY 并回显；可显式约定 SKIP/CATCH_UP_ONE | 不补跑无限历史；参数必须记录进被接受的提案 |
| 反馈 | 一次性终结反馈；周期按约定；阻塞/未知结果须反馈 | 进展列表由任务约定；不要把每段模型输出唤醒主会话 |
| World Model | 实体 + 登记谓词 + 不可变主张/证据 + 当前投影 | 不建聊天表、不保存权限、不引入向量库 |
| 事实类型 | 初始谓词由人工 SQL 种子维护；实体/来源经认知变更接口登记 | 示例领域不是永久业务字段；事实名称/偏好等也必须有来源 |
| 程序登记 | 人工登记版本、能力、参数/结果 schema、代码摘要 | 允许执行已登记程序；自动生成登记留以后 |
| 历史保留 | Demo 不执行历史 GC；退出只去掉短期操作入口 | 归档/压缩/长期保留天数另定；对象增长是可见限制 |

必须配置并校验的参数：模型 profile、adapter 版本、模型工具集合、context_budget、context_reserve、compaction_threshold、max_workers、输入/帧大小上限、data_root、workspace_root、PostgreSQL 连接环境变量。预算由实际模型能力决定，本设计不凭空指定 token 数。

context_reserve 必须小于 context_budget；整理阈值必须留出下一轮输入及返回空间。超限输入在 ACCEPTED 之前拒绝并明确原因，或者先完整保存为可读附件再接受引用；不能确认接收后截断原文。模型上下文装不下必要材料则保留输入并进入 CAPACITY_BLOCKED。

本地 UI 身份与执行 worker 身份是不同通道。按 Master 2026-09-22 变更，UI 使用 TUI，不使用 WebUI。终端读取本机 Master token，以 bearer 方式连接 127.0.0.1 API，不使用浏览器登录和 cookie。worker 通过宿主发行且绑定 attempt 的凭据访问受限入口。未经验证的 body 字段永不证明身份。没有远程公网接入设计。

未在本轮定死：模型厂商与 agent 库、具体执行工具清单、首次使用的程序清单、未来环境事件来源、长期日志归档周期、实际摘要质量阈值。UI 已按 Master 指令收敛为 TUI，主会话居左、task 看板居右，快捷键打开任务详情。不会以未定项为由留空状态/数据交接；由接口隔离，实现时再接入具体适配器。
