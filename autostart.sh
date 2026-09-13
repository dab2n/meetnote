#!/bin/sh
# 로그인하면 로컬 서버가 저절로 뜨고, 죽으면 다시 뜬다.
#   ./autostart.sh       켜기
#   ./autostart.sh off   끄기
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
LABEL=com.meetnote.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "$1" = off ]; then rm -f "$PLIST"; echo "자동 실행 끔"; exit 0; fi

# launchd 는 셸 PATH 를 모른다. claude(구독으로 맵 생성)와 python 을 찾게 넣어 준다.
PY=$(command -v python3)
PATHS="$(dirname "$(command -v claude)"):$(dirname "$PY"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>-u</string><string>$DIR/server.py</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATHS</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/meetnote-server.log</string>
  <key>StandardErrorPath</key><string>/tmp/meetnote-server.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 2
curl -s -m 2 http://127.0.0.1:8787/health >/dev/null && echo "자동 실행 켬 · http://127.0.0.1:8787/notes/" || { echo "서버가 안 떴습니다 — /tmp/meetnote-server.log 확인"; exit 1; }
