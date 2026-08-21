# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-21 tarde (verificado contra git, filesystem, CDP y `npm run verify` en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`git status -sb` → `## main...origin/main`, sin ahead/behind). Working tree limpio salvo la memoria de este cierre.
- Últimos commits: `88bdbe8 fix(renderer): un destructuring dejó el picker sin proyectos ni personalidades`, `925af4f feat(lan): el QR del espejo se renueva solo y dice lo que le queda`, `a4446f9 feat(lan): el espejo dice por qué falla, en vez de quedarse en blanco`.
- Tests: **1672 pass, 0 fail, 6 skipped** (1652 + 16 del módulo del espejo + 3 de colisiones de ámbito global + 1 de encadenado del QR). Suite completa en el pre-commit de los tres commits, Node del sistema v24.13.0.
- **`npm run verify` → VEREDICTO OK (0 KO · 0 WARN · 6 OK)**. Sintaxis de 141 ficheros, huérfanos de `build.files`, deploy al día, proceso, lock y bridge.
- Deploy: `/Applications/POWER-AGENT.app` v1.3.0, asar del **2026-08-21 19:25** ≥ último commit de código empaquetado (`88bdbe8`, 19:24) y **3/3 canarios idénticos a HEAD**. El fichero nuevo `main/mirror-connection-status.js` se comprobó DENTRO del asar y es byte-idéntico al del repo.
- App corriendo **con ventana** (pid 41543, `--type=renderer`), sin dev viva y sin puerto de debug. **0 errores en la consola del renderer** (verificado por CDP tras el fix).
- **Bridge de WhatsApp: APAGADO y deshabilitado** (launchd `=> true`, no cargado, 3031 libre). Sigue siendo el estado que Luismi quiere por defecto.

## Última sesión (2026-08-21 — el espejo aprende a decir por qué falla, y una lección cara)

- **DeepSeek Harness evaluado y descartado.** `dsh` es el BUCLE (lo que aquí hace el binario `claude` en el PTY); POWER-AGENT es todo lo de alrededor. Decisión de Luismi: seguir igual. Deuda que dsh sí cubre: sandbox de subprocesos y desacople del binario. Detalle en la memoria auto.
- **Espejo LAN: diagnóstico cerrado a medias, con código.** El renewal caduca **4 h después de escanear el QR**, no es deslizante y NO se re-emite (`ws-server.js:3253`, anti-cadena deliberado). Mientras el WS aguante abierto nadie revalida; pasadas las 4 h, **el primer corte es definitivo**. Descartados con evidencia: lock, límite de sesiones (no existe), el GET no quema el invite (`has()`, no `claim()`), `MIRROR_TARGET_GONE` tiene mensaje propio, URLs públicas de config vacías, `lan-mirror.html` sí en `build.files`.
- **`a4446f9`** — el móvil ya no se queda en blanco: `main/mirror-connection-status.js` distingue token quemado / Mac inalcanzable / WS bloqueado / terminal cerrado, nombra `host:puerto` y sondea `/status` antes de acusar a nadie (un 401 ya prueba que el host existe). El módulo se INYECTA en `lan-mirror.html` al servirla — sin endpoint nuevo, sin duplicar lógica.
- **`925af4f`** — el QR se renueva solo cada 75 s mientras la banda esté abierta, con cuenta atrás visible. Antes moría a los 90 s sin cambiar de aspecto.
- **`88bdbe8`** — el fix del fallo que rompió la app en el escritorio de Luismi, más el mecanismo que faltaba (ver abajo).

## Riesgo abierto que descubrió esta sesión

- **`npm run verify` NO detecta una página muerta.** Dijo "proceso con ventana · 1 renderer" con la UI completamente rota: proceso vivo, renderer cargado y `renderer.js` sin ejecutar por un `SyntaxError`. **Arrancar ≠ funcionar.** Lo cazó el ojo de Luismi y luego CDP, no la verificación automática. Candidato claro de mejora para `verify`: una comprobación de salud de la UI.

## Próximo paso

- **Probar el espejo en real** (lo hará Luismi estos días, en la empaquetada). La causa del "el QR nuevo tampoco conectaba" sigue SIN CERRAR: quedan dos sospechosos —la ventana de 90 s y el túnel dando IP LAN en vez de pública— y el mensaje nuevo del móvil dirá cuál en cuanto vuelva a pasar.
- **Decisión pendiente de Luismi**: el techo de 4 h del renewal sigue intacto a propósito. Tocarlo es decisión suya, no técnica.
- ~~Poda del runbook~~ **HECHA el 2026-08-21**: `AGENTS.md` 16,9 → **15,7 KB**. Criterio aplicado: se queda lo que hay que saber ANTES de tocar nada (invariantes); se muda el cómo y los nombres de función, que se consultan ya trabajando en el subsistema. Se comprimieron relay/forks, espejo LAN, allowlists, ámbito global, ciclo de vida del bridge y conocimiento. **La regla madre de WhatsApp no se tocó** (seguridad crítica). Antes de quitar nada se verificó que el detalle estaba en su ficha; el aviso de descarte de allowlists (`pickDropped`/`warnings`) NO estaba y se mudó a `bugs/bug_lan_allowlist_urls_publicas_2026_08_13.md` primero.

## Notas operativas

- **Para pruebas de varios días, desplegar a `/Applications`** — dev es solo para verificación puntual. Luismi no puede tener una sesión de dev abierta horas.
- **El script de deploy dice "✅ abierto" aunque la app se haya suicidado**: si hay una dev viva, sobrevive a su kill, retiene el `SingletonLock` y la empaquetada muere en silencio. Verificar SIEMPRE con `npm run verify` (proceso + lock) después de desplegar.
- Un `<script src>` nuevo en `index.html` comparte ámbito global con `renderer.js`: nada de `const`/`let`/destructuring que repita un nombre. Lo vigila `tests/renderer-global-scope-collisions.test.js`.
- `tests/telegram-relay-concurrent-turns.test.js:87` es **sensible a timing**: si falla suelto, repetir antes de investigar.
- Node del sistema v24.13.0; el CI usa 20.18.0.
