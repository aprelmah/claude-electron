import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import qrcode from 'qrcode-terminal';
import express from 'express';
import pino from 'pino';
import { ensureToken, makeAuthMiddleware, makeRateLimiter, maskToken } from './auth.js';

const PORT = 3031;
const HOST = '127.0.0.1';
const MEDIA_DIR = join(new URL('.', import.meta.url).pathname, 'media');
// Absoluta, no './.baileys_auth': la relativa dependía del cwd del proceso y
// hay que poder borrarla desde el manejador de loggedOut sin ambigüedad.
const AUTH_DIR = join(new URL('.', import.meta.url).pathname, '.baileys_auth');
const MAX_INBOX = 200;
const logger = pino({ level: 'silent' });

if (!existsSync(MEDIA_DIR)) await mkdir(MEDIA_DIR, { recursive: true });

let sock = null;
let clientStatus = 'initializing';
let lastQR = null;
let lastQRAscii = null;
// Guard anti-bucle: solo se limpian las credenciales muertas UNA vez por ciclo.
// Se rearma al conectar de verdad (connection === 'open').
let deadCredsWiped = false;
const inbox = [];
const sentByBridge = new Set();
// Tabla de identidades por JID: { jid, lid, name, notify, phone }
// Se rellena con eventos contacts.upsert/update + pushName de mensajes.
const identities = new Map();
// Identidad del propio usuario conectado al bridge: pushName y phone propios.
// Sirve para rechazar contaminación cuando WhatsApp/Baileys propaga el notify
// del propio usuario a contactos ajenos (sucede con @lid enmascarados).
let selfNotify = '';
let selfPhone = '';

function jidServer(jid) {
  const s = String(jid || '');
  const at = s.indexOf('@');
  if (at < 0) return '';
  return s.slice(at + 1).toLowerCase();
}

function isGroupJid(jid) {
  return jidServer(jid) === 'g.us';
}

function isLidJid(jid) {
  const server = jidServer(jid);
  return server === 'lid' || server === 'hosted.lid';
}

function isPnJid(jid) {
  const server = jidServer(jid);
  return server === 's.whatsapp.net' || server === 'c.us';
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function asPhoneJid(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.endsWith('@s.whatsapp.net') || s.endsWith('@c.us')) return s;
  if (s.includes('@')) return '';
  const d = digitsOnly(s);
  return d ? `${d}@s.whatsapp.net` : '';
}

function asLidJid(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.endsWith('@lid') || s.endsWith('@hosted.lid')) return s;
  if (s.includes('@')) return '';
  const d = digitsOnly(s);
  return d ? `${d}@lid` : '';
}

function phoneFromVcard(vcard) {
  const s = String(vcard || '');
  if (!s) return '';
  let m = s.match(/waid=(\d{6,20})/i);
  if (m && m[1]) return m[1];
  m = s.match(/TEL[^:\n]*:\+?([0-9]{6,20})/i);
  if (m && m[1]) return m[1];
  return '';
}

function mappingToPair(mapping) {
  if (!mapping || typeof mapping !== 'object') return null;
  const lidRaw = mapping.lid || mapping.lidJid || mapping.lid_id || mapping.lidUser || mapping.liduser || '';
  const pnRaw = mapping.pn || mapping.phoneNumber || mapping.pnJid || mapping.pn_jid || mapping.jid || '';
  const lid = asLidJid(lidRaw);
  const pnJid = asPhoneJid(pnRaw);
  if (!lid || !pnJid) return null;
  return { lid, pnJid };
}

function jidNumber(jid) {
  if (!jid) return '';
  const s = String(jid);
  if (!isPnJid(s)) return '';
  const local = (s.split('@')[0] || '').split(':')[0];
  const d = digitsOnly(local);
  return d || '';
}

function jidLocalDigits(jid) {
  if (!jid) return '';
  const local = (String(jid).split('@')[0] || '').split(':')[0];
  return digitsOnly(local);
}

function pushResolvedPhone(candidates, value) {
  if (!value) return;
  const raw = String(value).trim();
  if (!raw) return;
  const phone = raw.includes('@') ? jidNumber(raw) : digitsOnly(raw);
  if (!phone) return;
  candidates.push(phone);
}

function updateIdentity(jid, partial) {
  if (!jid) return;
  const key = String(jid).trim();
  if (!key) return;
  const patch = { ...(partial || {}) };
  if (patch.lid) patch.lid = asLidJid(patch.lid) || patch.lid;
  if (patch.jid) patch.jid = asPhoneJid(patch.jid) || patch.jid;
  if (patch.phone) patch.phone = digitsOnly(patch.phone);
  if (!patch.phone && patch.jid && String(patch.jid).endsWith('@s.whatsapp.net')) {
    patch.phone = jidNumber(patch.jid);
  }
  // Defensa anti-contaminación: si el patch trae phone/jid que apuntan al PROPIO
  // usuario del bridge, NO los aplicamos a JIDs ajenos (contaminación cruzada via
  // multi-device / mappings @lid). Solo el JID propio puede tener su propio phone.
  if (selfPhone && patch.phone === selfPhone && jidNumber(key) !== selfPhone) {
    delete patch.phone;
    if (patch.jid && jidNumber(patch.jid) === selfPhone) delete patch.jid;
  }

  const prev = identities.get(key) || { jid: key };
  const next = { ...prev, ...patch };
  // Si el partial trae un `jid` distinto (mapping lid→jid), guardamos cruzado.
  if (patch.lid && patch.lid !== key) {
    const lidEntry = identities.get(patch.lid) || { jid: patch.lid };
    identities.set(patch.lid, { ...lidEntry, ...patch });
  }
  if (patch.jid && patch.jid !== key) {
    const jidEntry = identities.get(patch.jid) || { jid: patch.jid };
    identities.set(patch.jid, { ...jidEntry, ...patch });
  }
  identities.set(key, next);
}

function resolvePhoneFromIdentity(jid) {
  const key = String(jid || '').trim();
  if (!key) return '';
  if (isGroupJid(key)) return '';

  const candidates = [];
  const addFrom = (info) => {
    if (!info || typeof info !== 'object') return;
    pushResolvedPhone(candidates, info.phone);
    pushResolvedPhone(candidates, info.phoneNumber);
    pushResolvedPhone(candidates, info.pn);
    pushResolvedPhone(candidates, info.jid);
  };

  addFrom(identities.get(key));
  for (const [entryKey, info] of identities.entries()) {
    if (!info || typeof info !== 'object') continue;
    if (entryKey === key || info.lid === key || info.jid === key) addFrom(info);
  }

  // Para JID de teléfono, el propio JID ya es fuente válida.
  if (isPnJid(key)) pushResolvedPhone(candidates, key);

  const lidLocal = isLidJid(key) ? jidLocalDigits(key) : '';
  const keyIsSelf = jidNumber(key) === selfPhone;
  for (const phone of candidates) {
    // Evita confundir LID local con teléfono real.
    if (lidLocal && phone === lidLocal) continue;
    // Si el JID no es el del propio usuario, nunca devolvemos el phone propio.
    if (selfPhone && phone === selfPhone && !keyIsSelf) continue;
    return phone;
  }
  return '';
}

function resolveDisplay(jid) {
  const info = identities.get(jid) || {};
  // Orden de preferencia: name (libreta) → notify (pushName) → phoneNumber legible → ''
  // Defensa en runtime: si el notify cacheado coincide con el del propio usuario,
  // lo tratamos como vacío (datos contaminados de sesiones previas).
  const safeNotify = info.notify && (!selfNotify || info.notify !== selfNotify) ? info.notify : '';
  const displayName = info.name || safeNotify || '';
  const phoneNumber = resolvePhoneFromIdentity(jid);
  return { displayName, phoneNumber };
}

function jidLocalPart(jid) {
  return (String(jid || '').split('@')[0] || '').split(':')[0];
}

function sanitizeMentionLabel(value) {
  const raw = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.replace(/^@+/, '');
}

function mentionLocalCandidates(jid) {
  const local = jidLocalPart(jid);
  const digits = digitsOnly(local);
  const out = [];
  if (local) out.push(local);
  if (digits && digits !== local) out.push(digits);
  return Array.from(new Set(out.filter((v) => v && v.length >= 5)));
}

function mentionLabelForJid(jid) {
  const { displayName, phoneNumber } = resolveDisplay(jid);
  const preferred = sanitizeMentionLabel(displayName) || sanitizeMentionLabel(phoneNumber);
  if (preferred) return preferred;

  const local = jidLocalPart(jid);
  const digits = digitsOnly(local);
  if (isPnJid(jid) && digits) return `+${digits}`;
  if (isLidJid(jid) && digits) return `Miembro ${digits.slice(-6)}`;
  if (digits) return digits;
  return sanitizeMentionLabel(local) || 'Contacto';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function humanizeMentionsInText(text, mentionedJids) {
  const src = String(text || '');
  if (!src) return src;
  const list = Array.isArray(mentionedJids) ? mentionedJids : [];
  if (!list.length) return src;

  let out = src;
  for (const jid of Array.from(new Set(list.map((v) => String(v || '').trim()).filter(Boolean)))) {
    const label = mentionLabelForJid(jid);
    if (!label) continue;
    const replacement = `@${label}`;
    const candidates = mentionLocalCandidates(jid).sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      const rx = new RegExp(`(^|[^0-9A-Za-z_])@${escapeRegex(candidate)}(?![0-9A-Za-z_])`, 'g');
      out = out.replace(rx, (_all, prefix) => `${prefix}${replacement}`);
    }
  }
  return out;
}

const groupMetaInflight = new Map();

async function ensureGroupIdentity(jid) {
  if (!jid || !isGroupJid(jid) || !sock) return;
  const key = String(jid);
  const known = identities.get(key);
  if (known && known.name) return;
  if (groupMetaInflight.has(key)) return groupMetaInflight.get(key);

  const task = (async () => {
    try {
      const meta = await sock.groupMetadata(key);
      const subject = String(meta?.subject || '').trim();
      if (subject) updateIdentity(key, { name: subject });

      for (const participant of (meta?.participants || [])) {
        const id = participant?.id || participant?.jid || participant?.userJid || '';
        const lid = asLidJid(participant?.lid || participant?.lidJid || id);
        const pnJid = asPhoneJid(participant?.phoneNumber || participant?.pnJid || '');
        if (lid && pnJid) updateIdentity(lid, { lid, jid: pnJid, phone: jidNumber(pnJid) });
        else if (lid) updateIdentity(lid, { lid });
        else if (pnJid) updateIdentity(pnJid, { jid: pnJid, phone: jidNumber(pnJid) });
      }
    } catch (err) {
      console.warn('[bridge] groupMetadata fallback failed for', key, err?.message || err);
    } finally {
      groupMetaInflight.delete(key);
    }
  })();

  groupMetaInflight.set(key, task);
  return task;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function toJid(to) {
  return to.includes('@') ? to : `${to}@s.whatsapp.net`;
}

async function saveMedia(msg, ext) {
  try {
    const buf = await downloadMediaMessage(msg, 'buffer', {}, {
      logger,
      reuploadRequest: sock.updateMediaMessage
    });
    const filename = `${Date.now()}_${msg.key.id.slice(-8)}.${ext}`;
    const path = join(MEDIA_DIR, filename);
    await writeFile(path, buf);
    return path;
  } catch (e) {
    console.error('[bridge] Error descargando media:', e.message);
    return null;
  }
}

function collectIdentityHints(payload, maxDepth = 5) {
  const pnJids = new Set();
  const lidJids = new Set();
  const seen = new Set();
  const stack = [{ value: payload, depth: 0, key: '' }];

  const maybeAdd = (key, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const k = String(key || '').toLowerCase();
    if (
      k.includes('pn') ||
      k.includes('phone') ||
      k.includes('remotejidalt') ||
      k.includes('participantalt') ||
      k.includes('sender') ||
      k.includes('jid')
    ) {
      const pn = asPhoneJid(value);
      if (pn) pnJids.add(pn);
    }
    if (k.includes('lid') || k.includes('participant') || k.includes('sender')) {
      const lid = asLidJid(value);
      if (lid) lidJids.add(lid);
    }
  };

  while (stack.length) {
    const { value, depth, key } = stack.pop();
    if (value == null) continue;

    if (typeof value === 'string') {
      maybeAdd(key, value);
      continue;
    }

    if (typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (depth >= maxDepth) continue;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        stack.push({ value: value[i], depth: depth + 1, key });
      }
      continue;
    }

    for (const [k, v] of Object.entries(value)) {
      stack.push({ value: v, depth: depth + 1, key: k });
    }
  }

  return { pnJids, lidJids };
}

async function parseIncoming(msg) {
  const jid = msg.key.remoteJid;
  const type = Object.keys(msg.message)[0];
  const ts = Number(msg.messageTimestamp);
  const key = msg.key || {};
  const isGroup = isGroupJid(jid);
  const remoteAltPnJid = asPhoneJid(key.remoteJidAlt);
  const participantAltPnJid = asPhoneJid(key.participantAlt);
  const senderPnJid = asPhoneJid(key.senderPn);
  const participantPnJid = asPhoneJid(key.participantPn);
  const senderLidJid = asLidJid(key.senderLid);
  const participantLidJid = asLidJid(key.participantLid);
  // Enriquecemos identidad con el pushName solo en chats individuales.
  if (msg.pushName && !msg.key.fromMe && !isGroup) updateIdentity(jid, { notify: msg.pushName });
  // En grupos NO mapeamos la identidad del grupo al PN/LID del participante.
  if (!isGroup) {
    if (!msg.key.fromMe && senderLidJid) updateIdentity(jid, { lid: senderLidJid });
    if (!msg.key.fromMe && participantLidJid) updateIdentity(jid, { lid: participantLidJid });
    if (remoteAltPnJid) updateIdentity(jid, { jid: remoteAltPnJid, phone: jidNumber(remoteAltPnJid) });
    if (!msg.key.fromMe && participantAltPnJid) updateIdentity(jid, { jid: participantAltPnJid, phone: jidNumber(participantAltPnJid) });
    // Si Baileys nos da PN alternativo (sender/participant), lo guardamos como mapeo real.
    if (!msg.key.fromMe && senderPnJid) updateIdentity(jid, { jid: senderPnJid, phone: jidNumber(senderPnJid) });
    if (!msg.key.fromMe && participantPnJid) updateIdentity(jid, { jid: participantPnJid, phone: jidNumber(participantPnJid) });
    const inferred = collectIdentityHints(msg);
    for (const lidJid of inferred.lidJids) updateIdentity(jid, { lid: lidJid });
    for (const pnJid of inferred.pnJids) updateIdentity(jid, { jid: pnJid, phone: jidNumber(pnJid) });
  }

  let { displayName, phoneNumber } = resolveDisplay(jid);
  if (isGroup && !displayName) {
    await ensureGroupIdentity(jid);
    const refreshed = resolveDisplay(jid);
    displayName = refreshed.displayName || displayName;
  }

  // Grupos: participant = quién habló; pushName = su nombre en ese mensaje.
  const participantJid = msg.key.participant || null;
  const participantResolved = participantJid ? resolveDisplay(participantJid) : { displayName: '', phoneNumber: '' };
  const participantName = isGroup ? (msg.pushName || participantResolved.displayName || participantResolved.phoneNumber || null) : null;
  const participantPhoneNumber = isGroup ? (participantResolved.phoneNumber || null) : null;
  const innerMsg = msg.message?.[type];
  const msgContext = innerMsg?.contextInfo || null;
  const mentionedJids = Array.isArray(msgContext?.mentionedJid) ? msgContext.mentionedJid.filter(Boolean) : [];

  // Mensaje citado (reply/quote) — extraído del contextInfo de Baileys.
  let quotedMsg = null;
  if (msgContext?.quotedMessage) {
    const qType = Object.keys(msgContext.quotedMessage)[0];
    const qBodyRaw = msgContext.quotedMessage?.conversation
      || msgContext.quotedMessage?.extendedTextMessage?.text
      || msgContext.quotedMessage?.[qType]?.caption
      || '';
    const qDisplayType = (qType === 'conversation' || qType === 'extendedTextMessage') ? 'text' : (qType?.replace('Message', '') || 'text');
    const qMentionCtx = msgContext.quotedMessage?.[qType]?.contextInfo || msgContext.quotedMessage?.extendedTextMessage?.contextInfo || null;
    const qBody = humanizeMentionsInText(qBodyRaw, qMentionCtx?.mentionedJid || []);
    quotedMsg = {
      id: msgContext.stanzaId || '',
      body: String(qBody),
      type: qDisplayType,
      fromMe: Boolean(msgContext.participant && msgContext.participant === jid),
      participantName: msgContext.participant ? (resolveDisplay(msgContext.participant).displayName || null) : null
    };
  }

  const base = {
    id: msg.key.id,
    from: jid,
    fromMe: msg.key.fromMe,
    timestamp: ts,
    read: false,
    displayName,
    phoneNumber: isGroup ? '' : phoneNumber,
    isGroup,
    participant: participantJid,
    participantName,
    participantPhoneNumber,
    mentionedJids,
    quotedMsg
  };

  if (type === 'conversation') {
    const body = humanizeMentionsInText(msg.message.conversation, msgContext?.mentionedJid || []);
    return { ...base, type: 'text', body };
  }
  if (type === 'extendedTextMessage') {
    const rawText = msg.message.extendedTextMessage?.text || '';
    const body = humanizeMentionsInText(rawText, msgContext?.mentionedJid || []);
    return { ...base, type: 'text', body };
  }
  if (type === 'contactMessage') {
    const cm = msg.message.contactMessage || {};
    const phone = phoneFromVcard(cm.vcard);
    if (phone && !isGroup) {
      const pnJid = asPhoneJid(phone);
      updateIdentity(jid, { jid: pnJid, phone });
      const resolved = resolveDisplay(jid);
      base.phoneNumber = resolved.phoneNumber;
    }
    const label = cm.displayName ? `Contacto compartido: ${cm.displayName}` : 'Contacto compartido';
    return { ...base, type: 'text', body: `[${label}]` };
  }
  if (type === 'contactsArrayMessage') {
    const arr = msg.message.contactsArrayMessage?.contacts || [];
    let phone = '';
    for (const c of arr) {
      phone = phoneFromVcard(c?.vcard);
      if (phone) break;
    }
    if (phone && !isGroup) {
      const pnJid = asPhoneJid(phone);
      updateIdentity(jid, { jid: pnJid, phone });
      const resolved = resolveDisplay(jid);
      base.phoneNumber = resolved.phoneNumber;
    }
    const names = arr.map((c) => c?.displayName).filter(Boolean);
    const label = names.length ? `Contactos compartidos: ${names.join(', ')}` : 'Contactos compartidos';
    return { ...base, type: 'text', body: `[${label}]` };
  }
  if (type === 'requestPhoneNumberMessage') {
    return { ...base, type: 'text', body: '[Solicitud de teléfono]' };
  }
  if (type === 'imageMessage') {
    const path = await saveMedia(msg, 'jpg');
    return { ...base, type: 'image', body: msg.message.imageMessage?.caption || '', mediaPath: path };
  }
  if (type === 'audioMessage' || type === 'pttMessage') {
    const path = await saveMedia(msg, 'ogg');
    return { ...base, type: 'audio', body: '', mediaPath: path };
  }
  if (type === 'videoMessage') {
    const path = await saveMedia(msg, 'mp4');
    return { ...base, type: 'video', body: msg.message.videoMessage?.caption || '', mediaPath: path };
  }
  if (type === 'documentMessage') {
    const ext = msg.message.documentMessage?.fileName?.split('.').pop() || 'bin';
    const path = await saveMedia(msg, ext);
    return { ...base, type: 'document', body: msg.message.documentMessage?.fileName || '', mediaPath: path };
  }
  if (type === 'stickerMessage') {
    const path = await saveMedia(msg, 'webp');
    return { ...base, type: 'sticker', body: '', mediaPath: path };
  }
  return null;
}

// ─── WhatsApp connection ───────────────────────────────────────────────────

async function startBridge() {
  console.log('[bridge] Cargando sesión...');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  let version;
  try {
    const r = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
    ]);
    version = r.version;
    console.log('[bridge] Versión WA:', version?.join('.'));
  } catch {
    console.log('[bridge] Versión por defecto (timeout)');
  }

  // markOnlineOnConnect:false — sin esto el dispositivo vinculado aparece "en línea"
  // 24/7 (señal clara de bot para Meta y roba las notificaciones push del teléfono).
  sock = makeWASocket({ ...(version ? { version } : {}), auth: state, logger, printQRInTerminal: false, markOnlineOnConnect: false });

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      clientStatus = 'qr';
      lastQR = qr;
      console.log('[bridge] QR generado. Ejecuta: whatsapp-bridge qr');
      // Con callback qrcode-terminal NO imprime: cacheamos el ASCII para GET /qr
      // (el modal de la app lo pinta tal cual) y lo mandamos al log a mano.
      qrcode.generate(qr, { small: true }, (ascii) => {
        lastQRAscii = ascii;
        console.log(ascii);
      });
    }
    if (connection === 'open') {
      clientStatus = 'ready';
      lastQR = null;
      lastQRAscii = null;
      deadCredsWiped = false; // rearma el guard: la próxima expulsión sí puede limpiar
      // Capturamos el pushName y phone propios para poder rechazarlos cuando
      // aparezcan asignados a JIDs ajenos (contaminación de identidad cruzada).
      try {
        const me = sock?.user || {};
        if (me.name) selfNotify = String(me.name);
        else if (me.notify) selfNotify = String(me.notify);
        if (me.id) selfPhone = digitsOnly(String(me.id).split(':')[0].split('@')[0]);
      } catch {}
      console.log('[bridge] Conectado y listo. self:', JSON.stringify({ notify: selfNotify, phone: selfPhone }));
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        clientStatus = 'reconnecting';
        console.log('[bridge] Reconectando...');
        setTimeout(startBridge, 30000);
      } else if (!deadCredsWiped) {
        // WhatsApp ha cerrado la sesión: las credenciales de .baileys_auth ya no
        // valen. Antes esto se quedaba aquí para siempre — useMultiFileAuthState
        // recargaba esas mismas credenciales muertas, WhatsApp las rechazaba otra
        // vez y NUNCA se llegaba a emitir un QR nuevo, ni pulsando "Reintentar"
        // en la app (reiniciar no ayuda si el estado muerto sigue en disco).
        deadCredsWiped = true;
        clientStatus = 'disconnected';
        console.log('[bridge] Sesión cerrada por WhatsApp. Borrando credenciales muertas y regenerando QR...');
        try {
          rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch (e) {
          console.error('[bridge] no se pudo borrar', AUTH_DIR, e?.message || e);
        }
        setTimeout(startBridge, 1000);
      } else {
        // Ya se limpiaron una vez sin llegar a conectar: no insistir en bucle.
        clientStatus = 'disconnected';
        console.log('[bridge] Sesión cerrada de nuevo tras limpiar credenciales. Re-escanea QR manualmente.');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Mantener tabla de identidades para resolver @lid → nombre/número real.
  const ingestContact = (c) => {
    if (!c || !c.id) return;
    const partial = {};
    if (c.name) partial.name = c.name;
    // Rechazamos notify si coincide con el pushName del propio usuario: WhatsApp
    // propaga el notify del autor cuando hay multi-device/@lid y eso contamina
    // el displayName del contacto destinatario.
    if (c.notify && (!selfNotify || c.notify !== selfNotify)) partial.notify = c.notify;
    const lidJid = asLidJid(c.lid || c.lidJid) || (String(c.id).endsWith('@lid') ? String(c.id) : '');
    const pnJid = asPhoneJid(c.jid || c.phoneNumber || c.pnJid);
    if (lidJid) partial.lid = lidJid;
    if (pnJid) { partial.jid = pnJid; partial.phone = jidNumber(pnJid); }
    const directPhone = digitsOnly(c.phone || c.phoneNumber);
    if (directPhone) partial.phone = directPhone;
    if (jidNumber(c.id)) partial.phone = partial.phone || jidNumber(c.id);
    updateIdentity(c.id, partial);
  };
  sock.ev.on('contacts.upsert', (list) => { for (const c of (list || [])) ingestContact(c); });
  sock.ev.on('contacts.update', (list) => { for (const c of (list || [])) ingestContact(c); });
  sock.ev.on('messaging-history.set', ({ contacts, lidPnMappings } = {}) => {
    for (const c of (contacts || [])) ingestContact(c);
    for (const m of (lidPnMappings || [])) {
      const pair = mappingToPair(m);
      if (!pair) continue;
      updateIdentity(pair.lid, { lid: pair.lid, jid: pair.pnJid, phone: jidNumber(pair.pnJid) });
    }
  });
  // v7+ (si la librería/servidor lo emite): actualización incremental LID<->PN.
  sock.ev.on('lid-mapping.update', (update) => {
    const pair = mappingToPair(update);
    if (!pair) return;
    updateIdentity(pair.lid, { lid: pair.lid, jid: pair.pnJid, phone: jidNumber(pair.pnJid) });
  });
  sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
    const lidJid = asLidJid(lid);
    const pnJid = asPhoneJid(jid);
    if (!lidJid || !pnJid) return;
    updateIdentity(lidJid, { lid: lidJid, jid: pnJid, phone: jidNumber(pnJid) });
  });
  sock.ev.on('chats.upsert', (list) => {
    for (const ch of (list || [])) {
      if (!ch || !ch.id) continue;
      const partial = {};
      const subject = String(ch.subject || ch.name || '').trim();
      if (subject) partial.name = subject;
      updateIdentity(ch.id, partial);
      if (isGroupJid(ch.id) && !subject) {
        Promise.resolve().then(() => ensureGroupIdentity(ch.id));
      }
    }
  });

  // Nombres de grupos: Baileys los emite en groups.upsert con subject.
  sock.ev.on('groups.upsert', (list) => {
    for (const g of (list || [])) {
      if (!g || !g.id) continue;
      if (g.subject) updateIdentity(g.id, { name: g.subject });
    }
  });
  sock.ev.on('groups.update', (list) => {
    for (const g of (list || [])) {
      if (!g || !g.id) continue;
      if (g.subject) updateIdentity(g.id, { name: g.subject });
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      // No filtramos envios via API: la app los necesita para monitorizar fromMe.
      const entry = await parseIncoming(msg);
      if (!entry) continue;
      entry._raw = msg; // guardamos original para poder usar como quoted en replies
      inbox.push(entry);
      if (inbox.length > MAX_INBOX) inbox.shift();
      console.log(`[bridge] ← ${entry.from} [${entry.type}]`);
    }
  });
}

startBridge().catch(e => console.error('[bridge] Error fatal:', e));

// ─── HTTP API (solo 127.0.0.1) ────────────────────────────────────────────

// Token compartido cliente↔bridge. Generamos al arrancar; el cliente lee el
// mismo archivo en disco y manda el header X-Auth-Token en cada request.
const authState = ensureToken();
console.log(`[bridge-auth] token listo (${maskToken(authState.token)}, generated=${authState.created}) en ${authState.path}`);
const getAuthToken = () => authState.token;

const app = express();
app.use(express.json({ limit: '50mb' }));

// 1. Rate limit ANTES del auth para que ataques de fuerza bruta no consuman
//    timingSafeEqual ni saturen logs con 401 falsos.
//    Política:
//      /send/*    → 30 req/min (envíos reales, costosos en Baileys)
//      /messages  → 600 req/min (polling agresivo del cliente cada 1.5s = 40/min holgado)
//      /status    → 600 req/min (lo consultan a la vez el poll del cliente, el panel,
//                   el widget de salud y el modal QR cada 2s; con 60/min se saturaba
//                   y la app quedaba ciega en bucle de 429 — visto 2026-08-02)
//      /qr        → 600 req/min (modal QR abierto = 30/min por ventana)
//      otros      → 60 req/min
app.use(makeRateLimiter({
  rulesPerMinute: { '/send/*': 30, '/messages': 600, '/status': 600, '/qr': 600 },
  defaultPerMinute: 60
}));

// 2. Auth: todas las rutas requieren X-Auth-Token. Si falta o no coincide → 401.
app.use(makeAuthMiddleware({ getToken: getAuthToken }));

app.get('/status', (_, res) => res.json({ status: clientStatus }));

app.get('/qr', (_, res) => res.json({ status: clientStatus, qr: lastQR, qrAscii: lastQRAscii }));

// ── Humanización anti-detección (solo respuestas automáticas, humanize:true) ──
// Secuencia que imita a una persona: leer el mensaje (check azul) → "escribiendo…"
// un tiempo proporcional a la respuesta con jitter → pausa → enviar. Todo con
// try/catch: si presence/read fallan, el envío sale igual.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

async function humanizeBeforeSend(jid, text) {
  try {
    const lastIn = [...inbox].reverse().find((m) => m.from === jid && !m.fromMe);
    if (lastIn?._raw?.key) {
      await sleep(rand(500, 1500));
      await sock.readMessages([lastIn._raw.key]);
    }
    // Recortado 2026-08-02 (feedback Luismi: la respuesta con KB ya tarda por
    // el propio pipeline — sumarle de más un humanizado largo se notaba lento).
    // ~20-45ms por carácter, mínimo 1,2s, tope 5s.
    const typingMs = Math.min(1200 + String(text || '').length * rand(20, 45), 5000);
    await sock.sendPresenceUpdate('available'); // sin available el contacto no ve el composing
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(typingMs);
    await sock.sendPresenceUpdate('paused', jid);
    await sleep(rand(200, 500));
  } catch (e) {
    console.log('[bridge] humanize omitido:', e?.message || e);
  }
}

async function humanizeAfterSend() {
  // Volver a "unavailable": no quedar en línea y devolver las notifs al teléfono.
  try { await sock.sendPresenceUpdate('unavailable'); } catch {}
}

app.post('/send/text', async (req, res) => {
  if (clientStatus !== 'ready') return res.status(503).json({ error: 'No listo', status: clientStatus });
  const { to, message, quotedId, humanize } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'Faltan: to, message' });
  try {
    const payload = { text: message };
    let sendOpts = {};
    if (quotedId) {
      const quoted = inbox.find(m => m.id === quotedId);
      if (quoted?._raw) sendOpts = { quoted: quoted._raw };
    }
    if (humanize) await humanizeBeforeSend(toJid(to), message);
    const sent = await sock.sendMessage(toJid(to), payload, sendOpts);
    if (sent?.key?.id) sentByBridge.add(sent.key.id);
    if (humanize) humanizeAfterSend();
    res.json({ ok: true, id: sent?.key?.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/send/request-phone', async (req, res) => {
  if (clientStatus !== 'ready') return res.status(503).json({ error: 'No listo', status: clientStatus });
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Falta: to' });
  try {
    const sent = await sock.sendMessage(toJid(to), { requestPhoneNumber: true });
    if (sent?.key?.id) sentByBridge.add(sent.key.id);
    res.json({ ok: true, id: sent?.key?.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/send/image', async (req, res) => {
  if (clientStatus !== 'ready') return res.status(503).json({ error: 'No listo', status: clientStatus });
  const { to, base64, mimetype = 'image/jpeg', caption = '' } = req.body;
  if (!to || !base64) return res.status(400).json({ error: 'Faltan: to, base64' });
  try {
    const sent = await sock.sendMessage(toJid(to), { image: Buffer.from(base64, 'base64'), mimetype, caption });
    if (sent?.key?.id) sentByBridge.add(sent.key.id);
    res.json({ ok: true, id: sent?.key?.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/send/audio', async (req, res) => {
  if (clientStatus !== 'ready') return res.status(503).json({ error: 'No listo', status: clientStatus });
  const { to, base64, ptt = false, mimetype = 'audio/ogg; codecs=opus' } = req.body;
  if (!to || !base64) return res.status(400).json({ error: 'Faltan: to, base64' });
  try {
    const sent = await sock.sendMessage(toJid(to), { audio: Buffer.from(base64, 'base64'), mimetype, ptt });
    if (sent?.key?.id) sentByBridge.add(sent.key.id);
    res.json({ ok: true, id: sent?.key?.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/send/video', async (req, res) => {
  if (clientStatus !== 'ready') return res.status(503).json({ error: 'No listo', status: clientStatus });
  const { to, base64, caption = '', mimetype = 'video/mp4' } = req.body;
  if (!to || !base64) return res.status(400).json({ error: 'Faltan: to, base64' });
  try {
    const sent = await sock.sendMessage(toJid(to), { video: Buffer.from(base64, 'base64'), mimetype, caption });
    if (sent?.key?.id) sentByBridge.add(sent.key.id);
    res.json({ ok: true, id: sent?.key?.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/send/document', async (req, res) => {
  if (clientStatus !== 'ready') return res.status(503).json({ error: 'No listo', status: clientStatus });
  const { to, base64, filename, mimetype = 'application/octet-stream', caption = '' } = req.body;
  if (!to || !base64 || !filename) return res.status(400).json({ error: 'Faltan: to, base64, filename' });
  try {
    const sent = await sock.sendMessage(toJid(to), { document: Buffer.from(base64, 'base64'), mimetype, fileName: filename, caption });
    if (sent?.key?.id) sentByBridge.add(sent.key.id);
    res.json({ ok: true, id: sent?.key?.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const unreadOnly = req.query.unreadOnly === 'true';
  const msgs = unreadOnly ? inbox.filter(m => !m.read) : inbox.slice(-limit);
  msgs.forEach(m => m.read = true);
  res.json({ messages: msgs });
});

app.delete('/messages', (_, res) => {
  inbox.length = 0;
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`[bridge] API en http://${HOST}:${PORT}`);
});
