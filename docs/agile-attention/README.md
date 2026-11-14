# 敏捷实例的本地文件与入口

唯一持久敏捷实例是 `/Users/muy/Desktop/secretary-agile`，运行分支为 `agile`。main 开发 checkout 与隔离 benchmark 不作为该部署实例使用。合并 agile 至 main、改变持久数据域或部署配置需要 Master 的明确许可。

从 #120 起，根目录 `agents.md`、`敏捷实例使用说明.md`、`启动Secretary.command`、`停止Secretary.command` 是各 checkout 的本地文件，均由 `.gitignore` 排除。main 与 agile 分别维护自己的代理约定；新 clone 不会获得这些本地文件。共享参考保存在本目录，运行实现仍由 [scripts/agile.mjs](../../scripts/agile.mjs) 管理。

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

本次停止跟踪只作用于当前索引和后续提交，不删除本机文件、不重写 Git 历史，也不改变正在运行的服务。更新或切换旧提交前备份本地说明和入口，避免旧版跟踪文件覆盖本地版本。现有运行记录和历史部署约定仍保留在 [敏捷专题](../fix/fix_20261108start_敏捷迭代专题/000-实例部署与保留约定.md)。
