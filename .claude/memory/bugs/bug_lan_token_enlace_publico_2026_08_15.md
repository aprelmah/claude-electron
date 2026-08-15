# El Bearer permanente viajaba dentro del enlace público del túnel

**Fecha**: 2026-08-15 · **Commit del fix**: `cdc392b` · **Detectado por**: `/code-review` sobre `4ff868b`

## El fallo

`buildClientUrl` (`main/ws-server.js`) terminaba así:

```js
if (tk && !extra.invite) url.searchParams.set('token', tk)
```

Ese append corría **después** de decidir la URL, así que se aplicaba igual a la URL LAN que a la
pública del túnel. Con `publicClientUrl` + `publicWsUrl` configurados, el enlace que devolvía
"Compartir" era:

```
https://<algo>.trycloudflare.com/?wsUrl=wss://…&token=<Bearer persistente de 64 chars>
```

Un enlace alcanzable desde internet con la llave completa del servidor LAN dentro. Quien lo viera
—captura, portapapeles, logs de acceso del túnel, historial del navegador del móvil del cliente—
tenía auth total y **permanente** sobre WS + HTTP. Contradecía el comentario que el propio código
tenía dos líneas más arriba: solo las invitaciones, que son capabilities temporales, deben salir.

Latente desde que existen las URLs públicas, pero **inalcanzable hasta el 13-ago**: hasta `4ff868b`
la allowlist `SAFE_LAN` descartaba esos dos campos, así que nunca llegaban a persistirse. Arreglar
el bug de la allowlist es lo que abrió este. Ver `bug_lan_allowlist_urls_publicas_2026_08_13.md`.

## El fix: estructura, no condición

No basta con añadir `&& !esPublica` al `if`. El `set('token')` se **movió dentro** de la rama que
construye la URL LAN:

```js
if (publicClient && publicWs && extra.invite) { /* URL pública, jamás token */ }
if (!url) {
  url = new URL(`http://${lanIp}:${httpPort}/lan-client.html`)
  …
  if (tk && !extra.invite) url.searchParams.set('token', tk)   // solo aquí
}
```

Así no queda **camino** por el que el Bearer alcance una URL pública, aunque alguien relaje el guard
más adelante. Un invariante que depende de que nadie toque un `if` no es un invariante.

Corolario de diseño: con túnel configurado y **sin** invite, se devuelve la URL LAN con token (enlace
de uso interno). Un enlace público sin credencial no sirve para nada y confunde.

## Regla que queda

**Ningún enlace que pueda salir a internet lleva credencial persistente. Solo invites.**

## Lección preventiva: verificar sin volcar el secreto

Verificando este mismo fix por CDP imprimí el `clientUrl` completo y **volqué el `authToken` de 64
chars en el transcript de la sesión**. Segunda vez en tres días (la primera, 2026-08-13). El token se
rotó acto seguido (`eaf89e70` → `92a093d4`, hashes de sha256 truncados), y las dos URLs muertas del
túnel se limpiaron de la config.

Al verificar cualquier cosa que devuelva URLs, config o cabeceras: **enmascarar antes de imprimir**.
Lo que interesa es el booleano, no el valor:

```js
const llevaToken = /[?&]token=/.test(url)   // esto es lo que se imprime
```

Nunca la URL entera. Aplica igual a logs, salidas de CDP y mensajes al usuario.

## Cómo rotar el token

Con la app **cerrada** (si no, la sobrescribe al guardar): reescribir `lanServer.authToken` en
`~/Library/Application Support/CLAUDE-NOVAK/claude-novak.config.json` con
`crypto.randomBytes(32).toString('hex')`, backup previo y `chmod 600`. El clasificador de permisos
bloquea que el agente escriba ahí — correcto: **lo ejecuta Luismi**.

## Enlaces

- Mecanismo del descarte mudo que lo mantenía latente: `bug_lan_allowlist_urls_publicas_2026_08_13.md`
- Por qué el handler no tenía cobertura: `tech/tech_logica_en_ipc_handle_sin_cobertura.md`
- Tests: `tests/ws-server-public-url.test.js` (10 casos, banda de puertos 13400-13600)
