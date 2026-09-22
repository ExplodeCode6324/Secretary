# 对照测试的复现材料

本目录保存本次额外编写的边界、负载和短记忆探针。生产源码保持不变，探针只复制到 `test/runs/comparison-20260922/snapshot/` 的独立副本。该副本与合成运行数据被 gitignore 排除；报告中的 baseline.json 给出被测文件 hash。复制上游源码时不要包含 `.git`、实际会话、`.private`、凭据和 node_modules 内容。

## 安装探针到隔离副本

| 本目录文件 | 副本目标（相对 snapshot） |
|---|---|
| go-audit-engine_test.go | demo_src_go/internal/engine/audit_test.go |
| go-audit-store_test.go | demo_src_go/internal/store/audit_test.go |
| go-load_test.go | demo_src_go/internal/engine/audit_load_test.go |
| go-memory_test.go | demo_src_go/internal/engine/audit_memory_test.go |
| pi-audit.test.ts | demo_pi/pi_secretary/test/audit.test.ts |
| pi-load.test.ts | demo_pi/pi_secretary/test/audit-load.test.ts |
| pi-memory.ts | demo_pi/pi_secretary/scripts/audit-memory.ts |

Pi 需要锁定的上游源码及安装好的依赖，本轮复用了原目录 node_modules 的只读符号链接。Go 使用模块依赖缓存。不要将这些测试直接混入原有套件后拿其总数与本报告比较：那会重复计算封装测试。

## 离线与数据库命令

在副本 `demo_src_go` 下：

```sh
env -u SECRETARY_LIVE_TEST -u SECRETARY_TEST_PG_DSN go test -race -json ./... -count=1
go test -race -json ./internal/engine ./internal/store -run '^TestAudit_AUD' -count=1
go test -race -json ./internal/engine -run '^TestAuditGate' -count=1
go vet ./...
python3 scripts/test-postgres.py
```

第一条在复制探针前执行才是报告中的原有套件统计；复制后请只选择原有测试或先移开探针。AUD12 最初同时改变 epoch/attempt，另有 TestAuditGateValid/Epoch/Attempt 分别证明有效对照与单条件反例。它们属于同组补充检查，不能重复累计缺陷数。

在副本 `demo_pi` 下：

```sh
env -u SECRETARY_TEST_DATABASE_URL node --import tsx --test pi_secretary/test/runtime.test.ts pi_secretary/test/tui.test.ts pi_secretary/test/world.test.ts
node --import tsx --test --test-name-pattern='^AUD[0-9]+ ' pi_secretary/test/audit.test.ts
node --import tsx --test --test-name-pattern='AUD12-refinement' pi_secretary/test/audit.test.ts
npm run check
npm run format:check
python3 pi_secretary/scripts/test-postgres.py --pg-bin /opt/homebrew/opt/postgresql@18/bin
```

补充探针预期在当前基线上出现断言失败；测试失败就是报告对象，不应为获得绿灯而降低断言。AUD04/05/06/07/12 使用内部受信测试接口，不能当作远程注入漏洞证明。AUD08–10 只损坏专属临时数据副本。

负载探针需要 `AUDIT_LOAD_REPORT` 指向新的报告路径；Go 使用 `-run '^TestAuditLoad$'`，Pi 单独运行 audit-load.test.ts。各自的 DataRoot 位于临时目录。报告比较的是输入字节、去重结果与重新打开后的状态；并未测满负载模型执行。

## 真实模型短记忆

[run_comparison_live.py](../../scripts/run_comparison_live.py) 是本轮专用驱动，读取现有本地 MAIN/TASK 密钥或 Pi credential 文件，绝不打印其值。默认执行已有合成 live 链；`--memory-only` 执行两边短记忆；`--memory-go-only` 为本轮修正驱动配置后的 Go 重跑。它会发起付费模型请求，不能并入普通设计检查。

**重新执行时，先给驱动的 SNAP/OUT 与 AUDIT_MEMORY_DATA 配置新的 attempt 专属路径，避免复用旧记忆或覆盖旧证据。** 保留 baseline 和全部失败；不要使用生产数据目录。每个短记忆实例最多 30 次模型调用，控制器超时 420 秒。

`memory-battery.json` 中只有 events/question 被送给模型，gold 保留在控制器侧。Go 用 256,000 的保守字节预算，Pi 用其实际模型 profile；不是严格预算相同的算法实验。程序成功退出后还要执行 [summarize_comparison.py](../../scripts/summarize_comparison.py) 并检查 memory-scores.json；Go 本轮就是程序成功、语义题失败。

公开答案仅保留 text。原始模型 reasoning/signature 不进入报告。8 条逻辑日期资料不是运行 365 天，也不是完整 MEM-013 时间轴；同进程 close/open 不是进程 SIGKILL。
