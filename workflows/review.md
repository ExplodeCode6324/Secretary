# 复核与验收

| 阶段 | 送审材料 | 通过后 |
| --- | --- | --- |
| 计划 | 仓库与目标 issue/PR 的 URL、完整英文计划、验收条件、测试范围 | 记录执行条件、修改意见及双方处置，按本轮授权决定何时构建 |
| 实施 | 当前 PR HEAD、相对上轮的差异、实际测试和 CI、首次失败及未验证项 | 核对准确 HEAD 后交 Master 终审 |
| 合并 | 复核覆盖的 SHA、目标分支、同一 HEAD 的必需 CI、Master 授权 | 按下文核查当前 issue 的阻塞项，向 Master 报告结果 |

**独立 reviewer。** 默认在 Master 已打开的 Claude 浏览器页面选择 Opus 5.5 和 Extra。提交前确认界面，指定一个操作者并复用同一审查会话。全程以英文联络。Reviewer 无法读取本机路径，提供完整英文正文、可访问的仓库链接及必要 diff。只发送脱敏材料。

提交后记录时间，首次等待十分钟，之后每五分钟检查一次，Master 另定间隔时从其安排。将逐轮英文请求、原始回复及必要截图放进任务专用的 Git 忽略目录。Reviewer 不可用时记录具体阻断，由 Master 决定是否使用本地 Hermes。

获准使用 Hermes 时，按本轮指定的模型和 provider 建独立具名会话，核对首次实际返回身份，后续复用。把请求写入文件，请 Hermes 使用其 review skill。以下变量由操作者设置。

```sh
hermes chat --in "$repo" --model "$model" --provider "$provider" \
  --continue "$review_session" --create-if-missing \
  --query-file "$request_file" --oneshot --format stream-json
```

**处理意见。** 按轮记录 reviewer 实际查阅的材料、发现、采纳或异议及依据。修订后送回同一会话，说明具体变化。区分源码审查、执行者提供的测试、独立实测及 Master 人工验收。CHANGES_REQUIRED 需解决后回审，PASS_PENDING_CI 需补齐 CI；实施后追加提交需提交新 SHA 和对应变化重新复核。

**交付。** 在 docs/fix 的本轮记录中留下准确版本、覆盖范围、遗留风险与结论。冻结后新增的 CI 和审查回执可附在 PR，并将固定链接关联至本轮记录，避免仅靠更新状态文字反复移动受审 HEAD。交 Master 的报告列出 PR、实际改动、主要修订、验证结果及待决定项。

**合并前核查。** 收到 Master 的合并授权后，重读当前 issue 的验收条件和最新决定，对照 PR 当前 HEAD 的复核结论与必需 CI，逐项核实是否仍有阻塞。

- **无阻塞项**时，向 Master 报告核查结果，并询问“是否将 PR 的当前提交 `<SHA>` 合入 `<目标分支>`？”收到确认后按该 SHA 合并，登记合并提交和目标分支 CI 结果。
- **仍有阻塞项**时，暂停合并，向 Master 如实报告未满足的条件、现有证据及缺口。由 Master 决定是否新开会话继续处理。

部署和关闭 issue 分别按 Master 的授权执行。
