# #122 工作流与检出清理记录

[中文方案](../../fix_20261127_issue122_native_workflows.md) · [English plan](../../fix_20261127_issue122_native_workflows.en.md)

## 构建记录

以 Secretary main 的 PR #137 为开发基线，核对既有 secretary-pr-fix、agile 000/002/005 和两个 checkout 的现行说明。将计划、修复、敏捷部署边界和独立复核程序拆入四份工作流。Master 随后明确根目录规范与流程全部入 Git；据此采用单一大写 AGENTS.md，并取消原拟定的本机专用入口与 Codex 回退配置。项目 skill 仅负责转到对应流程。

每轮沿用原中英文文件名或敏捷专题编号。方案、构建经过、测试证据、复核结论可在同一记录分节，公开材料只含脱敏结果。首次失败、私有原始材料及完整校验回执由私有归档保存。

## 复核结论

此稿按 Master 要求先交本人检查。尚无本轮独立 reviewer 签署，Master 对新工作流的终审与合并决定待定。原生 ProkBot/pi 运行未执行；本轮工作没有改变产品代码或记忆机制。
