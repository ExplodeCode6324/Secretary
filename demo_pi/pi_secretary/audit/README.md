# 2026-09-22 review 复核与回归

来源：Master 提供的 `review_202609222048.zip`。其审计版本和本轮修改前 HEAD 均为 `377eb30052cc18e57fa9d0de0562509944b1900b`。本目录的 `*.test.ts`、`crash-batch.ts`、`run-world.py` 是原始复现源码副本；没有改写断言来获得通过。

从 `demo_pi` 执行：

```sh
npm run check
npm run format:check
npm test
npm run test:review
python3 pi_secretary/scripts/test-postgres.py --pg-bin /path/to/postgresql/bin
python3 pi_secretary/audit/run-world.py --pg-bin /path/to/postgresql/bin
```

`test:review` 排除 **AUD14** 一个已核实的误报：该断言在 `tools_schema` 的系统消息数组顶层寻找 `name`，而 Pi 0.87.0 将工具声明放在系统消息内容内。原始测试未删除；`new.test.ts` 的 CONTROL 使用 Pi 的 `getCurrentTools` 正确解析，已通过。运行所有原始测试可复现这一误报：

```sh
node_modules/.bin/tsx --test pi_secretary/audit/{new,extra,final,legacy}.test.ts
```

必须在 `demo_pi` 下执行：NEW01 的子进程使用 `--import tsx`，依赖当前目录解析依赖。它确实用 SIGKILL 中断进程，再验证恢复后的模型请求包含第二条输入。

`results/` 是本轮实际输出，不替换以前的验证报告或设计覆盖率。PostgreSQL 脚本各自启动隔离的临时数据库，仅监听本地 Unix socket，结束后关闭；不要把 `world-extra.test.ts` 指向业务数据库，它会删除测试 schema。

实现结论、已知边界和未完成项见 [复核说明](../REVIEW_FIXES_20260922.md)。这些 fixture 测试经过真实 Pi 执行循环，但不调用在线模型；数据库测试使用实际 PostgreSQL。没有声称 LIVE_MODEL、REAL_USE、OS sandbox 或 Go/Pi 语义完全一致。
