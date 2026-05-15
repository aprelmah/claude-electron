# Estado Telegram y App (2026-05-14)

## Proyecto
- Ruta: `/Users/isabel/Desktop/claude-electron`
- App instalada: `/Applications/POWER-AGENT.app`

## Problemas trabajados
1. **Crash al abrir app empaquetada** por `Cannot find module './telegram-bridge'`.
2. **Telegram error `fetch is not defined`** en Electron 20.
3. **Telegram error `HTTP 409`** por conflicto con otro poller/bridge antiguo.
4. **Input desde Telegram no ejecutaba auto** (se veía en CLI pero no se enviaba igual que Enter).

## Cambios aplicados
1. Inclusión de `telegram-bridge.js` en el empaquetado (`build.files`).
2. Reemplazo de `fetch` por `https` nativo en `telegram-bridge.js`.
3. Manejo explícito de conflictos `409` y mensajes de error Telegram más claros.
4. Parada y borrado del servicio antiguo:
   - LaunchAgent eliminado: `~/Library/LaunchAgents/com.luismi.claude-telegram-bridge.plist`
   - Carpeta eliminada: `~/.claude/telegram-bridge`
5. Ajuste de envío a PTY con CR (`\r`) para simular Enter real en Telegram bridge.

## Commits en GitHub (main)
- `54608f4` Add Telegram bridge and in-app configuration panel
- `5eca1c9` Include telegram-bridge.js in packaged app files
- `70481ee` fix(telegram): remove fetch dependency in Electron main process
- `17693b9` fix(telegram): handle 409 conflicts and surface API error details
- `2ce9d86` fix(telegram): send CR enter to PTY for auto-submit

## Estado pendiente reportado por usuario
1. Sigue viendo comportamiento anómalo: Telegram vuelca salida del CLI pero no responde como espera.
2. La app no abre bien desde `/Applications` en algunos intentos; desde carpeta sí.

## Comando recomendado para continuar por CLI (sin app)
```bash
cd "/Users/isabel/Desktop/claude-electron"
/Users/isabel/.local/bin/claude
```

