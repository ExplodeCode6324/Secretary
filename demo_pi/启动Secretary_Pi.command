#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export SECRETARY_COLOR=256
printf '\nSecretary_Pi 实时模型测试\n输入 /quit 或按 Ctrl+C 退出。\n\n'
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print '启动失败：未找到 Node.js / npm。'
elif [[ ! -f .demo-data/live-credentials.json ]]; then
  print '启动失败：缺少 .demo-data/live-credentials.json。'
elif [[ ! -d node_modules ]]; then
  print '启动失败：请先在此目录执行 npm ci --ignore-scripts。'
else
  npm run start:live
fi
printf '\n测试已退出。按回车关闭窗口。'
read -r
