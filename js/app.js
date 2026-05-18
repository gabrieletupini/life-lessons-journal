import {
  initFirebase, onSyncStatus, onAuthReady, loginWithGoogle,
  subscribeToPillars, createPillar, updatePillar, deletePillar,
  subscribeToLessons, createLesson, updateLesson, deleteLesson,
  seedDefaultPillars, exportAll, importAll,
} from './firebase.js';

// ===== Defaults =====
const DEFAULT_PILLARS = [
  { name: 'Relationships',    icon: '\u{1F49E}', color: '#c2185b', order: 0 },
  { name: 'Pickup',           icon: '\u{1F339}', color: '#7b1fa2', order: 1 },
  { name: 'Finances',         icon: '\u{1F4B0}', color: '#2e7d32', order: 2 },
  { name: 'Spiritual',        icon: '\u{1F56F}', color: '#5d4037', order: 3 },
  { name: 'Health',           icon: '\u{1F33F}', color: '#00695c', order: 4 },
  { name: 'Career',           icon: '\u{269C}',  color: '#1565c0', order: 5 },
  { name: 'Personal Growth',  icon: '\u{1F331}', color: '#ef6c00', order: 6 },
  { name: 'Creativity',       icon: '\u{1F3A8}', color: '#ad1457', order: 7 },
  { name: 'Family',           icon: '\u{1F3DB}', color: '#6a1b9a', order: 8 },
  { name: 'Travel',           icon: '\u{2708}',  color: '#00838f', order: 9 },
];

const PILLAR_TAG_SUGGESTIONS = {
  'Relationships':   ['communication', 'conflict', 'trust', 'boundaries', 'intimacy', 'friendship', 'vulnerability'],
  'Pickup':          ['confidence', 'approach', 'attraction', 'body-language', 'social-skills', 'frame', 'vibe', 'openers'],
  'Finances':        ['budget', 'investing', 'savings', 'debt', 'mindset', 'income', 'taxes'],
  'Spiritual':       ['meditation', 'mindfulness', 'gratitude', 'purpose', 'presence', 'faith'],
  'Health':          ['fitness', 'nutrition', 'sleep', 'mental-health', 'habits', 'recovery', 'energy'],
  'Career':          ['leadership', 'productivity', 'networking', 'skills', 'negotiation', 'work-life'],
  'Personal Growth': ['discipline', 'self-awareness', 'learning', 'mindset', 'reflection', 'identity'],
  'Creativity':      ['writing', 'art', 'music', 'ideas', 'flow', 'expression'],
  'Family':          ['parenting', 'marriage', 'traditions', 'support', 'memory'],
  'Travel':          ['solo', 'adventure', 'planning', 'cultural', 'photography', 'language'],
};

const PALETTE = [
  '#c2185b', '#7b1fa2', '#2e7d32', '#5d4037', '#00695c',
  '#1565c0', '#ef6c00', '#ad1457', '#6a1b9a', '#00838f',
  '#8b3a3a', '#a8801f', '#5d6a3a', '#3e2723', '#6d4c41',
  '#37474f', '#bf360c', '#827717', '#4a148c', '#01579b',
];

// ===== State =====
let pillars = [];
let lessons = [];
let currentPillarId = null;
let currentSort = 'date-desc';
let currentLessonSearch = '';
let currentGlobalSearch = '';
let editingPillarColor = PALETTE[0];
let editingStars = 0;
let didSeedAttempt = false;

// ===== DOM =====
const $ = (id) => document.getElementById(id);

const loginScreen = $('login-screen');
const appEl = $('app');
const googleBtn = $('google-login-btn');
const loginError = $('login-error');
const syncStatus = $('sync-status');

const pillarsGrid = $('pillars-grid');
const pillarsEmpty = $('pillars-empty');

const viewDashboard = $('view-dashboard');
const viewPillar = $('view-pillar');
const viewSearch = $('view-search');

const lessonsList = $('lessons-list');
const lessonsEmpty = $('lessons-empty');
const pillarDetailName = $('pillar-detail-name');
const pillarDetailIcon = $('pillar-detail-icon');

const lessonsSearchInput = $('lessons-search');
const lessonsSortSelect = $('lessons-sort');
const globalSearchInput = $('global-search');
const searchResults = $('search-results');

const toast = $('toast');

// ===== Init =====
function init() {
  initFirebase();

  onSyncStatus((status) => {
    syncStatus.className = 'sync-status ' + status;
    syncStatus.title = status;
  });

  onAuthReady((user) => {
    if (!user) {
      loginScreen.classList.remove('hidden');
      appEl.classList.add('hidden');
      return;
    }
    loginScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
    startApp();
  });

  googleBtn.addEventListener('click', async () => {
    loginError.textContent = '';
    const result = await loginWithGoogle();
    if (result.error === 'unauthorized') {
      loginError.textContent = 'Unauthorized account.';
    } else if (result.error) {
      loginError.textContent = result.error;
    }
  });
}

let appStarted = false;
function startApp() {
  if (appStarted) return;
  appStarted = true;

  subscribeToPillars((p) => {
    pillars = p;
    renderPillarsGrid();
    if (currentPillarId) renderPillarDetail();
    if (currentGlobalSearch) renderGlobalSearch();
    maybeAutoSeed();
  });

  subscribeToLessons((l) => {
    lessons = l;
    renderPillarsGrid();
    if (currentPillarId) renderPillarDetail();
    if (currentGlobalSearch) renderGlobalSearch();
  });

  setupNav();
  setupPillarModal();
  setupManageModal();
  setupLessonModal();
  setupLessonViewModal();
  setupExportModal();
  setupSearch();
  setupKeyboard();

  $('seed-defaults-btn').addEventListener('click', async () => {
    await seedDefaultPillars(DEFAULT_PILLARS);
    showToast('Default pillars added');
  });
}

async function maybeAutoSeed() {
  if (didSeedAttempt) return;
  didSeedAttempt = true;
  if (pillars.length === 0) {
    await seedDefaultPillars(DEFAULT_PILLARS);
    showToast('Welcome — seeded default pillars');
  }
}

// ===== Views =====
function showView(name) {
  [viewDashboard, viewPillar, viewSearch].forEach(v => {
    v.classList.add('hidden');
    v.classList.remove('view-active');
  });
  if (name === 'dashboard') {
    viewDashboard.classList.remove('hidden');
    viewDashboard.classList.add('view-active');
    currentPillarId = null;
  } else if (name === 'pillar') {
    viewPillar.classList.remove('hidden');
    viewPillar.classList.add('view-active');
  } else if (name === 'search') {
    viewSearch.classList.remove('hidden');
    viewSearch.classList.add('view-active');
  }
}

function setupNav() {
  $('add-pillar-btn').addEventListener('click', () => openPillarModal());
  $('open-manage').addEventListener('click', openManageModal);
  $('open-search').addEventListener('click', openSearch);
  $('open-export').addEventListener('click', () => openModal('export-modal'));

  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.back));
  });

  $('add-lesson-btn').addEventListener('click', () => openLessonModal());
}

// ===== Pillars grid =====
function lessonCount(pillarId) {
  return lessons.filter(l => l.pillarId === pillarId).length;
}

function renderPillarsGrid() {
  pillarsGrid.innerHTML = '';

  if (pillars.length === 0) {
    pillarsGrid.classList.add('hidden');
    pillarsEmpty.classList.remove('hidden');
    return;
  }

  pillarsGrid.classList.remove('hidden');
  pillarsEmpty.classList.add('hidden');

  pillars.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pillar-card';
    card.style.borderTopColor = p.color || PALETTE[0];
    const count = lessonCount(p.id);
    card.innerHTML = `
      <div>
        <div class="pillar-card-icon">${escapeHtml(p.icon || '\u{1F4D6}')}</div>
        <div class="pillar-card-name">${escapeHtml(p.name)}</div>
      </div>
      <div class="pillar-card-count">${count} ${count === 1 ? 'lesson' : 'lessons'}</div>
    `;
    card.addEventListener('click', () => openPillar(p.id));
    pillarsGrid.appendChild(card);
  });
}

// ===== Pillar detail =====
function openPillar(id) {
  currentPillarId = id;
  currentLessonSearch = '';
  lessonsSearchInput.value = '';
  showView('pillar');
  renderPillarDetail();
}

function renderPillarDetail() {
  const p = pillars.find(x => x.id === currentPillarId);
  if (!p) {
    showView('dashboard');
    return;
  }
  pillarDetailName.textContent = p.name;
  pillarDetailName.style.color = p.color || 'var(--ink-dark)';
  pillarDetailIcon.textContent = p.icon || '';

  let items = lessons.filter(l => l.pillarId === currentPillarId);

  if (currentLessonSearch) {
    const q = currentLessonSearch.toLowerCase();
    items = items.filter(l => matchesQuery(l, q));
  }

  items = sortLessons(items, currentSort);

  lessonsList.innerHTML = '';
  if (items.length === 0) {
    lessonsEmpty.classList.remove('hidden');
    return;
  }
  lessonsEmpty.classList.add('hidden');

  items.forEach(l => {
    lessonsList.appendChild(buildLessonCard(l, p));
  });
}

function buildLessonCard(lesson, pillar) {
  const card = document.createElement('div');
  card.className = 'lesson-card';
  card.style.borderLeftColor = (pillar && pillar.color) || PALETTE[0];
  const plain = stripHtml(lesson.description || '');
  const snippet = plain.slice(0, 180);
  const stars = renderStars(lesson.importance || 0);
  const dateStr = formatDate(lesson.date);
  const tagsHtml = (lesson.tags && lesson.tags.length)
    ? `<span class="lesson-card-tags">${lesson.tags.map(t => `<span class="lesson-card-tag">${escapeHtml(t)}</span>`).join('')}</span>`
    : '';
  card.innerHTML = `
    <div class="lesson-card-head">
      <h3 class="lesson-card-title">${escapeHtml(lesson.title)}</h3>
      <span class="lesson-card-stars">${stars}</span>
    </div>
    <p class="lesson-card-snippet">${escapeHtml(snippet)}${plain.length > 180 ? '…' : ''}</p>
    <div class="lesson-card-foot">
      ${pillar ? `<span class="lesson-card-pillar" style="background:${hexToSoft(pillar.color)};color:${pillar.color}">${escapeHtml(pillar.name)}</span>` : ''}
      <span>${dateStr}</span>
      ${tagsHtml}
    </div>
  `;
  card.addEventListener('click', () => openLessonView(lesson));
  return card;
}

function sortLessons(arr, mode) {
  const sorted = [...arr];
  if (mode === 'date-desc') sorted.sort((a, b) => dateValue(b) - dateValue(a));
  else if (mode === 'date-asc') sorted.sort((a, b) => dateValue(a) - dateValue(b));
  else if (mode === 'importance-desc') sorted.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  else if (mode === 'title-asc') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return sorted;
}

function dateValue(l) {
  const d = l.date;
  if (!d) return 0;
  if (typeof d === 'string') return new Date(d).getTime();
  if (d.seconds) return d.seconds * 1000;
  if (d instanceof Date) return d.getTime();
  return 0;
}

function formatDate(d) {
  if (!d) return '';
  let date;
  if (typeof d === 'string') date = new Date(d);
  else if (d.seconds) date = new Date(d.seconds * 1000);
  else if (d instanceof Date) date = d;
  else return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function matchesQuery(lesson, q) {
  return (lesson.title || '').toLowerCase().includes(q)
      || (lesson.description || '').toLowerCase().includes(q)
      || (lesson.tags || []).some(t => t.toLowerCase().includes(q));
}

function renderStars(n) {
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += i <= n ? '★' : '<span class="empty">★</span>';
  }
  return out;
}

lessonsSearchInput.addEventListener('input', (e) => {
  currentLessonSearch = e.target.value.trim();
  renderPillarDetail();
});

lessonsSortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  renderPillarDetail();
});

// ===== Search =====
function openSearch() {
  showView('search');
  currentGlobalSearch = '';
  globalSearchInput.value = '';
  searchResults.innerHTML = '';
  setTimeout(() => globalSearchInput.focus(), 50);
}

function setupSearch() {
  globalSearchInput.addEventListener('input', (e) => {
    currentGlobalSearch = e.target.value.trim();
    renderGlobalSearch();
  });
}

function renderGlobalSearch() {
  searchResults.innerHTML = '';
  if (!currentGlobalSearch) return;
  const q = currentGlobalSearch.toLowerCase();
  const results = lessons.filter(l => matchesQuery(l, q));
  const sorted = sortLessons(results, 'date-desc');
  if (sorted.length === 0) {
    searchResults.innerHTML = '<div class="empty-state"><p>No lessons match your search.</p></div>';
    return;
  }
  sorted.forEach(l => {
    const pillar = pillars.find(p => p.id === l.pillarId);
    searchResults.appendChild(buildLessonCard(l, pillar));
  });
}

// ===== Pillar modal =====
function setupPillarModal() {
  const form = $('pillar-form');
  buildColorPicker($('pillar-color-picker'), (c) => { editingPillarColor = c; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('pillar-id').value;
    const data = {
      name: $('pillar-name').value.trim(),
      icon: $('pillar-icon').value.trim() || '\u{1F4D6}',
      color: editingPillarColor,
    };
    if (!data.name) return;
    if (id) {
      await updatePillar(id, data);
      showToast('Pillar updated');
    } else {
      data.order = pillars.length;
      await createPillar(data);
      showToast('Pillar added');
    }
    closeModal('pillar-modal');
  });

  $('pillar-delete-btn').addEventListener('click', async () => {
    const id = $('pillar-id').value;
    if (!id) return;
    const count = lessonCount(id);
    const msg = count > 0
      ? `Delete this pillar and its ${count} lesson${count === 1 ? '' : 's'}? This cannot be undone.`
      : 'Delete this pillar?';
    if (!confirm(msg)) return;
    await deletePillar(id);
    closeModal('pillar-modal');
    closeModal('manage-modal');
    if (currentPillarId === id) showView('dashboard');
    showToast('Pillar deleted');
  });
}

function openPillarModal(pillar) {
  $('pillar-modal-title').textContent = pillar ? 'Edit Pillar' : 'New Pillar';
  $('pillar-id').value = pillar ? pillar.id : '';
  $('pillar-name').value = pillar ? pillar.name : '';
  $('pillar-icon').value = pillar ? (pillar.icon || '') : '';
  editingPillarColor = pillar ? (pillar.color || PALETTE[0]) : pickRandomPalette();
  refreshColorPicker($('pillar-color-picker'), editingPillarColor);
  $('pillar-delete-btn').classList.toggle('hidden', !pillar);
  openModal('pillar-modal');
  setTimeout(() => $('pillar-name').focus(), 50);
}

// ===== Manage modal =====
function setupManageModal() {
  $('manage-add-btn').addEventListener('click', () => {
    closeModal('manage-modal');
    openPillarModal();
  });
}

function openManageModal() {
  const list = $('manage-list');
  list.innerHTML = '';
  pillars.forEach(p => {
    const row = document.createElement('div');
    row.className = 'manage-row';
    const count = lessonCount(p.id);
    row.innerHTML = `
      <span class="manage-row-color" style="background:${p.color || PALETTE[0]}"></span>
      <span class="manage-row-icon">${escapeHtml(p.icon || '\u{1F4D6}')}</span>
      <span class="manage-row-name">${escapeHtml(p.name)}</span>
      <span class="manage-row-count">${count}</span>
    `;
    row.addEventListener('click', () => {
      closeModal('manage-modal');
      openPillarModal(p);
    });
    list.appendChild(row);
  });
  openModal('manage-modal');
}

// ===== Lesson modal =====
function setupLessonModal() {
  const form = $('lesson-form');
  const starsEl = $('lesson-stars');
  const editor = $('lesson-description');

  starsEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('star')) return;
    const v = parseInt(e.target.dataset.val);
    editingStars = (editingStars === v) ? 0 : v;
    refreshStars();
  });

  // Rich text toolbar
  document.querySelectorAll('.rich-toolbar button[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      editor.focus();
      document.execCommand(btn.dataset.cmd, false);
      updateToolbarState();
    });
  });

  editor.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); document.execCommand('bold'); updateToolbarState(); }
    if (k === 'i') { e.preventDefault(); document.execCommand('italic'); updateToolbarState(); }
  });

  editor.addEventListener('keyup', updateToolbarState);
  editor.addEventListener('mouseup', updateToolbarState);

  // Tag suggestions
  $('lesson-pillar').addEventListener('change', updateTagSuggestions);
  $('lesson-tags').addEventListener('input', updateTagSuggestions);
  $('tag-suggestions').addEventListener('click', (e) => {
    const chip = e.target.closest('.tag-chip');
    if (!chip) return;
    const tagsInput = $('lesson-tags');
    const cur = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
    if (!cur.includes(chip.dataset.tag)) cur.push(chip.dataset.tag);
    tagsInput.value = cur.join(', ');
    updateTagSuggestions();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('lesson-id').value;
    const title = $('lesson-title').value.trim();
    const description = sanitizeRichHtml(editor.innerHTML);
    const pillarId = $('lesson-pillar').value;
    const dateRaw = $('lesson-date').value;
    const tagsRaw = $('lesson-tags').value;

    if (!title || !pillarId) return;

    const data = {
      title,
      description,
      pillarId,
      date: dateRaw ? new Date(dateRaw) : new Date(),
      importance: editingStars,
      tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
    };
    if (id) {
      await updateLesson(id, data);
      showToast('Lesson updated');
    } else {
      await createLesson(data);
      showToast('Lesson added');
    }
    closeModal('lesson-modal');
  });

  $('lesson-delete-btn').addEventListener('click', async () => {
    const id = $('lesson-id').value;
    if (!id) return;
    if (!confirm('Delete this lesson?')) return;
    await deleteLesson(id);
    closeModal('lesson-modal');
    closeModal('lesson-view-modal');
    showToast('Lesson deleted');
  });
}

function updateToolbarState() {
  document.querySelectorAll('.rich-toolbar button[data-cmd]').forEach(btn => {
    let active = false;
    try { active = document.queryCommandState(btn.dataset.cmd); } catch {}
    btn.classList.toggle('active', active);
  });
}

function updateTagSuggestions() {
  const container = $('tag-suggestions');
  const pillarId = $('lesson-pillar').value;
  const p = pillars.find(x => x.id === pillarId);
  if (!p) { container.innerHTML = ''; return; }
  const suggestions = PILLAR_TAG_SUGGESTIONS[p.name] || [];
  const current = $('lesson-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  container.innerHTML = suggestions
    .filter(s => !current.includes(s))
    .map(s => `<button type="button" class="tag-chip" data-tag="${escapeHtml(s)}">+ ${escapeHtml(s)}</button>`)
    .join('');
}

function openLessonModal(lesson) {
  $('lesson-modal-title').textContent = lesson ? 'Edit Lesson' : 'New Lesson';
  $('lesson-id').value = lesson ? lesson.id : '';
  $('lesson-title').value = lesson ? lesson.title : '';
  $('lesson-description').innerHTML = lesson ? (lesson.description || '') : '';

  // Pillar dropdown
  const sel = $('lesson-pillar');
  sel.innerHTML = '';
  pillars.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.icon || ''} ${p.name}`.trim();
    sel.appendChild(opt);
  });
  sel.value = (lesson && lesson.pillarId) || currentPillarId || (pillars[0] && pillars[0].id) || '';

  // Date
  const dateInput = $('lesson-date');
  if (lesson && lesson.date) {
    const d = lesson.date.seconds ? new Date(lesson.date.seconds * 1000)
      : (typeof lesson.date === 'string' ? new Date(lesson.date) : lesson.date);
    dateInput.value = d.toISOString().slice(0, 10);
  } else {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  // Stars
  editingStars = lesson ? (lesson.importance || 0) : 0;
  refreshStars();

  // Tags
  $('lesson-tags').value = lesson && lesson.tags ? lesson.tags.join(', ') : '';

  $('lesson-delete-btn').classList.toggle('hidden', !lesson);

  updateTagSuggestions();
  openModal('lesson-modal');
  setTimeout(() => $('lesson-title').focus(), 50);
}

function refreshStars() {
  document.querySelectorAll('#lesson-stars .star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= editingStars);
  });
  $('lesson-stars').dataset.val = editingStars;
}

// ===== Lesson view modal =====
function setupLessonViewModal() {
  $('lv-edit-btn').addEventListener('click', () => {
    const lesson = lessons.find(l => l.id === $('lesson-view-modal').dataset.lessonId);
    if (!lesson) return;
    closeModal('lesson-view-modal');
    openLessonModal(lesson);
  });

  $('lv-copy-btn').addEventListener('click', async () => {
    const lesson = lessons.find(l => l.id === $('lesson-view-modal').dataset.lessonId);
    if (!lesson) return;
    const text = `${lesson.title}\n\n${lesson.description}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    } catch {
      showToast('Copy failed', 'error');
    }
  });
}

function openLessonView(lesson) {
  const modal = $('lesson-view-modal');
  modal.dataset.lessonId = lesson.id;
  $('lv-title').textContent = lesson.title;
  const pillar = pillars.find(p => p.id === lesson.pillarId);
  const pEl = $('lv-pillar');
  pEl.textContent = pillar ? pillar.name : '—';
  if (pillar) {
    pEl.style.background = hexToSoft(pillar.color);
    pEl.style.color = pillar.color;
  }
  $('lv-date').textContent = formatDate(lesson.date);
  $('lv-stars').innerHTML = renderStars(lesson.importance || 0);
  const tagsEl = $('lv-tags');
  tagsEl.innerHTML = (lesson.tags || []).map(t => `<span>${escapeHtml(t)}</span>`).join('');
  $('lv-description').innerHTML = sanitizeRichHtml(lesson.description || '');
  openModal('lesson-view-modal');
}

// ===== Export / Import =====
function setupExportModal() {
  $('export-btn').addEventListener('click', async () => {
    const log = $('export-log');
    log.classList.add('show');
    log.textContent = 'Fetching…';
    try {
      const data = await exportAll();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `life-lessons-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      log.textContent = `Exported ${data.pillars.length} pillars and ${data.lessons.length} lessons.`;
      showToast('Backup downloaded');
    } catch (err) {
      log.textContent = 'Error: ' + err.message;
    }
  });

  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const log = $('export-log');
    log.classList.add('show');
    log.textContent = 'Reading file…';
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!confirm(`Import ${payload.pillars?.length || 0} pillars and ${payload.lessons?.length || 0} lessons? This REPLACES all existing data.`)) {
        log.textContent = 'Cancelled.';
        e.target.value = '';
        return;
      }
      const result = await importAll(payload);
      log.textContent = `Imported ${result.pillars} pillars and ${result.lessons} lessons.`;
      showToast('Imported');
    } catch (err) {
      log.textContent = 'Error: ' + err.message;
      showToast('Import failed', 'error');
    }
    e.target.value = '';
  });
}

// ===== Color picker =====
function buildColorPicker(container, onSelect) {
  container.innerHTML = '';
  PALETTE.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = c;
    sw.dataset.color = c;
    sw.addEventListener('click', () => {
      onSelect(c);
      refreshColorPicker(container, c);
    });
    container.appendChild(sw);
  });
}

function refreshColorPicker(container, selected) {
  container.querySelectorAll('.color-swatch').forEach(sw => {
    sw.classList.toggle('selected', sw.dataset.color === selected);
  });
}

function pickRandomPalette() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

// ===== Modals helpers =====
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    const modal = btn.closest('.modal');
    if (modal) modal.classList.remove('open');
  });
});

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
});

// ===== Keyboard =====
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
  });
}

// ===== Utilities =====
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// Allow only bold/italic + line breaks. Strip everything else, including
// attributes (no on*, no style, no href). Safe for innerHTML rendering.
const ALLOWED_RICH = new Set(['B', 'I', 'EM', 'STRONG', 'BR', 'DIV', 'P']);
function sanitizeRichHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  tmp.querySelectorAll('script, style, iframe, object, embed').forEach(el => el.remove());
  tmp.querySelectorAll('*').forEach(el => {
    if (!ALLOWED_RICH.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      return;
    }
    [...el.attributes].forEach(a => el.removeAttribute(a.name));
  });
  const out = tmp.innerHTML.trim();
  return (out === '<br>' || out === '<br/>') ? '' : out;
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

function hexToSoft(hex) {
  if (!hex) return 'rgba(212,175,55,0.18)';
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.16)`;
}

let toastTimer = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

document.addEventListener('DOMContentLoaded', init);
