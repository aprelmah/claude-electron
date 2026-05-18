/* whatsapp-panel.js — UI del puente WhatsApp integrado en POWER-AGENT
   Aislado en IIFE. Lee window.api.whatsapp si existe; si no, arranca deshabilitado. */

;(function () {
  'use strict'

  const LS_LAST_CHAT = 'poweragent_wa_last_chat'
  const LS_PANEL_W = 'poweragent_wa_panel_width'
  const LS_PANEL_OPEN = 'poweragent_wa_panel_open'
  const LS_TRANSCRIPTS = 'poweragent_wa_transcripts'

  const wa = (window.api && window.api.whatsapp) || null
  const bridgeReady = !!wa

  // ── Estado ──
  let panelEl = null
  let toggleBtn = null
  let chatListEl = null
  let convoEl = null
  let convoHeaderEl = null
  let convoBodyEl = null
  let convoFooterEl = null
  let modeSwitchEl = null
  let modeNoteEl = null
  let handoverBannerEl = null
  let inputEl = null
  let sendBtnEl = null
  let attachBtnEl = null
  let micBtnEl = null
  let qrModalEl = null
  let cfgModalEl = null
  let imgViewerEl = null
  let recIndicatorEl = null
  let statusDotEl = null
  let unreadBadgeEl = null

  let chats = []
  let currentJid = null
  let currentMessages = []
  let status = { connected: false, qrPresent: false, autoReply: true, ownerNumber: '', authorizedNumbers: [] }
  let recording = false
  let mediaRecorder = null
  let recordedChunks = []
  let recStart = 0
  let recTimer = null
  let unsubs = []

  // ── Utilidades ──
  function $(sel, root = document) { return root.querySelector(sel) }
  function el(tag, opts = {}) {
    const node = document.createElement(tag)
    if (opts.cls) node.className = opts.cls
    if (opts.text != null) node.textContent = opts.text
    if (opts.html != null) node.innerHTML = opts.html
    if (opts.attrs) for (const k in opts.attrs) node.setAttribute(k, opts.attrs[k])
    if (opts.style) Object.assign(node.style, opts.style)
    return node
  }

  function fmtTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) {
      return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    }
    const diff = now - d
    if (diff < 86400000 * 2) return 'ayer'
    if (diff < 86400000 * 7) {
      return d.toLocaleDateString('es-ES', { weekday: 'short' })
    }
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
  }

  function fmtRelative(ts) {
    if (!ts) return ''
    const diff = Date.now() - ts
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'ahora'
    if (m < 60) return `hace ${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `hace ${h}h`
    return fmtTime(ts)
  }

  function truncate(s, n) {
    if (!s) return ''
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c])
  }

  function previewFromMessage(m) {
    if (!m) return ''
    const prefix = {
      audio: '🎤 ',
      image: '📷 ',
      video: '🎬 ',
      document: '📎 ',
      sticker: '💭 '
    }[m.type] || ''
    const body = m.body || (m.type ? `(${m.type})` : '')
    return prefix + truncate(body, 60)
  }

  function loadTranscripts() {
    try { return JSON.parse(localStorage.getItem(LS_TRANSCRIPTS) || '{}') } catch { return {} }
  }
  function saveTranscript(id, text) {
    const all = loadTranscripts()
    all[id] = text
    try { localStorage.setItem(LS_TRANSCRIPTS, JSON.stringify(all)) } catch {}
  }

  function initials(displayNumber) {
    const s = String(displayNumber || '').replace(/\D/g, '')
    if (s.length >= 4) return s.slice(-4)
    return s || '?'
  }

  // ── Beep para notificaciones ──
  let audioCtx = null
  function playBeep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtx
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = 880
      g.gain.value = 0.001
      o.connect(g); g.connect(ctx.destination)
      const t = ctx.currentTime
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
      o.start(t); o.stop(t + 0.2)
    } catch {}
  }

  // ── Construcción de DOM ──
  function buildToggleButton() {
    const btn = el('button', {
      cls: 'icon-btn wa-btn',
      attrs: { id: 'btn-whatsapp', title: 'WhatsApp (Cmd+Shift+W)', 'aria-label': 'WhatsApp' }
    })
    btn.innerHTML = `
      <svg class="wa-logo" viewBox="0 0 24 24" aria-hidden="true">
        <path class="wa-bg" d="M12 2.04c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.16-1.36c1.45.79 3.08 1.21 4.74 1.21h.04c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.17-2.92-7.05A9.94 9.94 0 0 0 12 2.04z"/>
        <path class="wa-tail" d="M17.45 14.6c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.49-.89-.79-1.5-1.77-1.67-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.06 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.27.49 1.7.63.71.23 1.36.19 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z"/>
      </svg>
      <span class="wa-badge hidden" aria-label="mensajes no leídos">0</span>
    `
    return btn
  }

  function buildPanel() {
    const root = el('div', { attrs: { id: 'wa-panel' }, cls: 'wa-panel hidden' })

    root.innerHTML = `
      <div class="wa-resizer" aria-hidden="true"></div>
      <div class="wa-header">
        <span class="wa-status-dot wa-status-off" aria-hidden="true"></span>
        <span class="wa-header-title">WhatsApp</span>
        <span class="wa-header-sub" id="wa-header-sub"></span>
        <button class="icon-btn small wa-header-btn" id="wa-btn-qr" title="Ver código QR" aria-label="Código QR">
          <svg viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="21"/><line x1="14" y1="14" x2="21" y2="14"/><line x1="18" y1="18" x2="21" y2="18"/><line x1="18" y1="21" x2="21" y2="21"/></svg>
        </button>
        <button class="icon-btn small wa-header-btn" id="wa-btn-cfg" title="Configuración" aria-label="Configuración">
          <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 20a1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4 9a1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 3.3l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4a1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.3.5.5.84.58.34.08.69.1 1.03.09a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1 .33c-.3.2-.5.5-.58.84z"/></svg>
        </button>
        <button class="icon-btn small wa-header-btn" id="wa-btn-close" title="Cerrar panel" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="14" height="14"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
      </div>
      <div class="wa-body">
        <aside class="wa-chatlist" role="listbox" aria-label="Lista de chats">
          <div class="wa-chatlist-empty">Sin chats todavía.</div>
        </aside>
        <section class="wa-convo">
          <div class="wa-convo-empty">
            <div class="wa-convo-empty-inner">Selecciona un chat para empezar.</div>
          </div>
        </section>
      </div>
    `

    return root
  }

  function buildConvo() {
    const wrap = el('div', { cls: 'wa-convo-inner' })
    wrap.innerHTML = `
      <div class="wa-convo-header">
        <div class="wa-convo-avatar"></div>
        <div class="wa-convo-id">
          <div class="wa-convo-name"></div>
          <div class="wa-convo-jid"></div>
        </div>
        <div class="wa-mode-wrap">
          <div class="wa-mode-switch" role="switch" tabindex="0" aria-label="Modo">
            <span class="wa-mode-thumb"></span>
            <span class="wa-mode-label-auto">AUTO</span>
            <span class="wa-mode-label-manual">MANUAL</span>
          </div>
          <div class="wa-mode-note"></div>
        </div>
      </div>
      <div class="wa-handover-banner hidden"></div>
      <div class="wa-convo-body" aria-live="polite"></div>
      <div class="wa-convo-footer">
        <button class="icon-btn small wa-footer-btn" id="wa-btn-attach" title="Adjuntar" aria-label="Adjuntar">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <button class="icon-btn small wa-footer-btn" id="wa-btn-mic" title="Mantén pulsado para grabar" aria-label="Grabar audio">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
        </button>
        <textarea class="wa-input" rows="1" placeholder="Escribe como Luismi…" aria-label="Mensaje"></textarea>
        <button class="icon-btn wa-send-btn" id="wa-btn-send" title="Enviar (Enter)" aria-label="Enviar" disabled>
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 12l18-9-4 18-7-7-7 3z" fill="currentColor" stroke="none"/></svg>
        </button>
        <div class="wa-rec-indicator hidden">
          <span class="wa-rec-dot"></span>
          <span class="wa-rec-time">0:00</span>
        </div>
      </div>
    `
    return wrap
  }

  function buildModals() {
    // QR modal
    const qr = el('div', { attrs: { id: 'wa-qr-modal' }, cls: 'wa-modal hidden' })
    qr.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-panel wa-modal-panel">
        <div class="modal-header">
          <span class="modal-title">Vincular WhatsApp</span>
          <span class="modal-sub">Escanea con tu teléfono</span>
          <button class="modal-close" data-close="wa-qr-modal">×</button>
        </div>
        <div class="wa-qr-body">
          <pre class="wa-qr-render" aria-label="código QR"></pre>
          <div class="wa-qr-note">Si no aparece nada, abre WhatsApp → Dispositivos vinculados → Vincular dispositivo.</div>
        </div>
      </div>
    `

    // Config modal
    const cfg = el('div', { attrs: { id: 'wa-cfg-modal' }, cls: 'wa-modal hidden' })
    cfg.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-panel settings wa-modal-panel">
        <div class="modal-header">
          <span class="modal-title">Configuración WhatsApp</span>
          <span class="modal-sub">Persona y autorizados</span>
          <button class="modal-close" data-close="wa-cfg-modal">×</button>
        </div>
        <div class="wa-cfg-tabs">
          <button class="wa-cfg-tab active" data-tab="general">General</button>
          <button class="wa-cfg-tab" data-tab="allowlist">Allowlist</button>
        </div>
        <div class="wa-cfg-body">
          <div class="wa-cfg-pane" data-pane="general">
            <label class="settings-check">
              <input type="checkbox" id="wa-cfg-autoreply" />
              <span>Auto-respuesta global activada</span>
            </label>
            <label class="settings-field">
              <span>Ruta al persona.md</span>
              <input type="text" id="wa-cfg-persona" placeholder="/ruta/al/persona.md" />
            </label>
            <div class="wa-cfg-actions">
              <button class="icon-btn text-btn" id="wa-cfg-open-persona">Abrir persona</button>
              <button class="icon-btn text-btn" id="wa-cfg-reload-persona">Recargar persona</button>
            </div>
          </div>
          <div class="wa-cfg-pane hidden" data-pane="allowlist">
            <div class="wa-cfg-allow-row">
              <input type="text" id="wa-cfg-allow-input" placeholder="+34 600 000 000" />
              <button class="icon-btn text-btn primary" id="wa-cfg-allow-add">Añadir</button>
            </div>
            <ul class="wa-cfg-allow-list" id="wa-cfg-allow-list"></ul>
          </div>
        </div>
        <div class="settings-actions">
          <span class="settings-note" id="wa-cfg-status"></span>
          <button class="icon-btn text-btn primary" id="wa-cfg-save">Guardar</button>
        </div>
      </div>
    `

    // Image viewer
    const img = el('div', { attrs: { id: 'wa-img-modal' }, cls: 'wa-modal hidden' })
    img.innerHTML = `
      <div class="modal-backdrop" data-close="wa-img-modal"></div>
      <div class="wa-img-viewer">
        <img alt="Imagen" />
        <button class="modal-close wa-img-close" data-close="wa-img-modal">×</button>
      </div>
    `

    return { qr, cfg, img }
  }

  // ── Renderizado ──
  function renderChatList() {
    chatListEl.innerHTML = ''
    if (!chats.length) {
      const empty = el('div', { cls: 'wa-chatlist-empty', text: bridgeReady ? 'Sin chats todavía.' : 'WhatsApp bridge no disponible.' })
      chatListEl.appendChild(empty)
      return
    }
    const sorted = [...chats].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
    for (const c of sorted) {
      const row = el('div', { cls: 'wa-chat-row', attrs: { role: 'option', tabindex: '0' } })
      if (c.jid === currentJid) row.classList.add('active')
      if (c.unread > 0) row.classList.add('has-unread')
      const last = c.lastMessage
      row.innerHTML = `
        <div class="wa-chat-avatar"><span>${escapeHtml(initials(c.displayNumber))}</span></div>
        <div class="wa-chat-main">
          <div class="wa-chat-top">
            <span class="wa-chat-name">${escapeHtml(c.displayNumber || c.jid)}</span>
            <span class="wa-chat-time">${escapeHtml(last ? fmtRelative(last.timestamp) : '')}</span>
          </div>
          <div class="wa-chat-bottom">
            <span class="wa-chat-preview">${escapeHtml(previewFromMessage(last))}</span>
            <span class="wa-chat-flags">
              <span class="wa-mode-dot ${c.mode === 'auto' ? 'auto' : 'manual'}" title="${c.mode === 'auto' ? 'AUTO' : 'MANUAL'}"></span>
              ${c.unread > 0 ? `<span class="wa-unread-badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
            </span>
          </div>
        </div>
      `
      row.addEventListener('click', () => selectChat(c.jid))
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectChat(c.jid) }
      })
      chatListEl.appendChild(row)
    }
  }

  function renderConvo() {
    if (!currentJid) {
      convoEl.innerHTML = `
        <div class="wa-convo-empty">
          <div class="wa-convo-empty-inner">Selecciona un chat para empezar.</div>
        </div>
      `
      return
    }
    const chat = chats.find(c => c.jid === currentJid)
    if (!chat) return

    convoEl.innerHTML = ''
    const inner = buildConvo()
    convoEl.appendChild(inner)

    convoHeaderEl = $('.wa-convo-header', inner)
    convoBodyEl = $('.wa-convo-body', inner)
    convoFooterEl = $('.wa-convo-footer', inner)
    modeSwitchEl = $('.wa-mode-switch', inner)
    modeNoteEl = $('.wa-mode-note', inner)
    handoverBannerEl = $('.wa-handover-banner', inner)
    inputEl = $('.wa-input', inner)
    sendBtnEl = $('#wa-btn-send', inner)
    attachBtnEl = $('#wa-btn-attach', inner)
    micBtnEl = $('#wa-btn-mic', inner)
    recIndicatorEl = $('.wa-rec-indicator', inner)

    $('.wa-convo-avatar', inner).textContent = initials(chat.displayNumber)
    $('.wa-convo-name', inner).textContent = chat.displayNumber || chat.jid
    $('.wa-convo-jid', inner).textContent = chat.jid

    updateModeSwitch(chat.mode)
    renderMessages()
    bindFooter(chat)
    bindModeSwitch(chat)

    // hand-over banner si pasó a manual recientemente
    if (chat._handoverAt && Date.now() - chat._handoverAt < 30000) {
      handoverBannerEl.classList.remove('hidden')
      handoverBannerEl.textContent = 'Cambiado a MANUAL porque escribiste desde otro dispositivo.'
    }
  }

  function updateModeSwitch(mode) {
    if (!modeSwitchEl) return
    modeSwitchEl.classList.toggle('manual', mode === 'manual')
    modeSwitchEl.setAttribute('aria-checked', mode === 'auto' ? 'true' : 'false')
    if (modeNoteEl) {
      modeNoteEl.textContent = mode === 'auto'
        ? 'Claude responde automáticamente como asistente de Luismi'
        : 'Solo tú respondes — Claude está silenciado'
      modeNoteEl.classList.toggle('manual', mode === 'manual')
    }
  }

  function renderMessages() {
    if (!convoBodyEl) return
    const prevScrollFromBottom = convoBodyEl.scrollHeight - convoBodyEl.scrollTop - convoBodyEl.clientHeight
    const stickBottom = prevScrollFromBottom < 80
    convoBodyEl.innerHTML = ''
    const chat = chats.find(c => c.jid === currentJid)
    const isAutoChat = chat && chat.mode === 'auto'
    const transcripts = loadTranscripts()
    for (const m of currentMessages) {
      const bubble = renderBubble(m, isAutoChat, transcripts)
      convoBodyEl.appendChild(bubble)
    }
    if (stickBottom) convoBodyEl.scrollTop = convoBodyEl.scrollHeight
  }

  function renderBubble(m, isAutoChat, transcripts) {
    const row = el('div', { cls: `wa-bubble-row ${m.fromMe ? 'me' : 'them'}` })
    const bubble = el('div', { cls: `wa-bubble wa-bubble-${m.type || 'text'}` })

    // Prefijo bot si fromMe + chat auto
    if (m.fromMe && isAutoChat) {
      bubble.appendChild(el('div', { cls: 'wa-bubble-bot', text: '🤖 Claude' }))
    }

    // Cuerpo según tipo
    if (m.type === 'image' && m.mediaUrl) {
      const img = el('img', { cls: 'wa-bubble-img', attrs: { src: m.mediaUrl, alt: 'imagen' } })
      img.addEventListener('click', () => openImageViewer(m.mediaUrl))
      bubble.appendChild(img)
      if (m.body) bubble.appendChild(el('div', { cls: 'wa-bubble-caption', text: m.body }))
    } else if (m.type === 'audio' && m.mediaUrl) {
      const audio = el('audio', { attrs: { controls: '', src: m.mediaUrl }, cls: 'wa-bubble-audio' })
      bubble.appendChild(audio)
      const cached = m.transcript || transcripts[m.id]
      const tWrap = el('div', { cls: 'wa-bubble-transcript' })
      if (cached) {
        tWrap.textContent = cached
      } else {
        const btn = el('button', { cls: 'wa-transcribe-btn', text: 'Transcribir' })
        btn.addEventListener('click', async () => {
          btn.disabled = true
          btn.textContent = 'Transcribiendo…'
          try {
            const res = await wa.transcribeAudio(m.mediaPath || m.mediaUrl)
            const text = (res && res.text) || ''
            saveTranscript(m.id, text)
            tWrap.textContent = text || '(sin texto)'
          } catch (e) {
            tWrap.textContent = '(error transcribiendo)'
          }
        })
        tWrap.appendChild(btn)
      }
      bubble.appendChild(tWrap)
    } else if (m.type === 'video' && m.mediaUrl) {
      const v = el('video', { cls: 'wa-bubble-video', attrs: { controls: '', src: m.mediaUrl } })
      bubble.appendChild(v)
      if (m.body) bubble.appendChild(el('div', { cls: 'wa-bubble-caption', text: m.body }))
    } else if (m.type === 'document') {
      const link = el('a', { cls: 'wa-bubble-doc', html: `📎 ${escapeHtml(m.body || 'archivo')}` })
      if (m.mediaUrl) link.href = m.mediaUrl
      link.target = '_blank'
      bubble.appendChild(link)
    } else if (m.type === 'sticker' && m.mediaUrl) {
      bubble.appendChild(el('img', { cls: 'wa-bubble-sticker', attrs: { src: m.mediaUrl, alt: 'sticker' } }))
    } else {
      bubble.appendChild(el('div', { cls: 'wa-bubble-text', text: m.body || '' }))
    }

    const meta = el('div', { cls: 'wa-bubble-meta' })
    meta.appendChild(el('span', { cls: 'wa-bubble-time', text: m.timestamp ? fmtTime(m.timestamp) : '' }))
    if (m.fromMe) meta.appendChild(el('span', { cls: 'wa-bubble-check', text: '✓' }))
    bubble.appendChild(meta)

    row.appendChild(bubble)
    return row
  }

  // ── Acciones ──
  async function selectChat(jid) {
    currentJid = jid
    try { localStorage.setItem(LS_LAST_CHAT, jid) } catch {}
    renderChatList()
    renderConvo()
    if (!wa) return
    try { await wa.markRead(jid) } catch {}
    try {
      const msgs = await wa.getHistory(jid, { limit: 200 })
      currentMessages = Array.isArray(msgs) ? msgs : []
      renderMessages()
      // forzar scroll abajo al abrir chat
      if (convoBodyEl) convoBodyEl.scrollTop = convoBodyEl.scrollHeight
    } catch (e) {
      console.warn('[wa] getHistory error', e)
      currentMessages = []
      renderMessages()
    }
    // refrescar lista para limpiar unread
    refreshChats()
  }

  async function refreshChats() {
    if (!wa) return
    try {
      const list = await wa.getChats()
      chats = Array.isArray(list) ? list : []
      updateUnreadBadge()
      renderChatList()
    } catch (e) {
      console.warn('[wa] getChats error', e)
    }
  }

  async function refreshStatus() {
    if (!wa) {
      updateStatusUI()
      return
    }
    try {
      const s = await wa.getStatus()
      status = Object.assign(status, s || {})
      updateStatusUI()
    } catch (e) {
      console.warn('[wa] getStatus error', e)
    }
  }

  function updateStatusUI() {
    if (statusDotEl) {
      statusDotEl.classList.remove('wa-status-off', 'wa-status-pending', 'wa-status-on')
      if (!bridgeReady) statusDotEl.classList.add('wa-status-off')
      else if (status.connected) statusDotEl.classList.add('wa-status-on')
      else if (status.qrPresent) statusDotEl.classList.add('wa-status-pending')
      else statusDotEl.classList.add('wa-status-off')
    }
    const sub = $('#wa-header-sub', panelEl)
    if (sub) {
      if (!bridgeReady) sub.textContent = 'bridge no disponible'
      else if (status.connected) sub.textContent = status.ownerNumber ? `conectado · ${status.ownerNumber}` : 'conectado'
      else if (status.qrPresent) sub.textContent = 'esperando QR…'
      else sub.textContent = 'desconectado'
    }
    // habilitar/deshabilitar botones del header
    const qrBtn = $('#wa-btn-qr', panelEl)
    if (qrBtn) qrBtn.classList.toggle('attention', !!status.qrPresent && !status.connected)
  }

  function updateUnreadBadge() {
    const total = chats.reduce((acc, c) => acc + (c.unread || 0), 0)
    if (!unreadBadgeEl) return
    if (total > 0) {
      unreadBadgeEl.textContent = total > 99 ? '99+' : String(total)
      unreadBadgeEl.classList.remove('hidden')
    } else {
      unreadBadgeEl.classList.add('hidden')
    }
    toggleBtn.classList.toggle('wa-has-unread', total > 0)
    toggleBtn.classList.toggle('wa-connected', !!status.connected)
  }

  // ── Footer (input, adjuntar, micro) ──
  function bindFooter(chat) {
    if (!inputEl) return
    inputEl.addEventListener('input', () => {
      sendBtnEl.disabled = !inputEl.value.trim()
      autosize(inputEl)
    })
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendCurrentText()
      }
    })
    sendBtnEl.addEventListener('click', sendCurrentText)
    attachBtnEl.addEventListener('click', attachAndSend)

    // Micro: pulsar y mantener
    let pressed = false
    const start = (ev) => {
      ev.preventDefault()
      if (pressed) return
      pressed = true
      startRecording()
    }
    const stop = (ev) => {
      ev.preventDefault()
      if (!pressed) return
      pressed = false
      stopRecording(true)
    }
    micBtnEl.addEventListener('mousedown', start)
    micBtnEl.addEventListener('touchstart', start, { passive: false })
    window.addEventListener('mouseup', stop)
    window.addEventListener('touchend', stop)
  }

  function autosize(ta) {
    ta.style.height = 'auto'
    const lineH = 20
    const max = lineH * 4 + 16
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px'
  }

  async function sendCurrentText() {
    if (!wa || !currentJid) return
    const text = inputEl.value.trim()
    if (!text) return
    inputEl.disabled = true
    sendBtnEl.disabled = true
    try {
      const res = await wa.sendText(currentJid, text)
      if (res && res.ok) {
        inputEl.value = ''
        autosize(inputEl)
        // optimistic: añadir burbuja local
        currentMessages.push({
          id: res.id || `local-${Date.now()}`,
          jid: currentJid,
          fromMe: true,
          timestamp: Date.now(),
          type: 'text',
          body: text
        })
        renderMessages()
        // backend pasa a manual al enviar — refrescar
        await refreshChats()
        const chat = chats.find(c => c.jid === currentJid)
        if (chat) updateModeSwitch(chat.mode)
      } else {
        showInputError(res && res.error || 'Error enviando')
      }
    } catch (e) {
      showInputError(e.message || 'Error enviando')
    } finally {
      inputEl.disabled = false
      sendBtnEl.disabled = !inputEl.value.trim()
      inputEl.focus()
    }
  }

  function showInputError(msg) {
    if (!inputEl) return
    const prev = inputEl.placeholder
    inputEl.placeholder = msg
    inputEl.classList.add('wa-input-err')
    setTimeout(() => {
      inputEl.placeholder = prev
      inputEl.classList.remove('wa-input-err')
    }, 2500)
  }

  async function attachAndSend() {
    if (!wa || !currentJid) return
    // Detección simple por extensión usando pickFile; si es imagen, sendImage; doc en caso contrario
    if (!window.api || !window.api.pickFile) {
      showInputError('Adjuntar no disponible')
      return
    }
    const picked = await window.api.pickFile()
    if (!picked) return
    const path = typeof picked === 'string' ? picked : (picked.path || picked.filePath)
    if (!path) return
    const ext = (path.split('.').pop() || '').toLowerCase()
    const caption = inputEl.value.trim()
    try {
      let res
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
        res = await wa.sendImage(currentJid, path, caption)
      } else if (['mp3', 'ogg', 'opus', 'm4a', 'wav', 'webm'].includes(ext)) {
        res = await wa.sendAudio(currentJid, path, false)
      } else {
        res = await wa.sendDocument(currentJid, path, caption)
      }
      if (res && res.ok) {
        inputEl.value = ''
        await refreshChats()
        const msgs = await wa.getHistory(currentJid, { limit: 200 })
        currentMessages = Array.isArray(msgs) ? msgs : currentMessages
        renderMessages()
      } else {
        showInputError(res && res.error || 'Error adjuntando')
      }
    } catch (e) {
      showInputError(e.message || 'Error adjuntando')
    }
  }

  // ── Grabador de audio ──
  async function startRecording() {
    if (recording) return
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showInputError('Micrófono no disponible')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime })
      recordedChunks = []
      mediaRecorder.addEventListener('dataavailable', e => { if (e.data && e.data.size) recordedChunks.push(e.data) })
      mediaRecorder.addEventListener('stop', () => {
        stream.getTracks().forEach(t => t.stop())
      })
      mediaRecorder.start()
      recording = true
      recStart = Date.now()
      micBtnEl.classList.add('recording')
      recIndicatorEl.classList.remove('hidden')
      updateRecTime()
      recTimer = setInterval(updateRecTime, 250)
    } catch (e) {
      showInputError('No se pudo acceder al micrófono')
    }
  }

  function updateRecTime() {
    if (!recIndicatorEl) return
    const s = Math.floor((Date.now() - recStart) / 1000)
    const mm = String(Math.floor(s / 60))
    const ss = String(s % 60).padStart(2, '0')
    const lbl = $('.wa-rec-time', recIndicatorEl)
    if (lbl) lbl.textContent = `${mm}:${ss}`
  }

  async function stopRecording(send) {
    if (!recording) return
    recording = false
    if (recTimer) { clearInterval(recTimer); recTimer = null }
    if (micBtnEl) micBtnEl.classList.remove('recording')
    if (recIndicatorEl) recIndicatorEl.classList.add('hidden')

    return new Promise((resolve) => {
      if (!mediaRecorder) return resolve()
      mediaRecorder.addEventListener('stop', async () => {
        if (!send) return resolve()
        try {
          const blob = new Blob(recordedChunks, { type: 'audio/webm' })
          if (blob.size < 1000) {
            showInputError('Grabación demasiado corta')
            return resolve()
          }
          const arr = await blob.arrayBuffer()
          const b64 = bufferToBase64(arr)
          // Convención propuesta: el backend acepta base64 con prefijo data:audio/webm;base64,
          // o filePath. Probamos primero base64; si falla, escribimos a tmp con fileWrite.
          const dataUrl = `data:audio/webm;base64,${b64}`
          let res = null
          try {
            res = await wa.sendAudio(currentJid, dataUrl, true)
          } catch (e) {
            res = { ok: false, error: e.message || 'sendAudio error' }
          }
          if (!res || !res.ok) {
            // Fallback: intentar escribir a tmp si fileWrite existe
            if (window.api && window.api.fileWrite) {
              const tmp = `/tmp/poweragent-wa-rec-${Date.now()}.webm`
              try {
                await window.api.fileWrite(tmp, b64)
                res = await wa.sendAudio(currentJid, tmp, true)
              } catch (e) {
                res = { ok: false, error: e.message || 'no se pudo persistir audio' }
              }
            }
          }
          if (res && res.ok) {
            await refreshChats()
            const msgs = await wa.getHistory(currentJid, { limit: 200 })
            currentMessages = Array.isArray(msgs) ? msgs : currentMessages
            renderMessages()
          } else {
            showInputError(res && res.error || 'Error enviando audio')
          }
        } catch (e) {
          showInputError(e.message || 'Error enviando audio')
        } finally {
          resolve()
        }
      }, { once: true })
      try { mediaRecorder.stop() } catch (e) { resolve() }
    })
  }

  function bufferToBase64(buf) {
    let binary = ''
    const bytes = new Uint8Array(buf)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  }

  // ── Modo switch ──
  function bindModeSwitch(chat) {
    const fire = async () => {
      if (!wa) return
      const next = (chat.mode === 'auto') ? 'manual' : 'auto'
      try {
        const r = await wa.setMode(chat.jid, next)
        if (r && r.ok) {
          chat.mode = next
          updateModeSwitch(next)
          renderChatList()
        }
      } catch (e) { console.warn('[wa] setMode error', e) }
    }
    modeSwitchEl.addEventListener('click', fire)
    modeSwitchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire() }
    })
  }

  // ── Visor de imagen ──
  function openImageViewer(src) {
    if (!imgViewerEl) return
    const img = $('img', imgViewerEl)
    img.src = src
    imgViewerEl.classList.remove('hidden')
  }

  // ── Modal QR ──
  async function openQrModal() {
    if (!wa) return
    qrModalEl.classList.remove('hidden')
    const pre = $('.wa-qr-render', qrModalEl)
    pre.textContent = 'Cargando…'
    try {
      const r = await wa.getQR()
      if (r && r.qr) {
        pre.textContent = renderQrAscii(r.qr)
      } else {
        pre.textContent = '(sin QR pendiente — quizá ya está conectado)'
      }
    } catch (e) {
      pre.textContent = '(error obteniendo QR)'
    }
  }

  // Render mínimo: el backend devuelve string ya en formato bloques (██  ██), lo pintamos tal cual.
  // Si llega como matriz/JSON, fallback simple.
  function renderQrAscii(qr) {
    if (typeof qr === 'string') return qr
    if (Array.isArray(qr)) {
      return qr.map(row => row.map(v => (v ? '██' : '  ')).join('')).join('\n')
    }
    return String(qr)
  }

  // ── Modal config ──
  async function openCfgModal() {
    if (!wa) return
    cfgModalEl.classList.remove('hidden')
    try {
      const c = await wa.getConfig()
      $('#wa-cfg-autoreply', cfgModalEl).checked = !!(c && c.autoReply)
      $('#wa-cfg-persona', cfgModalEl).value = (c && c.personaPath) || ''
      renderAllowlist((c && c.authorizedNumbers) || [])
    } catch (e) {
      $('#wa-cfg-status', cfgModalEl).textContent = 'Error cargando config'
    }
  }

  function renderAllowlist(list) {
    const ul = $('#wa-cfg-allow-list', cfgModalEl)
    ul.innerHTML = ''
    for (const n of list) {
      const li = el('li', { cls: 'wa-cfg-allow-item' })
      li.innerHTML = `<span>${escapeHtml(n)}</span><button class="wa-cfg-allow-del">×</button>`
      $('button', li).addEventListener('click', () => {
        const current = currentAllowlist().filter(x => x !== n)
        renderAllowlist(current)
      })
      ul.appendChild(li)
    }
  }

  function currentAllowlist() {
    const items = cfgModalEl.querySelectorAll('.wa-cfg-allow-item span')
    return Array.from(items).map(s => s.textContent)
  }

  function bindCfgModal() {
    cfgModalEl.querySelectorAll('.wa-cfg-tab').forEach(t => {
      t.addEventListener('click', () => {
        cfgModalEl.querySelectorAll('.wa-cfg-tab').forEach(x => x.classList.remove('active'))
        t.classList.add('active')
        const tab = t.dataset.tab
        cfgModalEl.querySelectorAll('.wa-cfg-pane').forEach(p => {
          p.classList.toggle('hidden', p.dataset.pane !== tab)
        })
      })
    })
    $('#wa-cfg-allow-add', cfgModalEl).addEventListener('click', () => {
      const inp = $('#wa-cfg-allow-input', cfgModalEl)
      const v = inp.value.trim()
      if (!v) return
      const cur = currentAllowlist()
      if (cur.includes(v)) return
      renderAllowlist([...cur, v])
      inp.value = ''
    })
    $('#wa-cfg-save', cfgModalEl).addEventListener('click', async () => {
      const partial = {
        autoReply: $('#wa-cfg-autoreply', cfgModalEl).checked,
        personaPath: $('#wa-cfg-persona', cfgModalEl).value.trim(),
        authorizedNumbers: currentAllowlist()
      }
      $('#wa-cfg-status', cfgModalEl).textContent = 'Guardando…'
      try {
        const r = await wa.saveConfig(partial)
        $('#wa-cfg-status', cfgModalEl).textContent = (r && r.ok) ? 'Guardado.' : 'Error guardando'
      } catch (e) {
        $('#wa-cfg-status', cfgModalEl).textContent = e.message || 'Error guardando'
      }
    })
    $('#wa-cfg-reload-persona', cfgModalEl).addEventListener('click', async () => {
      $('#wa-cfg-status', cfgModalEl).textContent = 'Recargando persona…'
      try {
        const r = await wa.saveConfig({ reloadPersona: true })
        $('#wa-cfg-status', cfgModalEl).textContent = (r && r.ok) ? 'Persona recargada.' : 'Error'
      } catch (e) {
        $('#wa-cfg-status', cfgModalEl).textContent = e.message || 'Error'
      }
    })
  }

  // ── Apertura/cierre del panel ──
  function togglePanel(force) {
    const open = (typeof force === 'boolean') ? force : panelEl.classList.contains('hidden')
    if (open) {
      panelEl.classList.remove('hidden')
      requestAnimationFrame(() => panelEl.classList.add('wa-open'))
      try { localStorage.setItem(LS_PANEL_OPEN, '1') } catch {}
      toggleBtn.classList.add('active')
      // refrescar al abrir
      refreshStatus(); refreshChats()
    } else {
      panelEl.classList.remove('wa-open')
      setTimeout(() => panelEl.classList.add('hidden'), 200)
      try { localStorage.setItem(LS_PANEL_OPEN, '0') } catch {}
      toggleBtn.classList.remove('active')
    }
  }

  // ── Redimensión del panel ──
  function bindResize() {
    const handle = $('.wa-resizer', panelEl)
    if (!handle) return
    let startX = 0
    let startW = 0
    const onMove = (e) => {
      const dx = startX - e.clientX
      const next = Math.max(320, Math.min(720, startW + dx))
      panelEl.style.width = next + 'px'
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const w = parseInt(panelEl.style.width, 10)
      if (w > 0) try { localStorage.setItem(LS_PANEL_W, String(w)) } catch {}
      document.body.classList.remove('wa-resizing')
    }
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault()
      startX = e.clientX
      startW = panelEl.getBoundingClientRect().width
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      document.body.classList.add('wa-resizing')
    })
  }

  // ── Atajo teclado ──
  function bindShortcut() {
    window.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.shiftKey && e.key.toLowerCase() === 'w') {
        // evita interferir con cerrar ventana solo si la combinación es exacta cmd+shift+w
        e.preventDefault()
        togglePanel()
      }
      if (e.key === 'Escape') {
        if (!qrModalEl.classList.contains('hidden')) { qrModalEl.classList.add('hidden'); return }
        if (!cfgModalEl.classList.contains('hidden')) { cfgModalEl.classList.add('hidden'); return }
        if (!imgViewerEl.classList.contains('hidden')) { imgViewerEl.classList.add('hidden'); return }
      }
    })
  }

  // ── Eventos del bridge ──
  function bindBridgeEvents() {
    if (!wa) return
    if (wa.onNewMessage) {
      const u = wa.onNewMessage((msg) => {
        if (!msg) return
        if (msg.jid === currentJid) {
          currentMessages.push(msg)
          renderMessages()
        } else {
          // pulso visual en lista
          const row = chatListEl.querySelector(`.wa-chat-row.has-unread`)
          if (row) row.classList.add('wa-pulse')
          setTimeout(() => row && row.classList.remove('wa-pulse'), 1200)
        }
        if (panelEl.classList.contains('hidden') || !document.hasFocus()) {
          playBeep()
        }
        refreshChats()
      })
      if (typeof u === 'function') unsubs.push(u)
    }
    if (wa.onChatUpdated) {
      const u = wa.onChatUpdated((chat) => {
        if (!chat) return
        const idx = chats.findIndex(c => c.jid === chat.jid)
        // detectar hand-over a manual desde fuera
        if (idx >= 0 && chats[idx].mode === 'auto' && chat.mode === 'manual') {
          chat._handoverAt = Date.now()
        }
        if (idx >= 0) chats[idx] = chat
        else chats.push(chat)
        updateUnreadBadge()
        renderChatList()
        if (chat.jid === currentJid) {
          updateModeSwitch(chat.mode)
          if (chat._handoverAt && handoverBannerEl) {
            handoverBannerEl.classList.remove('hidden')
            handoverBannerEl.textContent = 'Cambiado a MANUAL porque escribiste desde otro dispositivo.'
            setTimeout(() => handoverBannerEl && handoverBannerEl.classList.add('hidden'), 8000)
          }
        }
      })
      if (typeof u === 'function') unsubs.push(u)
    }
    if (wa.onStatusChanged) {
      const u = wa.onStatusChanged((s) => {
        status = Object.assign(status, s || {})
        updateStatusUI()
      })
      if (typeof u === 'function') unsubs.push(u)
    }
  }

  // ── Cierre de modales (delegado) ──
  function bindModalsClose() {
    const closeBy = (id) => document.getElementById(id)?.classList.add('hidden')
    document.body.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof Element)) return
      const closeId = t.getAttribute('data-close')
      if (closeId) closeBy(closeId)
    })
    // backdrop click cierra qr y cfg
    qrModalEl.querySelector('.modal-backdrop').addEventListener('click', () => qrModalEl.classList.add('hidden'))
    cfgModalEl.querySelector('.modal-backdrop').addEventListener('click', () => cfgModalEl.classList.add('hidden'))
  }

  // ── Init ──
  function init() {
    // 1. Botón en titlebar
    toggleBtn = buildToggleButton()
    unreadBadgeEl = toggleBtn.querySelector('.wa-badge')
    const controls = document.getElementById('controls')
    // insertar antes del telegram para mantener orden lógico
    const tgWrap = document.getElementById('btn-send-telegram-wrap')
    if (controls && tgWrap) controls.insertBefore(toggleBtn, tgWrap)
    else if (controls) controls.appendChild(toggleBtn)

    // 2. Panel
    panelEl = buildPanel()
    document.body.appendChild(panelEl)
    chatListEl = $('.wa-chatlist', panelEl)
    convoEl = $('.wa-convo', panelEl)
    statusDotEl = $('.wa-status-dot', panelEl)

    // 3. Modales
    const m = buildModals()
    qrModalEl = m.qr; cfgModalEl = m.cfg; imgViewerEl = m.img
    document.body.appendChild(qrModalEl)
    document.body.appendChild(cfgModalEl)
    document.body.appendChild(imgViewerEl)

    // 4. Listeners de panel
    toggleBtn.addEventListener('click', () => togglePanel())
    $('#wa-btn-close', panelEl).addEventListener('click', () => togglePanel(false))
    $('#wa-btn-qr', panelEl).addEventListener('click', openQrModal)
    $('#wa-btn-cfg', panelEl).addEventListener('click', openCfgModal)

    bindResize()
    bindShortcut()
    bindModalsClose()
    bindCfgModal()
    bindBridgeEvents()

    // 5. Persistencia de ancho y apertura
    try {
      const w = parseInt(localStorage.getItem(LS_PANEL_W) || '', 10)
      if (w > 0) panelEl.style.width = w + 'px'
    } catch {}

    // 6. Estado inicial
    updateStatusUI()
    if (!bridgeReady) {
      // mostrar estado deshabilitado pero permitir abrir el panel para ver mensaje
      toggleBtn.classList.add('wa-disabled')
      toggleBtn.title = 'WhatsApp bridge no disponible'
    } else {
      refreshStatus()
      refreshChats().then(() => {
        try {
          const last = localStorage.getItem(LS_LAST_CHAT)
          if (last && chats.find(c => c.jid === last)) selectChat(last)
        } catch {}
      })
      // polling de respaldo cada 15s por si no hay onStatusChanged
      setInterval(() => { refreshStatus(); refreshChats() }, 15000)
    }

    // 7. Restaurar apertura
    try {
      if (localStorage.getItem(LS_PANEL_OPEN) === '1') togglePanel(true)
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
