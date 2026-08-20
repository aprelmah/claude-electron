# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-20 tarde (verificado contra git, filesystem y `npm run verify` en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`git ls-remote origin main` → `b9107aa`, igual que HEAD local; sin ahead/behind). Working tree limpio salvo la memoria de este cierre.
- Últimos commits: `b9107aa feat(verify): npm run verify — la Definition of Done, ejecutable`, `8ad969d docs(runbook): la regla madre de WhatsApp ya tiene un mecanismo debajo`, `a3ee550 fix(runbook): dos comandos de verificación que nunca funcionaron`.
- Tests: **1652 pass, 0 fail, 6 skipped** (1635 + 17 del blindaje de verify). Suite completa en el pre-commit de los tres commits, Node del sistema v24.13.0.
- **`npm run verify` → VEREDICTO OK (0 KO · 0 WARN · 6 OK)** en 1,7 s. Es la nueva foto rápida: sintaxis de 140 ficheros, huérfanos de `build.files`, deploy al día, proceso, lock y bridge.
- Deploy: `/Applications/POWER-AGENT.app` v1.3.0, asar del **2026-08-17 17:38** ≥ último commit de código empaquetado (`8b544b9`, 17:26) y **3/3 canarios idénticos a HEAD**. Los commits de hoy no tocan código empaquetado (runbook, script de dev y tests), así que el asar sigue al día: no hace falta redeploy.
- App corriendo **con ventana** (pid 99510, `--type=renderer` presente), sin dev viva. Se cerró y relanzó en esta sesión: el `quit` ordenado retiró el `SingletonLock` solo.
- **Bridge de WhatsApp: APAGADO y deshabilitado** (launchd `=> true`, no cargado, 3031 libre). Sigue siendo el estado que Luismi quiere por defecto.

## Última sesión (2026-08-20 — el harness deja de ser prosa)

- Auditoría del harness a petición de Luismi. Diagnóstico: tenía mucha regla escrita al modelo y pocos mecanismos. Se cerraron tres huecos y se instrumentó el resto.
- **Dos comandos del protocolo de deploy llevaban meses mintiendo** y nadie lo vio porque se leían en vez de ejecutarse: `[ -e ]` sobre `SingletonLock` (es un symlink colgante: da FALSE con el lock puesto) y `ps aux | grep electron` (no ve la empaquetada, cuyo binario se llama POWER-AGENT). Corregidos en `a3ee550`. Ficha: `bugs/bug_runbook_verificaciones_falsas_2026_08_20.md`.
- **`npm run verify`** (`b9107aa`): la checklist en prosa del runbook, hecha comando. Solo lectura por construcción, blindada con un test que prohíbe 15 verbos destructivos. Ficha: `tech/tech_verify_script_2026_08_20.md`.
- **Barandillas globales** (fuera del repo, en `~/.claude/hooks/`, respaldadas en `aprelmah/claude-skills-luismi` commit `b328423`): hook de sintaxis en PostToolUse, y el guard de WhatsApp que convierte la regla madre en mecanismo. Documentado en `~/claude-shared/memory/01-infra.md` y en el skill `/harness`.
- Verificado en vivo, no por lectura: el hook de sintaxis bloqueó un `.js` roto escrito a propósito; el guard bloqueó un `wa:send` y un `Write` al sello.

## Próximo paso

- Nada urgente. Cuando toque: **poda del runbook** — `AGENTS.md` está en 20 KB, por encima del umbral de ~15 KB del contrato de capas. Candidata: la sección "Protocolo de despliegue y prueba" (~2,5 KB de bloques bash) ahora que `npm run verify` hace ese trabajo; se mudaría a `tech/runbook_deploy_verificacion.md` dejando el porqué y un puntero. **Propuesta, no aprobada.**
- Evals de skills: pospuesto a propósito hasta tener datos de uso reales en el log del harness.

## Notas operativas

- **`npm run verify` antes de dar nada por bueno.** Con `--full` añade la suite y el sync con origin. No mata procesos, no borra locks, no despliega: si algo hay que arreglar, lo dice y lo arreglas tú.
- El guard de WhatsApp bloquea cualquier comando que mencione la ruta del sello, aunque sea inocente (falla cerrado, es deliberado). Rodeo: meter el script en un fichero — el guard mira el comando, no el contenido.
- `tests/telegram-relay-concurrent-turns.test.js:87` es **sensible a timing**: falló una vez bajo carga (varios agentes a la vez) y pasó en las tres corridas siguientes. Si falla suelto, repetir antes de investigar.
- Node del sistema v24.13.0; el CI usa 20.18.0.
