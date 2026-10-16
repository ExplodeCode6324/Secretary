# Secretary

> 2026-10-17：当前仅推进后端 Core 优化。SwiftUI 路线已废弃；Master 正在调研更方便做 UI 自定义的技术路线，尚未选型。手机真实送达归冻结的随身终端 #11，macOS 实际展示验收推后，均不阻塞 Core 工作。

Secretary 是面向 Master 的持续个人助理。Core 保存会话与工作记忆，安排任务，由执行 Agent 或登记程序完成工作，再将结果交回主会话。项目基于 Pi v0.87.0，当前以本机 Core API v1 提供服务。

当前已实现独立 Core 生命周期、任务与同任务接续、Scope 工作范围、操作审批与未知结果裁定、模型有界重试、记忆维护，以及可选 PostgreSQL World Model。可靠增量同步、主会话定时唤醒和服务端主动推送已提供。现阶段通过 Core CLI 管理生命周期，通过 API v1 配置与查询业务。

## QuickStart

当前开发入口是独立 Core CLI 与 [API v1](docs/api/v1/README.md)，无需构建前端。已有 [macOS SwiftUI 实现](src/secretary_macos/README.md)保留供历史追溯。

需要 Node.js ≥ 22.19、npm 和 Python 3。World 功能使用 PostgreSQL，CI 使用 PostgreSQL 18。从仓库根目录执行：

```sh
git submodule update --init --recursive
npm ci
npm start
npm run core -- status
npm run core -- attach
npm run stop
```

默认使用 fixture 模型和 `.demo-data` 数据目录。Core 在后台运行，`attach` 连接已有实例，`stop` 停止服务。客户端通过发现文件连接本机 API；当前操作入口、真实模型配置和数据目录见[运行手册](docs/operations.md)。

```sh
npm run verify
```

统一验证依次执行类型检查、文档检查和离线测试。完整 PostgreSQL 验证及定向命令见[测试策略](docs/testing.md)。

## 阅读入口

| 内容 | 文档 |
| --- | --- |
| 启动、模型配置、日常操作 | [运行手册](docs/operations.md) |
| 客户端命令与查询 | [Core API v1](docs/api/v1/README.md) |
| Host、Scheduler、授权与存储 | [架构](docs/architecture.md) |
| Scope、任务工具与程序执行 | [工具与接口](docs/interfaces.md) |
| 记忆维护、模型重试与请求容量 | [提示词与记忆](docs/memory-and-prompts.md) |
| 文档与源码导航 | [文档目录](docs/README.md)、[仓库结构](docs/repository-layout.md) |

## 开发路线

截至 2026-10-17，Core API、可靠同步、Scope、授权、模型重试、记忆检索、旧输入退出、定时唤醒与服务端主动推送已合入。下一项是 [#24 存储性能与追加路径](https://github.com/ExplodeCode6324/Secretary/issues/24)，无需等待前端选型。

| 顺序 | Issue | 内容 |
| --- | --- | --- |
| 下一项 | [#24](https://github.com/ExplodeCode6324/Secretary/issues/24) | 存储性能、Context 编码与追加路径 |
| 后续 | [#25](https://github.com/ExplodeCode6324/Secretary/issues/25) | Host / Scheduler 拆分与状态机 |
| 后续 | [#26](https://github.com/ExplodeCode6324/Secretary/issues/26) | 按实际 Core 能力重写提示词 |
| 后续 | [#27](https://github.com/ExplodeCode6324/Secretary/issues/27) | 按最终实现整理 Core 文档 |
| 性能专项 | [#34](https://github.com/ExplodeCode6324/Secretary/issues/34) | 恢复平方扫描与空闲 tick 历史扫描；与 #24 协调索引方向 |

#34 提前到 #24 后的建议仍待 Master 确认；当前不改变其原定后置安排。总路线与范围调整见 [#7](https://github.com/ExplodeCode6324/Secretary/issues/7)。

### 后续产品方向

[#11 随身终端](https://github.com/ExplodeCode6324/Secretary/issues/11)、[#12 EVENT 调度](https://github.com/ExplodeCode6324/Secretary/issues/12)、[#13 远程工具](https://github.com/ExplodeCode6324/Secretary/issues/13)保持冻结，仅由 Master 明确解冻。手机真实送达验收移入随身终端范围；macOS 实际展示等待后续 UI 路线。现有 SwiftUI 源码与设计只作历史参考，不作为 Core 验收前置。
