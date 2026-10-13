#!/bin/zsh
cd -- "${0:A:h}/.." || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
printf '\n启动 Secretary live Core；日常操作请打开原生客户端。\n关闭此窗口不会停止 Core。\n\n'
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print '启动失败：未找到 Node.js / npm。'
elif [[ ! -f .demo-data/live-credentials.json ]]; then
  print '启动失败：缺少 .demo-data/live-credentials.json。'
elif [[ ! -d node_modules ]]; then
  print '启动失败：请先在此目录执行 npm ci --ignore-scripts。'
else
  npm run start:live
fi
printf '\n启动命令已结束。按回车关闭窗口。'
read -r
