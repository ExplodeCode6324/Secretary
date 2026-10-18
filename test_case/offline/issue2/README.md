# Issue #2：容量与工作记忆回归

本目录的 `*.test.ts` 随 `npm test` 执行，TypeScript helper 随 `npm run check` 检查。使用临时 Store、合成 stream 和可控模型容量。

当前覆盖预算参数、归一化请求中的 system/工具声明、输出与安全余量、输入超限、完整 checkpoint 保存、当前轮工具结果恢复、工作记忆与上下文裁剪、8 轮维护、节流、固定来源、设置重建和历史输入投影。#19 调整后的维护补试按当前时钟与次数规则运行。

测试对实际传给适配器的请求和持久记录进行断言；语义记忆质量由[online 场景](../../online/README.md)验证。旧 browser/PTY 辅助脚本在 PR3b 退役，容量、请求与 checkpoint 的领域断言继续由本目录测试验证；历史脚本通过删除前提交追溯。

原计划及当时验收矩阵见[修复记录](../../../docs/fix/archive/fix_20261005_issue2_上下文容量与记忆分离计划.md)，当前参数见[记忆与预算手册](../../../docs/memory-and-prompts.md)。

实施前的 13 项 INV/GOAL 矩阵、原始结果说明与当时未覆盖项完整保存在[历史基线](baseline-20261005.md)。
