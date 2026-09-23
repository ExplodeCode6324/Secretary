# Pi 历史补充探针

保留 `pi-audit.test.ts`、`pi-load.test.ts`、`pi-memory.ts` 和合成 `memory-battery.json`。在独立 Pi 副本中分别放入 test 或 scripts 目录执行，不覆盖实际会话数据。

这些是历史内部边界/负载/短记忆探针，部分原断言的有效性仍需审查；不能直接累加为设计用例覆盖率。真实模型探针会产生费用，gold 只供控制器判定，不能发送给被测模型。完整历史复现说明与混合驱动在相邻归档。
