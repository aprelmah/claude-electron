# `npm run verify` — la Definition of Done, ejecutable (2026-08-20)

Commit: `b9107aa`. Ficheros: `scripts/verify.sh`, `tests/verify-script.test.js`.

## Qué es

El protocolo de deploy vivía como checklist en prosa dentro del runbook: matar instancias,
mirar el `ps`, comprobar el asar, el lock. Cada paso dependía de que el agente de turno lo
leyera entero y no se saltara ninguno — y dos de esos comandos llevaban meses mintiendo
(`bugs/bug_runbook_verificaciones_falsas_2026_08_20.md`). Ahora es un comando: **1,7 s,
exit 0/1**.

```bash
npm run verify            # rápido
npm run verify -- --full  # + suite completa + sync con origin (es red)
npm run verify -- --quiet # solo veredicto y líneas KO
```

Comprueba: sintaxis del árbol entero (140 ficheros), huérfanos en la whitelist
`build.files`, deploy al día (timestamp + 3 canarios por contenido contra HEAD), proceso
dev/empaquetada con o sin ventana, lock huérfano, y el estado del bridge de WhatsApp
(informativo, jamás lo toca). `WARN` no cambia el exit; solo `KO` devuelve 1.

## Solo lectura, por construcción

No mata procesos, no borra locks, no despliega, no toca el bridge. Y no es una promesa:
`tests/verify-script.test.js` hace grep de 15 verbos destructivos sobre el fichero
(`pkill`, `kill`, `rm -rf`, `git reset/checkout/clean/stash`, `launchctl bootout/enable/
disable/kickstart`, `npm run deploy`, `osascript`). Si alguien "mejora" el script metiéndole
un `rm` del lock, la suite lo para.

Eso tuvo una consecuencia de diseño: el asar se lee con la **API de `@electron/asar`, en
memoria**, no con la CLI `extract-file`. La CLI extrae al cwd (el pie de 2026-08-09 que borró
`main.js` de la raíz), así que habría hecho falta un `mktemp -d` y limpiarlo después — es
decir, un `rm -rf` dentro del script, justo el verbo prohibido. Leyendo en memoria no hay
cwd que ensuciar ni nada que borrar: **el invariante se garantiza por estructura, no por
disciplina.**

## Los cuatro invariantes medidos (los fija el test)

Cada uno costó una medición y cada uno habría dado un resultado falso:

1. **`[ -L ]` para el `SingletonLock`**, nunca `[ -e ]` — es un symlink colgante.
2. **Normalizar los pathspec de `build.files`** quitando `/**/*` y `/**`. En el pathspec de
   git el `*` cruza `/`, así que `main/**/*` exige una segunda barra y **no matchea nada**:
   `git log -1 -- 'main/**/*'` sale vacío y `-- 'main'` da el commit. Sin normalizar, el
   check de deploy habría dicho "al día" con el asar anterior al fix del bridge. Es el
   **falso OK**, el más peligroso de los dos sentidos.
3. **Detectar la empaquetada por la ruta del bundle**, jamás por `grep electron`.
4. **Comparar el asar contra el último commit que toca código EMPAQUETADO**, no contra HEAD.
   HEAD suele ser un `docs(...)` sobre `.claude/memory/` y daría "desfasado" siendo correcto.
   La lista de qué es empaquetado sale de `build.files`, así que se automantiene.

## Trampas del entorno (medidas, no supuestas)

- El Mac tiene **bash 3.2.57**: sin `globstar`. `for f in main/**/*.js` no expande y deja el
  literal. Obligatorio `find`.
- **No hay `timeout` ni `gtimeout`**. Se decidió NO meter watchdog: exigiría matar un hijo
  propio y la garantía "este script no mata nada" tiene que ser verificable con un grep, sin
  matices. Si la suite se cuelga, se corta a mano.
- El check de sintaxis compila con `vm.Script` + el wrapper de CommonJS en **un solo proceso**
  (0,29 s) en vez de 140 `node --check` (12,8 s). El wrapper no es opcional: sin él, un
  `return` de nivel superior —legal en CJS— daría falso positivo.
- Sin `node_modules/` (worktree de sesión) la suite da decenas de `MODULE_NOT_FOUND` que no
  son regresiones: ahí el check de tests es **WARN + skip**, no KO.

## Comprobado que muerde

Con un `.js` roto y sin declarar en la raíz: **2 KO** (sintaxis + huérfano) y exit 1. Con
`pkill -9` y `rm -rf` inyectados en el script: el blindaje falla 2 tests. Un check que solo
pinta OK no vale nada — hay que verlo dar KO al menos una vez.
