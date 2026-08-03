# El bridge de Baileys entra en git

_2026-08-03. Decisión de Luismi tras el bug del QR._

## Por qué

El bridge llevaba meses corriendo desde `~/.claude/whatsapp-bridge/`, que no es un repo. Cada arreglo se hacía **a mano sobre el fichero en producción**, con copias `index.js.bak.<fecha>` en la misma carpeta como único respaldo. Un borrado o un backup viejo restaurado se llevaba trabajo que no estaba en ningún sitio — incluido, ese mismo día, el arreglo del QR.

## Cómo queda

**Fuente de verdad: `whatsapp-bridge/` en el repo.** Se versiona solo el código:

```
index.js  auth.js  package.json  package-lock.json  whatsapp-bridge-cli.sh  wa-send.cjs  README.md
```

**Nunca a git** (se quedan solo en el runtime): `.auth-token`, `.baileys_auth/`, `config.json` (lleva `ownerNumber`, teléfono real), `state.json`, `kb-audit.jsonl`, `kb/`, `persona.md`, `media/`.

Verificado antes de subir: no hay secretos embebidos en el código.

## Regla operativa

**Editar en el repo y desplegar. Nunca editar directo en el runtime** — vuelven a divergir las dos copias, que es exactamente el problema que esto resuelve.

```bash
scripts/deploy-wa-bridge.sh
```

Hace backup de lo que pisa (`.bak.<timestamp>`), copia el código, comprueba sintaxis, reinicia el servicio por `launchctl kickstart` y consulta `/status`. No toca el estado ni los secretos.

La carpeta **no entra en `build.files`** del `package.json`, así que no se empaqueta con la app Electron. Correcto: el bridge es un servicio aparte gestionado por launchd (`com.luismi.whatsapp-bridge`).

## Consecuencia para memorias viejas

`~/.claude/CLAUDE.md` decía "el bridge está fuera de git, cambios con backup `.bak` a mano". **Ya no aplica** — corregido en esta misma sesión.
