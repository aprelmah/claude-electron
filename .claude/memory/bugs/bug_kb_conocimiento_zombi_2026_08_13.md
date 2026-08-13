# Bug — el conocimiento borrado del panel 📚 resucitaba en la sesión siguiente

Fecha: 2026-08-13. Severidad: la peor posible del producto. El experto SAT de turbo e
respondía a instaladores eléctricos con fichas que Luismi había retirado — instrucciones
sobre instalaciones reales, sacadas de conocimiento derogado.

## Síntoma

Luismi borra fichas y casos; en la siguiente sesión el agente las tiene otra vez.

## Evidencia recogida (no hipótesis)

En `/Users/isabel/Desktop/turbo e`:

- `git status --short` → 10 fichas como ` D` (borradas en disco, borrado sin commitear) y
  `CLAUDE.md` con los 9 imports sustituidos por `(vacío — pendiente de cargar las nuevas
  fichas en kb/fichas/)`.
- Último commit `d862d7f` del 2026-08-10 19:04; mtime del borrado 2026-08-11 16:55 → 21 h
  después y sin commit asociado.
- **Ese texto placeholder NO existe en el código de la app** (`grep` en `main/`, `renderer.js`,
  raíz): no lo escribió el panel.

En los transcripts (`~/.claude/projects/-Users-isabel-Desktop-turbo-e/58df801f-*.jsonl`,
sesión arrancada 16:52 **en un worktree** — su transcript vive también bajo
`...worktrees-turbo-e-01caf6-msos457v-dc4c8a`):

```
16:53:28 USER  necesito que borres las fichas y atajos que hay en kb de este proyecto
16:55:30 Bash  cd "/Users/isabel/Desktop/turbo e" && rm -f kb/fichas/*.md
16:55:45 Edit  /Users/isabel/Desktop/turbo e/CLAUDE.md  (imports → placeholder)
```

Coincide al segundo con los mtimes (`kb/fichas` 16:55:32, `CLAUDE.md` 16:55:45).

**Veredicto**: el borrado se hizo FUERA del panel, por un agente de sesión. Descartadas
las hipótesis (b) "una ruta del panel no comitea" y (c) "commitKbChanges falló en
silencio" — el panel no intervino.

## Causa raíz

`main/session-git.js` crea el worktree de cada sesión con `git worktree add -b <branch>
<path> HEAD`. **Nace de HEAD**, así que ningún cambio sin commitear del working tree real
existe para la sesión. HEAD seguía conteniendo las 10 fichas y el CLAUDE.md con imports →
el agente las cargaba precargadas.

Es la regla ya conocida ("worktree + conocimiento sin commitear = experto invisible") en su
cara letal: **un borrado sin commitear es inmortal**.

Agravante de diseño: el CLAUDE.md de turbo e instruye al agente a escribir en la ruta REAL
cuando trabaja en un worktree (correcto, si no el cambio se pierde al finalizar), pero eso
deja el repo real sucio y sin commit — justo el estado que revive el conocimiento.

## Fix (commits `7da86fe` + `6563cc2`)

El invariante se garantiza **donde nace el worktree**, no en cada escritura: hay al menos
tres vías de borrar conocimiento (panel, agente de sesión, Finder/terminal) y parchear
rutas nunca las cubre todas.

- `main/kb-git.js`: `hasPendingKbChanges()` (`git status --porcelain -- CLAUDE.md kb`;
  `status` tolera pathspecs inexistentes, a diferencia de `add`) y `ensureKbCommitted()`,
  que a diferencia del best-effort del panel devuelve `ok:false` si lo pendiente no llega
  a HEAD.
- `commitKbChanges` pasa a `git commit --no-verify`: el conocimiento no es código y un
  pre-commit del proyecto destino bloqueando el commit dejaría el borrado fuera de HEAD —
  exactamente el bug.
- `main/session-git.js`: `prepareSessionWorkspace` llama a `ensureKbCommitted` antes del
  `worktree add`. Acotado a `CLAUDE.md`+`kb/`, **nunca `-A`**: el código a medias del
  usuario no se toca (verificado en la app real: `codigo.js` seguía ` M` tras el arranque).
- Si ese commit no es posible → **no se crea worktree**, la sesión arranca en el cwd real
  (donde el disco es la verdad) y avisa (`onDegraded` → `notifyKbNotCommitted` en `main.js`).
  Degradar es mejor que aislar con datos viejos: un worktree obsoleto miente.
- `main/kb-ipc.js` + `kb-panel.js`: las 7 llamadas propagan `commitWarning` y el panel lo
  canta. El 🗑 de fichas descartaba la respuesta entera, ni miraba `res.ok`.

Estado de turbo e reparado con `fada081` (el borrado del 11-ago, por fin en HEAD).

## Verificación en la app real (CDP, dev)

Repo de prueba replicando el caso (ficha commiteada + borrada en disco + `codigo.js` a medias):

- worktree creado **sin** la ficha zombi y con el CLAUDE.md sin imports; commit `kb:
  conocimiento al día antes de aislar la sesión` en el repo real; `codigo.js` intacto.
- con `.git/index.lock` puesto: **cero worktrees nuevos** y las dos líneas de aviso en el
  log (`[session-git] conocimiento pendiente sin commitear…` + el mensaje de usuario).
- `kb.toggle` con lock → `{"ok":true,"commitWarning":"Guardado en disco, pero git no lo
  registró: …"}`; sin lock → `{"ok":true}`.

## Lección de método (costó dos intentos)

`pty-start` es **idempotente**: si la ventana ya tiene PTY, devuelve el cwd existente sin
volver a pasar por `prepareSessionWorkspace`. Mis dos primeras pruebas A/B "demostraban"
la degradación (no aparecía worktree nuevo) cuando en realidad el código ni se ejecutaba —
y delataba el fallo la ausencia del log del aviso, que interpreté como bug en vez de como
prueba mal montada. **Un A/B que no controla el estado previo no prueba nada**: para
verificar el arranque de sesión hay que relanzar la app limpia y montar el PTY desde cero.

Segundo detalle: el explorador de archivos rechazó el repo de prueba con "Path not
allowed" — `allowedFsRoots()` (`main.js:511`) solo permite `~/.claude`, `~/.codex`,
`userData`, `/tmp/claude-electron` y los cwd de sesiones VIVAS. Artefacto de montar PTYs
por API saltándose el picker, no un bug.

## Límite conocido (no arreglado)

Una sesión YA abierta en worktree no ve un borrado posterior: el fix cubre la sesión
siguiente, que es el síntoma reportado. Arreglar el caso en caliente exigiría sincronizar
el worktree vivo, decisión no tomada.
