#!/bin/zsh
set -eu
cd -- "${0:A:h}"
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm start || exit $?
npm run tui
