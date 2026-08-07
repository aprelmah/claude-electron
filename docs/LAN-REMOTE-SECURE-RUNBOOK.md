# Acceso LAN y remoto seguro

## Qué queda activado

- En la red local, POWER-AGENT sigue sirviendo el cliente HTTP en `puerto + 1`
  y WebSocket en `puerto`.
- La opción **Copiar invitación de la sesión actual** crea un enlace temporal
  de 10 minutos y hasta 3 aperturas. El token vive solo en memoria y se borra
  al detener el servidor.
- El cliente remoto puede elegir un proyecto autorizado y una sesión con el
  selector persistente antes de entrar; las sesiones se pueden cambiar en
  caliente y el cambio de proyecto requiere desconectar primero. El servidor
  mantiene bloqueo por sesión para evitar dos operadores escribiendo a la
  misma conversación.

## Exponerlo fuera de casa

Usa Cloudflare Tunnel + Cloudflare Access. No hagas port-forwarding del router
ni publiques directamente los puertos 9999/10000.

1. Crea un túnel administrado en Cloudflare y dos hostnames, por ejemplo:
   `agent.example.com` para el cliente y `agent-ws.example.com` para WebSocket.
2. Configura las dos rutas del túnel hacia el Mac:

   ```yaml
   ingress:
     - hostname: agent.example.com
       service: http://127.0.0.1:10000
     - hostname: agent-ws.example.com
       service: http://127.0.0.1:9999
     - service: http_status:404
   ```

3. En Cloudflare Access crea aplicaciones self-hosted para ambos hostnames y
   añade una política `Allow` únicamente para las cuentas del equipo. La
   política debe quedar denegada por defecto para el resto.
4. En POWER-AGENT, dentro de **Modo servidor LAN**, guarda:

   ```text
   URL pública del cliente: https://agent.example.com/lan-client.html
   URL pública WebSocket:   wss://agent-ws.example.com
   ```

5. Activa el servidor LAN y prueba primero desde el móvil con datos móviles.
   La invitación seguirá llevando un segundo token de POWER-AGENT, además de
   la identidad de Cloudflare Access.

Cloudflare Tunnel realiza la conexión de salida desde el Mac, por lo que no
necesita IP pública fija ni puertos entrantes en el router. Cloudflare Tunnel
admite WebSockets; aun así, la prueba desde fuera debe hacerse antes de
compartir el enlace con el equipo.

## Operación segura

- Comparte una invitación, no la URL base ni el token Bearer de configuración.
- Si una invitación se filtra, detén y vuelve a activar el servidor LAN para
  invalidar las invitaciones pendientes; después genera una nueva.
- En modo empresa, el proyecto invitado debe estar dentro de las carpetas
  autorizadas del perfil/rol. El servidor rechaza una invitación fuera de esas
  raíces.
- La primera versión abre una copia aislada por worktree cuando está activado
  el aislamiento Git. No edites a la vez la misma conversación desde dos
  operadores sin coordinarlo: el bloqueo evita el doble acceso remoto, pero no
  convierte dos procesos de CLI en una sesión colaborativa simultánea.
