#!/bin/zsh
set -eu
cd -- "${0:A:h}"
mkdir -p logs
launcher_runtime="${LAUNCHER_ELECTRON:-./runtime/Electron.app/Contents/MacOS/Electron}"
if [[ "$launcher_runtime" == *.app ]]; then
  launcher_runtime="$launcher_runtime/Contents/MacOS/Electron"
fi
if [[ ! -x "$launcher_runtime" ]]; then
  print '请设置 LAUNCHER_ELECTRON 指向本地 Electron.app 或可执行文件，详见 README.md。'
  exit 1
fi
unset ELECTRON_RUN_AS_NODE
exec "$launcher_runtime" . "$@" >> logs/launcher.log 2>&1
