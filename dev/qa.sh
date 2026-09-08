#!/bin/bash
# T4：一次 headless Chrome 跑完 QA 截图 + 纸色留白统计 + 帧耗时。
# 用法: bash dev/qa.sh "tag=base"            全部八关 + 三张 UI
#       bash dev/qa.sh "tag=new&only=c4"     只跑一关（迭代用）
# 产物: _spec/qa/<tag>_*.png 与 _spec/qa/_stats.json
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=${PORT:-8777}
QS="${1:-tag=new}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$ROOT/_spec/qa"
rm -f "$ROOT/_spec/qa/_stats.json"
pkill -f "user-data-dir=/tmp/sjchrome" 2>/dev/null
python3 "$ROOT/dev/qa_server.py" "$PORT" >/tmp/sj_qa_server.log 2>&1 &
SRV=$!
sleep 1
perl -e 'alarm 240; exec @ARGV' "$CHROME" --headless --disable-gpu --no-sandbox --no-first-run \
  --disable-extensions --user-data-dir=/tmp/sjchrome --window-size=960,540 --hide-scrollbars \
  "http://127.0.0.1:$PORT/dev/shot.html?$QS" >/tmp/sj_chrome.log 2>&1 &
for i in $(seq 1 240); do [ -f "$ROOT/_spec/qa/_stats.json" ] && break; sleep 1; done
sleep 1
pkill -f "user-data-dir=/tmp/sjchrome" 2>/dev/null
kill $SRV 2>/dev/null
grep -c . /tmp/sj_qa_server.log >/dev/null 2>&1
grep '^saved\|^DONE' /tmp/sj_qa_server.log
[ -f "$ROOT/_spec/qa/_stats.json" ] || { echo "!! 没拿到 _stats.json，chrome 日志："; tail -20 /tmp/sj_chrome.log; exit 1; }
