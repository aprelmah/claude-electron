# HANDOFF · 2026-05-21 · LAN Chat Simple Semántico Estable

## 1) Resumen ejecutivo

Se cierra la inestabilidad de `Chat simple` migrándolo de parseo de PTY/TUI a un canal semántico dedicado por WebSocket:

- `chat:ask` (cliente → servidor)
- `chat:status` (servidor → cliente)
- `chat:result` (servidor → cliente)

Con esto, `Chat simple` deja de depender del stream crudo de terminal, que era la causa de ruido (`bypasspermissions`, fragmentos TUI, estado de modelo/ruta, etc.).  
`Terminal raw` mantiene PTY tradicional para uso técnico.

---

## 2) Problema raíz identificado

El problema no era “CSS” ni solo filtros de texto. Era arquitectónico:

1. `Chat simple` leía `output` del PTY (mismo stream que `Terminal raw`).
2. Ese stream incluye repintados TUI, secuencias ANSI/OSC y estados internos del CLI.
3. Cualquier filtro por regex acaba siendo frágil y puede:
   - dejar pasar basura,
   - o comerse respuestas reales.

Conclusión: parsear PTY para UX chat “limpio” no es estable a largo plazo.

---

## 3) Solución implementada

### 3.1 Nuevo canal semántico WS en servidor LAN

Archivo: `main/ws-server.js`

- Nueva capacidad anunciada:
  - `capabilities.chat.ask = true` si existe runner semántico.
- Nuevo mensaje soportado:
  - `type: 'chat:ask'`.
- Nueva lógica:
  - `handleSemanticChatAsk(session, payload)`.
  - Estado `chatBusy` por sesión (evita concurrencia de turnos).
  - `AbortController` por turno para cancelar en cierre/error de sesión.
  - Eventos emitidos:
    - `chat:status { state: 'started' | 'idle' }`
    - `chat:result { ok, text | error }`
- Limpieza robusta al cerrar sesión:
  - aborta turnos en vuelo (`abortSessionChat`).

### 3.2 Runner semántico central (headless limpio)

Archivo: `main.js`

- Nueva función:
  - `runLanSemanticChatTurn({ session, prompt, signal })`.
- Usa runners ya existentes:
  - `runCodexHeadless(...)`
  - `runClaudeHeadless(...)`
- Mantiene continuidad conversacional:
  - `session.chatSessionId` por sesión LAN.
- Respeta modelo/esfuerzo/cwd/CLI de contexto enterprise.
- Integración:
  - `ensureLanWsServer(...)` ahora inyecta `runSemanticChatTurn`.

### 3.3 Cliente LAN: Chat simple por canal semántico

Archivo: `lan-client.html`

- Si `capabilities.chat.ask` está disponible:
  - `sendChatText` envía `chat:ask`.
  - `output` PTY **ya no** se parsea para chat.
- Adjuntos y voz:
  - también pasan por `chat:ask` en modo semántico.
- Gestión de estado UX:
  - cola 1 turno (`chatPendingRequestId`).
  - bloqueo de input durante respuesta.
  - mensaje de estado en conexión.
- Indicador visible añadido:
  - `Agente escribiendo...` con animación de puntos.

---

## 4) Qué queda exactamente estable ahora

- `Chat simple`:
  - respuesta limpia de agente,
  - sin basura TUI,
  - con indicador de escritura,
  - sin solape de turnos.
- `Terminal raw`:
  - sigue siendo terminal real (intencionadamente “técnico”).

---

## 5) Comandos de validación ejecutados

### Sintaxis

- `node --check main.js` ✅
- `node --check main/ws-server.js` ✅
- Validación de script embebido en `lan-client.html` con `vm.Script(...)` ✅

### Tests

- `npm run test` ✅  
  Resultado: `pass 60`, `fail 0`, `skipped 7`.

### Compilación

- `npm run build:zip` ✅ (x64 + arm64)
  - ZIP generados en `dist/`.

### Deploy app

- `npm run deploy` ✅
  - App instalada y abierta desde `/Applications/POWER-AGENT.app`.

---

## 6) Riesgos/observaciones conocidas

1. En Codex headless `--json` puede emitir múltiples `agent_message` intermedios en algunos escenarios; hoy el runner toma el último texto significativo como resultado final de turno.
2. Si se quiere “cero ambigüedad” futura, se puede endurecer el parser para capturar estrictamente el mensaje posterior a `turn.completed`.
3. `Terminal raw` seguirá mostrando peculiaridades TUI por naturaleza; esto no afecta a `Chat simple`.

---

## 7) Checklist rápido para quien retome

1. Abrir app y activar LAN.
2. Conectar cliente LAN.
3. Verificar en sesión conectada que `capabilities.chat.ask=true` (detalles de sesión).
4. En `Chat simple`:
   - enviar `hola`,
   - comprobar indicador `Agente escribiendo...`,
   - comprobar respuesta limpia.
5. Probar adjunto y dictado en `Chat simple`.
6. Confirmar que `Terminal raw` sigue operativo.

---

## 8) Archivos tocados en este bloque

- `lan-client.html`
- `main.js`
- `main/ws-server.js`
- `HANDOFF-CODEX-2026-05-21-LAN-CHAT-SEMANTICO-ESTABLE.md`

---

## 9) Mensaje recomendado de commit

`feat(lan-chat): move Chat simple to semantic ws channel and add typing indicator`

