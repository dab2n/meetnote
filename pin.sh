#!/bin/sh
# 서버 + 우상단 고정 패널. 이미 떠 있으면 갈아끼운다.
# 마이크/화면녹음 권한(TCC)은 앱 번들이어야 물어보기 때문에 .app 으로 감싼다.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
APP="$DIR/meetnote.app"

if [ "$DIR/pin.swift" -nt "$APP/Contents/MacOS/pin" ] || [ ! -x "$APP/Contents/MacOS/pin" ]; then
  mkdir -p "$APP/Contents/MacOS"
  swiftc -O "$DIR/pin.swift" -o "$APP/Contents/MacOS/pin"
  cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>meetnote</string>
  <key>CFBundleExecutable</key><string>pin</string>
  <key>CFBundleIdentifier</key><string>com.meetnote.pin</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>회의 중 내 목소리를 녹음합니다.</string>
  <key>NSAudioCaptureUsageDescription</key><string>회의 상대방 목소리(시스템 오디오)를 녹음합니다.</string>
</dict></plist>
PLIST
  codesign -s - --force "$APP" >/dev/null 2>&1 || true
fi

curl -s -m 1 http://127.0.0.1:8787/health >/dev/null 2>&1 ||
  (cd "$DIR" && nohup python3 -u server.py >> /tmp/meetnote-server.log 2>&1 &)

pkill -x pin 2>/dev/null || true
exec "$APP/Contents/MacOS/pin"
