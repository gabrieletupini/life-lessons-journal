import {
  initFirebase, onSyncStatus, onAuthReady, loginWithGoogle,
  subscribeToPillars, createPillar, updatePillar, deletePillar,
  subscribeToLessons, createLesson, updateLesson, deleteLesson,
  subscribeToStudyNuances, createStudyNuance, updateStudyNuance, deleteStudyNuance,
  seedDefaultPillars, exportAll, importAll,
} from './firebase.js';
import { STUDIES } from './studies.js';
import { SEED_ADDENDUMS } from './seed-addendums.js';

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
let studyNuances = [];
let expandedStudies = new Set(); // study ids whose addendum panel is open
let pendingNuanceBody = '';      // raw HTML staged for the current addendum modal
let pendingNuanceFileName = '';  // filename of the most recently dropped HTML
let seedAttempted = false;       // run the addendum seeder only once per session
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

  subscribeToStudyNuances((n) => {
    studyNuances = n;
    if (currentPillarId) renderPillarDetail();
    if (!seedAttempted) {
      seedAttempted = true;
      maybeSeedAddendums();
    }
  });

  setupNav();
  setupPillarModal();
  setupManageModal();
  setupLessonModal();
  setupLessonViewModal();
  setupStudyNuanceModal();
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

function studiesForPillar(pillarName) {
  return STUDIES.filter(s => s.pillarName === pillarName);
}

function studyById(id) {
  return STUDIES.find(s => s.id === id);
}

function renderLinkedStudies(lesson) {
  const el = document.getElementById('lv-studies');
  if (!el) return;
  const ids = (lesson.studyIds || []).filter(Boolean);
  const items = ids.map(studyById).filter(Boolean);
  if (items.length === 0) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="lv-studies-title">Linked studies</div>
    ${items.map(s => {
      const fname = s.file.split('/').pop();
      return `
        <div class="study-card">
          <div class="study-card-info">
            <div class="study-card-title">${escapeHtml(s.title)}</div>
            <div class="study-card-excerpt">${escapeHtml(s.excerpt)}</div>
            <div class="study-card-meta">${s.readingMinutes} min</div>
          </div>
          <div class="study-card-actions">
            <a class="study-btn study-btn-view" href="${s.file}" target="_blank" rel="noopener">View →</a>
            <a class="study-btn study-btn-download" href="${s.file}" download="${fname}">⬇ Download</a>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function nuancesForStudy(studyId) {
  return studyNuances
    .filter(n => n.studyId === studyId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function renderPillarStudies(pillar) {
  const container = document.getElementById('pillar-studies');
  if (!container) return;
  const items = studiesForPillar(pillar.name);
  if (items.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  container.classList.remove('hidden');
  const cards = items.map(s => {
    const fname = s.file.split('/').pop();
    const ns = nuancesForStudy(s.id);
    const isOpen = expandedStudies.has(s.id);
    const addendumBtnLabel = ns.length ? `▾ Addendums (${ns.length})` : '+ Addendum';
    const panelHtml = isOpen ? renderStudyAddendumsPanel(s, ns) : '';
    return `
      <div class="study-card${isOpen ? ' is-open' : ''}" data-study-id="${escapeHtml(s.id)}">
        <div class="study-card-row">
          <div class="study-card-info">
            <div class="study-card-title">${escapeHtml(s.title)}</div>
            <div class="study-card-excerpt">${escapeHtml(s.excerpt)}</div>
            <div class="study-card-meta">${s.readingMinutes} min · ${escapeHtml(s.publishedAt || '')}</div>
          </div>
          <div class="study-card-actions">
            <a class="study-btn study-btn-view" href="${s.file}" target="_blank" rel="noopener">View →</a>
            <a class="study-btn study-btn-download" href="${s.file}" download="${fname}">⬇ Download</a>
            <button type="button" class="study-btn study-btn-addendum" data-study-id="${escapeHtml(s.id)}">${escapeHtml(addendumBtnLabel)}</button>
          </div>
        </div>
        ${panelHtml}
      </div>
    `;
  }).join('');
  container.innerHTML = `<div class="pillar-studies-title">Studies for this pillar</div>${cards}`;

  // Wire toggle buttons
  container.querySelectorAll('.study-btn-addendum').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.studyId;
      if (expandedStudies.has(id)) expandedStudies.delete(id);
      else expandedStudies.add(id);
      renderPillarStudies(pillar);
    });
  });
  container.querySelectorAll('[data-action="add-nuance"]').forEach(btn => {
    btn.addEventListener('click', () => openStudyNuanceModal(btn.dataset.studyId, null));
  });
  container.querySelectorAll('[data-action="edit-nuance"]').forEach(btn => {
    btn.addEventListener('click', () => openStudyNuanceModal(btn.dataset.studyId, btn.dataset.nuanceId));
  });
}

function renderStudyAddendumsPanel(study, ns) {
  const items = ns.length
    ? ns.map((n, i) => {
        const raw = n.body || n.text || '';
        // Wrap fragments in a minimal doc shell so legacy plain-text addendums
        // still render. Full-doc HTML is left untouched so its <head>/<style>
        // applies inside the iframe.
        const looksLikeDoc = /^\s*<(?:!doctype|html)/i.test(raw);
        const docHtml = looksLikeDoc ? raw : `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:'Crimson Text',Georgia,serif;color:#3e2723;background:#f4ede1;padding:18px;line-height:1.7;margin:0}h1,h2,h3,h4{font-family:'Cormorant Garamond',serif;font-weight:600;letter-spacing:0.02em}blockquote{font-style:italic;border-left:2px solid #d4af37;padding-left:14px;margin:10px 0;color:#3e2723}a{color:#a8801f}</style></head><body>${escapeHtml(raw)}</body></html>`;
        const srcdoc = String(docHtml).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const descHtml = n.description
          ? `<div class="study-nuance-desc">${escapeHtml(n.description)}</div>`
          : '';
        return `
          <div class="study-nuance">
            <div class="study-nuance-head">
              <span class="study-nuance-num">№ ${i + 1}</span>
              <span class="study-nuance-title">${escapeHtml(n.title || '')}</span>
              <button type="button" class="study-nuance-edit" data-action="edit-nuance"
                      data-study-id="${escapeHtml(study.id)}" data-nuance-id="${escapeHtml(n.id)}"
                      title="Edit">✎</button>
            </div>
            ${descHtml}
            <iframe class="study-nuance-iframe" sandbox srcdoc="${srcdoc}" loading="lazy" title="Addendum ${i + 1}"></iframe>
          </div>
        `;
      }).join('')
    : '<div class="study-nuance-empty">No addendums yet. Add one to start collecting variations on this study.</div>';
  return `
    <div class="study-addendums-panel">
      ${items}
      <button type="button" class="study-add-nuance-btn" data-action="add-nuance" data-study-id="${escapeHtml(study.id)}">+ Add addendum</button>
    </div>
  `;
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

  renderPillarStudies(p);

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

  const groupByMonth = currentSort === 'date-desc' || currentSort === 'date-asc';
  if (groupByMonth) {
    const groups = groupLessonsByMonth(items, currentSort === 'date-desc');
    groups.forEach(g => {
      lessonsList.appendChild(buildMonthGroup(g, p));
    });
  } else {
    items.forEach(l => {
      lessonsList.appendChild(buildLessonCard(l, p));
    });
  }
}

function groupLessonsByMonth(items, desc) {
  const groups = new Map();
  for (const l of items) {
    const ts = dateValue(l);
    let key, year, monthLabel;
    if (!ts) {
      key = 'undated';
      year = '';
      monthLabel = 'Undated';
    } else {
      const d = new Date(ts);
      key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
      year = String(d.getFullYear());
      monthLabel = d.toLocaleDateString(undefined, { month: 'long' });
    }
    if (!groups.has(key)) groups.set(key, { key, year, monthLabel, lessons: [] });
    groups.get(key).lessons.push(l);
  }
  const arr = [...groups.values()];
  arr.sort((a, b) => {
    if (a.key === 'undated') return 1;
    if (b.key === 'undated') return -1;
    return desc ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key);
  });
  return arr;
}

function buildMonthGroup(group, pillar) {
  const wrap = document.createElement('div');
  wrap.className = 'month-group';
  const count = group.lessons.length;
  const yearHtml = group.year ? `<span class="month-year">${escapeHtml(group.year)}</span>` : '';
  const head = document.createElement('div');
  head.className = 'month-header';
  head.innerHTML = `
    <div class="month-label">${escapeHtml(group.monthLabel)}${yearHtml}</div>
    <div class="month-count">${count} ${count === 1 ? 'lesson' : 'lessons'}</div>
  `;
  wrap.appendChild(head);
  const list = document.createElement('div');
  list.className = 'month-lessons';
  group.lessons.forEach(l => list.appendChild(buildLessonCard(l, pillar)));
  wrap.appendChild(list);
  return wrap;
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
  const linkedStudies = (lesson.studyIds || []).map(studyById).filter(Boolean);
  const studiesHtml = linkedStudies.length
    ? `<span class="lesson-card-studies" title="${linkedStudies.map(s => s.title).join(' · ')}">📎 ${linkedStudies.length === 1 ? linkedStudies[0].title : linkedStudies.length + ' studies'}</span>`
    : '';
  const nuanceList = (lesson.nuances || []).filter(n => n && (n.title || n.text));
  const nuancesHtml = nuanceList.length
    ? `
      <div class="lesson-card-nuances-inline">
        ${nuanceList.map((n, i) => {
          const t = n.text ? truncate(n.text, 140) : '';
          const dash = n.title && t ? ' — ' : '';
          return `
            <div class="lesson-card-nuance">
              <span class="lesson-card-nuance-num">№ ${i + 1}</span>
              ${n.title ? `<span class="lesson-card-nuance-title">${escapeHtml(n.title)}</span>` : ''}
              ${t ? `<span class="lesson-card-nuance-text">${dash}${escapeHtml(t)}</span>` : ''}
            </div>
          `;
        }).join('')}
      </div>`
    : '';
  card.innerHTML = `
    <div class="lesson-card-head">
      <h3 class="lesson-card-title">${escapeHtml(lesson.title)}</h3>
      <span class="lesson-card-stars">${stars}</span>
    </div>
    <p class="lesson-card-snippet">${escapeHtml(snippet)}${plain.length > 180 ? '…' : ''}</p>
    ${nuancesHtml}
    <div class="lesson-card-foot">
      ${pillar ? `<span class="lesson-card-pillar" style="background:${hexToSoft(pillar.color)};color:${pillar.color}">${escapeHtml(pillar.name)}</span>` : ''}
      <span>${dateStr}</span>
      ${tagsHtml}
      ${studiesHtml}
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

  // Tag suggestions + studies picker re-render on pillar change
  $('lesson-pillar').addEventListener('change', () => {
    updateTagSuggestions();
    refreshStudiesPicker();
  });
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

  $('add-nuance-btn').addEventListener('click', () => {
    const editor = $('lesson-nuances-editor');
    editor.appendChild(buildNuanceRow({}, editor.querySelectorAll('.nuance-row').length));
    const last = editor.querySelector('.nuance-row:last-child input.nuance-title');
    if (last) last.focus();
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

    const studyIds = [...document.querySelectorAll('#lesson-studies-picker input:checked')].map(cb => cb.value);
    const nuances = collectNuances();

    const data = {
      title,
      description,
      pillarId,
      date: dateRaw ? new Date(dateRaw) : new Date(),
      importance: editingStars,
      tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
      studyIds,
      nuances,
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

  // Studies picker pre-selection from existing lesson, then render based on current pillar
  editingStudyIds = lesson && lesson.studyIds ? [...lesson.studyIds] : [];
  updateTagSuggestions();
  refreshStudiesPicker();
  renderNuancesEditor(lesson ? lesson.nuances || [] : []);
  openModal('lesson-modal');
  setTimeout(() => $('lesson-title').focus(), 50);
}

let editingStudyIds = [];

function refreshStudiesPicker() {
  const labelEl = document.getElementById('lesson-studies-label');
  const pickerEl = document.getElementById('lesson-studies-picker');
  if (!labelEl || !pickerEl) return;

  const pillarId = $('lesson-pillar').value;
  const pillar = pillars.find(x => x.id === pillarId);
  const items = pillar ? studiesForPillar(pillar.name) : [];

  if (items.length === 0) {
    labelEl.classList.add('hidden');
    pickerEl.innerHTML = '';
    return;
  }
  labelEl.classList.remove('hidden');
  pickerEl.innerHTML = items.map(s => {
    const checked = editingStudyIds.includes(s.id);
    return `
      <label class="studies-picker-row${checked ? ' checked' : ''}">
        <input type="checkbox" value="${s.id}"${checked ? ' checked' : ''}>
        <span>${escapeHtml(s.title)}</span>
      </label>
    `;
  }).join('');
  pickerEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.studies-picker-row').classList.toggle('checked', cb.checked);
      editingStudyIds = [...pickerEl.querySelectorAll('input:checked')].map(c => c.value);
    });
  });
}

function refreshStars() {
  document.querySelectorAll('#lesson-stars .star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= editingStars);
  });
  $('lesson-stars').dataset.val = editingStars;
}

// ===== Nuances editor =====
function renderNuancesEditor(nuances) {
  const editor = document.getElementById('lesson-nuances-editor');
  if (!editor) return;
  editor.innerHTML = '';
  (nuances || []).forEach((n, i) => editor.appendChild(buildNuanceRow(n, i)));
}

function buildNuanceRow(nuance, index) {
  const row = document.createElement('div');
  row.className = 'nuance-row';
  row.innerHTML = `
    <div class="nuance-row-head">
      <span class="nuance-num">№ ${(index || 0) + 1}</span>
      <input type="text" class="nuance-title" placeholder="Title — e.g. edge case, variation, caveat" value="${escapeHtml(nuance && nuance.title || '')}">
      <button type="button" class="nuance-remove" title="Remove">×</button>
    </div>
    <textarea class="nuance-text" placeholder="What changes — the variation, the addendum, the subtlety…">${escapeHtml(nuance && nuance.text || '')}</textarea>
  `;
  row.querySelector('.nuance-remove').addEventListener('click', () => {
    row.remove();
    renumberNuances();
  });
  return row;
}

function renumberNuances() {
  document.querySelectorAll('#lesson-nuances-editor .nuance-row').forEach((row, i) => {
    const numEl = row.querySelector('.nuance-num');
    if (numEl) numEl.textContent = `№ ${i + 1}`;
  });
}

function collectNuances() {
  const rows = document.querySelectorAll('#lesson-nuances-editor .nuance-row');
  const out = [];
  rows.forEach(row => {
    const title = (row.querySelector('.nuance-title')?.value || '').trim();
    const text = (row.querySelector('.nuance-text')?.value || '').trim();
    if (!title && !text) return;
    out.push({ title, text });
  });
  return out;
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
  renderLessonNuances(lesson);
  renderLinkedStudies(lesson);
  openModal('lesson-view-modal');
}

function renderLessonNuances(lesson) {
  const el = document.getElementById('lv-nuances');
  if (!el) return;
  const list = (lesson.nuances || []).filter(n => n && (n.title || n.text));
  if (list.length === 0) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="lv-nuances-title">Nuances &amp; Addendums</div>
    ${list.map((n, i) => `
      <div class="lv-nuance">
        <span class="lv-nuance-num">№ ${i + 1}</span>
        ${n.title ? `<div class="lv-nuance-title">${escapeHtml(n.title)}</div>` : ''}
        ${n.text ? `<div class="lv-nuance-text">${escapeHtml(n.text)}</div>` : ''}
      </div>
    `).join('')}
  `;
}

// ===== Export / Import =====
// ===== Study addendum modal =====
function setupStudyNuanceModal() {
  // Drag-and-drop / click-to-browse HTML import
  const drop = $('sn-html-drop');
  const fileInput = $('sn-html-file');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) importHtmlIntoAddendum(file);
  });
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importHtmlIntoAddendum(file);
    fileInput.value = '';
  });

  $('sn-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('sn-id').value;
    const studyId = $('sn-study-id').value;
    const title = $('sn-title').value.trim();
    const description = $('sn-description').value.trim();
    if (!title || !studyId) return;
    if (!pendingNuanceBody) {
      showToast('Drop an .html file before saving.', 'error');
      return;
    }
    const data = { title, description, body: pendingNuanceBody };
    const saveBtn = e.submitter || $('sn-form').querySelector('button[type="submit"]');
    const originalLabel = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
      if (id) {
        await updateStudyNuance(id, data);
        showToast('Addendum updated');
      } else {
        const order = nuancesForStudy(studyId).length;
        await createStudyNuance({ studyId, ...data, order });
        showToast('Addendum added');
      }
      closeModal('study-nuance-modal');
    } catch (err) {
      console.error('Save addendum failed:', err);
      const msg = err && err.code === 'permission-denied'
        ? 'Permission denied. Firestore rules don\'t allow writes to study_nuances yet — see console.'
        : (err && err.message) || String(err);
      showToast('Save failed: ' + msg, 'error');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalLabel; }
    }
  });

  $('sn-delete-btn').addEventListener('click', async () => {
    const id = $('sn-id').value;
    if (!id) return;
    if (!confirm('Delete this addendum?')) return;
    await deleteStudyNuance(id);
    closeModal('study-nuance-modal');
    showToast('Addendum deleted');
  });
}

function openStudyNuanceModal(studyId, nuanceId) {
  const study = STUDIES.find(s => s.id === studyId);
  const nuance = nuanceId ? studyNuances.find(n => n.id === nuanceId) : null;
  $('sn-modal-title').textContent = nuance ? 'Edit addendum' : 'Add addendum';
  $('sn-modal-sub').textContent = study
    ? `Attached to: ${study.title}`
    : 'Variations on the study\'s central idea.';
  $('sn-id').value = nuance ? nuance.id : '';
  $('sn-study-id').value = studyId;
  $('sn-title').value = nuance ? (nuance.title || '') : '';
  $('sn-description').value = nuance ? (nuance.description || '') : '';
  pendingNuanceBody = nuance ? (nuance.body || nuance.text || '') : '';
  pendingNuanceFileName = '';
  updateHtmlStatus();
  $('sn-delete-btn').classList.toggle('hidden', !nuance);
  expandedStudies.add(studyId);
  openModal('study-nuance-modal');
  setTimeout(() => $('sn-title').focus(), 50);
}

async function importHtmlIntoAddendum(file) {
  if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
    showToast('Drop an .html file', 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('HTML file too large (max 2 MB)', 'error');
    return;
  }
  try {
    const text = await file.text();
    pendingNuanceBody = stripScripts(text);
    pendingNuanceFileName = file.name;

    // Auto-fill title from <title> / <h1>/<h2> when empty
    const titleEl = $('sn-title');
    if (!titleEl.value.trim()) {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const t = (doc.title || doc.querySelector('h1, h2, h3')?.textContent || '').trim();
      if (t) titleEl.value = t.slice(0, 120);
    }
    updateHtmlStatus();
    showToast(`Loaded ${file.name}`);
  } catch (err) {
    console.error(err);
    showToast('Could not read file: ' + (err.message || err), 'error');
  }
}

function updateHtmlStatus() {
  const el = $('sn-html-status');
  if (!pendingNuanceBody) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  const sizeKb = (pendingNuanceBody.length / 1024).toFixed(1);
  const label = pendingNuanceFileName
    ? `<strong>${escapeHtml(pendingNuanceFileName)}</strong>`
    : '<strong>Current saved body</strong>';
  el.innerHTML = `✓ ${label} · ${sizeKb} KB ready · <span class="sn-html-hint">drop another file to replace</span>`;
}

// Remove only <script> blocks. The iframe sandbox handles the rest of the
// isolation when rendering.
function stripScripts(html) {
  return String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// ===== Seed addendums (one-shot) =====
const SEED_IMPORTED_KEY = 'importedSeedAddendums:v1';
function loadImportedSeedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(SEED_IMPORTED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveImportedSeedSet(set) {
  try { localStorage.setItem(SEED_IMPORTED_KEY, JSON.stringify([...set])); }
  catch {}
}

async function maybeSeedAddendums() {
  const imported = loadImportedSeedSet();
  let created = 0;
  for (const seed of SEED_ADDENDUMS) {
    if (imported.has(seed.seedId)) continue;
    const existing = studyNuances.find(n => n.seedId === seed.seedId);
    if (existing) { imported.add(seed.seedId); continue; }
    try {
      const r = await fetch(seed.file);
      if (!r.ok) { console.warn('Seed fetch failed:', seed.file, r.status); continue; }
      const body = stripScripts(await r.text());
      await createStudyNuance({
        seedId: seed.seedId,
        studyId: seed.studyId,
        title: seed.title,
        description: seed.description || '',
        body,
        order: seed.order ?? 0,
      });
      imported.add(seed.seedId);
      created++;
    } catch (err) {
      console.warn('Seed addendum failed:', seed.seedId, err);
    }
  }
  saveImportedSeedSet(imported);
  if (created > 0) showToast(`Imported ${created} starter addendum${created === 1 ? '' : 's'}`);
}

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

function truncate(s, n) {
  if (!s) return '';
  const t = String(s).trim();
  if (t.length <= n) return t;
  return t.slice(0, n).replace(/\s+\S*$/, '') + '…';
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
