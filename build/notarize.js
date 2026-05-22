'use strict';

// afterSign hook for electron-builder.
// Notarizes the .app via Apple notarytool when credentials are present.
// If credentials are missing, skips silently (so unsigned dev builds keep working).

const path = require('path');

module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('[notarize] skipped (sin credenciales Apple Developer: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID)');
    return;
  }

  // Lazy-require so the dependency only matters when actually notarizing.
  let notarize;
  try {
    ({ notarize } = require('@electron/notarize'));
  } catch (err) {
    console.warn('[notarize] @electron/notarize no instalado. Ejecuta: npm install --save-dev @electron/notarize');
    throw err;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] enviando a Apple notarytool: ${appPath}`);
  const started = Date.now();

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[notarize] OK (${elapsed}s) — ${appName}.app notarizada y stapleada`);
};
