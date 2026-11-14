# 环境基础报告索引

#120 当前交付环境协议，不提供真实记忆工作负载结果。权威运行报告使用 [v1 schema](../../benchmarks/common/report.schema.json)，每个 run 独立写入 `.local/benchmark/<facility>/reports/<report-id>/`，Markdown 由 JSON 渲染。此目录仅提交人工审核过的脱敏摘要，不上传连接配置或原始对话。

普通 correctness 与 memory benchmark 的命令、适用范围和证据类别见[运行说明](../../online/benchmark/README.md)。历史已有报告保留原格式、原结论和首次失败。

## 2026-11-14 历史材料归档

Master 批准的两个 main checkout 具名候选在执行前重新核对完整文件 SHA-256/大小/权限、进程及打开文件引用、Git worktree 与已知凭据模式；未扩大目录范围。

| 原相对目录 | 结果 | 文件/字节 | 私有归档位置 |
| --- | --- | --- | --- |
| `.demo-data/issue112` | ARCHIVED_VERIFIED：完整副本与原件均核验 | 12 / 114511 | Desktop/Codex_Bak/Secretary_Tests_20261114Bak/20261114T191951+0800 下 verified-copy 与 originals 的 secretary-core/.demo-data/issue112 |
| `.demo-data/issue114` | RETAINED：检出凭据，整个候选保留原位 | 6642 / 121955005 | 未复制、未移动 |

没有永久删除。私有 manifest 记录原路径、每文件哈希和恢复说明；恢复时先核验不再被使用、确认原路径空闲，再把 originals 原子移回，verified-copy 继续保留。其它 worktree、敏捷实例、个人数据和本次失败证据未移动。根目录本地 agent/部署说明/启动器停止 Git 跟踪与本次数据归档是两项不同操作。
