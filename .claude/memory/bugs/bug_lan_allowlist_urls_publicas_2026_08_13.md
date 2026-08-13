# Bug: las URLs públicas del túnel se borraban al guardar (allowlist SAFE_LAN)

Fecha: 2026-08-13
Commit del fix: `4ff868b`

## Síntoma

En Ajustes → Modo servidor LAN, Luismi pegaba "URL pública del cliente" y "URL
pública WebSocket", pulsaba Guardar y **los dos campos volvían vacíos**. Sin
ellos, la invitación de sesión se sigue generando con la IP local
(`192.168.0.236`), que desde datos móviles no existe.

## Causa

`main.js`, handler `save-app-config`:

```js
const SAFE_LAN = ['enabled', 'port']
...
lanServer: { ...appConfig.lanServer, ...pick(partial.lanServer, SAFE_LAN) }
```

El renderer sí enviaba las dos URLs (`renderer.js:2947`), pero `pick` solo copia
las claves de la allowlist: las descartaba **sin error y sin aviso**. La
validación de destino ya existía y era correcta (`normalizeLanPublicUrl` en
`main/config-store.js:253`, solo `https:` para el cliente y `wss:` para el WS),
nunca llegó a ejecutarse.

Vivo desde el 2026-08-07 (`0509e5d`), invisible porque hasta hoy nunca se había
configurado un túnel: la propia decisión de aquel día cerraba con "`cloudflared`
no está instalado/configurado todavía".

## Fix

Las tres allowlists salen del handler a `main/app-config-allowlists.js`
(`SAFE_CLI`, `SAFE_TELEGRAM`, `SAFE_LAN`, `pick`) y `SAFE_LAN` gana
`publicClientUrl` y `publicWsUrl`. `authToken` sigue fuera a propósito: lo
genera y persiste main, no se acepta desde el renderer.

Cobertura nueva en `tests/app-config-allowlists.test.js` (8 tests): la
regresión, que `authToken` nunca pasa, que un string vacío SÍ pasa (vaciar el
campo es la forma de dejar de publicar fuera), y que `pick` no hereda del
prototipo.

## Lecciones

**Una allowlist que descarta en silencio es una trampa.** No hay error, no hay
log: el campo simplemente desaparece y la UI parece rota. Regla vigente: campo
de config nuevo enviado por el renderer → a la allowlist, o no existe. Ahora
tiene tests porque la omisión no da síntoma en tiempo de ejecución.

**Sacar la constante del handler fue lo que la hizo testeable.** Dentro de
`main.js` no hay forma de cubrirla: el fichero no se puede `require` sin
Electron.

## Falso positivo que costó tres vueltas

Después del fix, "Copiar invitación" seguía dando un `wss://…` pelado. No era
un bug del enlace: `createLanSessionInvite` devolvía `ok: false` con "Habla al
menos una vez antes de compartir esta sesión" (`main.js:863`, la sesión no
tenía `semanticSessionId`), así que `copyText` **nunca se ejecutaba** y el
portapapeles conservaba lo que Luismi había copiado antes — precisamente la URL
del WebSocket que estaba pegando en Ajustes.

Regla de método: **un botón que falla sin copiar deja el portapapeles anterior,
y eso se lee como "copió mal" en vez de "no copió"**. Antes de perseguir el
contenido pegado, mirar la línea de estado del botón. En la captura el mensaje
estaba a la vista y se leyó como texto de ayuda fijo.

## Gotcha de verificación

`curl` a un WebSocket por HTTP/2 devuelve **426 Upgrade Required** y parece que
el túnel no soporta WebSockets. Hay que forzar `--http1.1`; entonces sale
`101 Switching Protocols` (o `401` sin Bearer, que también prueba que el
tráfico llega).
