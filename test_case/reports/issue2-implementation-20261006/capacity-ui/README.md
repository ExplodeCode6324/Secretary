# Issue2 容量显示 Browser / PTY 验收

日期：2026-10-06（Asia/Hong_Kong）。独立合成实例 `/tmp/secretary-issue2-capacity-20261006`；没有连接部署实例、调用真实供应商或使用凭据。

- 已安装 Chrome 的真实浏览器验收通过：发送合成输入、等待主回复完成后，容量条与 `/api/state` 的 MODEL_REQUEST 数值一致；CHECKPOINT 标识及估算不同，不混作请求占用。
- 容量条以可用输入 U 为分母；提示包含 UTF-8 保守估算、输出额度、工具增长预留、安全余量、服务上限未核验及下一请求发送前重算。`next_request_budget=null`，不将最近请求冒充下一请求预测。
- 桌面 1280×900、移动端 390×844 截图已人工检查，容量条可读，未发现裁切或遮挡。
- macOS 真 PTY 执行 `/status`，逐字段核对相同请求 N/U/O/T/S 及方法说明，通过；`/quit` 退出码 0，后台保留。使用 Python 标准库读取 PTY 原始文本，未做 pyte 屏幕格子或光标保持验收。
- 请求值：N=6851、U=941808、C=1000000、O=4096、T=4096、S=50000；较新的完整恢复检查点估算=7165。供应商用量此处为 fixture 的合成零值，不能作为真实模型计量/校准证据。

证据：[browser.json](browser.json)、[pty.json](pty.json)、[desktop.png](desktop.png)、[mobile.png](mobile.png)、[capacity-strip.png](capacity-strip.png)。浏览器控制台错误为零。

复跑使用 `test_case/offline/issue2/capacity-web.ts` 启动新 `/tmp/secretary-issue2-capacity-*` 目录，再分别运行 `capacity-browser.mjs`（设置 PLAYWRIGHT_MODULE 为已有 Playwright）与 `capacity-pty.py`。测试结束停止该合成实例，保留目录用于复核。
