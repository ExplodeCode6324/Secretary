# 执行与判定协议

## 1. 依据与优先级

[BrainStorm](../BrainStorm_Baseline_v3.md) 定义职责；[catalog](../state_machine/catalog.json)、[语义约束](../json/SEMANTICS.md)、[事务协议](../demo_design/PERSISTENCE.md) 提供具体状态和提交边界。实现说明只声明能力与差异，不反向修改规范。若规范和实现不一致，记录差异、受影响用例和证据，由复核决定；禁止降低预期以制造 PASS。

P0 为数据丢失、重复作用、权限越界、虚假完成、证据或关键记忆错误，出现一例即阻断本批验收；P1 为核心功能与可恢复性；P2 为性能、可用性及扩展边界。每个用例的多个子情况必须分别记录，不能用其中一项通过代表整条通过。

## 2. 统一前置设施

1. 为每次 run 创建专用临时 data_root、workspace_root 和独立临时 PG，记录 root 的归属标记；故障注入只作用于该 run 的子进程和目录。测试结束保留证据，清理只删除同 run 标记的测试资源。
2. 固定源码 commit 与工作区差异摘要、规范 hash、配置、adapter/profile、模型角色、seed、时区、候选 TTL、预算和 max_workers。各实现分别运行、分别计分；不假定接口完全相同。
3. 测试控制器在被测进程之外记录请求原始字节、实际收到的 ACK、barrier 经过记录、fake clock 和副作用账本。副作用接收器按业务 intent 记录全部尝试，包括重复与被拦截尝试。日志不能仅依赖即将被杀的进程。
4. OfflineModel 返回确定性完整响应、部分响应、超时或畸形工具调用；ProgramFixture 可阻塞、输出、退出、忽略首次停止信号；FakeChannel 区分明确未发、已发回执及未知。真实 PG 用于仓储/桥接场景，内存替身不能标 `POSTGRES_RUNTIME`。
5. 故障窗口用显式 barrier/ack 控制顺序；禁止靠 sleep 猜中竞态。每个有两个竞争者的场景至少跑 A→B、B→A、同一 barrier 释放三个排列，并保存实际顺序。阻塞有测试超时和人工停止入口。

## 3. 每条用例执行方式

catalog 中的 preconditions、steps、expected、evidence 为必填要求。通过公开入口或受信测试适配器建立有效状态；构造被损坏的落盘副本只能用于存储故障，不绕过生产入口来证明授权正确。

同一用例需要两类断言：业务状态/不可变字节/来源链，以及实际副作用次数。拒绝路径检查目标状态与 revision 未非法变化、无副作用，允许独立的拒绝审计记录。成功路径确认可靠提交后重新打开存储，从新进程读取同一状态。对已发出且结果不明的动作只断言停止与核验，不承诺外部 exactly-once。

catalog 中“重启”默认是终止测试应用后重新创建进程并读原 run 数据；“仅主会话重启”不得递增应用 epoch。操作核验只能查询原结果，不能重新执行动作来猜测第一次是否发生。已 ACK 的输入必须全部可恢复；ACK 丢失的请求允许已提交或未提交，同键查询/重投必须收敛到单一记录。

## 4. 结果与证据

| 字段/枚举 | 规则 |
| --- | --- |
| evidence_level | DOC_ONLY、OFFLINE_RUNTIME、POSTGRES_RUNTIME、LIVE_MODEL、UI_RUNTIME、REAL_USE、POWER_LOSS 分开报告；不是可相互替代的等级阶梯 |
| verdict | NOT_RUN、PASS、FAIL、BLOCKED_CAPABILITY、BLOCKED_ENV、NOT_APPLICABLE、INCONCLUSIVE |
| run identity | run_id、case_id、子情况、seed、attempt、时间、实现/规范/配置摘要 |
| evidence | 前后状态及 revision、journal seq/digest、事件关联 ID、ACK、外部账本、响应原件 hash、故障位置与恢复观察 |
| semantic result | 事实与任务断言由独立 oracle/验证程序或人工证据裁决；模型自评不能证明完成 |
| limitation | 未执行子情况、丢失证据、能力限制、环境失败以及清理状态 |

必要证据缺失为 INCONCLUSIVE；功能失败为 FAIL；不支持的已要求能力为 BLOCKED_CAPABILITY，不是 NOT_APPLICABLE。只有场景与该运行声明范围确实无关才可 NOT_APPLICABLE，必须说明理由。总表分别列全部分母、执行数、PASS、FAIL、各类阻塞和未运行，不能仅展示成功率。

运行报告保存首次失败和全部重试。修复后新建 run，旧失败不删除；不同 seed/模型/Context 桶分别报告。报告不含密钥、连接口令或真实用户资料，必要原始材料留在访问受控的 run 目录，公开报告只用合成数据、对象 hash 与相对引用。

## 5. 状态机与契约覆盖

[转换矩阵](TRANSITIONS.md) 为每一条 canonical 边要求正向、守卫反例、提交失败恢复、重投四项。守卫包含多个条件时须每次只破坏一个条件，例如 final_gate 分别破坏 epoch、attempt、撤销、对象版本、参数和 intent。其他条件全部成立，才能定位缺失的检查。不可达 from/event 组合和终态非法回迁另由 STA-010 覆盖。

转换矩阵是设计义务；执行接线时必须记录具体 fixture、入口、barrier 和每项证据，未接线不能记为已覆盖。运行覆盖率 = 有完整运行证据的转换子项 / 当前 catalog 转换子项总数。J 约束映射、文档链接数量或 schema 验证结果不能充当运行覆盖率。

39 个根契约及嵌套定义的边界按 SYS-010/011 生成结构测试；跨字段/跨对象规则必须另外走真实 domain/service。现有合法示例含占位对象 hash，只能验证形状，不能直接作为运行 fixture。
