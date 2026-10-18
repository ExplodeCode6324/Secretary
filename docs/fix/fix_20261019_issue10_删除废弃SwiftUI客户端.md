# Issue #10：删除废弃 SwiftUI 客户端

## 决策与范围

Master 于 2026-10-19 指示按路线废弃关闭 #10，保留历史验收记录，并删除客户端代码。本次按 fix 范围执行，完成 Hermes 复核、PR 和 CI 后交 Master 终审。基线 main `468a9c37939bb721792f353ea4970222a0bf58f2`。

- 删除 `src/secretary_macos/` 中已跟踪的客户端、SecretaryKit、probe、Xcode 工程、Swift/XCTest、许可副本和构建脚本。
- 删除仅服务此客户端的 `test_case/native/` 七个 fixture，以及手动 Native archive workflow。
- 更新 README、运维说明和引用。历史计划、设计与验收记录保留；指向已删除文件的历史链接改为删除前固定提交链接，原验收结论不变。
- 保留 Core API、Core CLI、下载及通知实现、公开 API Swift 解码样例、生成机制和 `native-retirement.test.ts`：该文件验证 Core API 替代旧入口，不依赖 SwiftUI。
- #10 关闭原因为 NOT_PLANNED；#7 同步记录路线终止。#6、#11–#14 继续冻结。

只删除 Git 跟踪的客户端文件，不清理本地未跟踪报告、构建缓存或用户数据。历史源码可从基线提交恢复。

## 实施与验证

1. Hermes 使用 review skill 复核计划，官方 provider deepseek、model deepseek-flash、reasoning max；沿用 Master 指定配置，fallback 须另获批准。
2. 按范围删除，搜索全仓跟踪文件中的路径引用，修复现行入口与历史入链。
3. 检查删除范围与 Core 生产代码/公开合同无差异；运行 docs:check、类型检查和 Core 回归。完整 verify 使用隔离 PostgreSQL；不调用真实模型或设备。
4. 创建 PR，核对 Linux/macOS/verify CI 与最终 SHA，再由 Hermes 复核至 MERGE_READY。交 Master 终审，不自动合并。

## 复核与结果

Hermes 第一轮计划复核 PASS。采纳其非阻塞建议：登记当前计划，现行说明改为源码已移除；PR 使用 Refs #10，说明客户端 OS 通知 fixture 随路线退役。Core 通知 API 与服务端测试保留。

删除集合精确为 50 个客户端文件、7 个 fixture 和 1 个 workflow，共 10,276 行。验证命令：

- `git ls-files src/secretary_macos test_case/native .github/workflows/native-archive.yml` 应为空。
- `git diff --stat 468a9c3 -- src/pi_secretary docs/api/v1 test_case/offline package.json package-lock.json .github/workflows/verify.yml` 应为空。
- `npm run verify` 应通过；Linux 数据库用例执行，macOS 专属用例在 macOS 执行。

历史 evidence 文件保持逐字一致，归档计划仅替换原生手册链接为固定提交。
