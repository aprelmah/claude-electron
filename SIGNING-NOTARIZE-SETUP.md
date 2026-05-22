# Firma y notarización de POWER-AGENT en macOS

Esta guía cubre cómo construir POWER-AGENT con o sin firma de código de Apple.

La config de `electron-builder` ya está preparada para ambos escenarios. La diferencia es solo si tienes (o no) cuenta Apple Developer (99 €/año).

---

## Estado actual

- `package.json` → `build.mac.hardenedRuntime: true`, `entitlements: build/entitlements.mac.plist`, `notarize: false` (por defecto).
- `build/entitlements.mac.plist` → entitlements mínimos para Electron + node-pty + Whisper + red.
- `build/notarize.js` → hook `afterSign` que notariza si encuentra credenciales, y hace skip silencioso si no.
- `@electron/notarize` añadido como `devDependency`.
- Scripts:
  - `npm run dist` → igual que antes (autodetecta firma del Keychain si la hay).
  - `npm run dist:signed` → alias explícito para builds firmadas + notarizadas.
  - `npm run dist:unsigned` → fuerza build SIN firma (idéntico al comportamiento histórico).
  - `npm run build:zip` / `npm run build:dmg` → sin cambios.

---

## A. Sin cuenta Apple Developer (estado actual de Luismi)

No hace falta hacer nada distinto. El comportamiento es el mismo que ahora:

```bash
npm run dist:unsigned       # equivalente a la build de hoy, sin firma
npm run build:zip           # también sin firma si no hay creds
npm run deploy              # despliegue local con xattr -cr (sigue funcionando)
```

Implicaciones:
- En tu Mac la app abre con doble clic gracias a que `scripts/deploy.sh` ejecuta `xattr -cr` para quitar la cuarentena.
- Si pasas la app a OTRO Mac (USB, AirDrop, descarga), el receptor verá "app dañada" o "no verificada". Solución del receptor:
  ```bash
  xattr -cr /Applications/POWER-AGENT.app
  ```
  Luego puede abrirla con doble clic o `Click-derecho > Abrir`.

Sin firma de Apple, macOS Gatekeeper bloquea por defecto en máquinas ajenas. No hay forma de evitarlo distribuyendo el binario tal cual.

---

## B. Con cuenta Apple Developer (99 €/año)

### B.1. Alta y certificado

1. Inscribirse en https://developer.apple.com/programs/ (99 €/año, individual o organización).
2. En https://developer.apple.com/account/resources/certificates entra y crea un certificado **Developer ID Application** (NO el de Mac App Store, NO el de instalador).
3. Descarga el `.cer`, dale doble clic. Se instala en **Keychain Access > login > Mis certificados**. Debe verse `Developer ID Application: <Tu Nombre> (XXXXXXXXXX)`.
4. Click-derecho sobre el certificado en Keychain → **Exportar** → guarda como `.p12` con una contraseña fuerte. Guárdalo fuera del repo, p. ej. `~/Apple/poweragent-cert.p12`.

### B.2. App-specific password

1. Entra a https://appleid.apple.com/account/manage con tu Apple ID.
2. Sección **Sign-In and Security > App-Specific Passwords > Generate Password**.
3. Etiqueta sugerida: `poweragent-notarytool`. Copia el password generado (formato `xxxx-xxxx-xxxx-xxxx`).

### B.3. Team ID

Tu **Team ID** (10 chars alfanuméricos) aparece arriba a la derecha de https://developer.apple.com/account, o también en el nombre completo del certificado (`...(XXXXXXXXXX)`).

### B.4. Variables de entorno

Añade a `~/.zshrc` (o `~/.bashrc` si usas bash):

```bash
# --- POWER-AGENT signing/notarization ---
export CSC_LINK="$HOME/Apple/poweragent-cert.p12"
export CSC_KEY_PASSWORD="<password del p12>"
export APPLE_ID="tu@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

Recarga el shell:
```bash
source ~/.zshrc
```

NO subas estas variables al repo. NO subas el `.p12` al repo.

### B.5. Build firmada y notarizada

```bash
npm run dist:signed
```

Pasos que hace electron-builder por debajo:
1. Empaqueta `.app` x64 y arm64.
2. Firma cada `.app` con el certificado Developer ID Application encontrado vía `CSC_LINK` + `CSC_KEY_PASSWORD`, aplicando `build/entitlements.mac.plist`.
3. Crea `.dmg` y `.zip` para cada arquitectura.
4. El hook `build/notarize.js` envía cada `.app` a Apple Notary Service vía `notarytool` (usa `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`).
5. Apple devuelve OK en 1-10 minutos y electron-builder hace `stapler staple` para que la notarización quede embebida (Gatekeeper no necesita internet para validar).

Resultado: `dist/POWER-AGENT-1.2.0.dmg` (Intel), `dist/POWER-AGENT-1.2.0-arm64.dmg` (Apple Silicon), idem `.zip`. Estos binarios abren en cualquier Mac sin warnings ni `xattr -cr`.

---

## C. Verificación de firma y notarización

```bash
# Firma válida
codesign --verify --deep --strict --verbose=2 /Applications/POWER-AGENT.app

# Gatekeeper acepta
spctl -a -t exec -vv /Applications/POWER-AGENT.app

# Stapler en el DMG
xcrun stapler validate dist/POWER-AGENT-1.2.0.dmg
xcrun stapler validate dist/POWER-AGENT-1.2.0-arm64.dmg

# Inspeccionar entitlements aplicados
codesign -d --entitlements - /Applications/POWER-AGENT.app
```

Salidas esperadas:
- `codesign`: `satisfies its Designated Requirement`.
- `spctl`: `accepted`, `source=Notarized Developer ID`.
- `stapler`: `The validate action worked!`.

---

## D. Entitlements mínimos aplicados

Archivo: `build/entitlements.mac.plist`.

| Entitlement | Por qué |
|---|---|
| `com.apple.security.cs.allow-jit` | V8 (JavaScript JIT). |
| `com.apple.security.cs.allow-unsigned-executable-memory` | `node-pty` y otros nativos. |
| `com.apple.security.cs.disable-library-validation` | Carga dylibs de Electron/Helpers. |
| `com.apple.security.cs.allow-dyld-environment-variables` | Lanzar binarios externos (`claude`, `codex`, `whisper`) con `PATH` extendido. |
| `com.apple.security.network.client` | HTTP al bridge WhatsApp local y APIs. |
| `com.apple.security.device.audio-input` | Whisper transcribe micro/audios. |
| `com.apple.security.files.user-selected.read-write` | Diálogos de archivo (`dialog.showOpenDialog`). |
| `com.apple.security.inherit` | Que los Helpers de Electron hereden estos permisos. |

Si necesitas añadir uno nuevo (p. ej. cámara, ubicación), edita este plist. Cuanto menos permiso pidas, mejor pasa la review de Apple.

---

## E. Troubleshooting

### `errSecInternalComponent` al firmar
- El `.p12` no está accesible o la contraseña en `CSC_KEY_PASSWORD` no coincide.
- Verifica con: `security import "$CSC_LINK" -k login.keychain -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign`.

### `notarytool` falla con `Invalid credentials`
- El `APPLE_APP_SPECIFIC_PASSWORD` NO es tu contraseña normal de Apple ID. Tiene que ser generado en appleid.apple.com como app-specific.
- El `APPLE_ID` tiene que ser el mismo que la cuenta dueña del Team ID.

### `notarytool` falla con `The signature of the binary is invalid`
- Hardened runtime no activado o falta algún entitlement. Revisa `codesign -d --entitlements - <app>` y compara con la tabla de arriba.

### Build sin firmar produce `code signing skipped` (esperado)
Es el modo "sin Apple Developer". No es un error.

### Quiero forzar build sin firma aunque tenga credenciales en el shell
```bash
npm run dist:unsigned
```
Equivale a `CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --arm64 --x64`.

### El receptor (otro Mac) sigue viendo "app dañada" con build firmada
- Compruébalo con `spctl -a -t exec -vv <app>`. Si dice `source=Unsigned`, la firma no se aplicó.
- Si dice `source=Developer ID` pero no `Notarized`, la notarización falló o no se hizo. Mira el log de `npm run dist:signed`.
