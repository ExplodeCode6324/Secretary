# #106 真实使用验收交接

**Master 验收尚待完成。** 实际运行状态和最终候选 SHA 以 `status.command` 输出为准。首次交接已建立真实 DeepSeek Main/Task、独立 PostgreSQL/World、独立 Core 数据域、独立 Master 草稿目录。原生 Terminal 自动操作被工具拒绝；以下命令由 Master 在本机 Terminal 运行。

## 直接连接

```sh
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/status.command
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/connect.command
```

首次 `connect.command` 才启动人工两小时墙钟窗口，休眠时间也计入。服务此前在 ARMED_FOR_MASTER 状态保持待授权任务。重连/重启不重置额度或期限；已激活会话低于交付预留值仍可使用到实际预算耗尽。初始共享上限 100 次模型物理请求、300 次模型工具提案；准备完成时剩余 69/275，后续以状态输出为准。

## 首个场景

1. `/t` 进入 Task；`/taskdetail "引导验收 等待授权"` 打开详情。确认第 1 次执行为待授权。
2. 手敲开头 `/`，然后输入/粘贴余下内容；整条粘贴会保留为普通草稿。Shift+Enter 提交：

```text
/guide "引导验收 等待授权" 1 改为只读取 first.txt，不再写文件。最终报告包含 GUIDE106_MASTER；先通过 guidance_receipt 明确处理本次引导。
```

3. 确认 SENT，F6（Mac 可用 Fn+F6）查看原文和请求绑定。可先改写另一个草稿、切页、Esc 返回，原引导应保持原请求和执行。
4. 打开对应待授权事项，检查“新引导待处理”的说明，明确批准原操作。Core 应退休已过时操作并重新规划；这里批准并不表示旧写入应继续执行。观察 RECEIVED、GUIDED 和最终 `GUIDE106_MASTER` 报告，并检查 sample 项目没有产生被禁止的新写入。不要用拒绝代替该场景的批准：拒绝测试会使原执行失败。
5. 另行从 Main 发起自己的普通任务，核验流式跟随、标题/轮次补全和运行中引导。人工结果按 [G106-01–08](../../../tui/acceptance-criteria.md) 逐项记录；不是所有阶段都必须立即出现。

## 管理命令

```sh
# 重启同一个 Core；保留数据、请求、预算和人工截止时间
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/restart.command

# 原场景已结束时，显式准备新场景；保留旧执行和证据
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/prepare-task.command

# 停止本验收 Core 与其独立 PostgreSQL
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/stop.command

# 恢复原验收实例
/Users/muy/Desktop/Codex_Work/secretary-core/.demo-data/issue106/acceptance/start.command
```

`prepare-task.command` 输出新实际标题、轮次和完整 guide 命令；不要假定旧标题/轮次仍是目标。若预算或期限不足，它会明确拒绝，而不会静默扩额。status 将运行状态、场景是否仍可引导、模型、数据域、PID、路径、预算及香港时间期限分开显示。API、只读历史和证据保留到明确清理，不随停止删除。


## 重复提交、回退与长期停止后的恢复

相同原始引导被确认接收后，即使撤销清空、编辑再撤销，也会拒绝创建第二个请求。若确实需要再次提醒，请明确修改正文（例如追加“再次提醒，请按当前状态重新确认”）再提交；原文可由 F6 复制。不要通过删除本地受理记录绕过提示。

v4 状态含任何引导记录时，旧版导出会明确拒绝。请保留/导出引导证据，使用**另一个旧版客户端状态目录**回退，并保留原 v4 目录供恢复新版使用；不要让旧版打开 v4 目录。

私有 PostgreSQL socket 目录位于 `/tmp`。若实例停止多日后系统清理了空目录，先读取本实例配置中的 `socket` 路径；确认路径属于本实例且不存在，再用 `mkdir -m 700 <该路径>` 恢复，之后执行 `start.command`。已有目录权限或属主不正确时应停止排查，不要放宽权限。

## 显式扩额（仅 Master 另行批准后执行）

本次 100 次物理请求 / 300 次工具提案及两小时人工窗口不自动扩展。额度或期限不足时，先向 Master 说明当前用量、拟增加的额度/分钟数及原因。获得明确批准后，由操作员执行以下顺序；不能在服务运行时直接改 `budget.json`，否则会被内存账本覆盖。

1. 执行上面的 `stop.command`；必须看到停止确认。保留账本、数据域和 Master 草稿。
2. 在仓库目录运行下列命令，将占位值换成**实际批准**的原因、增量和毫秒数。该操作追加一个原子扩额事件，不重置已用次数或原始开始时间。

```sh
cd /Users/muy/Desktop/Codex_Work/secretary-core
node --import tsx --input-type=module -e '
import { AcceptanceBudget } from "./test_case/online/issue106-budget.ts";
const budget = new AcceptanceBudget(".demo-data/issue106/acceptance/budget.json");
budget.extend({ reason: "替换为 Master 批准的原因", physical: APPROVED_REQUESTS, tools: APPROVED_TOOLS, milliseconds: APPROVED_MILLISECONDS });
'
```

3. 执行 `start.command`，再执行 `status.command`，核对额度增量、扩额事件和香港时间期限。人工窗口已开始时，重启后的新生命周期会恢复 ACTIVE 并重新建立中止状态；首次人工窗口尚未开始时，扩额会回到 PREPARING，应重新完成准备/预留检查后才交接。

这是一份操作流程，不代表当前已获扩额授权；本次交接仍保留原额度和未启动的人工计时。
