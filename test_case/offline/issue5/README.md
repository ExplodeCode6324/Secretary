# Issue #5：设置来源与历史输入回归

从仓库根目录执行 `npm run test:issue5`，或通过完整 `npm run verify` 运行。每个场景使用临时 Store 和合成 stream，检查 Host 行为与实际模型请求内容。

覆盖空提取、已有承诺保留、设置应用后的历史 Master 原文、后续裁剪与重启、多工具协议配对、来源身份匹配、容量变化、旧裁剪映射和损坏证据处理。原文是否进入请求由请求内容断言，摘要使用可控 fixture。

当前设置行为见[Settings 手册](../../../docs/settings-activation.md)。历史首次失败、复核和测试环境记录见[2026-10-08 汇总](../../reports/memory-review-20261008/README.md)。
