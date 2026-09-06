#!/bin/sh
# 배포 버전을 찍는다. index.html 의 BUILD 와 docs/version.txt 를 같은 값으로 맞춰,
# 캐시에 묶인 옛 화면이 스스로 새로고침하게 한다.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
V=$(date +%Y%m%d-%H%M%S)
printf '%s\n' "$V" > "$DIR/docs/version.txt"
/usr/bin/sed -i '' "s/^const BUILD = '[^']*';/const BUILD = '$V';/" "$DIR/docs/index.html"
echo "$V"
