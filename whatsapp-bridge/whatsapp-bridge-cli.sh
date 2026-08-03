#!/bin/bash
# CLI para el WhatsApp Bridge

BASE="http://localhost:3031"

case "$1" in
  start)
    launchctl load ~/Library/LaunchAgents/com.luismi.whatsapp-bridge.plist 2>/dev/null
    echo "Bridge arrancado."
    ;;
  stop)
    launchctl unload ~/Library/LaunchAgents/com.luismi.whatsapp-bridge.plist 2>/dev/null
    echo "Bridge parado."
    ;;
  status)
    curl -s "$BASE/status" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Estado:', d['status'])"
    ;;
  qr)
    node --input-type=module <<'EOF'
import qrcode from '/Users/isabel/.claude/whatsapp-bridge/node_modules/qrcode-terminal/lib/main.js';
const res = await fetch('http://localhost:3031/qr');
const data = await res.json();
if (data.qr) {
  qrcode.generate(data.qr, { small: true });
} else {
  console.log('Estado:', data.status, '— no hay QR disponible');
}
EOF
    ;;
  send)
    if [ -z "$2" ] || [ -z "$3" ]; then
      echo "Uso: whatsapp-bridge send <numero> <mensaje>"
      echo "Ejemplo: whatsapp-bridge send 34612345678 \"Hola\""
      exit 1
    fi
    curl -s -X POST "$BASE/send" \
      -H "Content-Type: application/json" \
      -d "{\"to\":\"$2\",\"message\":\"$3\"}" | \
      python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('ok') else 'Error: '+d.get('error',''))"
    ;;
  log)
    tail -f ~/.claude/whatsapp-bridge/bridge.log
    ;;
  *)
    echo "Uso: whatsapp-bridge {start|stop|status|qr|send|log}"
    ;;
esac
