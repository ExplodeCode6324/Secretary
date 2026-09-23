#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node --import tsx pi_secretary/src/stop-ui.ts
printf '\n按回车关闭。\n'
read -r
