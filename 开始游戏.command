#!/bin/bash
# 《说剑》启动器：在本目录起一个静态服务，然后用默认浏览器打开。
# 关掉这个终端窗口即停止服务。
cd "$(dirname "$0")" || exit 1

PORT=8765
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt 8820 ]; then
    echo "8765–8820 全被占用了，先关掉一些程序再试。"
    read -r -p "按回车关闭…" _
    exit 1
  fi
done

URL="http://127.0.0.1:$PORT/index.html"
echo ""
echo "  《说剑》  $URL"
echo "  关掉这个窗口即停止服务。"
echo ""

( sleep 0.8; open "$URL" ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
