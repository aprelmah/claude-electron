'use strict';

const api = window.tasksAPI;

const state = {
  tasks: [],
  runs: [],
  selectedId: null,
  dirty: false,
  liveRuns: new Map(),
  telegramConfigured: false,
  cronPresets: [],
  defaults: { model: '', effort: '' },
  validateTimer: null,

  // ---------- Automations ----------
  activeTab: 'tasks',
  automations: [],
  selectedAutomationId: null,
  selectedAutomation: null,        // copia local en edición (draft o installed)
  autoDirty: false,
  autoBusy: false,                 // operaciones largas (generate / install / runOnce)
  autoLogPollTimer: null,
  autoLogLastLen: 0,
  runningAutomationIds: new Set(),
  autoRunningPollTimer: null,
  autoRunningStartedAt: new Map(), // id -> ts ms al detectar running por primera vez
};

const SCHED_TYPES = ['interval-min', 'interval-hour', 'daily', 'weekly', 'monthly', 'once', 'advanced'];
const DOW_LETTERS = { 0: 'D', 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S' };
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // L..D para visualización

const MODELS = {
  claude: [
    { value: '', label: 'Default' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
  ],
  codex: [
    { value: '', label: 'Default' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'o3-mini', label: 'o3-mini' },
    { value: 'o3', label: 'o3' },
  ],
};

const EFFORTS = {
  claude: [
    { value: '', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Xhigh' },
    { value: 'max', label: 'Max' },
  ],
  codex: [
    { value: '', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function fmtDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return ms + 'ms';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m + 'm ' + r + 's';
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const fwd = diff < 0;
  if (abs < 60_000) return fwd ? 'en segundos' : 'hace un momento';
  const m = Math.round(abs / 60_000);
  if (m < 60) return fwd ? `en ${m}min` : `hace ${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return fwd ? `en ${h}h` : `hace ${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return fwd ? `en ${d}d` : `hace ${d}d`;
  const dt = new Date(iso);
  return dt.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtAbs(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  const today = new Date();
  const sameDay = dt.toDateString() === today.toDateString();
  if (sameDay) return 'Hoy ' + dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (dt.toDateString() === y.toDateString()) return 'Ayer ' + dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return dt.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatNextRun(dt) {
  if (!(dt instanceof Date) || isNaN(dt.getTime())) return '—';
  const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const hhmm = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `hoy ${hhmm}`;
  if (dt.toDateString() === tomorrow.toDateString()) return `mañana ${hhmm}`;
  const diffDays = Math.round((dt - now) / 86400000);
  if (diffDays >= 0 && diffDays < 7) {
    const dow = dt.toLocaleDateString('es-ES', { weekday: 'long' });
    return `${dow} ${hhmm}`;
  }
  const date = dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `${date} ${hhmm}`;
}

// ---------- Schedule helpers ----------

function parseHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function parseDate(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

function scheduleToCron(s) {
  if (!s || typeof s !== 'object') return { error: 'Configuración vacía' };
  switch (s.type) {
    case 'interval-min': {
      const n = Number(s.every);
      if (!Number.isInteger(n) || n < 1) return { error: 'Minutos debe ser un entero ≥ 1' };
      if (n >= 60) return { error: 'Usa "Cada X horas" si pasa de 59 minutos' };
      return { cron: n === 1 ? '* * * * *' : `*/${n} * * * *` };
    }
    case 'interval-hour': {
      const n = Number(s.every);
      if (!Number.isInteger(n) || n < 1) return { error: 'Horas debe ser un entero ≥ 1' };
      if (n > 23) return { error: 'Máximo 23 horas' };
      return { cron: n === 1 ? '0 * * * *' : `0 */${n} * * *` };
    }
    case 'daily': {
      const t = parseHHMM(s.time);
      if (!t) return { error: 'Hora inválida' };
      return { cron: `${t.mm} ${t.hh} * * *` };
    }
    case 'weekly': {
      const t = parseHHMM(s.time);
      if (!t) return { error: 'Hora inválida' };
      const days = Array.isArray(s.weekdays) ? s.weekdays.filter((d) => d >= 0 && d <= 6) : [];
      if (!days.length) return { error: 'Selecciona al menos un día' };
      const uniq = [...new Set(days)].sort((a, b) => a - b);
      return { cron: `${t.mm} ${t.hh} * * ${uniq.join(',')}` };
    }
    case 'monthly': {
      const t = parseHHMM(s.time);
      if (!t) return { error: 'Hora inválida' };
      const d = Number(s.dayOfMonth);
      if (!Number.isInteger(d) || d < 1 || d > 28) return { error: 'Día del mes debe estar entre 1 y 28' };
      return { cron: `${t.mm} ${t.hh} ${d} * *` };
    }
    case 'once': {
      const t = parseHHMM(s.time);
      if (!t) return { error: 'Hora inválida' };
      const dd = parseDate(s.date);
      if (!dd) return { error: 'Fecha inválida' };
      // Check no en pasado (mejor esfuerzo, deja pasar mismo día)
      const target = new Date(dd.y, dd.mo - 1, dd.d, t.hh, t.mm, 0);
      if (isNaN(target.getTime())) return { error: 'Fecha inválida' };
      if (target.getTime() < Date.now() - 60_000) return { error: 'La fecha ya pasó' };
      return { cron: `${t.mm} ${t.hh} ${dd.d} ${dd.mo} *` };
    }
    case 'advanced': {
      const expr = (s.expr || '').trim();
      if (!expr) return { error: 'Cron vacío' };
      if (expr.split(/\s+/).length !== 5) return { error: 'Cron debe tener 5 campos' };
      return { cron: expr };
    }
    default:
      return { error: 'Tipo de frecuencia desconocido' };
  }
}

function cronToSchedule(cron) {
  const expr = (cron || '').trim();
  if (!expr) return { type: 'daily', time: '09:00' };
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { type: 'advanced', expr };
  const [m, h, dom, mon, dow] = parts;

  // interval-min: */N * * * *
  let mm = m.match(/^\*\/(\d+)$/);
  if (mm && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = parseInt(mm[1], 10);
    if (n >= 1 && n <= 59) return { type: 'interval-min', every: n };
  }
  if (m === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { type: 'interval-min', every: 1 };
  }

  // interval-hour: 0 */N * * *
  mm = h.match(/^\*\/(\d+)$/);
  if (m === '0' && mm && dom === '*' && mon === '*' && dow === '*') {
    const n = parseInt(mm[1], 10);
    if (n >= 1 && n <= 23) return { type: 'interval-hour', every: n };
  }
  if (m === '0' && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { type: 'interval-hour', every: 1 };
  }

  const numM = m.match(/^\d+$/);
  const numH = h.match(/^\d+$/);

  // daily: MM HH * * *
  if (numM && numH && dom === '*' && mon === '*' && dow === '*') {
    return { type: 'daily', time: pad2(h) + ':' + pad2(m) };
  }

  // weekly: MM HH * * dows
  if (numM && numH && dom === '*' && mon === '*' && dow !== '*') {
    const dows = dow.split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 0 && x <= 6);
    if (dows.length) return { type: 'weekly', time: pad2(h) + ':' + pad2(m), weekdays: dows };
  }

  // monthly: MM HH D * *
  if (numM && numH && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
    const d = parseInt(dom, 10);
    if (d >= 1 && d <= 28) return { type: 'monthly', time: pad2(h) + ':' + pad2(m), dayOfMonth: d };
  }

  return { type: 'advanced', expr };
}

function pad2(n) {
  const s = String(parseInt(n, 10));
  return s.length < 2 ? '0' + s : s;
}

function formatWeekdaysSummary(dows) {
  if (!dows || !dows.length) return '';
  const set = new Set(dows);
  // Compactar consecutivos en orden L..D
  const seq = DOW_ORDER.filter((d) => set.has(d));
  if (!seq.length) return '';
  // Detectar runs consecutivos en DOW_ORDER
  const runs = [];
  let start = 0;
  for (let i = 1; i <= seq.length; i++) {
    const prevIdx = DOW_ORDER.indexOf(seq[i - 1]);
    const curIdx = i < seq.length ? DOW_ORDER.indexOf(seq[i]) : -2;
    if (curIdx !== prevIdx + 1) {
      runs.push(seq.slice(start, i));
      start = i;
    }
  }
  return runs.map((r) => {
    if (r.length >= 3) return DOW_LETTERS[r[0]] + '-' + DOW_LETTERS[r[r.length - 1]];
    return r.map((d) => DOW_LETTERS[d]).join(', ');
  }).join(', ');
}

function scheduleSummary(task) {
  const s = task && task.schedule;
  const fallback = task && task.cron ? cronToSchedule(task.cron) : null;
  const sched = s || fallback;
  if (!sched) return task && task.cron ? ('cron: ' + task.cron) : '';
  switch (sched.type) {
    case 'interval-min': return `Cada ${sched.every} min`;
    case 'interval-hour': return `Cada ${sched.every} h`;
    case 'daily': return `Diario a las ${sched.time}`;
    case 'weekly': return `${formatWeekdaysSummary(sched.weekdays)} a las ${sched.time}`;
    case 'monthly': return `Día ${sched.dayOfMonth} a las ${sched.time}`;
    case 'once': {
      const d = parseDate(sched.date);
      if (!d) return 'Una vez';
      return `Una vez: ${d.d}/${d.mo} ${sched.time}`;
    }
    case 'advanced': return 'cron: ' + (sched.expr || task.cron || '');
    default: return task && task.cron ? ('cron: ' + task.cron) : '';
  }
}

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = '';
  void t.offsetWidth;
  t.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.className = ''; }, 3500);
}

function renderList() {
  const host = $('#list-scroll');
  host.innerHTML = '';
  if (!state.tasks.length) {
    host.appendChild(el('div', { class: 'empty-state' }, 'Sin tareas. Pulsa + Nueva.'));
    return;
  }
  for (const task of state.tasks) {
    const dot = el('div', { class: 'task-status-dot' + (task.enabled ? ' enabled' : '') });
    const name = el('div', { class: 'task-name' }, task.name || '(sin nombre)');
    const top = el('div', { class: 'task-item-top' }, dot, name);
    const summary = scheduleSummary(task) || (task.cron || '');
    const nextLabel = task.enabled
      ? (task.nextRunAt ? 'Próx: ' + formatNextRun(new Date(task.nextRunAt)) : 'Próx: —')
      : 'pausada';
    const summaryLine = el('div', { class: 'task-meta' }, summary + '  ·  ' + (task.cli || '?'));
    const meta = el('div', { class: 'task-meta', style: 'opacity:0.75;' }, nextLabel);
    const item = el('div', {
      class: 'task-item' + (task.id === state.selectedId ? ' selected' : ''),
      dataset: { id: task.id },
      onclick: () => selectTask(task.id),
    }, top, summaryLine, meta);
    host.appendChild(item);
  }
}

function renderRuns() {
  const host = $('#runs-scroll');
  host.innerHTML = '';
  const selected = state.selectedId;
  const head = $('#runs-header');
  head.textContent = selected ? 'Runs (filtrados)' : 'Runs (todos)';

  const live = Array.from(state.liveRuns.values())
    .filter((r) => !selected || r.taskId === selected)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  let runs = state.runs;
  if (selected) runs = runs.filter((r) => r.taskId === selected);

  if (!live.length && !runs.length) {
    host.appendChild(el('div', { class: 'empty-state' }, 'Sin runs.'));
    return;
  }

  for (const r of live) host.appendChild(buildRunItem(r, true));
  for (const r of runs) host.appendChild(buildRunItem(r, false));
}

function buildRunItem(run, isLive) {
  const status = isLive ? 'running' : (run.status || 'ok');
  const pill = el('span', { class: 'run-status-pill ' + status }, isLive ? 'live' : status);
  const when = el('div', { class: 'run-when' }, isLive ? 'Ejecutando ahora' : fmtAbs(run.startedAt || run.finishedAt));
  const top = el('div', { class: 'run-top' }, pill, when);
  const metaParts = [];
  if (!isLive) metaParts.push(fmtDuration(run.durationMs));
  if (!state.selectedId && run.taskName) metaParts.push(run.taskName);
  if (isLive && run.partialText) {
    const snippet = run.partialText.slice(-60).replace(/\s+/g, ' ').trim();
    if (snippet) metaParts.push('…' + snippet);
  }
  const meta = el('div', { class: 'run-meta' }, metaParts.join(' · ') || ' ');
  const item = el('div', {
    class: 'run-item' + (isLive ? ' live' : ''),
    onclick: () => { if (!isLive) showRunModal(run); },
  }, top, meta);
  return item;
}

function showRunModal(run) {
  $('#modal-title').textContent = `${run.taskName || 'Run'} · ${run.status} · ${fmtDuration(run.durationMs)}`;
  $('#modal-body').textContent = run.output || run.error || '(sin salida)';
  $('#modal-bg').classList.add('show');
  $('#btn-modal-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('#modal-body').textContent);
      toast('Copiado', 'ok');
    } catch (e) {
      toast('Error al copiar', 'error');
    }
  };
}

function hideModal() {
  $('#modal-bg').classList.remove('show');
}

function fillSelect(sel, options, current) {
  sel.innerHTML = '';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function populateModelEffort(cli, model = '', effort = '') {
  fillSelect($('#f-model'), MODELS[cli] || MODELS.claude, model);
  fillSelect($('#f-effort'), EFFORTS[cli] || EFFORTS.claude, effort);
}

function showSchedBlock(type) {
  for (const t of SCHED_TYPES) {
    const b = document.getElementById('sched-' + t);
    if (!b) continue;
    if (t === type) b.classList.add('active');
    else b.classList.remove('active');
  }
}

function readWeekdays() {
  const btns = $$('#f-weekly-days .weekday-btn');
  return btns.filter((b) => b.classList.contains('active'))
    .map((b) => parseInt(b.dataset.dow, 10));
}

function setWeekdays(dows) {
  const set = new Set((dows || []).map(Number));
  for (const b of $$('#f-weekly-days .weekday-btn')) {
    if (set.has(parseInt(b.dataset.dow, 10))) b.classList.add('active');
    else b.classList.remove('active');
  }
}

function readScheduleFromUI() {
  const type = $('#f-sched-type').value;
  switch (type) {
    case 'interval-min':
      return { type, every: parseInt($('#f-every-min').value, 10) };
    case 'interval-hour':
      return { type, every: parseInt($('#f-every-hour').value, 10) };
    case 'daily':
      return { type, time: $('#f-daily-time').value };
    case 'weekly':
      return { type, time: $('#f-weekly-time').value, weekdays: readWeekdays() };
    case 'monthly':
      return { type, time: $('#f-monthly-time').value, dayOfMonth: parseInt($('#f-monthly-day').value, 10) };
    case 'once':
      return { type, date: $('#f-once-date').value, time: $('#f-once-time').value };
    case 'advanced':
      return { type, expr: $('#f-cron-advanced').value.trim() };
    default:
      return { type: 'daily', time: '09:00' };
  }
}

function writeScheduleToUI(sched) {
  const s = sched && sched.type ? sched : { type: 'daily', time: '09:00' };
  $('#f-sched-type').value = s.type;
  showSchedBlock(s.type);

  // Reset defaults
  switch (s.type) {
    case 'interval-min':
      $('#f-every-min').value = Number.isInteger(s.every) ? s.every : 5;
      break;
    case 'interval-hour':
      $('#f-every-hour').value = Number.isInteger(s.every) ? s.every : 2;
      break;
    case 'daily':
      $('#f-daily-time').value = s.time || '09:00';
      break;
    case 'weekly':
      $('#f-weekly-time').value = s.time || '09:00';
      setWeekdays(s.weekdays && s.weekdays.length ? s.weekdays : [1, 2, 3, 4, 5]);
      break;
    case 'monthly':
      $('#f-monthly-time').value = s.time || '09:00';
      $('#f-monthly-day').value = Number.isInteger(s.dayOfMonth) ? s.dayOfMonth : 1;
      break;
    case 'once': {
      const today = new Date();
      const iso = today.toISOString().slice(0, 10);
      $('#f-once-date').value = s.date || iso;
      $('#f-once-time').value = s.time || '09:00';
      break;
    }
    case 'advanced':
      $('#f-cron-advanced').value = s.expr || '';
      break;
  }
}

function readForm() {
  const cli = ($$('input[name="cli"]:checked')[0] || {}).value || 'claude';
  const sched = readScheduleFromUI();
  const conv = scheduleToCron(sched);
  return {
    name: $('#f-name').value.trim(),
    cron: conv.cron || '',
    schedule: sched,
    scheduleError: conv.error || null,
    cli,
    cwd: $('#f-cwd').value.trim(),
    model: $('#f-model').value,
    effort: $('#f-effort').value,
    resume: $('#f-resume').checked,
    prompt: $('#f-prompt').value,
    sinks: {
      logApp: $('#f-sink-log').checked,
      notifyMacOS: $('#f-sink-macos').checked,
      telegram: $('#f-sink-tg').checked && state.telegramConfigured,
    },
  };
}

function fillForm(task) {
  $('#f-name').value = task.name || '';
  const sched = (task.schedule && task.schedule.type)
    ? task.schedule
    : (task.cron ? cronToSchedule(task.cron) : { type: 'daily', time: '09:00' });
  writeScheduleToUI(sched);
  for (const r of $$('input[name="cli"]')) r.checked = (r.value === (task.cli || 'claude'));
  $('#f-cwd').value = task.cwd || '';
  populateModelEffort(task.cli || 'claude', task.model || '', task.effort || '');
  $('#f-resume').checked = !!task.resume;
  $('#f-prompt').value = task.prompt || '';
  const sinks = task.sinks || {};
  $('#f-sink-log').checked = sinks.logApp !== false;
  $('#f-sink-macos').checked = !!sinks.notifyMacOS;
  $('#f-sink-tg').checked = !!sinks.telegram && state.telegramConfigured;
  state.dirty = false;
  scheduleCronValidate();
  refreshActionsState();
}

function emptyTaskDraft() {
  return {
    id: null,
    name: 'Nueva tarea',
    enabled: false,
    cron: '0 9 * * *',
    schedule: { type: 'daily', time: '09:00' },
    cli: 'claude',
    cwd: '',
    prompt: '',
    model: state.defaults.model || '',
    effort: state.defaults.effort || '',
    resume: false,
    sinks: { logApp: true, notifyMacOS: false, telegram: false },
  };
}

function showEditor(task) {
  $('#editor-content').style.display = 'block';
  $('#editor-actions').style.display = 'flex';
  $('#editor-empty').style.display = 'none';
  $('#editor-header').textContent = task && task.id ? 'Editor — ' + (task.name || '') : 'Editor — nueva';
  fillForm(task);
}

function hideEditor() {
  $('#editor-content').style.display = 'none';
  $('#editor-actions').style.display = 'none';
  $('#editor-empty').style.display = 'flex';
  $('#editor-header').textContent = 'Editor';
}

function refreshActionsState() {
  const t = state.tasks.find((x) => x.id === state.selectedId);
  $('#btn-toggle').textContent = t && t.enabled ? 'Pausar' : 'Activar';
  $('#btn-toggle').style.display = state.selectedId ? '' : 'none';
  $('#btn-delete').style.display = state.selectedId ? '' : 'none';
  $('#btn-run-now').style.display = state.selectedId ? '' : 'none';
  const liveForSelected = Array.from(state.liveRuns.values()).some((r) => r.taskId === state.selectedId);
  $('#btn-cancel').style.display = liveForSelected ? '' : 'none';
}

async function selectTask(id) {
  if (state.dirty) {
    if (!confirm('Hay cambios sin guardar. ¿Descartar?')) return;
  }
  state.selectedId = id;
  renderList();
  const task = state.tasks.find((t) => t.id === id);
  if (task) {
    showEditor(task);
  } else {
    hideEditor();
  }
  await refreshRuns();
  renderRuns();
}

function newTask() {
  if (state.dirty) {
    if (!confirm('Hay cambios sin guardar. ¿Descartar?')) return;
  }
  state.selectedId = null;
  renderList();
  showEditor(emptyTaskDraft());
  state.dirty = true;
  refreshActionsState();
}

async function saveTask() {
  const data = readForm();
  if (!data.name) { toast('Falta el nombre', 'error'); return; }
  if (data.scheduleError) { toast(data.scheduleError, 'error'); return; }
  if (!data.cron) { toast('Frecuencia inválida', 'error'); return; }
  if (!data.prompt) { toast('Falta el prompt', 'error'); return; }
  const payload = {
    name: data.name,
    cron: data.cron,
    schedule: data.schedule,
    cli: data.cli,
    cwd: data.cwd,
    model: data.model,
    effort: data.effort,
    resume: data.resume,
    prompt: data.prompt,
    sinks: data.sinks,
  };
  try {
    let result;
    if (state.selectedId) {
      result = await api.update(state.selectedId, payload);
    } else {
      result = await api.create({ ...payload, enabled: false });
      state.selectedId = result && result.id ? result.id : null;
    }
    state.dirty = false;
    toast('Guardado', 'ok');
    await refreshAll();
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  }
}

async function toggleTask() {
  if (!state.selectedId) return;
  const t = state.tasks.find((x) => x.id === state.selectedId);
  if (!t) return;
  try {
    await api.toggle(t.id, !t.enabled);
    toast(t.enabled ? 'Pausada' : 'Activada', 'ok');
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  }
}

async function deleteTask() {
  if (!state.selectedId) return;
  const t = state.tasks.find((x) => x.id === state.selectedId);
  if (!t) return;
  if (!confirm(`¿Eliminar "${t.name}"?`)) return;
  try {
    await api.remove(t.id);
    state.selectedId = null;
    toast('Eliminada', 'ok');
    await refreshAll();
    hideEditor();
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  }
}

async function runNow() {
  if (!state.selectedId) return;
  try {
    await api.runNow(state.selectedId);
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  }
}

async function cancelRun() {
  if (!state.selectedId) return;
  try {
    await api.cancel(state.selectedId);
    toast('Cancelando…');
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  }
}

async function pickFolder() {
  try {
    const result = await api.pickFolder();
    if (result && result.path) {
      $('#f-cwd').value = result.path;
      markDirty();
    }
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  }
}

function scheduleCronValidate() {
  clearTimeout(state.validateTimer);
  state.validateTimer = setTimeout(doValidateCron, 300);
}

async function doValidateCron() {
  const out = $('#cron-preview');
  const sched = readScheduleFromUI();
  const conv = scheduleToCron(sched);
  if (conv.error) {
    out.className = 'error';
    out.textContent = conv.error;
    return;
  }
  try {
    const r = await api.validateCron(conv.cron);
    if (r && r.ok) {
      const next = (r.nextRunsPreview || []).slice(0, 3)
        .map((iso) => formatNextRun(new Date(iso)))
        .join('  ·  ');
      out.className = 'ok';
      out.textContent = next ? ('Próximas: ' + next) : 'OK';
    } else {
      out.className = 'error';
      out.textContent = (r && r.error) || 'Cron inválido';
    }
  } catch (e) {
    out.className = 'error';
    out.textContent = 'Cron inválido';
  }
}

function markDirty() { state.dirty = true; }

async function refreshTasks() {
  try {
    state.tasks = await api.list() || [];
  } catch (e) {
    state.tasks = [];
  }
  renderList();
  refreshActionsState();
}

async function refreshRuns() {
  try {
    const opts = state.selectedId ? { taskId: state.selectedId, limit: 50 } : { limit: 50 };
    state.runs = await api.getRuns(opts) || [];
  } catch (e) {
    state.runs = [];
  }
}

async function refreshAll() {
  await refreshTasks();
  await refreshRuns();
  renderRuns();
  if (state.selectedId) {
    const t = state.tasks.find((x) => x.id === state.selectedId);
    if (t) showEditor(t); else hideEditor();
  }
}

// =====================================================================
// ============== AUTOMATIONS (system-level) ===========================
// =====================================================================

function setActiveTab(tab) {
  if (tab !== 'tasks' && tab !== 'automations') tab = 'tasks';
  state.activeTab = tab;
  try { localStorage.setItem('activeTab', tab); } catch (e) {}

  for (const btn of $$('#tab-bar .tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }

  const main = $('#main');
  const mainAuto = $('#main-automations');
  const btnNew = $('#btn-new');
  const btnAutoNew = $('#btn-auto-new');

  if (tab === 'tasks') {
    main.style.display = 'flex';
    mainAuto.classList.remove('active');
    if (btnNew) btnNew.style.display = '';
    stopAutoLogPolling();
    stopAutoRunningPolling();
    loadTasks();
  } else {
    main.style.display = 'none';
    mainAuto.classList.add('active');
    if (btnNew) btnNew.style.display = 'none';
    loadAutomations();
    startAutoRunningPolling();
  }
}

function startAutoRunningPolling() {
  stopAutoRunningPolling();
  if (!api.automationsGetRunning) return;
  refreshRunningAutomations();
  state.autoRunningPollTimer = setInterval(refreshRunningAutomations, 5000);
}

function stopAutoRunningPolling() {
  if (state.autoRunningPollTimer) {
    clearInterval(state.autoRunningPollTimer);
    state.autoRunningPollTimer = null;
  }
}

async function refreshRunningAutomations() {
  if (state.activeTab !== 'automations') { stopAutoRunningPolling(); return; }
  if (!api.automationsGetRunning) return;
  try {
    const ids = await api.automationsGetRunning() || [];
    const now = Date.now();
    const newSet = new Set(ids);
    // limpia entries que ya no corren
    for (const id of state.autoRunningStartedAt.keys()) {
      if (!newSet.has(id)) state.autoRunningStartedAt.delete(id);
    }
    // marca timestamps para los nuevos
    for (const id of newSet) {
      if (!state.autoRunningStartedAt.has(id)) state.autoRunningStartedAt.set(id, now);
    }
    // diff: ¿algo cambió?
    const prev = state.runningAutomationIds;
    let changed = prev.size !== newSet.size;
    if (!changed) {
      for (const id of newSet) if (!prev.has(id)) { changed = true; break; }
    }
    state.runningAutomationIds = newSet;
    if (changed) {
      renderAutomationsList();
      if (state.selectedAutomation) showAutomationEditor(state.selectedAutomation);
    } else if (state.selectedAutomation && newSet.has(state.selectedAutomation.id)) {
      // Solo refrescar el contador de duración del banner
      updateRunningBannerDuration();
    }
  } catch (e) { /* silencioso */ }
}

function updateRunningBannerDuration() {
  const a = state.selectedAutomation;
  if (!a) return;
  const banner = document.getElementById('auto-running-banner');
  if (!banner) return;
  const startedAt = state.autoRunningStartedAt.get(a.id);
  if (!startedAt) return;
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const spanDur = banner.querySelector('.dur');
  if (spanDur) spanDur.textContent = secs + 's';
}

async function loadTasks() {
  // Stub explícito: ya hay refreshAll, esto solo asegura que se llama al entrar en la tab.
  await refreshAll();
}

async function loadAutomations() {
  try {
    if (!api.automationsList) {
      state.automations = [];
    } else {
      state.automations = (await api.automationsList()) || [];
    }
  } catch (e) {
    state.automations = [];
  }
  renderAutomationsList();
  // Aviso (una sola vez por sesión) si shellcheck falta.
  if (!state.__shellcheckChecked && api.automationsShellcheckStatus) {
    state.__shellcheckChecked = true;
    try {
      const st = await api.automationsShellcheckStatus();
      if (st && st.available === false) {
        toast('shellcheck no instalado · brew install shellcheck para validación automática', 'error');
      }
    } catch (e) {}
  }

  // Reposicionar selección si el item sigue existiendo
  if (state.selectedAutomationId) {
    const found = state.automations.find((a) => a.id === state.selectedAutomationId);
    if (found) {
      state.selectedAutomation = found;
      showAutomationEditor(found);
      maybeStartLogPolling();
    } else {
      clearAutomationSelection();
    }
  } else {
    clearAutomationSelection();
  }
}

function clearAutomationSelection() {
  state.selectedAutomationId = null;
  state.selectedAutomation = null;
  state.autoDirty = false;
  hideAutomationEditor();
  stopAutoLogPolling();
  $('#auto-log-pre').textContent = 'Selecciona una automatización para ver el log.';
  $('#auto-log-pre').classList.remove('has-error');
  $('#auto-log-header').textContent = 'Log en vivo';
}

function renderAutomationsList() {
  const host = $('#auto-list-scroll');
  host.innerHTML = '';
  if (!state.automations.length) {
    host.appendChild(el('div', { class: 'empty-state' }, 'Sin automatizaciones. Pulsa + Nueva.'));
    return;
  }
  for (const a of state.automations) {
    const isRunning = state.runningAutomationIds.has(a.id);
    const dotClass = a.paused && a.status === 'installed' ? 'paused'
      : a.status === 'installed' ? 'installed'
      : a.status === 'failed-install' ? 'failed'
      : 'draft';
    const dot = el('div', { class: 'auto-status-dot ' + dotClass });
    const nameChildren = [a.name || '(sin nombre)'];
    if (isRunning) nameChildren.push(el('span', { class: 'auto-running-spinner', title: 'Ejecutándose…' }));
    const name = el('div', { class: 'auto-name' }, ...nameChildren);
    const top = el('div', { class: 'auto-item-top' }, dot, name);

    const sched = a.schedule || (a.cron ? cronToSchedule(a.cron) : null);
    const schedTxt = sched ? scheduleSummary({ schedule: sched, cron: a.cron }) : '(sin programación)';
    let statusTxt;
    if (a.status === 'installed') {
      if (isRunning) statusTxt = '⟳ ejecutándose…';
      else if (a.paused) statusTxt = '⏸ pausada';
      else statusTxt = '✓ instalado';
    } else if (a.status === 'failed-install') {
      statusTxt = '⚠ error instalación';
    } else {
      statusTxt = '✎ borrador';
    }
    const meta = el('div', { class: 'auto-meta' }, schedTxt + '  ·  ' + statusTxt);

    const item = el('div', {
      class: 'auto-item' + (a.id === state.selectedAutomationId ? ' selected' : ''),
      dataset: { id: a.id },
      onclick: () => selectAutomation(a.id),
    }, top, meta);
    host.appendChild(item);
  }
}

async function selectAutomation(id) {
  if (state.autoDirty) {
    if (!confirm('Hay cambios sin guardar. ¿Descartar?')) return;
  }
  state.selectedAutomationId = id;
  state.autoDirty = false;
  let auto = state.automations.find((a) => a.id === id);
  // Fetch fresco por si el detalle tiene más campos (scripts, explicación, paths)
  try {
    if (api.automationsGet) {
      const fresh = await api.automationsGet(id);
      if (fresh) auto = fresh;
    }
  } catch (e) {}
  state.selectedAutomation = auto || null;
  renderAutomationsList();
  if (auto) showAutomationEditor(auto);
  else hideAutomationEditor();
  maybeStartLogPolling();
}

function newAutomation() {
  if (state.autoDirty) {
    if (!confirm('Hay cambios sin guardar. ¿Descartar?')) return;
  }
  state.selectedAutomationId = null;
  state.selectedAutomation = emptyAutomationDraft();
  state.autoDirty = true;
  renderAutomationsList();
  showAutomationEditor(state.selectedAutomation);
  stopAutoLogPolling();
  $('#auto-log-pre').textContent = 'Describe la automatización y pulsa "Generar con IA".';
  $('#auto-log-pre').classList.remove('has-error');
  $('#auto-log-header').textContent = 'Preview';
}

function emptyAutomationDraft() {
  return {
    id: null,
    name: '',
    description: '',
    schedule: { type: 'daily', time: '09:00' },
    status: 'draft',
    generatedScript: '',
    generatedPlist: '',
    explanation: '',
  };
}

function hideAutomationEditor() {
  $('#auto-editor-content').style.display = 'none';
  $('#auto-editor-actions').style.display = 'none';
  $('#auto-editor-actions').innerHTML = '';
  $('#auto-editor-empty').style.display = 'flex';
  $('#auto-editor-header').textContent = 'Editor';
}

function showAutomationEditor(auto) {
  $('#auto-editor-empty').style.display = 'none';
  $('#auto-editor-content').style.display = 'block';
  $('#auto-editor-actions').style.display = 'flex';
  $('#auto-editor-header').textContent = auto && auto.name
    ? 'Editor — ' + auto.name
    : 'Editor — nueva';

  if (auto && auto.status === 'installed') {
    renderInstalledEditor(auto);
    $('#auto-log-header').textContent = 'Log en vivo';
  } else {
    renderDraftEditor(auto);
    $('#auto-log-header').textContent = 'Preview';
    const pre = $('#auto-log-pre');
    pre.textContent = auto && auto.explanation
      ? auto.explanation
      : (auto && auto.generatedScript ? 'Script generado. Revisa y pulsa "Instalar y probar".' : 'Describe la automatización y pulsa "Generar con IA".');
    pre.classList.remove('has-error');
  }
}

// ---------- Draft editor ----------

function renderDraftEditor(auto) {
  const c = $('#auto-editor-content');
  c.innerHTML = '';

  // Nombre
  const fldName = el('div', { class: 'field' });
  fldName.appendChild(el('label', { class: 'field-label', for: 'auto-f-name' }, 'Nombre'));
  const inpName = el('input', { type: 'text', id: 'auto-f-name', placeholder: 'p.ej. Backup Documents al NAS' });
  inpName.value = auto.name || '';
  inpName.addEventListener('input', () => { state.selectedAutomation.name = inpName.value; state.autoDirty = true; });
  fldName.appendChild(inpName);
  c.appendChild(fldName);

  // Descripción
  const fldDesc = el('div', { class: 'field' });
  fldDesc.appendChild(el('label', { class: 'field-label', for: 'auto-f-desc' }, 'Descripción'));
  const inpDesc = el('textarea', { id: 'auto-f-desc', rows: '4', placeholder: 'Explica qué hace, sobre qué carpetas o servicios actúa, qué condiciones aplica…' });
  inpDesc.value = auto.description || '';
  inpDesc.addEventListener('input', () => { state.selectedAutomation.description = inpDesc.value; state.autoDirty = true; });
  fldDesc.appendChild(inpDesc);
  c.appendChild(fldDesc);

  // Frecuencia — reutilizamos el control rico de tareas via instancia inline.
  const fldFreq = el('div', { class: 'field' });
  fldFreq.appendChild(el('label', { class: 'field-label' }, 'Frecuencia'));
  const freqHost = el('div', { id: 'auto-sched-host' });
  fldFreq.appendChild(freqHost);
  c.appendChild(fldFreq);
  buildAutoSchedule(freqHost, auto.schedule || { type: 'daily', time: '09:00' });

  // Si ya hay scripts generados → secciones colapsables editables
  if (auto.generatedScript || auto.generatedPlist || auto.explanation) {
    if (auto.generatedScript) {
      const sec = el('div', { class: 'auto-section' });
      sec.appendChild(el('div', { class: 'auto-section-title' },
        el('span', {}, 'Script (.sh)'),
        el('span', { class: 'hint' }, 'editable')));
      const ta = el('textarea', { id: 'auto-f-script', class: 'code-area', rows: '14', spellcheck: 'false' });
      ta.value = auto.generatedScript;
      ta.addEventListener('input', () => { state.selectedAutomation.generatedScript = ta.value; state.autoDirty = true; });
      sec.appendChild(ta);
      c.appendChild(sec);
    }
    if (auto.generatedPlist) {
      const sec = el('div', { class: 'auto-section' });
      sec.appendChild(el('div', { class: 'auto-section-title' },
        el('span', {}, 'Plist launchd'),
        el('span', { class: 'hint' }, 'editable')));
      const ta = el('textarea', { id: 'auto-f-plist', class: 'code-area', rows: '10', spellcheck: 'false' });
      ta.value = auto.generatedPlist;
      ta.addEventListener('input', () => { state.selectedAutomation.generatedPlist = ta.value; state.autoDirty = true; });
      sec.appendChild(ta);
      c.appendChild(sec);
    }
    if (auto.explanation) {
      const sec = el('div', { class: 'auto-section' });
      sec.appendChild(el('div', { class: 'auto-section-title' }, el('span', {}, 'Qué hace')));
      sec.appendChild(el('pre', { class: 'explain-pre' }, auto.explanation));
      c.appendChild(sec);
    }
  }

  // Botones de acción
  const actions = $('#auto-editor-actions');
  actions.innerHTML = '';
  const hasGenerated = !!(auto.generatedScript || auto.generatedPlist);

  const btnGen = el('button', { class: 'btn btn-primary', id: 'btn-auto-generate' },
    hasGenerated ? '↻ Regenerar' : '▶ Generar con IA');
  btnGen.addEventListener('click', onGenerateOrRegenerate);
  actions.appendChild(btnGen);

  if (hasGenerated) {
    const btnInstall = el('button', { class: 'btn btn-primary', id: 'btn-auto-install' }, '✓ Instalar y probar');
    btnInstall.addEventListener('click', onInstallAndTest);
    actions.appendChild(btnInstall);
  }

  if (api.openAutomationChat) {
    const btnChat = el('button', { class: 'btn', id: 'btn-auto-chat' }, '💬 Hablar con el agente');
    btnChat.title = hasGenerated
      ? 'Conversa con el CLI para ajustar el script'
      : 'Conversa con el CLI para diseñar la automatización antes de generar';
    btnChat.addEventListener('click', () => onOpenAutomationChatFromDraft(auto));
    actions.appendChild(btnChat);
  }

  actions.appendChild(el('div', { class: 'spacer' }));

  const btnDiscard = el('button', { class: 'btn btn-danger', id: 'btn-auto-discard' }, '✗ Descartar');
  btnDiscard.addEventListener('click', onDiscardDraft);
  actions.appendChild(btnDiscard);

  applyBusyToAutoActions();
}

// Abre el agente PTY desde el editor draft. Si el draft aún no tiene id,
// crea primero un "draft shell" en backend (sin script generado) para que el agente
// tenga algo con lo que trabajar y a lo que aplicar bloques al final.
async function onOpenAutomationChatFromDraft(auto) {
  if (!api.openAutomationChat) return;
  try {
    let id = auto && auto.id;
    if (!id) {
      const name = (auto.name || '').trim();
      if (name.length < 3) { toast('Pon un nombre antes de abrir el agente', 'error'); return; }
      const conv = scheduleToCron(auto.schedule || {});
      if (conv.error) { toast(conv.error, 'error'); return; }
      if (!api.automationsCreateDraftShell) { toast('Backend no soporta draft shell', 'error'); return; }
      setAutoBusy(true);
      try {
        const res = await api.automationsCreateDraftShell({
          name,
          description: (auto.description || '').trim(),
          schedule: auto.schedule
        });
        if (!res || res.ok === false) {
          toast((res && res.error) || 'No se pudo crear borrador', 'error');
          return;
        }
        const merged = Object.assign({}, auto, res.automation || {});
        state.selectedAutomationId = merged.id;
        state.selectedAutomation = merged;
        id = merged.id;
        try { state.automations = (await api.automationsList()) || []; renderAutomationsList(); } catch (e) {}
      } finally {
        setAutoBusy(false);
      }
    }
    if (!id) return;
    const r = await api.openAutomationChat({ automationId: id });
    if (!r || r.ok === false) toast((r && r.error) || 'No se pudo abrir el agente', 'error');
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  }
}

// Mini control de schedule autónomo (reutiliza scheduleToCron/cronToSchedule del módulo).
// Renderiza select de tipo + sub-campos. Guarda en state.selectedAutomation.schedule.
function buildAutoSchedule(host, sched) {
  host.innerHTML = '';
  const cur = sched && sched.type ? sched : { type: 'daily', time: '09:00' };
  state.selectedAutomation.schedule = cur;

  const sel = el('select', { id: 'auto-f-sched-type' });
  const opts = [
    ['interval-min', 'Cada X minutos'],
    ['interval-hour', 'Cada X horas'],
    ['daily', 'Cada día'],
    ['weekly', 'Días concretos de la semana'],
    ['monthly', 'Cada mes'],
    ['once', 'Una sola vez'],
    ['advanced', 'Avanzado (cron)'],
  ];
  for (const [v, l] of opts) {
    const o = document.createElement('option');
    o.value = v; o.textContent = l;
    if (v === cur.type) o.selected = true;
    sel.appendChild(o);
  }
  host.appendChild(sel);

  const sub = el('div', { id: 'auto-sched-sub', style: 'margin-top:8px;display:flex;flex-direction:column;gap:8px;' });
  host.appendChild(sub);

  const preview = el('div', { id: 'auto-cron-preview', style: 'margin-top:6px;font-size:11px;font-family:var(--mono);color:var(--fg-muted);line-height:1.5;min-height:14px;' });
  host.appendChild(preview);

  function renderSub(type) {
    sub.innerHTML = '';
    const s = state.selectedAutomation.schedule;
    if (type === 'interval-min') {
      const wrap = el('div', { class: 'sched-inline' });
      wrap.appendChild(el('label', {}, 'Cada'));
      const i = el('input', { type: 'number', min: '1', max: '59' });
      i.value = s.every || 5;
      i.addEventListener('input', () => { s.every = parseInt(i.value, 10); state.autoDirty = true; updatePreview(); });
      wrap.appendChild(i);
      wrap.appendChild(el('label', {}, 'minutos'));
      sub.appendChild(wrap);
    } else if (type === 'interval-hour') {
      const wrap = el('div', { class: 'sched-inline' });
      wrap.appendChild(el('label', {}, 'Cada'));
      const i = el('input', { type: 'number', min: '1', max: '23' });
      i.value = s.every || 2;
      i.addEventListener('input', () => { s.every = parseInt(i.value, 10); state.autoDirty = true; updatePreview(); });
      wrap.appendChild(i);
      wrap.appendChild(el('label', {}, 'horas'));
      sub.appendChild(wrap);
    } else if (type === 'daily') {
      const wrap = el('div', { class: 'sched-inline' });
      wrap.appendChild(el('label', {}, 'Hora'));
      const i = el('input', { type: 'time' });
      i.value = s.time || '09:00';
      i.addEventListener('input', () => { s.time = i.value; state.autoDirty = true; updatePreview(); });
      wrap.appendChild(i);
      sub.appendChild(wrap);
    } else if (type === 'weekly') {
      const wrap = el('div', { class: 'sched-inline' });
      wrap.appendChild(el('label', {}, 'Hora'));
      const t = el('input', { type: 'time' });
      t.value = s.time || '09:00';
      t.addEventListener('input', () => { s.time = t.value; state.autoDirty = true; updatePreview(); });
      wrap.appendChild(t);
      sub.appendChild(wrap);

      const wrap2 = el('div', { class: 'sched-inline' });
      wrap2.appendChild(el('label', {}, 'Días'));
      const days = el('div', { class: 'weekday-toggles' });
      const cur2 = new Set((s.weekdays && s.weekdays.length ? s.weekdays : [1, 2, 3, 4, 5]).map(Number));
      s.weekdays = [...cur2];
      const dows = [[1,'L'],[2,'M'],[3,'X'],[4,'J'],[5,'V'],[6,'S'],[0,'D']];
      for (const [dv, lt] of dows) {
        const b = el('button', { type: 'button', class: 'weekday-btn' + (cur2.has(dv) ? ' active' : ''), dataset: { dow: String(dv) } }, lt);
        b.addEventListener('click', () => {
          b.classList.toggle('active');
          const dv2 = parseInt(b.dataset.dow, 10);
          const set = new Set(s.weekdays || []);
          if (b.classList.contains('active')) set.add(dv2); else set.delete(dv2);
          s.weekdays = [...set];
          state.autoDirty = true; updatePreview();
        });
        days.appendChild(b);
      }
      wrap2.appendChild(days);
      sub.appendChild(wrap2);
    } else if (type === 'monthly') {
      const wrap = el('div', { class: 'sched-inline' });
      wrap.appendChild(el('label', {}, 'Día del mes'));
      const d = el('input', { type: 'number', min: '1', max: '28' });
      d.value = s.dayOfMonth || 1;
      d.addEventListener('input', () => { s.dayOfMonth = parseInt(d.value, 10); state.autoDirty = true; updatePreview(); });
      wrap.appendChild(d);
      wrap.appendChild(el('label', {}, 'Hora'));
      const t = el('input', { type: 'time' });
      t.value = s.time || '09:00';
      t.addEventListener('input', () => { s.time = t.value; state.autoDirty = true; updatePreview(); });
      wrap.appendChild(t);
      sub.appendChild(wrap);
    } else if (type === 'once') {
      const wrap = el('div', { class: 'sched-inline' });
      wrap.appendChild(el('label', {}, 'Fecha'));
      const d = el('input', { type: 'date' });
      d.value = s.date || new Date().toISOString().slice(0, 10);
      d.addEventListener('input', () => { s.date = d.value; state.autoDirty = true; updatePreview(); });
      wrap.appendChild(d);
      wrap.appendChild(el('label', {}, 'Hora'));
      const t = el('input', { type: 'time' });
      t.value = s.time || '09:00';
      t.addEventListener('input', () => { s.time = t.value; state.autoDirty = true; updatePreview(); });
      wrap.appendChild(t);
      sub.appendChild(wrap);
    } else if (type === 'advanced') {
      const i = el('input', { type: 'text', id: 'auto-f-cron-advanced', placeholder: '0 9 * * *', style: 'font-family:var(--mono);' });
      i.value = s.expr || '';
      i.addEventListener('input', () => { s.expr = i.value.trim(); state.autoDirty = true; updatePreview(); });
      sub.appendChild(i);
      sub.appendChild(el('div', { class: 'sched-hint' }, 'Formato cron de 5 campos: min hora díaMes mes díaSemana.'));
    }
  }

  async function updatePreview() {
    const s = state.selectedAutomation.schedule;
    const conv = scheduleToCron(s);
    if (conv.error) { preview.style.color = 'var(--error)'; preview.textContent = conv.error; return; }
    preview.style.color = 'var(--ok)';
    preview.textContent = 'Calculando próximas ejecuciones…';
    try {
      const r = await api.validateCron({ expr: conv.cron });
      if (r && r.ok && Array.isArray(r.nextRunsPreview) && r.nextRunsPreview.length) {
        const next = r.nextRunsPreview.slice(0, 3).map((iso) => formatNextRun(new Date(iso))).join('  ·  ');
        preview.textContent = 'Próximas: ' + next;
      } else {
        preview.textContent = 'Programación válida';
      }
    } catch { preview.textContent = 'Programación válida'; }
  }

  sel.addEventListener('change', () => {
    const t = sel.value;
    // Inicializa defaults sensatos al cambiar tipo
    const s = state.selectedAutomation.schedule;
    if (t === 'interval-min') { s.every = s.every || 5; }
    if (t === 'interval-hour') { s.every = s.every || 2; }
    if (t === 'daily' || t === 'weekly' || t === 'monthly' || t === 'once') { s.time = s.time || '09:00'; }
    if (t === 'weekly' && (!s.weekdays || !s.weekdays.length)) s.weekdays = [1,2,3,4,5];
    if (t === 'monthly' && !s.dayOfMonth) s.dayOfMonth = 1;
    if (t === 'once' && !s.date) s.date = new Date().toISOString().slice(0, 10);
    s.type = t;
    state.autoDirty = true;
    renderSub(t);
    updatePreview();
  });

  renderSub(cur.type);
  updatePreview();
}

// ---------- Installed editor ----------

function renderInstalledEditor(auto) {
  const c = $('#auto-editor-content');
  c.innerHTML = '';

  const isRunning = state.runningAutomationIds.has(auto.id);
  const isPaused = !!auto.paused;

  // Banner "está ejecutándose ahora"
  if (isRunning) {
    const startedAt = state.autoRunningStartedAt.get(auto.id) || Date.now();
    const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const banner = el('div', { class: 'auto-running-banner', id: 'auto-running-banner' });
    banner.appendChild(el('span', { class: 'auto-running-spinner' }));
    banner.appendChild(el('span', {}, '  Ejecutándose ahora · duración: '));
    banner.appendChild(el('span', { class: 'dur' }, secs + 's'));
    c.appendChild(banner);
  } else if (isPaused) {
    const banner = el('div', { class: 'auto-paused-banner' }, '⏸ Pausada — el cron no la dispara hasta que la reanudes.');
    c.appendChild(banner);
  }

  const sched = auto.schedule || (auto.cron ? cronToSchedule(auto.cron) : null);
  const schedTxt = sched ? scheduleSummary({ schedule: sched, cron: auto.cron }) : (auto.cron || '—');
  const nextTxt = auto.nextRunAt ? formatNextRun(new Date(auto.nextRunAt)) : '—';
  const estadoTxt = isRunning ? '⟳ Ejecutándose' : (isPaused ? '⏸ Pausada' : '✓ Instalado');

  c.appendChild(kvRow('Nombre', auto.name || '(sin nombre)'));
  c.appendChild(kvRow('Cuándo', schedTxt + '  ·  próxima: ' + nextTxt));
  c.appendChild(kvRow('Estado', estadoTxt));
  c.appendChild(kvRow('Slug', auto.slug || '—'));
  c.appendChild(kvRow('Script', auto.scriptPath || '—', auto.scriptPath));
  c.appendChild(kvRow('Plist',  auto.plistPath  || '—', auto.plistPath));
  if (auto.logPath) c.appendChild(kvRow('Log', auto.logPath, auto.logPath));

  if (auto.explanation) {
    const sec = el('div', { class: 'auto-section' });
    sec.appendChild(el('div', { class: 'auto-section-title' }, 'Qué hace'));
    sec.appendChild(el('pre', { class: 'explain-pre' }, auto.explanation));
    c.appendChild(sec);
  }

  // Actions
  const actions = $('#auto-editor-actions');
  actions.innerHTML = '';

  const btnRun = el('button', { class: 'btn btn-primary', id: 'btn-auto-run' }, '▶ Ejecutar ahora');
  btnRun.addEventListener('click', onRunNowAutomation);
  if (isRunning) btnRun.setAttribute('disabled', 'disabled');
  actions.appendChild(btnRun);

  if (isRunning) {
    const btnStop = el('button', { class: 'btn btn-danger', id: 'btn-auto-stop' }, '⏹ Parar ejecución');
    btnStop.addEventListener('click', onStopRunAutomation);
    actions.appendChild(btnStop);
  } else if (isPaused) {
    const btnResume = el('button', { class: 'btn', id: 'btn-auto-resume' }, '▶ Reanudar');
    btnResume.addEventListener('click', onResumeAutomation);
    actions.appendChild(btnResume);
  } else {
    const btnPause = el('button', { class: 'btn', id: 'btn-auto-pause' }, '⏸ Pausar');
    btnPause.addEventListener('click', onPauseAutomation);
    actions.appendChild(btnPause);
  }

  if (auto.id && api.openAutomationChat) {
    const btnChat = el('button', { class: 'btn', id: 'btn-auto-chat' }, '💬 Hablar con el agente');
    btnChat.addEventListener('click', () => onOpenAutomationChat(auto));
    actions.appendChild(btnChat);
  }

  actions.appendChild(el('div', { class: 'spacer' }));

  const btnRemove = el('button', { class: 'btn btn-danger', id: 'btn-auto-remove' }, '🗑 Retirar');
  btnRemove.addEventListener('click', onRemoveAutomation);
  actions.appendChild(btnRemove);

  applyBusyToAutoActions();
}

function kvRow(k, v, pathToOpen) {
  const row = el('div', { class: 'kv-row' });
  row.appendChild(el('div', { class: 'k' }, k));
  const vEl = el('div', { class: 'v' }, String(v));
  if (pathToOpen) {
    const btn = el('button', { class: 'path-link' }, 'Abrir en Finder');
    btn.addEventListener('click', async () => {
      try {
        if (api.revealInFinder) await api.revealInFinder(pathToOpen);
        else toast('No disponible aún', 'error');
      } catch (e) {
        toast('Error: ' + (e && e.message ? e.message : e), 'error');
      }
    });
    vEl.appendChild(btn);
  }
  row.appendChild(vEl);
  return row;
}

// ---------- Action handlers ----------

function setAutoBusy(on) {
  state.autoBusy = !!on;
  applyBusyToAutoActions();
}

function applyBusyToAutoActions() {
  const btns = $$('#auto-editor-actions .btn');
  for (const b of btns) {
    if (state.autoBusy) b.setAttribute('disabled', 'disabled');
    else b.removeAttribute('disabled');
  }
}

async function onGenerateOrRegenerate() {
  const a = state.selectedAutomation;
  if (!a) return;
  const name = (a.name || '').trim();
  const description = (a.description || '').trim();
  if (!name) { toast('Falta el nombre', 'error'); return; }
  if (description.length < 20) { toast('La descripción debe tener al menos 20 caracteres', 'error'); return; }
  const conv = scheduleToCron(a.schedule || {});
  if (conv.error) { toast(conv.error, 'error'); return; }

  const isRegen = !!(a.generatedScript || a.generatedPlist);
  const btn = isRegen ? $('#btn-auto-generate') : $('#btn-auto-generate');
  if (btn) {
    btn.innerHTML = '';
    btn.appendChild(el('span', { class: 'spinner' }));
    btn.appendChild(document.createTextNode('  ' + (isRegen ? 'Regenerando…' : 'Generando…')));
  }
  setAutoBusy(true);

  try {
    const payload = { name, description, schedule: a.schedule, cron: conv.cron };
    if (a.id) payload.id = a.id;
    const fn = isRegen && api.automationsRegenerate ? api.automationsRegenerate : api.automationsGenerateDraft;
    const res = await fn(payload);
    if (!res || res.ok === false) {
      const msg = (res && res.error) || 'Error al generar';
      toast(msg, 'error');
      return;
    }
    // Merge resultado en state
    const merged = Object.assign({}, a, res.automation || res);
    if (merged.id && !a.id) state.selectedAutomationId = merged.id;
    state.selectedAutomation = merged;
    // Refresca lista por si el draft quedó persistido en backend
    if (api.automationsList) {
      try { state.automations = (await api.automationsList()) || []; } catch (e) {}
      renderAutomationsList();
    }
    showAutomationEditor(merged);
    // Si shellcheck encontró issues persistentes, avisar.
    if (res.lint && res.lint.available && res.lint.hasIssues) {
      toast('Generado, pero shellcheck encontró errores tras ' + (res.lint.attempts || '?') + ' intentos. Revisa antes de instalar.', 'error');
    } else if (res.lint && !res.lint.available) {
      toast('Generado. shellcheck no instalado: brew install shellcheck para validación automática.', 'ok');
    } else {
      toast(isRegen ? 'Regenerado' : 'Generado', 'ok');
    }
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

async function onInstallAndTest() {
  const a = state.selectedAutomation;
  if (!a || !a.id) { toast('Genera primero la automatización', 'error'); return; }

  // Si hay ediciones manuales en script/plist, persistirlas antes de instalar
  if (state.autoDirty && api.automationsUpdateDraft) {
    try {
      await api.automationsUpdateDraft({
        id: a.id,
        name: a.name,
        description: a.description,
        schedule: a.schedule,
        generatedScript: a.generatedScript,
        generatedPlist: a.generatedPlist,
      });
      state.autoDirty = false;
    } catch (e) {
      toast('Error guardando edición: ' + (e && e.message ? e.message : e), 'error');
      return;
    }
  }

  setAutoBusy(true);
  try {
    let r = await api.automationsInstall({ id: a.id });
    if (r && r.ok === false && r.lintBlocking && r.lintIssues) {
      // Pedir al usuario qué hacer.
      const choice = await showLintBlockedDialog(r.lintIssues);
      if (choice === 'regenerate') {
        setAutoBusy(false);
        // Reusa generator con la descripción actual.
        await onGenerateOrRegenerate();
        return;
      }
      if (choice === 'force') {
        r = await api.automationsInstall({ id: a.id, force: true });
        if (!r || r.ok === false) {
          toast((r && r.error) || 'Error al instalar (forzado)', 'error');
          return;
        }
      } else {
        // cancel
        return;
      }
    } else if (!r || r.ok === false) {
      toast((r && r.error) || 'Error al instalar', 'error');
      return;
    }
    toast('Instalado. Ejecutando primera vez…', 'ok');

    const r2 = await api.automationsRunOnce({ id: a.id });
    if (r2 && r2.ok !== false) {
      const dur = r2.durationMs != null ? fmtDuration(r2.durationMs) : '';
      toast('✓ Primera ejecución OK' + (dur ? ' en ' + dur : ''), 'ok');
    } else {
      const tail = (r2 && (r2.logTail || r2.error)) || 'Error desconocido';
      toast('Primera ejecución falló: ' + String(tail).slice(0, 160), 'error');
    }
    await loadAutomations();
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

// Modal sencillo (inline, sin librería) para errores de shellcheck.
function showLintBlockedDialog(rawIssues) {
  return new Promise((resolve) => {
    let resolved = false;
    function done(choice) {
      if (resolved) return;
      resolved = true;
      try { document.body.removeChild(overlay); } catch {}
      resolve(choice);
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-elev,#232327);color:var(--fg,#e8e8ea);max-width:640px;width:100%;border-radius:10px;padding:18px;border:1px solid var(--border,#34343a);box-shadow:0 18px 48px rgba(0,0,0,0.45);display:flex;flex-direction:column;gap:10px;';
    const h = document.createElement('div');
    h.style.cssText = 'font-weight:700;font-size:14px;';
    h.textContent = 'shellcheck encontró errores críticos';
    box.appendChild(h);
    const p = document.createElement('div');
    p.style.cssText = 'font-size:12px;color:var(--fg-muted,#9a9aa0);';
    p.textContent = 'El script generado tiene errores que pueden hacer que falle en runtime. Puedes regenerarlo, instalarlo igualmente o cancelar.';
    box.appendChild(p);
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--code-bg,#161618);padding:10px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;max-height:240px;overflow:auto;white-space:pre-wrap;';
    pre.textContent = String(rawIssues || '(sin detalle)');
    box.appendChild(pre);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
    const bRegen = document.createElement('button');
    bRegen.className = 'btn btn-primary';
    bRegen.textContent = 'Volver a generar';
    bRegen.onclick = () => done('regenerate');
    const bForce = document.createElement('button');
    bForce.className = 'btn btn-danger';
    bForce.textContent = 'Instalar igualmente';
    bForce.onclick = () => done('force');
    const bCancel = document.createElement('button');
    bCancel.className = 'btn';
    bCancel.textContent = 'Cancelar';
    bCancel.onclick = () => done('cancel');
    row.appendChild(bRegen);
    row.appendChild(bForce);
    row.appendChild(bCancel);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

async function onDiscardDraft() {
  const a = state.selectedAutomation;
  if (!a) return;
  if (!confirm('¿Descartar este borrador?')) return;
  setAutoBusy(true);
  try {
    if (a.id && api.automationsRemove) {
      await api.automationsRemove({ id: a.id });
    }
    state.selectedAutomationId = null;
    state.selectedAutomation = null;
    state.autoDirty = false;
    await loadAutomations();
    clearAutomationSelection();
    toast('Descartado', 'ok');
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

async function onRunNowAutomation() {
  const a = state.selectedAutomation;
  if (!a || !a.id) return;
  setAutoBusy(true);
  try {
    const r = await api.automationsRunOnce({ id: a.id });
    if (r && r.ok !== false) {
      const dur = r.durationMs != null ? fmtDuration(r.durationMs) : '';
      toast('✓ Ejecutado' + (dur ? ' en ' + dur : ''), 'ok');
    } else {
      const tail = (r && (r.logTail || r.error)) || 'Error';
      toast(String(tail).slice(0, 160), 'error');
    }
    await refreshAutoLog();
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

async function onReinstallAutomation() {
  const a = state.selectedAutomation;
  if (!a || !a.id) return;
  setAutoBusy(true);
  try {
    const r = await api.automationsInstall({ id: a.id });
    if (r && r.ok !== false) toast('Reinstalado', 'ok');
    else toast((r && r.error) || 'Error reinstalando', 'error');
    await loadAutomations();
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

async function onPauseAutomation() {
  const a = state.selectedAutomation;
  if (!a || !a.id || !api.automationsPause) return;
  setAutoBusy(true);
  try {
    const r = await api.automationsPause({ id: a.id });
    if (r && r.ok !== false) toast('Pausada', 'ok');
    else toast((r && r.error) || 'Error pausando', 'error');
    await loadAutomations();
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

async function onResumeAutomation() {
  const a = state.selectedAutomation;
  if (!a || !a.id || !api.automationsResume) return;
  setAutoBusy(true);
  try {
    const r = await api.automationsResume({ id: a.id });
    if (r && r.ok !== false) toast('Reanudada', 'ok');
    else toast((r && r.error) || 'Error reanudando', 'error');
    await loadAutomations();
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

async function onStopRunAutomation() {
  const a = state.selectedAutomation;
  if (!a || !a.id || !api.automationsStopRun) return;
  setAutoBusy(true);
  try {
    const r = await api.automationsStopRun({ id: a.id });
    if (r && r.ok !== false) toast('Señal de parada enviada (SIGTERM)', 'ok');
    else toast((r && r.error) || 'Error parando', 'error');
    // Refresca estado running enseguida
    await refreshRunningAutomations();
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

async function onOpenAutomationChat(auto) {
  if (!auto || !auto.id || !api.openAutomationChat) return;
  try {
    const r = await api.openAutomationChat({ automationId: auto.id });
    if (!r || r.ok === false) toast((r && r.error) || 'No se pudo abrir el chat', 'error');
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  }
}

async function onRemoveAutomation() {
  const a = state.selectedAutomation;
  if (!a || !a.id) return;
  if (!confirm(`¿Retirar y borrar "${a.name || a.id}"?`)) return;
  setAutoBusy(true);
  try {
    const r = await api.automationsRemove({ id: a.id });
    if (r && r.ok === false) {
      toast((r && r.error) || 'Error al retirar', 'error');
      return;
    }
    state.selectedAutomationId = null;
    state.selectedAutomation = null;
    state.autoDirty = false;
    await loadAutomations();
    clearAutomationSelection();
    toast('Retirada', 'ok');
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    setAutoBusy(false);
  }
}

// ---------- Log polling ----------

function maybeStartLogPolling() {
  stopAutoLogPolling();
  const a = state.selectedAutomation;
  if (!a || a.status !== 'installed' || !a.logPath) return;
  if (state.activeTab !== 'automations') return;
  refreshAutoLog();
  state.autoLogPollTimer = setInterval(refreshAutoLog, 3000);
}

function stopAutoLogPolling() {
  if (state.autoLogPollTimer) {
    clearInterval(state.autoLogPollTimer);
    state.autoLogPollTimer = null;
  }
  state.autoLogLastLen = 0;
}

async function refreshAutoLog() {
  const a = state.selectedAutomation;
  if (!a || !a.id) return;
  if (!api.automationsReadLog) return;
  try {
    const r = await api.automationsReadLog({ id: a.id, lines: 200 });
    const txt = (r && (r.content || r.tail || r.text)) || '';
    const pre = $('#auto-log-pre');
    pre.textContent = txt || '(log vacío)';
    // Detección de error: última línea no vacía
    const lines = txt.split('\n').filter((l) => l.trim());
    const last = lines.length ? lines[lines.length - 1] : '';
    if (/ERROR|FAIL/i.test(last)) pre.classList.add('has-error');
    else pre.classList.remove('has-error');
    // Auto-scroll abajo si el contenido creció
    if (txt.length > state.autoLogLastLen) {
      pre.scrollTop = pre.scrollHeight;
    }
    state.autoLogLastLen = txt.length;
  } catch (e) {
    // silent
  }
}

// =====================================================================

function wireEvents() {
  $('#btn-new').addEventListener('click', newTask);
  $('#btn-close').addEventListener('click', () => api.close());
  $('#btn-minimize').addEventListener('click', () => api.minimize());
  $('#btn-save').addEventListener('click', saveTask);
  $('#btn-toggle').addEventListener('click', toggleTask);
  $('#btn-delete').addEventListener('click', deleteTask);
  $('#btn-run-now').addEventListener('click', runNow);
  $('#btn-cancel').addEventListener('click', cancelRun);
  $('#btn-pick-folder').addEventListener('click', pickFolder);
  $('#btn-modal-close').addEventListener('click', hideModal);
  $('#modal-bg').addEventListener('click', (e) => { if (e.target === $('#modal-bg')) hideModal(); });

  $('#f-sched-type').addEventListener('change', () => {
    const type = $('#f-sched-type').value;
    showSchedBlock(type);
    // Inicializar defaults sensatos al cambiar de tipo si los campos están vacíos
    if (type === 'weekly') {
      const cur = readWeekdays();
      if (!cur.length) setWeekdays([1, 2, 3, 4, 5]);
    }
    if (type === 'once' && !$('#f-once-date').value) {
      $('#f-once-date').value = new Date().toISOString().slice(0, 10);
    }
    markDirty();
    scheduleCronValidate();
  });

  const schedInputs = [
    '#f-every-min', '#f-every-hour',
    '#f-daily-time', '#f-weekly-time',
    '#f-monthly-day', '#f-monthly-time',
    '#f-once-date', '#f-once-time',
    '#f-cron-advanced',
  ];
  for (const sel of schedInputs) {
    const node = $(sel);
    if (!node) continue;
    node.addEventListener('input', () => { markDirty(); scheduleCronValidate(); });
    node.addEventListener('change', () => { markDirty(); scheduleCronValidate(); });
  }

  for (const btn of $$('#f-weekly-days .weekday-btn')) {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      markDirty();
      scheduleCronValidate();
    });
  }

  for (const r of $$('input[name="cli"]')) {
    r.addEventListener('change', () => {
      const cli = ($$('input[name="cli"]:checked')[0] || {}).value || 'claude';
      populateModelEffort(cli, '', '');
      markDirty();
    });
  }

  const dirtyInputs = ['#f-name','#f-cwd','#f-prompt','#f-model','#f-effort','#f-resume','#f-sink-log','#f-sink-macos','#f-sink-tg'];
  for (const sel of dirtyInputs) {
    const node = $(sel);
    if (!node) continue;
    node.addEventListener('input', markDirty);
    node.addEventListener('change', markDirty);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#modal-bg').classList.contains('show')) hideModal();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if ($('#editor-actions').style.display !== 'none') saveTask();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      if (state.activeTab === 'automations') newAutomation();
      else newTask();
    }
  });

  // ---------- Tab bar ----------
  for (const btn of $$('#tab-bar .tab')) {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  }

  // ---------- Automations ----------
  const btnAutoNew = $('#btn-auto-new');
  if (btnAutoNew) btnAutoNew.addEventListener('click', newAutomation);
}

function wireBroadcast() {
  api.onListChanged(() => {
    refreshAll();
  });
  api.onRunStarted((p) => {
    state.liveRuns.set(p.runId, { ...p, status: 'running' });
    refreshActionsState();
    renderRuns();
  });
  api.onRunProgress((p) => {
    const cur = state.liveRuns.get(p.runId);
    if (cur) {
      cur.partialText = p.partialText;
      state.liveRuns.set(p.runId, cur);
      renderRuns();
    }
  });
  api.onRunFinished(async (p) => {
    state.liveRuns.delete(p.runId);
    refreshActionsState();
    await refreshRuns();
    renderRuns();
    await refreshTasks();
  });

  if (api.onAutomationsListChanged) {
    api.onAutomationsListChanged(() => {
      if (state.activeTab === 'automations') loadAutomations();
    });
  }
  if (api.onAutomationRunStarted) {
    api.onAutomationRunStarted((p) => {
      if (state.activeTab !== 'automations') return;
      const pid = p && (p.automationId || p.id);
      if (!state.selectedAutomation || pid !== state.selectedAutomation.id) return;
      refreshAutoLog();
    });
  }
  if (api.onAutomationRunFinished) {
    api.onAutomationRunFinished(async (p) => {
      if (state.activeTab !== 'automations') return;
      const pid = p && (p.automationId || p.id);
      if (state.selectedAutomation && pid === state.selectedAutomation.id) {
        await refreshAutoLog();
      }
      // Refrescar lista por si cambia nextRunAt
      try { state.automations = (await api.automationsList()) || []; renderAutomationsList(); } catch (e) {}
    });
  }
}

async function bootstrap() {
  // El tema ya quedó aplicado por el script inline del <head>, que lee
  // primero ?theme= (heredado de la ventana principal) y luego localStorage.
  // No sobreescribir con nativeTheme aquí porque rompía la herencia.

  try {
    state.telegramConfigured = !!(await api.getTelegramConfigured());
  } catch (e) {
    state.telegramConfigured = false;
  }
  if (!state.telegramConfigured) {
    const lbl = $('#lbl-sink-tg');
    lbl.classList.add('disabled');
    lbl.title = 'Configura el bridge de Telegram primero';
    $('#f-sink-tg').disabled = true;
  }

  try {
    state.cronPresets = await api.getCronPresets() || [];
  } catch (e) {
    state.cronPresets = [
      { label: 'Cada hora en punto', expr: '0 * * * *' },
      { label: 'Cada día a las 9:00', expr: '0 9 * * *' },
    ];
  }

  try {
    const d = await api.getDefaultModelEffort();
    if (d) state.defaults = { model: d.model || '', effort: d.effort || '' };
  } catch (e) {}

  wireEvents();
  wireBroadcast();
  await refreshAll();

  // Restaurar tab activa
  let initialTab = 'tasks';
  try {
    const saved = localStorage.getItem('activeTab');
    if (saved === 'tasks' || saved === 'automations') initialTab = saved;
  } catch (e) {}
  setActiveTab(initialTab);
}

bootstrap();
