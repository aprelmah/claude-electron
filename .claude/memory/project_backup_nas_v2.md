---
name: project-backup-nas-v2
description: "Estado del backup automático Mac → NAS QNAP, reconstruido vía POWER-AGENT Automatizaciones (2026-05-16)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2e9c12d6-032c-4786-b2bc-824f09b1e89f
---

# Backup NAS — V2 (POWER-AGENT Automatizaciones)

**Reemplaza al script viejo `~/backup_nas.sh`** (que llevaba roto desde el 14 mayo cuando se borró `~/.claude/telegram-bridge/` con el script dentro).

## Estado actual (2026-05-16)

- **Automation en POWER-AGENT**: slug `copia-nas` (originalmente "Backup snapshots LUISMI al NAS").
- **Script**: `~/Library/PowerAgent/automations/copia-nas.sh`.
- **Plist**: `~/Library/LaunchAgents/com.luismi.poweragent.copia-nas.plist`.
- **Log**: `~/Library/PowerAgent/automations/logs/copia-nas.log`.
- **Programado**: cada día a las **03:00** vía launchd (`StartCalendarInterval`).

## Origen y destino

- Origen: `/Users/isabel/Desktop/LUISMI/`.
- Destino: NAS QNAP 192.168.1.156, share `Public`, ruta `Mac temas luismi/snapshots/YYYY-MM-DD/`.
- Mount: `~/.cache/nas_mount` (montado por el propio script si no está, desmontado al terminar si lo montó él).

## Estrategia: snapshots tipo Time Machine

- Cada día crea una subcarpeta nueva `snapshots/2026-MM-DD/`.
- Si hay snapshot del día anterior: rsync con `--link-dest` → archivos no modificados son **hardlinks**, no duplicar bytes. Cada día ocupa solo lo nuevo+modificado.
- Si NO hay snapshot previo: copia completa (~1,25 GB / 10.699 archivos).
- Retención: 60 últimos snapshots. Los más antiguos se borran con safety net (case match `YYYY-MM-DD`, validar que el path está bajo `snapshots/`).

## Patrones aplicados (todos en [[tech_macos_bash_rsync_landmines]])

- Bash 3.2 safe: `while IFS= read -r` (no mapfile), comillas dobles, `${arr[@]+"${arr[@]}"}` para arrays opcionales.
- rsync 2.6.9 BSD: SOLO `-a --partial --ignore-errors --stats --timeout=120`. **NO `-H -A -X`, NO `--info=progress2`, NO `--contimeout`**.
- `python3` para parsear el JSON de config Telegram (NO `jq`).
- Lockfile con `mkdir` atómico (NO `flock`).
- Watchdog global con `MAX_RUNTIME=2700` (45 min).
- Pass del NAS desde Keychain: `security find-generic-password -s "NAS QNAP - 192.168.1.156" -w`. URL-encode con python3 antes de mount_smbfs.
- launchctl moderno (`bootstrap`/`bootout`/`kickstart`, NO `load`/`unload`). Ver [[tech_launchctl_modern]].
- Plist con `repairPlist` automático en generator (ver [[tech_llm_plist_truncation]]).

## Estado al cerrar la sesión 2026-05-16

- ✅ Primera copia 2026-05-16 OK (1,25 GB / 10.699 archivos).
- ✅ Notificación Telegram OK funciona desde la corrida 10:33.
- ⚠️ Segunda corrida (13:16) se quedó zombie 32 min por SMB colgado SIN timeout en rsync → matada a mano.
- ✅ Tras el incidente, script parcheado con `--timeout=120` + watchdog 45 min. Skill actualizada.
- ❌ Pendiente: bug UI POWER-AGENT — "Parar ejecución" no refresca el spinner en la lista (la corrida sí se para, solo la UI miente). Ver [[project_power_agent]].

## Próxima ejecución programada

Madrugada **2026-05-17 a las 03:00**. Esa será la primera vez que use `--link-dest` apuntando al snapshot del 16. Esperado: 1-5 min (incremental) y ocupación marginal en disco del NAS.

## Si vuelve a fallar

1. Mirar log: `tail -50 ~/Library/PowerAgent/automations/logs/copia-nas.log`.
2. Si el log dice rsync zombie sin progreso: el watchdog ya debería haberlo matado en 45 min.
3. Si Telegram avisa de FALLO: abrir chat del agente en POWER-AGENT y pegar el log.
4. NUNCA reinstalar la automation desde el chat agente — el chat agente destruyó el script el 16 mayo. Mejor: retirar desde la UI, generar de cero con la descripción guardada.

## Descripción canónica para regenerar (si hace falta)

Guardada en el chat con Claude del 2026-05-16 (sesión `e188c52a-1ee0-452b-8f86-bfb20867ab9d`). Esencia: snapshots tipo Time Machine + `--link-dest` + retención 60 + Telegram via POWER-AGENT config + bash 3.2 + rsync 2.6.9 + python3 (no jq) + watchdog + timeouts.
