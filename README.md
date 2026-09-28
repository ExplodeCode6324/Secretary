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

### 基本架构搭建
基本完成架构搭建，还需进行一系列后续优化。

### 后续架构改进规划
1. 完善 task 系统
当前缺陷：
（仅针对task agent类任务）目前，task的生成机制是任何master的执行请求都会触发 task 生成，且同一个task没有接续工作的能力；不同的task没有互相查看的权限。举例：master让secretary做task A，返回结果后master提出了修改意见，要求做一遍更改要求后的task A，此时secretary无法复用task A的产出和上下文（task B没有访问task A的workspace的权限），需要重新创建task B，这样会有两个问题：1.任务产出/结论无法复用和审计，master让干了A，但是在结果不满意的时候无法审计task A，如果想修正A的规划接着干，只能靠secretary主会话塞入未必可靠的任务总结给task B。 2.master交互没有连贯性，造成了secretary在实际上无法独立完成长任务。
task的缺陷使整个task系统都处于不可用的情况，
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
