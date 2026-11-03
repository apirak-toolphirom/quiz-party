#!/usr/bin/env bash
# เปิดเซิร์ฟเวอร์ Quiz Party เบื้องหลัง และตั้งพอร์ต 3000 เป็นสาธารณะ ให้มือถือสแกน QR เข้าได้
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install
pkill -f "node server.js" 2>/dev/null
nohup node server.js > /tmp/quiz-party.log 2>&1 &
sleep 2
if [ -n "$CODESPACE_NAME" ]; then
  gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 \
    || echo "⚠️ ตั้งพอร์ตเป็น public ไม่สำเร็จ: ไปที่แท็บ PORTS → คลิกขวาพอร์ต 3000 → Port Visibility → Public"
  echo "🎉 Quiz Party: https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/host.html"
fi
