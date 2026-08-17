# Runbook — ciclo de vida del bridge de WhatsApp (LaunchAgent)

_Creada 2026-08-17. Origen: Luismi llegó por la mañana y el bridge estaba conectado sin que él lo hubiera arrancado. Commit del fix: `8b544b9`, merge `7ea7eb4`._

## El hecho que no estaba escrito en ningún sitio

El bridge **no lo arranca la app**. Lo arranca `launchd` desde un LaunchAgent instalado a mano el 2026-05-18:

`~/Library/LaunchAgents/com.luismi.whatsapp-bridge.plist`

```
RunAtLoad = 1        → arranca en CADA login de la sesión gráfica
KeepAlive = 1        → si el proceso muere, launchd lo resucita
ProgramArguments     → node ~/.claude/whatsapp-bridge/index.js
StandardOut/ErrorPath → ~/.claude/whatsapp-bridge/bridge.log  (SIN timestamps)
```

Consecuencia que costó un susto: reiniciar el Mac = bridge conectado a WhatsApp solo, sin tocar nada. El 2026-08-16 a las 23:45 hubo reboot y por la mañana estaba vivo. No fue la app, no fue un bug: era el plist haciendo su trabajo.

## Dónde vive el estado de "encendido" — y dónde NO

| Sitio | Qué guarda | Qué NO decide |
|---|---|---|
| **override store de launchd** (`launchctl enable/disable`) | si el servicio puede arrancar en el próximo login | — |
| servicio cargado/descargado (`bootstrap`/`bootout`) | si está vivo AHORA | no sobrevive al login |
| `~/.claude/whatsapp-bridge/config.json` → `autoReply` | si el bot RESPONDE | no arranca ni para el bridge |

Los tres son independientes. **El bridge conectado con `autoReply:false` recibe pero no contesta a nadie**: estar vivo no es estar respondiendo. Al diagnosticar "¿ha escrito algo solo?", mirar `autoReply`, no el proceso. Kill switch real y los tres controles de cabecera: [[kill_switch_whatsapp_2026_08_02]].

## Parar es persistente por decisión de producto (2026-08-17)

Luismi: *"lo quiero apagado por defecto"*, *"SIEMPRE PARADO SALVO QUE YO LO PULSE"*.

El botón STOP hacía solo `bootout` → duraba hasta el siguiente login y launchd lo volvía a levantar. Ahora la escalera de `main/whatsapp-bridge-control.js` es:

| acción | comandos |
|---|---|
| **stop** | `disable` → `bootout` (label, escala a plist) |
| **start** | `enable` → `bootstrap` → `kickstart -k` |
| **restart** | `bootout` → `enable` → `bootstrap` → `kickstart -k` (jamás `disable`) |

Tres decisiones con su porqué:

1. **El `disable` va PRIMERO en el stop.** Si el bootout falla y la operación sale con error, el estado que el usuario pidió (apagado) ya quedó grabado y no revive en el login. El fail-safe apunta hacia apagado, que es lo que se pidió.
2. **El `enable` del start es incondicional**, no condicionado a detectar "estaba disabled". Un stop previo deja el servicio deshabilitado y sin `enable` el botón START quedaría inservible — el propio STOP se habría cargado el START.
3. **El restart no deshabilita.** Su stop es un paso intermedio, no la intención de dejarlo apagado; un `disable` ahí sería un estado incoherente a mitad de operación.

## Los mensajes de launchd, MEDIDOS (macOS 12, no de memoria)

Con el servicio **deshabilitado**, probado con un plist dummy para no levantar WhatsApp:

```
launchctl bootstrap gui/501 <plist>   → "Bootstrap failed: 5: Input/output error"   exit 5
launchctl kickstart -k gui/501/<label> → "Could not find service ... for user gui: 501"  exit 113
```

Trampa: ese `Input/output error` **ya estaba en `isBenignBootstrapFailure`**, así que el bootstrap pasaba por bueno y el que reventaba era el kickstart, un escalón más abajo de donde uno lo busca. Por eso el fix **no parsea** ese mensaje: los textos de launchd son frágiles y el fallo aparece donde no esperas. Se habilita antes y punto.

## Reglas duras

- **Un `enable`/`disable` que falla no se queda mudo.** Devuelve `warning` (mismo criterio que `commitWarning` en kb-git) que el handler propaga y el panel pinta. Sin eso el usuario cree que quedó apagado para siempre y reaparece en el próximo login: el peor fallo posible es el silencioso que contradice lo que el botón prometió.
- **`bridge.log` no tiene timestamps.** Para saber cuándo arrancó, `ls -la` del log (mtime) y `last reboot`; no hay más forma. Si algún día hace falta precisión, añadir timestamps al bridge antes de intentar deducirlos.
- **Nada más en la app arranca el bridge.** `tryStartWhatsapp` (`main.js`) solo hace ping a `127.0.0.1:3031` y engancha el cliente si YA está vivo; el health-watchdog solo lo etiqueta para el panel 📈. Si aparece un tercer sitio que haga `kickstart`, "siempre parado" deja de ser cierto — documentarlo aquí.
- Con el bridge apagado, `tryStartWhatsapp` reintenta el ping **cada 10 s indefinidamente** (sin tope). Inofensivo (localhost) pero es ruido perpetuo en el log de la app. Conocido y aceptado el 2026-08-17.
- El código de la escalera vive fuera del `ipcMain.handle` a propósito: la suite corre sin Electron ([[tech_logica_en_ipc_handle_sin_cobertura]]). Cobertura en `tests/whatsapp-bridge-control.test.js` (29 tests, `exec` inyectado).

## Operar a mano

```bash
launchctl print-disabled gui/501 | grep whatsapp     # => true  significa DESHABILITADO
pgrep -f "whatsapp-bridge/index.js"                  # ¿vivo ahora?
launchctl enable  gui/501/com.luismi.whatsapp-bridge # rehabilitar
launchctl disable gui/501/com.luismi.whatsapp-bridge # apagar para siempre
launchctl kickstart -k gui/501/com.luismi.whatsapp-bridge
```

Ojo con la lectura de `print-disabled`: **`=> true` es "deshabilitado", no "activo"**. Se lee al revés de lo que parece.
