# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre.

_Última actualización: 2026-08-07 (verificado contra git)._

## Estado de entrega (verificado)

- Rama `main` lista para sincronizar con `origin/main`; este cierre guarda también la memoria y la decisión LAN/remoto.
- Último commit funcional: `0509e5d feat(lan): secure remote project and session access`.
- Tests: `1300` totales, `1294` pass, `0` fail, `6` skip.
- Deploy: el commit está pusheado, pero `/Applications/POWER-AGENT.app` no se ha redeployado. La app de desarrollo sí está abierta desde Terminal con el repositorio actual.
- Acceso exterior: no activo. `cloudflared` no está instalado y no hay configuración Cloudflare en este Mac.

## Última sesión

- Se completó el acceso LAN/remoto seguro para móvil, tablet, otros PCs y equipos multioperador.
- El cliente LAN permite elegir proyecto autorizado y sesión antes de entrar; las sesiones se pueden cambiar en caliente y cambiar de proyecto requiere desconectar.
- El servidor usa un catálogo efímero de proyectos por conexión, valida roots permitidas y nunca acepta un `cwd` arbitrario enviado por el navegador.
- Las invitaciones duran 10 minutos, admiten hasta 3 aperturas y no incluyen el Bearer permanente en la URL compartida.
- Las URLs exteriores se normalizan únicamente como `HTTPS/WSS`.
- Se añadieron pruebas de configuración LAN, invitaciones, Bearer y selección proyecto/sesión.

## Próximo paso

- Probar primero en la misma Wi‑Fi: Ajustes → Modo servidor LAN → activar → guardar → abrir la URL Cliente desde el móvil.
- Para probar una conversación concreta, usar «Copiar invitación de la sesión actual».
- Configurar Cloudflare Tunnel + Access para el acceso desde datos móviles, sin abrir puertos del router. Hace falta un dominio y crear el túnel en Cloudflare.
- Tras validar manualmente, cerrar la instancia dev antes de ejecutar `npm run deploy`; no desplegar sin prueba viva.

## Notas operativas

- El servidor LAN permanece detenido por defecto. Al activarlo genera/persiste el Bearer y escucha HTTP en `puerto + 1` y WebSocket en `puerto`.
- Configuración exterior prevista: `agent.<dominio>` → `127.0.0.1:10000` y `agent-ws.<dominio>` → `127.0.0.1:9999`; proteger ambos hostnames con Cloudflare Access y política Allow solo para el equipo.
- No usar Quick Tunnel como solución permanente de equipo.
- Antes de desplegar, cerrar POWER-AGENT dev para evitar `SingletonLock`; verificar el contenido del asar después del deploy.
- Reglas duras heredadas: WhatsApp siempre con `X-Auth-Token` y prefijo internacional; Electron 32 sin `File.path`; state crítico mediante `main/atomic-writes.js`; no ampliar `WA_SAFE_CONFIG_FIELDS`.
