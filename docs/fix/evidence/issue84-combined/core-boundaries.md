# Issue #84 — Core 边界补验

Master 在 r8 原生交接及后台核对通过后选择「先补可自动验证的 Core 边界」，暂不收口；另两个原生样例按 Master 的既往使用反馈略过。本页只补自动化证据，不把略过或模拟终端测试记成本轮物理终端 PASS。字体/字号/行列仍未捕获，历史首次打开异常仍保留观察。

产品基线 `1ebf5cd9c54c87f08ec1c0282d04b761d8a9e45c`；补验开始时 HEAD `e73e7de7ef0ac235dcf93b17af9e3027af922878`。本轮产品源文件、依赖、CI 配置、真实模型验收工具及配置均未更改，仅增加两份 offline 测试文件和文档。全量 `npm test` 自动收录新测试，两文件所在 issue91/issue93 目录也在现有 macOS CI 范围内。最终提交 SHA/CI/Claude 复核结果追加 [PR #102](https://github.com/ExplodeCode6324/Secretary/pull/102)。

## 结果与来源

本轮本机定向 **58/58 PASS，0 skipped，64.8 秒**，类型检查通过。以下表格每行只断言列出的子边界，不宣告整项 AC 或 #84 完成。已有产品完整 verify 1013/1013 仍归属原产品提交；新增测试后完整套件预期为 1016 项，其实际最终结果以新 CI 为准。

| 边界 | 本轮可执行来源 | 实际覆盖及证据类别 |
| --- | --- | --- |
| 4 MiB 淘汰→正文恢复→Core 重启 | [core-budget-restart.test.ts](../../../../test_case/offline/issue91/core-budget-restart.test.ts) | **新增 PASS**。十条各约 512 KiB 的明确合成持久消息，累计超过 5 MiB；实际 HTTP 分页和 RemoteViews 逐条加载，每次驻留字节不超 4 MiB；确实发生淘汰，按稳定 ID 取回完整正文 SHA；重启实际 Core 后旧 fragment cursor 被拒绝，锚点和正文恢复。读取阶段日志序列不增、ModelCall 为零。未注入私有缓存或模拟 HTTP 响应 |
| 精确取消待执行 request | [cancel-isolation.test.ts](../../../../test_case/offline/issue93/cancel-isolation.test.ts) 第一项 | **新增 PASS**。真实 HTTP 创建目标、相邻请求及周期计划，带缺失资源前置；取消目标后，相邻请求和周期计划逐字段不变。等待异步取消 COMPLETED 后原请求 ID 重放不新增日志；scheduler 实际产生相邻和周期执行，目标不产生执行。ModelCall 为零 |
| 精确取消周期 occurrence | [cancel-isolation.test.ts](../../../../test_case/offline/issue93/cancel-isolation.test.ts) 第二项 | **新增 PASS**。真实 HTTP 取消当前 WAIT_PRECONDITION occurrence，原执行 CANCELLED；邻接执行不变，计划仍 ACTIVE，trigger/next_due 不变。只推进隔离 scheduler 的时钟到下一到期时间，实际生成唯一下一轮 WAIT_PRECONDITION；邻接仍只有原执行。ModelCall 为零。不证明执行中外部副作用的强制中断 |
| 归档排除与短 ID 歧义 | [issue83/api.test.ts](../../../../test_case/offline/issue83/api.test.ts) `prefix uniqueness...`；[projection.test.ts](../../../../test_case/offline/issue83/projection.test.ts) | 实际 HTTP/领域投影；合成稳定 ID 和分组数据。全授权历史歧义判定、归档后排除、计数/建议/详情保护、外部会话拒绝。不是新原生导航验收 |
| 纯暂停与暂停但仍有工作 | [predicate.test.ts](../../../../test_case/offline/issue83/predicate.test.ts) `schedule is a display predicate...`、`SEEDED projection...`；[window.test.ts](../../../../test_case/offline/issue83/window.test.ts) 历史卡片 | 纯函数及合成状态的实际领域投影。纯暂停不作为当前任务；自己的执行/等待仍保留；外部任务 follow-up 不会错误纳入，历史定位保留状态/Scope |
| UNKNOWN 只读、旧失败拒绝 | [failures.test.ts](../../../../test_case/offline/issue93/failures.test.ts) `foreign failure cannot be handled...` | 实际 HTTP 与失败领域服务，明确种入 UNKNOWN/RETIRED。UNKNOWN 不可操作、不产生日志或改变保留状态；旧失败 REDO 明确拒绝但 DISMISS 可用；外部归属不越权 |
| 注意事项 overflow | [controller.test.ts](../../../../test_case/offline/issue92/controller.test.ts) `attention wraps across all pages...` | 实际 Core HTTP，65 个合成授权，30 行分页；末页、循环、异步加载时 Escape 的失效结果处理。无误恢复选择/日志写入；非物理键位或屏幕布局证据 |
| 四轮 Agent，仅显示最近三轮 | [projection.test.ts](../../../../test_case/offline/issue83/projection.test.ts) `real Agent events, latest three...` | 真实 scheduler 和 fixture provider 产生四个 Execution；领域查询只返回最近三轮。另加入合成长正文/CoT 事件验证分页、重复消息和 redacted 排除；查询只读。不是四轮新付费 provider 调用 |
| 列表/正文窗口与重连 | [window.test.ts](../../../../test_case/offline/issue83/window.test.ts)、[body-budget.test.ts](../../../../test_case/offline/issue91/body-budget.test.ts)、[core-stream.test.ts](../../../../test_case/offline/issue91/core-stream.test.ts) | 混合明确标注的真实 HTTP、模拟客户端缓存测试、合成预览/日志和 80/120 列 VirtualTerminal；覆盖有界分页、列表重启稳定 ID、CoT、归档清理、预览更新。新增主历史组合测试补上模拟缓存与真实重启之间的缺口 |
| 取消参数和回执 UI | [tui.test.ts](../../../../test_case/offline/issue93/tui.test.ts) `cancel parser...`、`cancellation lost reply...` | 参数解析及实际 Core HTTP 配合丢响应模拟；精确完整 ID、错目标拒绝、同 request 对账，当前终态不冒称由本次取消造成；另有 VirtualTerminal 交互回归。物理终端输入未新增 |

## 首轮失败与测试修正

首轮新增三项为 1 PASS / 2 FAIL，原始输出完整保留。两项失败来自新增测试的错误假设，未修改产品或放宽目标行为：

- 正文加载后若仍固定在第一个锚点，新加载的非焦点正文可能立即成为淘汰对象。测试改为逐条阅读时设置实际阅读锚点，再检查加载正文及总驻留字节；仍强制累计加载超过预算、出现淘汰、回到被淘汰 ID 取回相同 SHA。
- 异步取消首次回执是 QUEUED，重放时可已推进到 COMPLETED，不能要求整张回执与首次字面相同。测试等待对应 ApiCommand COMPLETED，再核对原 request_id/资源标识、ACCEPTED/COMPLETED 及零新增日志，不把接收等同取消完成。

修正后的三项单独 3/3 PASS；同版本再纳入 58 项定向组通过。未发现新的产品缺陷，无新的生产实施请求。

## 证据保管与限制

原始输出保存在 Git 忽略目录 `.demo-data/issue84/recovery-20261106/core-boundaries/`：`first.txt`、`second.txt`、`targeted.txt`、`typecheck.txt`；新测试初版/修正版源码及 `before-first-execution.json`、`before-second-execution.json`、`before-targeted-execution.json` 均在相应执行前存档并计算散列。与早期 live driver 事后重建的局限分开记录。

每个测试使用新的临时 App/本地 HTTP 端点、fixture provider、关闭自动 pump。原 r8 live、旧 u2、数据库和历史用量未被本轮测试写入。此组未调用付费模型，未用 Core 证据补写原生样例 PASS。Claude 源码复核不等于独立运行测试；最终 CI 与复核结论仍须匹配同一提交。Master 全账本收口、合并和关闭均保留待裁定。
