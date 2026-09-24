# 设计哲学

当前实现把持续沟通、工作执行和执行许可分开。Master 保留最终决定权；主会话负责理解输入、维护工作记忆、提案和汇报；Scheduler 管理任务生命周期；执行 Agent 或登记程序完成具体工作。职责在工具注册和宿主代码中落实，不能仅靠 system prompt 保证。

## 模型负责判断，宿主负责状态

Pi Agent 提供模型与工具循环。Secretary 的 Host、Scheduler、Authorization 和 Store 持有输入、任务、许可和持久化状态。主会话只有六个注册工具，没有 bash、文件写入或批准工具。任务的 `submit_result` 是结构化声明，验收评估仍是模型主张，不是独立验收证明。

## 执行前明确范围

写文件、shell、登记程序和 World Model 更改通过 Operation 及统一授权检查。批准绑定请求版本、展示摘要和参数；实际派发前再检查 owner、attempt、执行状态、授权及规则版本。聊天中的同意和材料中的指令不直接产生许可。shell 以当前用户运行，具有文件系统和网络访问能力；当前没有 OS sandbox。

## 不确定性必须保留

动作已经发出但缺少持久回执时，结果是 `RESULT_UNKNOWN`。重启、超时与取消不能证明外部作用没有发生。实现保留回执和待核验状态，不把未知作用直接重放。文件写入有专用核验；任意 shell 和程序没有通用的自动恢复证明。

## 记忆可追溯

原始输入、上下文、工具结果以哈希对象保存。Consciousness 是可替换的工作摘要；承诺由宿主保留和处理，不让摘要遗漏直接删除承诺。World Model 保留来源、证据、冲突和版本，摘要不能变成授权规则。

## 已实现边界

当前是单机、单数据目录独占后台的原型。没有分布式调度、全面语义验收、历史 GC、长期真实使用稳定性证明，也没有社交、GitHub、移动端、语音或生命体征完整集成。旧设计的目标不自动构成当前能力。

实现依据：[Host](../src/pi_secretary/src/host.ts)、[Scheduler](../src/pi_secretary/src/scheduler.ts)、[Authorization](../src/pi_secretary/src/authorization.ts)、[Store](../src/pi_secretary/src/store.ts)。
