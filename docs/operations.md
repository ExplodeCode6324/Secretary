# 运行手册

从仓库根目录运行命令。需要 Node.js ≥22.19、npm、Python 3 和固定 Pi 子模块；World 可选使用 PostgreSQL。

## 安装与启动

```sh
git submodule update --init --recursive
npm ci
npm start
npm run core -- status
npm run core -- attach
npm run stop
```

默认模式为 fixture，数据目录为 `.demo-data`，使用合成模型。`start` 启动后台 Core 或附着已有实例；启动器结束后服务继续运行。`status`、`attach` 连接已有实例，无实例时退出 1；stop 无实例时退出 0。

自定义目录使用 `SECRETARY_DATA`，各管理命令保持相同目录和模式。`core-endpoint.json` 保存端口、实例和本机 token，`core.log` 保存日志，两者权限为 0600。CLI 输出状态和回执。

日常交互使用 [SwiftUI 客户端](../src/secretary_macos/README.md)。连接页可启动/附着/停止 Core，退出应用或关闭窗口不停止已经受理的后台工作。旧 Web/TUI 源码、静态页面和 npm 启动入口已退役；旧 HTTP 路径返回 404，`start:live -- --web` 明确失败。迁移不删除 Store、World 或用户缓存。

## 真实模型模式

`start:live` 读取已有凭据 JSON 的 `main`、`task` 两项，将其注入对应角色：

```sh
npm run start:live
SECRETARY_MODE=live SECRETARY_DATA=.demo-data/interactive-live npm run core -- status
SECRETARY_MODE=live SECRETARY_DATA=.demo-data/interactive-live npm run stop
```

该 wrapper 默认数据目录 `.demo-data/interactive-live`，凭据路径 `.demo-data/live-credentials.json`，两角色 provider 为 opencode-go。代码默认主模型 deepseek-v4.1-flash、任务模型 gpt-5.6-luna，可用角色环境变量覆盖模型名称。

默认 live 目录读取可选 `.demo-data/live-runtime.json`，也可显式指定 `SECRETARY_RUNTIME_FILE`。runtime 的 database_url 提供 World 连接；`SECRETARY_DATABASE_URL` 优先。未给环境 DSN 且配置 local_postgres_data 时，wrapper 可用 pg_ctl 启动已有集群；数据库初始化通过 API 的迁移命令完成。Core stop 关闭连接，PostgreSQL 继续运行。

直接 `SECRETARY_MODE=live npm start` 使用环境中的角色配置；凭据 JSON 读取属于 start:live wrapper。凭据文件与运行数据保存在本机私密目录。

| 环境变量 | 用途 |
| --- | --- |
| SECRETARY_DATA / SECRETARY_MODE | 数据目录与 fixture/live 模式 |
| SECRETARY_CREDENTIALS_FILE | live wrapper 凭据文件 |
| SECRETARY_RUNTIME_FILE | live wrapper 运行配置文件 |
| SECRETARY_MAIN_PROVIDER / SECRETARY_TASK_PROVIDER | 直接 Core 的角色 provider |
| SECRETARY_MAIN_MODEL / SECRETARY_TASK_MODEL | 角色模型 |
| SECRETARY_MAIN_API_KEY / SECRETARY_TASK_API_KEY | 角色凭据 |
| SECRETARY_PROVIDER / SECRETARY_MODEL | 直接 Core 的共享 provider/model 默认值 |
| SECRETARY_DATABASE_URL | World PostgreSQL DSN |
| SECRETARY_MAX_WORKERS | 默认 2 个任务执行者 |

容量和维护参数见[模型预算](memory-and-prompts.md#容量与配置)。

## API 操作

使用 [CoreClient](../src/pi_secretary/src/core-client.ts) 或遵循 [API v1](api/v1/README.md) 的本机客户端。写命令带 UUID request_id；同一意图重试保持路径、ID 和完整 body。202 是持久受理，`requests/{id}` 返回关联业务资源。

| 工作 | API 路径，前缀 `/api/v1` |
| --- | --- |
| 对话 | POST messages；GET timeline、timeline/around |
| 工作范围 | GET/POST scopes；GET/POST scopes/{id}；POST scopes/{id}/archive |
| 任务与接续 | POST task-requests；GET tasks/{id}、executions/{id} |
| 审批 | GET authorizations/{id}；POST authorizations/{id}/decision，带 revision/display_hash |
| 工作回答 | POST decisions/{id}/answer |
| 访问执行 | POST executions/{id}/viewed |
| 设置 | GET settings；POST settings/draft、settings/apply |
| 记忆 | POST session/compact、memory/extraction/retry、memory/commitments/{id}/resolve |
| 未知结果 | POST operations/{id}/verify-write 或 operations/{id}/resolve |
| World 初始化 | POST admin/world/migrate |

DIRECTORY Scope 选择已存在的物理根目录，和其他活动范围、Core 数据及仍占用的旧绑定保持分离。NONE 为分组，各任务使用独立目录。归档保留历史和已启动执行。

## 低频管理示例

程序登记和 World 初始化使用公开 API v1。在已启动的同目录 Core 上执行以下合成示例；程序入口应是经过检查的本机文件。

```sh
SECRETARY_DATA=.demo-data node --import tsx --input-type=module <<'JS'
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachCore } from './src/pi_secretary/src/core-client.ts';
const client = await attachCore(path.resolve(process.env.SECRETARY_DATA));
if (!client) throw Error('Core 未运行');
console.log(await client.command('admin/programs', {
  request_id: randomUUID(), name: 'Synthetic report generator',
  entrypoint: path.resolve('src/pi_secretary/examples/report.mjs'),
}));
console.log(await client.query('admin/programs'));
// 仅在 Core 已配置指定 World 数据库时执行：
// console.log(await client.command('admin/world/migrate', { request_id: randomUUID() }));
JS
```

程序登记/运行由 `runtime/native-retirement.test.ts` 验证；迁移与 World 增改撤回、冲突恢复由 `issue8/world.test.ts` 和原生 PG 探针验证。日常任务、审批、规则、记忆及恢复仍在 SwiftUI 操作，不需要手写 API。模型或数据库异常时先查看连接页、维护状态和 Core 私有日志；不把新 request_id 当作未知命令的重试。

## 状态与处理

| 状态或错误 | 后续处理 |
| --- | --- |
| OWNER_BUSY | 查找该目录已运行的 Core，通过它连接或停止 |
| CORE_MODE_MISMATCH / UNSAFE_ENDPOINT | 核对数据目录、模式、发现文件归属和权限 |
| CAPACITY_BLOCKED | 查看模型容量、请求预算及需保留的来源 |
| RECOVERY_BLOCKED | 根据恢复错误核对 checkpoint、调用与工具回执 |
| RESULT_UNKNOWN | 核对作用结果，执行文件核验或 owner 裁定；进程停止后释放占用 |
| Settings BLOCKED | 核对原配置、数据库批次回执，继续桥接和重建 |
| journal/CAS 错误 | 保存完整副本，定位损坏帧或缺失对象 |

时间线支持 streaming/thinking 开关；预览随当前进程存在，最终消息保存到 journal/CAS。可靠增量同步使用持久游标；通知实际可见后记录 presented，明确标记已读才记录 read。渠道 state 与展示/已读分开。

## 备份与升级

停止 Core，备份完整数据目录、World 数据库、代码及配置，在隔离副本验证新版本重放。未完成设置使用原配置恢复，目录迁移时检查程序入口和待执行绑定。回退时一并对账升级期间的外部作用。详细存储布局和恢复机制见[持久化](persistence.md)。
