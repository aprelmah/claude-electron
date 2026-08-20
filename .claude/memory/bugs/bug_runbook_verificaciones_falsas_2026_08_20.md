# Dos verificaciones del runbook que nunca funcionaron (2026-08-20)

Commit del fix: `a3ee550`. Los dos se midieron en vivo, con la app empaquetada corriendo.

## El bug

El "Protocolo de despliegue y prueba" del runbook tenía dos comandos que llevaban meses
dando la respuesta equivocada. Nadie lo notó porque **se leían, no se ejecutaban**: los
agentes copiaban el bloque, veían salida plausible y seguían.

### 1. El lock huérfano nunca se limpiaba

```bash
[ -e "$UD/SingletonLock" ] && ! pgrep -f "..." && rm -f "$UD/SingletonLock" ...
```

`SingletonLock` es un **symlink colgante**: apunta a `<hostname>-<pid>`, que no existe como
fichero. `[ -e ]` sigue el enlace, no encuentra destino y da FALSE **con el lock puesto**.
Medido con el lock presente: `-e` → NO, `-L` → SÍ.

Consecuencia: el paso 2 del protocolo era decorativo. Cada vez que se limpió un lock
huérfano en esta máquina fue a mano, no por ese comando.

Bonus del `-L`: el pid va dentro del target del symlink, así que se distingue lock legítimo
de huérfano **con certeza** (`ps -p` sobre ese pid), sin heurística de "¿habrá algo vivo?".

### 2. La empaquetada no se veía por ningún lado

```bash
ps aux | grep electron | grep -v grep
```

El binario de la app empaquetada se llama **POWER-AGENT**, no `electron`. Medido con la app
corriendo (pid 45846): ese grep devolvía **solo Docker**.

Ese comando sí sirve para la instancia de DEV (que corre `node_modules/electron/...`), y ahí
estaba bien. El problema es que la regla de deploy —"verificar por PROCESO con ventana
(`--type=renderer`)", que existe justo porque la empaquetada se suicida en silencio— no tenía
ningún comando válido para mirar la empaquetada. Se añade:

```bash
ps -Awwo args= | grep "[P]OWER-AGENT.app/Contents" | grep -o "\-\-type=[a-z-]*" | sort | uniq -c
```

(`-Awwo args=` para no depender del ancho del terminal, que trunca y esconde el `--type=`.)

## La lección

**Una verificación que no se ejecuta no verifica.** Estos dos comandos vivían en el runbook
como si fueran garantías, y durante meses lo que garantizaban era la sensación de haber
comprobado. El fallo no fue escribirlos mal: fue que nada los ejecutaba nunca de verdad.

Por eso la respuesta no es solo corregirlos, sino `npm run verify`
(`tech/tech_verify_script_2026_08_20.md`): lo que se ejecuta se puede desmentir, y los cuatro
invariantes que costaron medir están ahora fijados con tests. La prosa no falla nunca —
por eso no sirve de garantía.

## Cómo se destapó

Encargando a un agente el diseño de `verify.sh` con una instrucción explícita: **medir cada
comando en esta máquina antes de proponerlo**, no copiarlo del runbook. Los dos fallos
salieron en la primera pasada de medición.
