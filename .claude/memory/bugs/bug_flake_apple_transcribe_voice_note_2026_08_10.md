# Bug — flake intermitente en apple-transcribe.test.js / voice-note.test.js

Detectado y confirmado 2026-08-10 (sesión "notebook de conocimiento"). Sin resolver — solo documentado.

## Síntoma

`npm test` (o el pre-commit hook, mismo comando) sale a veces con exit code 1 pese a `# fail 0` en el resumen TAP. La causa son entradas `failureType: 'cancelledByParent'` con `error: 'Promise resolution is still pending but the event loop has already resolved'`, siempre confinadas a `tests/apple-transcribe.test.js` y `tests/voice-note.test.js` (subtests de timeout del helper de voz/transcripción).

## Confirmado NO relacionado con el código que se está tocando

- Reproducido 3/3 en runs manuales consecutivos sobre un `HEAD` limpio, sin relación con los ficheros tocados en esa sesión (`git log` confirma que ni `apple-transcribe.test.js` ni `voice-note.test.js` fueron tocados por ningún commit de esa rama).
- Parece depender de la carga del sistema en el momento exacto del run: en la misma sesión, unas veces salió limpio (`0 cancelled`) y otras no (`17 cancelled`), sin cambiar una sola línea de código entre intentos.
- Usado dos veces `git commit --no-verify` por esta causa (autorizado por el controller cada vez, documentado en el cuerpo de esos commits): `770c3c1` y `6902648` de la rama `feature/kb-notebook-window`.

## Hipótesis (sin confirmar)

Un timer/mock de esos dos tests de "timeout si el helper no contesta" compite con el propio timeout del test runner bajo carga alta — el mock nunca resuelve, y cuando el runner corta por su cuenta, Node marca el subtest como `cancelledByParent` en vez de fallo limpio.

## Qué hacer si reaparece

- Comprobar `# fail 0` en el resumen: si el único problema son estos dos ficheros con `cancelledByParent`, es este bug — reintentar el commit 2-3 veces antes de escalar.
- `--no-verify` puntual está justificado SOLO si se confirma que el fallo es exclusivamente esto (no basta con "el hook falló", hay que mirar el resumen).
- No se ha investigado la causa raíz en el propio `apple-transcribe.test.js`/`voice-note.test.js` — sería el siguiente paso si esto sigue mordiendo.

Relacionado: [[runbook_kb_conocimiento]] (mencionado en el cierre de esa sesión).
