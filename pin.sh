#!/bin/sh
# 서버 + 좌상단 고정 패널을 같이 띄운다. 이미 떠 있으면 갈아끼운다.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
[ -x "$DIR/pin" ] || swiftc -O "$DIR/pin.swift" -o "$DIR/pin"
curl -s -m 1 http://127.0.0.1:8787/health >/dev/null 2>&1 ||
  (cd "$DIR" && nohup python3 -u server.py >> /tmp/meetnote-server.log 2>&1 &)
pkill -x pin 2>/dev/null || true
exec "$DIR/pin"
