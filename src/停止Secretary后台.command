#!/bin/zsh
cd -- "${0:A:h}/.." || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export SECRETARY_DATA="${SECRETARY_DATA:-.demo-data/interactive-live}"
export SECRETARY_MODE="${SECRETARY_MODE:-live}"
npm run stop
printf '\n按回车关闭。\n'
read -r
