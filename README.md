# Secretary

Secretary 是面向 Master 的持续个人助理。Core 保存会话与工作记忆，安排任务，由执行 Agent 或登记程序完成工作，再将结果交回主会话。项目基于 Pi v0.87.0，当前以本机 Core API v1 提供服务。

当前已实现独立 Core 生命周期、任务与同任务接续、Scope 工作范围、操作审批与未知结果裁定、模型有界重试、记忆维护，以及可选 PostgreSQL World Model。可靠增量同步已提供。SwiftUI 已有[原生连接、聊天与日常管理](src/secretary_macos/README.md)（PR2c），完整替代验收与旧入口退役仍归 PR3；首版保持简洁，后续再做美学设计。

## QuickStart

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

我们现在在进行一系列 Issue 修复，修复路线如下。截至 2026-10-13，第 1–6 批已合入 main：#20、#19、#16、#18、#17、#9、#21、#28 已完成，当前实施第 7 批 #10。

| 批次 | 领取 issue | 主要工作与安排理由 |
|---|---|---|
| **1** | [**#20**](https://github.com/ExplodeCode6324/Secretary/issues/20) | 统一测试入口、类型检查与 CI，先建立后续改动的回归基础。 |
| **2** | [**#19**](https://github.com/ExplodeCode6324/Secretary/issues/19) | 模型调用有界重试、维护退避、待补提来源跟踪，删除旧提取恢复流程。后面的未知结果收束和记忆退出会用到它。 |
| **3** | [**#16**](https://github.com/ExplodeCode6324/Secretary/issues/16) **＋** [**#18**](https://github.com/ExplodeCode6324/Secretary/issues/18) | **联动领取：Scope 工作范围与未知结果裁定。** 两项共同验收，避免共享目录启用后仍被旧拦截规则封住。 |
| **4** | [**#17**](https://github.com/ExplodeCode6324/Secretary/issues/17) | 在 Scope 和未知结果规则稳定后，实现默认写入策略、只读命令和“批准并记住”。 |
| **5** | [**#9**](https://github.com/ExplodeCode6324/Secretary/issues/9) | 轻量同步，统一纳入 Scope、授权规则和裁定结果，并完成分页、聚合视图刷新等合同。 |
| **6** | [**#21**](https://github.com/ExplodeCode6324/Secretary/issues/21) **＋** [**#28**](https://github.com/ExplodeCode6324/Secretary/issues/28) | **联动领取：记忆检索与旧输入退出。** 先交付检索，再启用退出，最后通过真实路径的联合验收。 |
| **7** | [**#10**](https://github.com/ExplodeCode6324/Secretary/issues/10) | SwiftUI 日常流程与旧入口退役，接入前面已经稳定的公共合同。 |
| **8** | [**#23**](https://github.com/ExplodeCode6324/Secretary/issues/23) | 主会话定时唤醒，并补齐自身需要的客户端管理、取消入口。 |
| **9** | [**#22**](https://github.com/ExplodeCode6324/Secretary/issues/22) | 主动送达，并补齐推送目标配置和发送状态展示。此时可以完整验证提醒的创建、触发和送达。 |
| **10** | [**#24**](https://github.com/ExplodeCode6324/Secretary/issues/24) | 完成存储性能、Context 编码与追加路径改造；其中独立的小补丁可以提前插入。 |
| **11** | [**#25**](https://github.com/ExplodeCode6324/Secretary/issues/25) | 行为和存储稳定后，再拆分 Host／Scheduler、落实状态机校验，减少文件搬迁与功能修改交叉。 |
| **12** | [**#26**](https://github.com/ExplodeCode6324/Secretary/issues/26) | 按最终已注册的工具集合重写提示词，进行前后真实模型回归。 |
| **13** | [**#27**](https://github.com/ExplodeCode6324/Secretary/issues/27) | 按最终实现整合、精简文档。Codex 执行，Astra 复核。 |
| **14** | [**#34（N2）**](https://github.com/ExplodeCode6324/Secretary/issues/34) | 本批修复完成后的性能专项：消除进程恢复的平方扫描和空闲 tick 对历史 Operation 的全表扫描，复用第 10 批的存储索引成果，验证长期历史下的恢复和调度成本。 |

本次文档重写对应当前实现；第 13 批会在前面各项完成后再做一次整合。第 14 批 N2 按 Master 最新安排放在这批修复之后，和 #24 共用索引方向。

### 后续产品方向

[总路线 #7](https://github.com/ExplodeCode6324/Secretary/issues/7) 还包含 [#11 Portable 接入](https://github.com/ExplodeCode6324/Secretary/issues/11)、[#12 EVENT 调度](https://github.com/ExplodeCode6324/Secretary/issues/12)、[#13 touch agent 远程工具](https://github.com/ExplodeCode6324/Secretary/issues/13)，设备展示由 [#14](https://github.com/ExplodeCode6324/Secretary/issues/14) 配套推进。

SwiftUI 首版以简洁、功能完整的界面为目标，后续再做美学设计。按[客户端设计](docs/native-client-design-v0.3.md)实现：文字导航、连续对话区、13 pt 正文和默认 200 pt 可收起旁栏。设备方向包括 NX1 互联网便携端、HK13 传感器与 LoRa 短消息终端；本地模型用于后续断网场景。这些方向的接口、功耗与设备能力由相应项目验证，Core 当前提供会话、任务、记忆、设置和产物服务。
