# Decisión: acceso LAN y remoto seguro

Fecha: 2026-08-07

## Decisión

POWER-AGENT mantiene un servidor LAN HTTP/WebSocket con Bearer obligatorio al
activarse. El acceso desde Internet se hará mediante Cloudflare Tunnel +
Cloudflare Access, sin abrir puertos entrantes del router y sin Tailscale.

## Alcance entregado

- Cliente responsive para móvil, tablet y PC.
- Selector remoto de proyecto y sesión.
- Catálogo de proyectos efímero por conexión, con IDs opacos y validación de
  roots autorizadas; el navegador no puede imponer un `cwd`.
- Invitaciones de sesión de 10 minutos y hasta 3 usos.
- La URL de invitación no contiene el Bearer permanente.
- Bloqueos por sesión para evitar escritura simultánea accidental.
- Las URLs públicas solo aceptan `https://` y `wss://`.

## Operación

En local se activa desde Ajustes → Modo servidor LAN, dejando el cliente en
`puerto + 1` y el WebSocket en `puerto`. Para compartir una conversación se
usa «Copiar invitación de la sesión actual».

Para Internet se prevén dos hostnames: uno al HTTP local `127.0.0.1:10000` y
otro al WebSocket local `127.0.0.1:9999`. Ambos deben quedar protegidos por
Cloudflare Access con una política Allow limitada al equipo.

## Estado al cerrar

- Commit: `0509e5d` pusheado a `origin/main`.
- Tests: `1300` totales, `1294` pass, `0` fail, `6` skip.
- `cloudflared` no está instalado/configurado todavía.
- `/Applications/POWER-AGENT.app` no contiene aún este commit; la app de
  desarrollo sí está abierta desde Terminal.

## Delta 2026-08-13 — probado en real, y dos matices

Ejecutado el pendiente "`cloudflared` no está instalado/configurado todavía":
instalado 2026.7.3 por brew y validado de punta a punta. El WebSocket
**atraviesa el túnel** (`101 Switching Protocols`) y una sesión real se abrió
desde el móvil con datos, sin abrir puertos del router.

Dos matices a lo decidido arriba:

1. **Quick Tunnel sí vale para asistencia efímera.** El "no usar Quick Tunnel"
   de esta decisión apuntaba a la *publicación permanente del equipo*, y ahí
   sigue vigente. Para un túnel que nace al crear un enlace y muere al
   cerrarlo, la URL cambiante es irrelevante: el enlace se genera en ese
   momento y se manda ya construido. Permite operar sin dominio.
2. **Cloudflare Access no aplica cuando el invitado es un cliente externo.**
   No tiene ni va a tener identidad en el equipo. Un hostname para clientes
   queda necesariamente público, con el invite como única llave — y por eso no
   puede apuntar al `ws-server` actual, que sirve el panel de operador con
   terminal. Ver `docs/superpowers/specs/2026-08-13-soporte-cliente-enlace-design.md`.

Bug encontrado al probarlo: las URLs públicas nunca se guardaban
(`bugs/bug_lan_allowlist_urls_publicas_2026_08_13.md`, commit `4ff868b`), así
que esta parte de la decisión llevaba inaplicable desde el día que se escribió.

## Riesgos y límites

- Cambiar de proyecto requiere desconectar la sesión activa; cambiar de sesión
  sí puede hacerse en caliente.
- No usar Quick Tunnel como publicación permanente del equipo.
- Antes de desplegar, cerrar la instancia dev para evitar `SingletonLock` y
  verificar el contenido del asar.
