# Secretary

Secretary 是面向 Master 的持续个人助理。当前已完成基本架构搭建，基于固定版本 Pi 实现唯一主会话、任务调度、执行 Agent、授权、工作记忆、可选 PostgreSQL World Model，以及共享后台的 TUI / WebUI。当前仍处于原型完善阶段。

## QuickStart

需要 Node.js ≥ 22.19、npm、Python 3；可选 World Model 使用 PostgreSQL（本仓库验证环境为 18）。从仓库根目录执行：

```sh
git submodule update --init --recursive
npm ci --ignore-scripts
npm start
```

默认使用离线 fixture 模型，执行真实 Pi loop，但回复来自固定测试适配器。输入 `task: 整理一份测试报告` 可体验任务流；`/help` 查看命令。`npm run start:web` 打开同一后台的 WebUI，`/quit` 只退出客户端。

真实模型：在本地 `.demo-data/live-credentials.json` 配置独立的 `main` / `task` 密钥，权限设为 `0600`，然后执行 `npm run start:live` 或 `npm run start:web:live`；这会调用真实 API。模型、数据库、停止后台与恢复说明见 [运行手册](docs/operations.md)。macOS 双击入口位于 [src](src)。

```sh
npm run verify
# 停止默认真实模型后台
npm run stop
# 停止默认离线后台
SECRETARY_DATA=.demo-data npm run stop
```

## 仓库分类

| 分类 | 内容 |
| --- | --- |
| README | 项目简介、QuickStart、开发路线 |
| [src](src) | Secretary Pi 实现、固定 Pi 子模块、运行契约与 SQL |
| [test case](test_case/README.md) | offline、online、每次 test report 三个目录 |
| [docs](docs/README.md) | 当前实现文档、开工前 BrainStorm、原始设计归档 |

根目录的 npm / TypeScript / Git 配置服务于上述目录；本地依赖和 `.demo-data` 不纳入版本控制。

## 开发路线

当前完成基本架构搭建。后续将完善 task 系统、system prompt、主会话工具、TUI 和 WebUI，优化 agent loop，使其更适配 Secretary 的工作模式；完善更接近日常使用、可持续衡量行为稳定性的 online 回归用例。

后续还将支持社交软件内容导入 World Model 人际关系、GitHub 等仓库状态导入 World Model 认知、移动应用、语音输入、生命体征监测。这些属于规划，当前没有对应的完整集成实现。
