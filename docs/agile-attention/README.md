# 敏捷实例的本地文件与入口

唯一持久敏捷实例是 `/Users/muy/Desktop/secretary-agile`，运行分支为 `agile`。main 开发 checkout 与隔离 benchmark 不作为该部署实例使用。合并 agile 至 main、改变持久数据域或部署配置需要 Master 的明确许可。

根目录 [AGENTS.md](../../AGENTS.md) 和 [工作流](../../workflows/agile.md) 纳入 Git，开发检出和敏捷实例共用。根目录的 `敏捷实例使用说明.md`、`启动Secretary.command`、`停止Secretary.command` 是各 checkout 的本地文件。可共享的操作参考保存在本目录，运行入口由 [scripts/agile.mjs](../../scripts/agile.mjs) 管理。

常驻敏捷实例保留 Core/PostgreSQL、会话、CAS、任务工作区、TUI 草稿、Scope 目录、附件及凭据。登录自启服务和守护持续维护同一实例；不设实例总请求、调用数或运行时长额度。关闭 TUI 不会停止 Core。只在经授权的敏捷变更时短暂停机，完成后立即恢复。

## 操作入口

仅在已配置的敏捷实例目录执行：

```sh
cd /Users/muy/Desktop/secretary-agile
npm start
npm run tui
npm run core -- status
npm run stop
```

`npm run stop` 写入维护标记以避免守护立即重启。完成维护后必须 `npm start` 恢复，不能留下维护标记。不得为 benchmark 调用这些入口；独立 benchmark 使用其自己的 CLI 和归属校验。

需要 Finder 双击入口时，可在**已配置敏捷实例的根目录**手工保存以下本地模板。不要从本文档目录直接执行，不要在 main 开发目录安装或运行敏捷启动器。

`启动Secretary.command`：

```sh
#!/bin/zsh
set -eu
cd -- "${0:A:h}"
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm start || exit $?
npm run tui
```

`停止Secretary.command`：

```sh
#!/bin/zsh
set -eu
cd -- "${0:A:h}"
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run stop
```

## 从旧 checkout 迁移

#120 曾将四个本机文件移出跟踪。升级旧检出前，私下备份原代理说明、实例说明和两个启动器。将仍适用的通用约束对照共享 AGENTS.md 和工作流；保留机器专属资料的私有备份。大小写敏感系统还须检查旧的 `agents.md`，移走旧副本后检出根目录统一的大写文件。核实 `git ls-files -- AGENTS.md` 能列出该文件，其余三个本机文件仍受忽略保护。流程文档的更新无需重启服务。历轮部署记录见[敏捷专题](../fix/fix_20261108start_敏捷迭代专题/000-实例部署与保留约定.md)。
