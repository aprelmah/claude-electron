# Telegram manda sobre lo que haya abierto en el Mac

_2026-08-04. Regla fijada por Luismi._

## El bug

Elegías TURBO-ENERGY con `/proyecto`, escribías, y contestaba la sesión de **eatBook** que tenías abierta en la app — con el cwd de eatBook y `bypassPermissions`. No es cosmético: esa sesión puede leer y escribir ficheros del proyecto que no elegiste.

El bridge hacía bien su parte (al elegir proyecto deshace el binding de relay, borra los sessionId del chat y guarda el `chatCwd`). El agujero estaba en `main.js`: sin binding y sin sessionId, el enrutado caía en

```js
pickRelaySessionForChat(chatId, !binding.bound, 'claude')
```

que acaba en `pickRelaySession()` → la sesión primaria de la app, o cualquier otra sesión claude viva, **sin mirar el cwd**.

## Por qué parecía funcionar a veces

Luismi recordaba que "ayer funcionaba" y dudaba de su memoria. **Tenía razón**, verificado con git:

| Commit | Fecha | Qué hizo |
|---|---|---|
| `f4d2d61`, `c281a60` | 17-may | Introducen el fallback. Nunca miró el cwd |
| `12aae16` | 2-ago | El picker `/proyecto`. Solo tocó `telegram-bridge.js` |
| `870e658` | 2-ago | Mete `chatCwd` en main.js — **solo al camino headless** |

Así que `/proyecto` + `/sesiones` **sí** respetaba el proyecto (había sessionId → headless con `resolveResumeCwd`), y `/proyecto` a secas no. Le funcionó en el camino que probó.

## La regla

Literal, de Luismi:

> "si abro un proyecto o sesión desde Telegram se respeta independientemente de lo que tenga abierto en el Mac"

Con `chatCwd` puesto, el fallback a las sesiones de la app queda **desactivado** para ese chat. Solo hay dos destinos: la sesión que elegiste, o una nueva **en ese proyecto**. Ni una tercera.

Vive en `shouldAllowMacSessionFallback()` (`main/telegram-relay-bindings.js`), testeable sin arrancar Electron. Test: `tests/telegram-project-wins.test.js`.

## La alternativa descartada

Mi primera propuesta era permitir el fallback **filtrando por cwd**: engancharse a la sesión de la app solo si está en el proyecto elegido. Luismi la rechazó, y con razón: deja el destino dependiendo de lo que tengas abierto en ese momento. La regla tiene que ser predecible.

## Aviso

Si alguien "optimiza" reactivando el fallback cuando hay `chatCwd` —por ejemplo para reaprovechar una sesión ya caliente— el bug vuelve entero.
