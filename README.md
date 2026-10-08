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

WebUI 主会话支持流式正文和可见思考内容，两项默认开启，可在「显示设置」独立关闭。思考区使用更小字号，实际内容取决于供应商是否返回。开关只影响当前浏览器显示；详见[运行手册](docs/operations.md#流式输出与思考显示)。

WebUI 在消息之间展示活动与可展开步骤，历史来自已有 journal/CAS，支持刷新、重启恢复及向前分页；输入区保留排队与当前活动跳转入口。TUI 保留输入区状态及 `/activity`。活动独立于正文显示开关；详见[当前活动](docs/operations.md#当前活动)。

WebUI 已提供 World Model 管理：实体与事实查询、登记、更正、撤回和历史记录。修改先保存草稿，一键应用时完整摘要工作上下文并重建 context；Secretary 说明遵循同一规则。使用及恢复边界见[设置生效规范](docs/settings-activation.md)。

## 仓库分类

| 分类 | 内容 |
| --- | --- |
| README | 项目简介、QuickStart、开发路线 |
| [src](src) | Secretary Pi 实现、固定 Pi 子模块、运行契约与 SQL |
| [test case](test_case/README.md) | offline、online、每次 test report 三个目录 |
| [docs](docs/README.md) | 当前实现文档、开工前 BrainStorm、原始设计归档 |

根目录的 npm / TypeScript / Git 配置服务于上述目录；本地依赖和 `.demo-data` 不纳入版本控制。

## 开发路线

### 产品形态设想（规划，尚未实现）

以下均为未来设计，尚未实现；验收目标仍需设计、原型与实测验证。

受管设备按以下关系规划；Portable 的三类设备共同服务于主助手，不是三个平行主助手。

| 分类与从属关系 | 部署与职责 |
| --- | --- |
| Core（核心主机） | 运行核心服务，保存权威状态。 |
| touch agent（受管设备协助端） | 部署在其他机器，按授权监测设备活动并协助 Master 工作，作为主助手委派的设备执行端。 |
| Secretary Portable（便携设备）：internet portable（互联网便携终端） | 日常互联网连接与远程交互入口。 |
| Portable：internet portable 下属生命体征监测设备 | 向所属互联网便携终端提供监测数据；不默认拥有 root（系统最高权限）或任务执行权限。 |
| Portable：LoRa（低功耗远距离无线通信）应急终端 | 独立的短指令与状态通信终端，与日常互联网便携终端分工。 |

- **客户端与状态**：采用薄客户端（主要承担交互的轻量客户端），由一个主客户端和若干 touch agent 组成。主客户端位于 Core 部署机器，Portable 用于远程交互。计划提供更丰富的用户界面、代码 diff（差异展示）和可重建的会话缓存，缓存可从 Core 权威状态重建。客户端框架和 touch agent 的完整能力尚未确定，HTTPS（加密超文本传输协议）配合 SSE（服务器推送事件）、WSS（加密双向连接）等仅为可选研究方向，未决定具体协议。
- **本地模型与断网降级**：最终设计必须包含本地模型，平时可以不用，但须支持断网时的降级运行；离线可用能力与资源要求仍需验证。断网本身不自动需要 root。
- **NX1 专用便携端**：考虑为专用 NX1 定制 AOSP（Android 开源系统），以不依赖 GMS（Google 移动服务）的实时通信为目标。用户界面与系统级通信服务分离，规划可靠重连、消息去重、过期处理与回执。连续在线 48 小时是待实测的验收目标，尚非现有能力。
- **LoRa 应急终端**：待产品稳定后探索 LoRa 独立终端，承担短指令与状态链路；两端均需额外无线电模块，必要时配置中继。理想形态为小型开发板加 4G、LoRa 并进一步缩小体积，当前规划与 NX1 分工。Cardputer 类形态仅为候选，不承诺具体型号可购、频段或覆盖；3 km 是特定场景目标，须经过法规核查和实地验证。
- **独立恢复服务与逃生终端**：规划独立恢复控制服务及主会话逃生终端，应对系统、基础环境或必要组件故障；主会话及恢复入口不得依赖已故障的调度器。Master 可主动授权并限定设备权限和有效期，凭据留在受控服务，不进入模型上下文。故障只触发诊断或预授权范围内的恢复，不自动扩大 root 权限；接管还须防止旧调度器恢复后重复执行。恢复策略、接管机制与权限细节仍需设计验证。
- **生命体征紧急告警**：未来作为待验证的辅助能力，优先走预先设计的正常应急流程，执行链路故障时才使用恢复通道。传感器异常不等于医学诊断，也不构成无限提权依据；该能力不能成为唯一的生命安全保障。

### 基本架构搭建
基本完成架构搭建，还需进行一系列后续优化。

### 后续架构改进规划
1. 完善 task 系统
当前实现已支持已结束任务的同任务接续：查询原任务后提交新的执行要求，保留工作目录、执行记录与产物证据；独立任务仍有独立工作区。后续需继续验证日常使用中的任务归并、长任务接续与失败恢复边界，详见[任务复用验收](docs/testing.md#任务复用验收)。
2. system prompt
当前缺陷：
目前的system prompt还比较原始，没有根据架构特性把需要模型注意的部分着重处理。实际上对于deepseek v4.1 flash及以上能力的模型来说，上下文窗口是比较富裕的。目前还没有激发secretary主会话的主观能动性（根据当前的表现，secretary的主会话像一个听话但不聪明的本科生。）
3. 主会话工具、TUI 和 WebUI

4. 优化 agent loop，使其更适配 Secretary 的工作模式
5. 完善更接近日常使用、可持续衡量行为稳定性的 online 回归用例。

### 使用改进规划
1. 支持社交软件内容导入 World Model 人际关系
2. GitHub 等仓库状态导入 World Model 认知
3. 移动应用
4. 语音输入
5. 生命体征监测。
