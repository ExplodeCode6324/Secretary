#!/bin/zsh
cd -- "${0:A:h}/.." || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run start:web:live
if [[ $? != 0 ]]; then
  printf '\n启动失败，按回车关闭。\n'
  read -r
fi
