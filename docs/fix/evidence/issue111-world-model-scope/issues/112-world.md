总跟踪：#111。常规迭代，当前仅登记；完整 R5 双语计划及新会话入口见总 issue 所列本地目录。对应计划 §3–4、§6–9，验收/交付按 §10。技术计划已获 Fable 5.2 High PASS，尚未实现或运行测试。

## 问题

World 事实目前通过 Settings/意识摘要生效，SQL 收据/outbox 与 journal 构成双重权威；Master/Secretary 要先手工建实体才能记守则；现有 aliases 未成为可用检索链，person.height 无用且 person.display_name 与实体名重复；日志搜索不等于事实召回，缺少稳定常驻画像。

## 实现范围

1. **单一持久权威。** 新增 Store WorldEntity、WorldAssertion、WorldGenesis 及回放内存视图；journal+CAS 持久，不新增 World SQL 投影。保留 PG 日志搜索与旧 wm 历史。按照计划 A1–H2 清单移除活跃 World SQL receipt/outbox、source registration、fact_slot/value-hash 分组、重复 World 版本/散列，以及普通 World→Settings 摘要路径；保留通用 Store CAS/revision、幂等、授权、证据和历史解码。
2. **一个接受入口和批工具。** 同步 common acceptor 校验模型/owner/seed/import 不同权威来源。Main 仅增加一个 memory_propose_change，单批 1–20 项实体/别名/事实混合修改，支持批内新实体引用；一次精确批准、原子全部提交，每条记录只改一次。ASSERT 不自动覆盖；CORRECT 显式指向 LIVE 目标；断言正文/来源不可原地重写。新 World 批跳过记忆授权/通配规则，旧规则保留但不生效。
3. **内部提交与结果。** 与 Scope 共用受限 journal_apply 边，但 World 帧仅含匹配的 grant 消耗、World 修改、Operation/结果，无 DISPATCHED/UNKNOWN 间隙。World 成功/拒绝/撤销/到期/失败均不自动唤醒 Main。持久 UI/timeline 及 Main 可调用 memory_read world_batch 暴露终态；提议/批准不等于已记录。外部副作用动作语义不改。
4. **稳定角色。** 根据 CoreIdentity.owner_id 建立受保护 MASTER PERSON / SECRETARY SERVICE 锚点；role:master/role:secretary 可用于主体和实体对象，不依赖名称。保护 id/kind/role/external_key/non-retired；不接管仅同名实体。Secretary display_name 以 AssistantProfile 为唯一权威并原子同步；名称/别名和 profile 改名均检查保留 role: 前缀。
5. **别名、谓词和来源。** 别名按 add/remove 集合增量，拒绝同批矛盾，改名验证 from→to，歧义返回候选。退役 person.height 和重复 person.display_name，历史仍可读/撤回；保留其余八个活动谓词，新增 role-only entity.guideline 与描述性 entity.note。证据由真实事件推导，批准推断不能将其来源升级 MASTER。SINGLE 多 LIVE 值显示 CONTESTED，指定 MULTI/topic 显示可能冲突；不自动选赢家。
6. **画像和系统上下文。** 先采用可追溯事实 ID 的确定性摘取，统一 BASE_SYSTEM → 原文 UserInstructions 一次 → 派生角色画像 → Scope → 条件 FAILURE_SYSTEM → 标注召回数据。UserInstructions 不有损迁移。只有真实 Master 来源的 guideline 为行为指令；其他事实是数据。Master 40 行/3KiB、Secretary 20 行/1.5KiB，整行/冲突组选择；联系方式及自由 note 不常驻。不复制到 Task，完整预算预留，claim 时冻结 system/recall_ref 并在工具接续/恢复复用。
7. **可度量召回。** 名称/别名正规化、词法/中文双字、双语标签、来源/时效排序与有界一跳；LIVE/有效期/实体/撤回过滤。冲突组整体保留或整体省略并给精读入口；12 行/1.5KiB、每实体 5 行，不截断否定。新增 fact 搜索/精读/目录、无写入无模型的 owner preview；profile off/on、recall off/shadow/on 不改变 runtime 指纹。没有 embeddings 或自动历史抽取。
8. **迁移和启动。** 非空 legacy 全量只读快照及 CAS 清单核对，原 ID/状态/来源保留，实体/断言/角色/genesis 单帧幂等导入，不 drop/reset 旧表。fresh/legacy 以已核实数据域证据判断，PG 不可达不是空库。首次新记录前 Settings preflight；旧待处理 command/outbox/Settings 先处置；新 mem-only SQL initializer 不执行历史 wm ALTER。首次升级 runtime Settings 激活 APPLIED 后才 Main readiness，此后普通事实不触发。越过新 journal 格式后只向前修复，不能旧快照覆盖新写入。

## 验收

- [ ] 一个新人物连同事实一批批准成功；重复请求幂等，改参数拒绝，任一无效项无部分写入；撤回/owner_epoch/批准竞争/崩溃均覆盖。
- [ ] 预设角色可直接记守则；保护不可绕过，名称/别名一处权威；别名歧义、相反增量顺序、改名过期检查有证据。
- [ ] 普通 World 写入不排 Settings、不唤醒 Main；Main 查询确认 COMMITTED 后才报告记录成功；下一自然轮画像更新，接续/重放冻结。
- [ ] 使用计划规定的 40 开发题，冻结实现后再编 40 保留题：名称 10 题≥9；歧义 4 题全通过；释义/跨语言各 3 题报告非门槛；否定 2/被替代 3/时间 3/冲突 2/一跳 2 全通过；空召回 8≥7。禁止来源/错误未标注/预算超限为零；10k 合成事实 p95≤50ms，并报告硬件、内存、启动成本。
- [ ] 非空 legacy 导入、重复/中断/PG 不可达/Settings 激活失败/恢复/重启持久性验证；旧事件与 CAS 仍读，不误执行旧写入。
- [ ] 构建并实际启动常规验收实例，区分离线请求捕获与真实 provider；记录原生 TUI 与未测边界。
- [ ] 更新正式架构/API/合同/使用文档，与 #111 组合验收衔接。

## 边界

本项不重写任务或意识记忆、不引入动态图谱/向量服务，不部署或清理持久敏捷实例；#6 的设备模型研究不并入。新实现后仍需精确 HEAD 的实现复核、CI 与 Master 终审。
