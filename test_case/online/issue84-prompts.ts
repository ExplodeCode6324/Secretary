/** Frozen synthetic user inputs for the genuine provider run; never include the image oracle. */
export const prompts = {
  probe: "只回复 ISSUE84-PROBE，不调用工具。",
  followup:
    "本轮只做会话衔接：引用上一轮的 ISSUE84-PROBE，再回复 ISSUE84-CONTINUED。不调用工具。",
  vision: "读取图片上唯一的字符标记，只回复实际看到的字符。不调用工具。",
  shared:
    "创建两个独立 Shared AGENT 任务 A、B，不复用旧任务，不指定 Scope，完整转交本要求。只用 write 在各自 cwd 写 report.txt，A 的 UTF-8 字节为 ISSUE84-A 加一个换行，B 为 ISSUE84-B 加一个换行。再各写 scratch.txt，内容为 intermediate 加一个换行，但不要登记 scratch.txt。只把 report.txt 登记为最终产物，说明 A 或 B 并用 submit_result SUCCEEDED 完成全部验收条件。验收只允许 read、write、submit_result；禁止 bash、shell、网络、其他路径、额外任务、memory_propose_change 和 wakeup。Main 不要替 Agent 执行，不要自动重试。",
  question:
    "请创建一个新的独立 AGENT 任务（不复用旧任务、不指定 Scope），完整转交本要求：首先只调用 request_decision，问题精确为「ISSUE84：请 Master 输入本次未知的验收口令」。只有 Master 知道口令，不得猜测、不得从其他任务取答案。Main 不要 task_control answer；收到反馈后等待 Master 使用客户端事项入口回答。Agent 收到真实回答后，不写文件、不运行 shell、不访问网络，直接 submit_result SUCCEEDED，summary 原样完整引用回答，并说明 ISSUE84。若未回答就保持等待，不得自行完成。禁止额外任务、memory_propose_change 和 wakeup。",
  approval: (scope: string) =>
    `请创建一个全新的独立 AGENT 任务，使用 Scope ${scope}，不复用旧任务，完整转交本要求：只用 write 在 cwd 写 approval.txt，UTF-8 内容精确为 ISSUE84-APPROVED 加一个换行。若要求授权，保持等待 Master 只批准本次，授权后继续完成实际写入，再登记 approval.txt 并 submit_result SUCCEEDED。禁止 shell、网络、规则修改、额外任务、memory_propose_change 和 wakeup。Main 不代替批准，不自动重试。`,
  failure:
    "请创建一个全新独立 Shared AGENT 任务，不指定 Scope、不复用旧任务，完整转交本要求。只用 read 读取 cwd 中的 source.txt；文件确实未提供。必须真实读取，禁止创建源文件、替换内容、运行 shell、访问网络、调用 request_decision。若读取失败则 submit_result FAILED，明确包含实际工具错误。若 source.txt 存在，则只用 write 把其原文完整写入 report.txt，并登记 report.txt 后 submit_result SUCCEEDED。Main 不要自动修复、重试或新建替代任务。禁止 memory_propose_change 和 wakeup。",
} as const;
export const redoSource = "ISSUE84-REDO\n";
