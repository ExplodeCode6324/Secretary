# Secretary

Secretary 是面向 Master 的持续个人助理。Core 保存主会话与工作记忆，安排任务，由执行 Agent 或登记程序完成工作，再将结果交回主会话；历史检索、定时唤醒和推送帮助持续处理事务。项目基于固定 Pi v0.87.0，通过本机 Core API v1 提供服务。

## 快速开始

需要 Node.js ≥22.19、npm 和 Python 3。World 与历史检索使用 PostgreSQL。

```sh
git submodule update --init --recursive
npm ci
npm start
npm run core -- status
npm run core -- attach
npm run stop
```

默认 fixture 模型和 `.demo-data` 数据目录，Core 在后台运行。真实模型、数据库、备份与管理操作见[运行手册](docs/operations.md)。开发验证使用 `npm run verify`，完整 PostgreSQL 配置见[开发验证](docs/operations.md#开发验证)。

## 文档

- [架构](docs/architecture.md)：模块、进程与存储。
- [数据流](docs/data-flow.md)：输入、任务、记忆和通知的主路径。
- [系统不变量](docs/invariants.md)：实现与测试保证的约束。
- [记忆与提示词](docs/memory-and-prompts.md)：上下文、检索与模型预算。
- [Core API v1](docs/api/v1/README.md)：客户端命令、查询和同步。
- [文档目录](docs/README.md)：生成参考、测试与历史资料。

## 开发路线

Core 已合入独立生命周期、可靠同步、Scope、授权与未知结果裁定、模型重试、记忆检索与原文退出、定时唤醒、主动推送、存储性能、模块拆分和提示词整理。现行文档由 [#27](https://github.com/ExplodeCode6324/Secretary/issues/27) 按代码整理，总路线见 [#7](https://github.com/ExplodeCode6324/Secretary/issues/7)。

SwiftUI 路线已废弃，[历史实现](src/secretary_macos/README.md)保留，新客户端技术选型由 Master 安排。[#6 设备接入](https://github.com/ExplodeCode6324/Secretary/issues/6)、[#11 随身终端](https://github.com/ExplodeCode6324/Secretary/issues/11)、[#12 EVENT 调度](https://github.com/ExplodeCode6324/Secretary/issues/12)、[#13 远程工具](https://github.com/ExplodeCode6324/Secretary/issues/13)、[#14 设备展示](https://github.com/ExplodeCode6324/Secretary/issues/14)保持冻结，待 Master 安排恢复。
