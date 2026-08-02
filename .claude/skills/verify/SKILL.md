---
name: verify
description: Conducir POWER-AGENT (Electron) por CDP para verificar cambios de UI en la app real — arranque con puerto de debug, evaluate, screenshots y limpieza.
---

# Verificar cambios en POWER-AGENT

La superficie es una app Electron. Verificar = conducirla, no correr tests.

## 1. Arrancar con CDP

`npm run deploy` deja la app en `/Applications` pero **sin** puerto de debug. Para conducirla hay que relanzarla a mano:

```bash
osascript -e 'quit app "POWER-AGENT"' 2>/dev/null; sleep 4
UD="$HOME/Library/Application Support/CLAUDE-NOVAK"
[ -e "$UD/SingletonLock" ] && ! pgrep -f "POWER-AGENT.app" >/dev/null \
  && rm -f "$UD/SingletonLock" "$UD/SingletonSocket" "$UD/SingletonCookie"

cat > /tmp/launch_pa_cdp.scpt << 'EOF'
tell application "Terminal"
    activate
    do script "/Applications/POWER-AGENT.app/Contents/MacOS/POWER-AGENT --remote-debugging-port=9222 2>&1 | tee /tmp/pa-cdp.log"
end tell
EOF
osascript /tmp/launch_pa_cdp.scpt
```

Trampas:
- `do shell script "... &"` desde osascript **no** arranca la app (muere con el osascript). Hay que ir por Terminal.
- Sin limpiar el `SingletonLock` huérfano, el arranque se suicida en silencio.
- `pkill -f "POWER-AGENT.app"` NO mata la app. Usar `osascript -e 'quit app'`.

## 2. Conducir

El MCP `chrome-devtools` **no sirve**: abre su propio Chrome, no se conecta al Electron. Hay que hablar CDP a pelo.

`Bash` tiene un hook que bloquea HTTP inline (curl y `node -e`). Usar `ctx_execute` (corre en Bun, con red).
El `ws` de `node_modules` **falla en Bun** (`Unexpected server response: 101`) — usar el `WebSocket` global de Bun.

```javascript
const http=require('http'),fs=require('fs');
function targets(){return new Promise((res,rej)=>{http.get('http://127.0.0.1:9222/json/list',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)))}).on('error',rej)})}
async function conn(t){const ws=new WebSocket(t.webSocketDebuggerUrl);let id=0;const pend=new Map();
  await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',e=>{const o=JSON.parse(e.data);if(o.id&&pend.has(o.id)){pend.get(o.id)(o);pend.delete(o.id)}});
  const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}))});
  const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r.result?.result?.value ?? ('EXC:'+(r.result?.exceptionDetails?.exception?.description||''))};
  const shot=async(f,clip)=>{const p={format:'png'};if(clip)p.clip={...clip,scale:2};const r=await send('Page.captureScreenshot',p);fs.writeFileSync(f,Buffer.from(r.result.data,'base64'));return f};
  return {ev,shot,close:()=>ws.close()};
}
```

Targets: `index.html?wid=0` es la ventana principal; el panel de WhatsApp abre **ventana propia** (`whatsapp-window.html`) al pulsar `#btn-whatsapp`. Cada una es un target CDP distinto y **ambas montan el mismo panel** — verificar en las dos.

API del renderer: `window.api.whatsapp.*` (no `waApi`). Ver `preload.js` / `whatsapp-window-preload.js`.

Screenshots: `Page.captureScreenshot` con `clip` + `scale:2` recorta la zona que interesa; leerlos con `Read` para verlos.

## 3. Medir, no suponer

- El panel refresca por `setInterval` de **15 s** (`refreshStatus`/`refreshChats`). Medir sincronización entre ventanas con margen > 15 s o dará falso negativo.
- Al leer el mismo fichero varias veces dentro de una ejecución de `ctx_execute` puede dar valores rancios. Un `statSync` + relectura por iteración, y desconfiar del primer valor.
- Config de WhatsApp en disco: `~/.claude/whatsapp-bridge/config.json`. Se escribe ~200 ms tras la acción.

## 4. Dejarlo limpio

Cerrar y relanzar sin puerto de debug, y devolver el estado que tocaste (p. ej. `autoReply`) a como estaba:

```bash
osascript -e 'quit app "POWER-AGENT"'; sleep 4; open -a "/Applications/POWER-AGENT.app"
```
