# Test case

- [offline](offline/README.md)：无真实模型 API 的运行回归、隔离 PostgreSQL 测试和历史探针。
- [online](online/README.md)：显式调用真实模型的链路、说明与记忆探针。
- [reports](reports/README.md)：历次 test report 和原始证据，本次整理报告单独保存。

入口统一从仓库根目录运行；完整范围、证据边界及 online 日常稳定性回归规划见 [测试策略](../docs/testing.md)。Online test 需要后续优化，现有短链路不能替代持续日常使用回归。

## Memory Regression Harness（记忆回归测试框架）

Memory Regression Harness 用于把“Secretary 是否保持连续记忆”从主观体验转换为可重复、可归因的回归测试。它**仅属于 online 模式**：必须由真实模型参与记忆生成、检索、回答和恢复验证；offline fixture 不用于评价长期记忆质量，也不应以固定输出模拟通过此类用例。

后续补充的复杂 online 用例应尽量贴近真实长期使用场景，例如：跨多轮对话形成事实、随后纠正旧事实；经历 context 退出、Consciousness 重组或重启后再次查询；在大量无关活动之间保持未完成事项；从 Operation Log 中找回已退出活动上下文的原始证据；必要时更换模型或记忆版本后检查连续性。

### 基本测试流程

1. **建立原始证据**：以 Operation Log / 原始会话与执行记录作为 source evidence（原始证据），记录测试问题对应的 gold evidence（正确证据）和预期状态。
2. **正常运行记忆链路**：让真实模型按当前实现生成 World Model、Consciousness、索引或其他派生记忆，并在经历测试场景规定的时间线变化后回答问题或继续任务。
3. **记录首次结果**：保存回答、检索证据、当前派生记忆、模型与配置版本，不只记录 pass / fail。
4. **失败后执行 Restore Counterfactual（恢复反事实测试）**：从原始证据中取出对应 gold evidence，绕过正常检索，强制装入当前 Context，再由同一真实模型重试。
5. **按失败层归因**：
   - 原始证据本身缺失或错误：数据采集 / Operation Log 问题；
   - 原始证据存在，但正常链路未检索到：retrieval（检索）问题；
   - 原始证据曾存在，但派生记忆或遗忘流程不可逆地丢失了必要信息，强制恢复后可以答对：memory generation / eviction（记忆生成或淘汰）问题；
   - 正确证据已强制进入 Context 仍然失败：reader / reasoning（读取或推理）问题。
6. **可选执行 Memory Portability（记忆可迁移性）测试**：模型或记忆实现升级时，用新模型直接读取旧派生记忆，再让新模型从同一份原始 Operation Log 重建派生记忆并重测。比较两者差异，识别“数据仍在但记忆语义已经漂移”的兼容性问题。

### 约束

- Memory Regression Harness 不改变 Operation Log 是长期原始证据层、World Model / Consciousness 等属于派生状态的设计边界。
- 测试失败必须尽可能保留可复现证据，不允许只留下最终分数。
- 测试重点是长期一致性与失败归因，不要求每个 online 用例都覆盖全部诊断步骤；只有首次运行失败时才需要进入对应恢复 / 归因流程。
- 模型、prompt、embedding、检索算法或记忆结构发生重要变化时，应优先复跑同一组 online memory regression cases，以观察行为回归和迁移风险。
- 复杂测试用例优先模拟真实使用时间线，而不是为了让模型容易通过而拆成孤立问答。
