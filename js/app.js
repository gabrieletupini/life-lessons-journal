import {
  initFirebase, onSyncStatus, onAuthReady, loginWithGoogle, logout,
  subscribeToPillars, createPillar, updatePillar, deletePillar,
  subscribeToLessons, createLesson, updateLesson, deleteLesson,
  subscribeToStudyNuances, createStudyNuance, updateStudyNuance, deleteStudyNuance,
  subscribeToStoaLogs,
  seedDefaultPillars, exportAll, importAll,
} from './firebase.js';
import { STUDIES } from './studies.js';
import { SEED_ADDENDUMS } from './seed-addendums.js';

// ===== Defaults =====
const DEFAULT_PILLARS = [
  { name: 'Pickup',           icon: '\u{1F339}', color: '#7b1fa2', order: 0 },
  { name: 'Shadow Work',      icon: '\u{1F311}', color: '#311b92', order: 1 },
];

const PILLAR_TAG_SUGGESTIONS = {
  'Pickup':       ['confidence', 'approach', 'attraction', 'body-language', 'social-skills', 'frame', 'vibe', 'openers'],
  'Shadow Work':  ['trigger', 'anxiety', 'anger', 'fear', 'shame', 'projection', 'essay', 'pattern', 'somatic', 'integration'],
};

// Emotions surfaced in the trigger form (negative-emotion focus, expanded
// beyond Stoa's 4 core so the user can land on the precise one).
const TRIGGER_EMOTIONS = [
  { key: 'anger',         label: 'Anger',         color: '#b85a45' },
  { key: 'frustration',   label: 'Frustration',   color: '#c97a5a' },
  { key: 'resentment',    label: 'Resentment',    color: '#9b4f3f' },
  { key: 'sadness',       label: 'Sadness',       color: '#5a6f8b' },
  { key: 'grief',         label: 'Grief',         color: '#4a5670' },
  { key: 'loneliness',    label: 'Loneliness',    color: '#6b7a96' },
  { key: 'anxiety',       label: 'Anxiety',       color: '#a17a4a' },
  { key: 'fear',          label: 'Fear',          color: '#7a5a3a' },
  { key: 'shame',         label: 'Shame',         color: '#8b4a5f' },
  { key: 'guilt',         label: 'Guilt',         color: '#7a4555' },
  { key: 'jealousy',      label: 'Jealousy',      color: '#6e7a3a' },
  { key: 'helplessness',  label: 'Helplessness',  color: '#7a7a7a' },
  { key: 'hypochondria',  label: 'Hypochondria',  color: '#8b6b45' },
];

// Legacy pillar names removed in the 2-pillar refactor. Empty ones get
// auto-deleted on next load; ones with lessons are left alone for the user.
const LEGACY_PILLAR_NAMES = new Set([
  'Relationships', 'Finances', 'Spiritual', 'Health', 'Career',
  'Personal Growth', 'Creativity', 'Family', 'Travel',
]);

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
let pillarView = 'calendar';     // 'calendar' | 'catalog'
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let readOnly = false;            // true when the visitor entered without auth
let currentSort = 'date-desc';
let currentLessonSearch = '';
let currentGlobalSearch = '';
let editingPillarColor = PALETTE[0];
let editingStars = 0;
let didSeedAttempt = false;
let stoaLogs = [];
let editingTriggerEmotions = [];

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
    if (user) {
      // Auth wins — drop read-only mode if it was on
      readOnly = false;
      document.body.classList.remove('read-only');
      const banner = document.getElementById('readonly-banner');
      if (banner) banner.classList.add('hidden');
      loginScreen.classList.add('hidden');
      appEl.classList.remove('hidden');
      startApp();
      return;
    }
    // No user — show login UNLESS we're already in read-only mode
    if (!readOnly) {
      loginScreen.classList.remove('hidden');
      appEl.classList.add('hidden');
    }
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

  document.getElementById('readonly-btn').addEventListener('click', enterReadOnly);
  const signinLink = document.getElementById('signin-link');
  if (signinLink) signinLink.addEventListener('click', exitReadOnly);
  const bannerLink = document.getElementById('readonly-banner-signin');
  if (bannerLink) bannerLink.addEventListener('click', exitReadOnly);

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      console.log('Sign out clicked');
      logoutBtn.disabled = true;
      const originalLabel = logoutBtn.textContent;
      logoutBtn.textContent = 'Signing out…';
      try {
        await logout();
        console.log('signOut resolved — reloading');
      } catch (err) {
        console.error('signOut failed:', err);
        showToast('Sign out failed: ' + (err && err.message ? err.message : err), 'error');
        logoutBtn.disabled = false;
        logoutBtn.textContent = originalLabel;
        return;
      }
      window.location.reload();
    });
  }
}

function enterReadOnly() {
  readOnly = true;
  document.body.classList.add('read-only');
  const banner = document.getElementById('readonly-banner');
  if (banner) banner.classList.remove('hidden');
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  startApp();
}

function exitReadOnly(e) {
  if (e && e.preventDefault) e.preventDefault();
  window.location.reload();
}

let appStarted = false;
function startApp() {
  if (appStarted) return;
  appStarted = true;

  subscribeToPillars((p) => {
    pillars = p;
    pillarsLoaded = true;
    renderPillarsGrid();
    if (currentPillarId) renderPillarDetail();
    if (currentGlobalSearch) renderGlobalSearch();
    maybeAutoSeed();
    maybeCleanupLegacyPillars();
  });

  subscribeToLessons((l) => {
    lessons = l;
    lessonsLoaded = true;
    renderPillarsGrid();
    if (currentPillarId) renderPillarDetail();
    if (currentGlobalSearch) renderGlobalSearch();
    maybeCleanupLegacyPillars();
  });

  subscribeToStudyNuances((n) => {
    studyNuances = n;
    if (currentPillarId) renderPillarDetail();
    if (!seedAttempted) {
      seedAttempted = true;
      maybeSeedAddendums();
    }
  });

  subscribeToStoaLogs((logs) => {
    stoaLogs = logs;
    if (currentPillarId && isShadowWorkPillar(pillars.find(p => p.id === currentPillarId))) {
      renderPillarDetail();
    }
  });

  setupNav();
  setupPillarModal();
  setupManageModal();
  setupTriggerModal();
  setupStoaViewModal();
  setupLessonModal();
  setupLessonViewModal();
  setupStudyNuanceModal();
  setupExportModal();
  setupSearch();
  setupPillarViewToggle();
  setupKeyboard();

  $('seed-defaults-btn').addEventListener('click', async () => {
    await seedDefaultPillars(DEFAULT_PILLARS);
    showToast('Default pillars added');
  });
}

async function maybeAutoSeed() {
  if (didSeedAttempt) return;
  didSeedAttempt = true;
  if (readOnly) return;

  if (pillars.length === 0) {
    await seedDefaultPillars(DEFAULT_PILLARS);
    showToast('Welcome — seeded default pillars');
    return;
  }

  // Top-up: add any default pillar that's missing by name
  const existingNames = new Set(pillars.map(p => p.name));
  const missing = DEFAULT_PILLARS.filter(d => !existingNames.has(d.name));
  if (missing.length) {
    const nextOrder = Math.max(...pillars.map(p => p.order ?? 0), -1) + 1;
    const withOrder = missing.map((d, i) => ({ ...d, order: nextOrder + i }));
    await seedDefaultPillars(withOrder);
    showToast(`Added ${missing.map(m => m.name).join(', ')}`);
  }
}

let pillarsLoaded = false;
let lessonsLoaded = false;
let cleanupAttempted = false;
async function maybeCleanupLegacyPillars() {
  if (cleanupAttempted) return;
  if (readOnly) return;
  if (!pillarsLoaded || !lessonsLoaded) return;
  if (localStorage.getItem('legacyPillarsCleanedV1') === '1') {
    cleanupAttempted = true;
    return;
  }
  cleanupAttempted = true;

  const toRemove = pillars.filter(p =>
    LEGACY_PILLAR_NAMES.has(p.name) && lessonCount(p.id) === 0
  );

  if (!toRemove.length) {
    localStorage.setItem('legacyPillarsCleanedV1', '1');
    return;
  }

  try {
    for (const p of toRemove) {
      await deletePillar(p.id);
    }
    localStorage.setItem('legacyPillarsCleanedV1', '1');
    showToast(`Cleaned up ${toRemove.length} empty pillar${toRemove.length > 1 ? 's' : ''}`);
  } catch (err) {
    console.error('Legacy pillar cleanup failed:', err);
    cleanupAttempted = false; // allow retry next session
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
  $('add-trigger-btn').addEventListener('click', () => openTriggerModal());
}

function isShadowWorkPillar(p) {
  return p && p.name === 'Shadow Work';
}

function dateKeyFromAny(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value.seconds != null) {
    const d = new Date(value.seconds * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return null;
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
  container.querySelectorAll('[data-action="view-nuance"]').forEach(btn => {
    btn.addEventListener('click', () => viewAddendum(btn.dataset.nuanceId));
  });
  container.querySelectorAll('[data-action="download-nuance"]').forEach(btn => {
    btn.addEventListener('click', () => downloadAddendum(btn.dataset.nuanceId));
  });
}

function renderStudyAddendumsPanel(study, ns) {
  const items = ns.length
    ? ns.map((n, i) => {
        const descHtml = n.description
          ? `<div class="study-nuance-desc">${escapeHtml(n.description)}</div>`
          : '';
        return `
          <div class="study-nuance">
            <div class="study-nuance-row">
              <div class="study-nuance-info">
                <div class="study-nuance-head">
                  <span class="study-nuance-num">№ ${i + 1}</span>
                  <span class="study-nuance-title">${escapeHtml(n.title || '')}</span>
                </div>
                ${descHtml}
              </div>
              <div class="study-nuance-actions">
                <button type="button" class="study-btn study-btn-view" data-action="view-nuance"
                        data-nuance-id="${escapeHtml(n.id)}">View →</button>
                <button type="button" class="study-btn study-btn-download" data-action="download-nuance"
                        data-nuance-id="${escapeHtml(n.id)}">⬇ Download</button>
                <button type="button" class="study-btn study-btn-edit-nuance" data-action="edit-nuance"
                        data-study-id="${escapeHtml(study.id)}" data-nuance-id="${escapeHtml(n.id)}"
                        title="Edit">✎ Edit</button>
              </div>
            </div>
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

// Build a Blob URL for an addendum body. Stash live URLs on a Map so we can
// revoke them when the panel re-renders, to avoid leaking object URLs.
const addendumBlobUrls = new Map();
function blobUrlForAddendum(nuance) {
  const cached = addendumBlobUrls.get(nuance.id);
  if (cached) return cached;
  const raw = nuance.body || nuance.text || '';
  const looksLikeDoc = /^\s*<(?:!doctype|html)/i.test(raw);
  const html = looksLikeDoc ? raw : `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(nuance.title || 'Addendum')}</title><style>body{font-family:Georgia,serif;color:#3e2723;background:#f4ede1;padding:40px;line-height:1.7;max-width:680px;margin:0 auto}</style></head><body>${raw}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  addendumBlobUrls.set(nuance.id, url);
  return url;
}

function viewAddendum(nuanceId) {
  const nuance = studyNuances.find(n => n.id === nuanceId);
  if (!nuance) return;
  const url = blobUrlForAddendum(nuance);
  window.open(url, '_blank', 'noopener');
}

function downloadAddendum(nuanceId) {
  const nuance = studyNuances.find(n => n.id === nuanceId);
  if (!nuance) return;
  const url = blobUrlForAddendum(nuance);
  const slug = (nuance.title || 'addendum')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'addendum';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
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

  // Shadow Work specifics: extra "Log Trigger" button + intensity stats
  const triggerBtn = $('add-trigger-btn');
  const shadowStats = $('shadow-stats');
  if (isShadowWorkPillar(p)) {
    triggerBtn.classList.remove('hidden');
    renderShadowStats(p);
    shadowStats.classList.remove('hidden');
  } else {
    triggerBtn.classList.add('hidden');
    shadowStats.classList.add('hidden');
    shadowStats.innerHTML = '';
  }

  renderPillarStudies(p);

  // Reflect the active view in the toggle
  document.querySelectorAll('#pillar-view-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === pillarView);
  });

  // The sort dropdown only makes sense in catalog view
  const sortEl = document.getElementById('lessons-sort');
  if (sortEl) sortEl.style.visibility = pillarView === 'catalog' ? 'visible' : 'hidden';

  let items = lessons.filter(l => l.pillarId === currentPillarId);
  if (currentLessonSearch) {
    const q = currentLessonSearch.toLowerCase();
    items = items.filter(l => matchesQuery(l, q));
  }

  const calEl = document.getElementById('lessons-calendar');
  if (items.length === 0) {
    calEl.classList.add('hidden');
    lessonsList.classList.add('hidden');
    lessonsList.innerHTML = '';
    lessonsEmpty.classList.remove('hidden');
    return;
  }
  lessonsEmpty.classList.add('hidden');

  if (pillarView === 'calendar') {
    calEl.classList.remove('hidden');
    lessonsList.classList.add('hidden');
    lessonsList.innerHTML = '';
    renderLessonsCalendar(p, items);
  } else {
    calEl.classList.add('hidden');
    calEl.innerHTML = '';
    lessonsList.classList.remove('hidden');
    lessonsList.innerHTML = '';
    const sorted = sortLessons(items, currentSort);
    const groupByMonth = currentSort === 'date-desc' || currentSort === 'date-asc';
    if (groupByMonth) {
      const groups = groupLessonsByMonth(sorted, currentSort === 'date-desc');
      groups.forEach(g => lessonsList.appendChild(buildMonthGroup(g, p)));
    } else {
      sorted.forEach(l => lessonsList.appendChild(buildLessonCard(l, p)));
    }
  }
}

// ===== Calendar view =====
const WEEKDAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function renderLessonsCalendar(pillar, items) {
  const cal = document.getElementById('lessons-calendar');
  const showStoa = isShadowWorkPillar(pillar);

  // Group lessons by date key
  const byDate = new Map();
  const undated = [];
  for (const l of items) {
    const ts = dateValue(l);
    if (!ts) { undated.push(l); continue; }
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(l);
  }

  // Index Stoa moodLogs by date key (only for Shadow Work)
  const stoaByDate = new Map();
  if (showStoa) {
    for (const log of stoaLogs) {
      const key = dateKeyFromAny(log.date);
      if (key) stoaByDate.set(key, log);
    }
  }

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === calendarYear && today.getMonth() === calendarMonth;
  const firstWeekday = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const monthLabel = new Date(calendarYear, calendarMonth, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const cellsHtml = [];
  for (let i = 0; i < firstWeekday; i++) cellsHtml.push('<div class="cal-day cal-day-empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayLessons = byDate.get(key) || [];
    const isToday = isCurrentMonth && d === today.getDate();
    const chips = dayLessons.slice(0, 2).map(l => {
      const isTrigger = l.kind === 'trigger';
      const cls = isTrigger ? 'cal-chip cal-chip-trigger' : 'cal-chip';
      const intensity = isTrigger && l.trigger && l.trigger.intensity != null
        ? `<span class="cal-chip-intensity">${l.trigger.intensity}</span>` : '';
      const titleAttr = isTrigger ? `Trigger · ${l.title}` : l.title;
      return `
        <div class="${cls}" data-lesson-id="${escapeHtml(l.id)}"
             style="border-left-color:${isTrigger ? '#b85a45' : pillar.color}"
             title="${escapeHtml(titleAttr)}">${intensity}${escapeHtml(truncate(l.title, 18))}</div>
      `;
    }).join('');
    const more = dayLessons.length > 2
      ? `<div class="cal-more" data-date="${key}">+${dayLessons.length - 2} more</div>`
      : '';
    const stoaLog = showStoa ? stoaByDate.get(key) : null;
    const stoaPill = stoaLog
      ? `<div class="cal-stoa" data-stoa-id="${escapeHtml(stoaLog.id)}"
              title="Stoa mood: ${escapeHtml((stoaLog.emotions || []).join(', ') || 'logged')}">
           <span class="cal-stoa-dot"></span>${escapeHtml(((stoaLog.emotions || [])[0] || 'mood'))}
         </div>`
      : '';
    cellsHtml.push(`
      <div class="cal-day${isToday ? ' cal-day-today' : ''}${dayLessons.length ? ' cal-day-has' : ''}"
           data-date="${key}">
        <div class="cal-day-num">${d}</div>
        ${stoaPill}
        ${chips}
        ${more}
      </div>
    `);
  }
  while (cellsHtml.length % 7 !== 0) cellsHtml.push('<div class="cal-day cal-day-empty"></div>');

  const undatedHtml = undated.length
    ? `<div class="cal-undated">
        <div class="cal-undated-title">Undated lessons — ${undated.length}</div>
        <div class="cal-undated-list">
          ${undated.map(l => `
            <div class="cal-chip" data-lesson-id="${escapeHtml(l.id)}"
                 style="border-left-color:${pillar.color}"
                 title="${escapeHtml(l.title)}">${escapeHtml(truncate(l.title, 30))}</div>
          `).join('')}
        </div>
      </div>`
    : '';

  cal.innerHTML = `
    <div class="cal-nav">
      <button class="cal-nav-btn" data-cal-nav="prev" title="Previous month">←</button>
      <span class="cal-month-label">${escapeHtml(monthLabel)}</span>
      <button class="cal-nav-btn" data-cal-nav="next" title="Next month">→</button>
    </div>
    <div class="cal-weekdays">${WEEKDAY_LABELS_SHORT.map(w => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid">${cellsHtml.join('')}</div>
    ${undatedHtml}
  `;

  // Wire nav
  cal.querySelectorAll('[data-cal-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.calNav === 'prev') {
        calendarMonth--;
        if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
      } else {
        calendarMonth++;
        if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
      }
      renderPillarDetail();
    });
  });

  // Lesson chips open the lesson view directly
  cal.querySelectorAll('.cal-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const l = lessons.find(x => x.id === chip.dataset.lessonId);
      if (l) openLessonView(l);
    });
  });

  // Stoa pills open the read-only Stoa view
  cal.querySelectorAll('.cal-stoa').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const log = stoaLogs.find(x => x.id === pill.dataset.stoaId);
      if (log) openStoaView(log);
    });
  });

  // "+N more" opens a popover listing all lessons of that day
  cal.querySelectorAll('.cal-more').forEach(more => {
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = more.dataset.date;
      const dayLessons = byDate.get(key) || [];
      showDayPopover(more, key, dayLessons);
    });
  });

  // Clicking elsewhere on a day cell with lessons also opens the popover
  cal.querySelectorAll('.cal-day-has').forEach(cell => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.cal-chip, .cal-more')) return;
      const key = cell.dataset.date;
      const dayLessons = byDate.get(key) || [];
      if (dayLessons.length > 0) showDayPopover(cell, key, dayLessons);
    });
  });
}

function showDayPopover(anchor, dateKey, dayLessons) {
  document.querySelector('.day-popover')?.remove();
  const pop = document.createElement('div');
  pop.className = 'day-popover';
  const [y, m, d] = dateKey.split('-').map(Number);
  const dateLabel = new Date(y, m - 1, d)
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  pop.innerHTML = `
    <div class="day-popover-title">${escapeHtml(dateLabel)} — ${dayLessons.length} lesson${dayLessons.length === 1 ? '' : 's'}</div>
    <ul class="day-popover-list">
      ${dayLessons.map(l => `
        <li data-lesson-id="${escapeHtml(l.id)}">
          <span class="day-popover-num">★ ${l.importance || 0}</span>
          <span>${escapeHtml(l.title)}</span>
        </li>
      `).join('')}
    </ul>
  `;
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 6;
  const left = Math.min(
    rect.left + window.scrollX,
    window.innerWidth - pop.offsetWidth - 12
  );
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const l = lessons.find(x => x.id === li.dataset.lessonId);
      pop.remove();
      if (l) openLessonView(l);
    });
  });
  setTimeout(() => {
    document.addEventListener('click', function handler(ev) {
      if (!pop.contains(ev.target)) {
        pop.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
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

function setupPillarViewToggle() {
  document.querySelectorAll('#pillar-view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      pillarView = btn.dataset.view;
      // When switching to calendar, snap to current month so the user lands on
      // something pertinent rather than wherever they last navigated.
      if (pillarView === 'calendar') {
        const now = new Date();
        calendarYear = now.getFullYear();
        calendarMonth = now.getMonth();
      }
      if (currentPillarId) renderPillarDetail();
    });
  });
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
  if (readOnly) return;
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
  if (readOnly) return;
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

  // Paste handler: strip inline styles/classes/colors so pasted text adopts
  // the editor's own typography instead of carrying foreign colors/backgrounds.
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const data = e.clipboardData || window.clipboardData;
    if (!data) return;
    const html = data.getData('text/html');
    if (html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      tmp.querySelectorAll('*').forEach(el => {
        el.removeAttribute('style');
        el.removeAttribute('class');
        el.removeAttribute('color');
        el.removeAttribute('bgcolor');
        el.removeAttribute('face');
      });
      document.execCommand('insertHTML', false, tmp.innerHTML);
    } else {
      const text = data.getData('text/plain');
      document.execCommand('insertText', false, text);
    }
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
    const addendumIds = [...document.querySelectorAll('#lesson-addendums-picker input:checked')].map(cb => cb.value);

    const data = {
      title,
      description,
      pillarId,
      date: dateRaw ? new Date(dateRaw) : new Date(),
      importance: editingStars,
      tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
      studyIds,
      addendumIds,
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
  if (readOnly) return;
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

  // Studies and addendums picker pre-selection from existing lesson
  editingStudyIds = lesson && lesson.studyIds ? [...lesson.studyIds] : [];
  editingAddendumIds = lesson && lesson.addendumIds ? [...lesson.addendumIds] : [];
  updateTagSuggestions();
  refreshStudiesPicker();
  refreshAddendumsPicker();
  openModal('lesson-modal');
  setTimeout(() => $('lesson-title').focus(), 50);
}

let editingAddendumIds = [];

function refreshAddendumsPicker() {
  const labelEl = document.getElementById('lesson-addendums-label');
  const pickerEl = document.getElementById('lesson-addendums-picker');
  if (!labelEl || !pickerEl) return;

  // Group all study_nuances by study, keep only studies that have nuances and
  // for which we have a STUDIES catalog entry (so we can show the study title).
  const grouped = new Map();
  for (const n of studyNuances) {
    const study = STUDIES.find(s => s.id === n.studyId);
    if (!study) continue;
    if (!grouped.has(study.id)) grouped.set(study.id, { study, items: [] });
    grouped.get(study.id).items.push(n);
  }

  if (grouped.size === 0) {
    labelEl.classList.add('hidden');
    pickerEl.innerHTML = '';
    return;
  }
  labelEl.classList.remove('hidden');

  pickerEl.innerHTML = [...grouped.values()].map(({ study, items }) => `
    <div class="addendums-picker-group">
      <div class="addendums-picker-group-title">${escapeHtml(study.title)}</div>
      ${items.map(n => {
        const checked = editingAddendumIds.includes(n.id);
        return `
          <label class="addendums-picker-row${checked ? ' checked' : ''}">
            <input type="checkbox" value="${escapeHtml(n.id)}"${checked ? ' checked' : ''}>
            <span>${escapeHtml(n.title || '(untitled)')}</span>
          </label>
        `;
      }).join('')}
    </div>
  `).join('');

  pickerEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.addendums-picker-row').classList.toggle('checked', cb.checked);
      editingAddendumIds = [...pickerEl.querySelectorAll('input:checked')].map(c => c.value);
    });
  });
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

// ===== Lesson view modal =====
function setupLessonViewModal() {
  $('lv-edit-btn').addEventListener('click', () => {
    const lesson = lessons.find(l => l.id === $('lesson-view-modal').dataset.lessonId);
    if (!lesson) return;
    closeModal('lesson-view-modal');
    if (lesson.kind === 'trigger') openTriggerModal(lesson);
    else openLessonModal(lesson);
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
  // For triggers, render structured fields above the (usually empty) description.
  if (lesson.kind === 'trigger' && lesson.trigger) {
    $('lv-description').innerHTML = renderTriggerView(lesson.trigger) +
      (lesson.description ? `<div class="lv-essay">${sanitizeRichHtml(lesson.description)}</div>` : '');
  } else {
    $('lv-description').innerHTML = sanitizeRichHtml(lesson.description || '');
  }
  renderLinkedAddendums(lesson);
  renderLinkedStudies(lesson);
  openModal('lesson-view-modal');
}

function renderTriggerView(t) {
  const emoChips = (t.emotions || []).map(k => {
    const info = TRIGGER_EMOTIONS.find(e => e.key === k);
    const label = info ? info.label : k;
    const color = info ? info.color : '#888';
    return `<span class="emotion-chip-static" style="--chip-color:${color}">${escapeHtml(label)}</span>`;
  }).join('');

  const intensity = Number.isFinite(t.intensity) ? t.intensity : null;
  const intensityBar = intensity != null ? `
    <div class="trigger-intensity-bar">
      <div class="trigger-intensity-track">
        <div class="trigger-intensity-fill" style="width:${intensity * 10}%"></div>
      </div>
      <span class="trigger-intensity-num">${intensity}/10</span>
    </div>` : '';

  const time = t.timeOfDay ? `<span class="lv-trigger-time">${escapeHtml(t.timeOfDay)}</span>` : '';
  const row = (label, value) => value && value.trim()
    ? `<div class="lv-trigger-row"><div class="lv-trigger-label">${escapeHtml(label)}</div><div class="lv-trigger-text">${escapeHtml(value).replace(/\n/g, '<br>')}</div></div>`
    : '';

  return `
    <div class="lv-trigger">
      <div class="lv-trigger-head">
        <span class="lv-trigger-badge">Trigger</span>
        ${time}
        ${emoChips ? `<div class="lv-trigger-emotions">${emoChips}</div>` : ''}
      </div>
      ${intensityBar}
      ${row('What happened',  t.source)}
      ${row('Body sensations', t.body)}
      ${row('Inner narrative', t.thoughts)}
      ${row('Response',        t.response)}
      ${row('Reframe / insight', t.reframe)}
    </div>
  `;
}

function renderLinkedAddendums(lesson) {
  const el = document.getElementById('lv-nuances');
  if (!el) return;
  const list = (lesson.addendumIds || [])
    .map(id => studyNuances.find(n => n.id === id))
    .filter(Boolean);
  if (list.length === 0) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="lv-nuances-title">Linked addendums</div>
    ${list.map((n, i) => {
      const study = STUDIES.find(s => s.id === n.studyId);
      const studyTitle = study ? study.title : 'Study';
      return `
        <div class="lv-addendum study-nuance">
          <div class="study-nuance-row">
            <div class="study-nuance-info">
              <div class="study-nuance-head">
                <span class="study-nuance-num">№ ${i + 1}</span>
                <span class="study-nuance-title">${escapeHtml(n.title || '(untitled)')}</span>
              </div>
              <div class="study-nuance-desc">From: ${escapeHtml(studyTitle)}</div>
              ${n.description ? `<div class="study-nuance-desc">${escapeHtml(n.description)}</div>` : ''}
            </div>
            <div class="study-nuance-actions">
              <button type="button" class="study-btn study-btn-view" data-action="lv-view-addendum" data-nuance-id="${escapeHtml(n.id)}">View →</button>
              <button type="button" class="study-btn study-btn-download" data-action="lv-download-addendum" data-nuance-id="${escapeHtml(n.id)}">⬇ Download</button>
            </div>
          </div>
        </div>
      `;
    }).join('')}
  `;
  el.querySelectorAll('[data-action="lv-view-addendum"]').forEach(btn => {
    btn.addEventListener('click', () => viewAddendum(btn.dataset.nuanceId));
  });
  el.querySelectorAll('[data-action="lv-download-addendum"]').forEach(btn => {
    btn.addEventListener('click', () => downloadAddendum(btn.dataset.nuanceId));
  });
}

// ===== Trigger modal (Shadow Work) =====
function setupTriggerModal() {
  // Emotion chips: build once
  const chipsEl = $('trigger-emotions');
  chipsEl.innerHTML = TRIGGER_EMOTIONS.map(e => `
    <button type="button" class="emotion-chip" data-key="${e.key}"
            style="--chip-color:${e.color}">${escapeHtml(e.label)}</button>
  `).join('');
  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.emotion-chip');
    if (!btn) return;
    const key = btn.dataset.key;
    const idx = editingTriggerEmotions.indexOf(key);
    if (idx >= 0) editingTriggerEmotions.splice(idx, 1);
    else editingTriggerEmotions.push(key);
    btn.classList.toggle('active');
  });

  // Live label for the intensity slider
  const slider = $('trigger-intensity');
  const label = $('trigger-intensity-label');
  slider.addEventListener('input', () => { label.textContent = slider.value; });

  $('trigger-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('trigger-id').value;
    const title = $('trigger-title').value.trim();
    if (!title) return;

    const shadowPillar = pillars.find(p => isShadowWorkPillar(p));
    if (!shadowPillar) {
      showToast('Shadow Work pillar not found', 'error');
      return;
    }

    const dateRaw = $('trigger-date').value;
    const data = {
      title,
      description: '',
      pillarId: shadowPillar.id,
      date: dateRaw ? new Date(dateRaw) : new Date(),
      importance: 0,
      tags: $('trigger-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      studyIds: [],
      addendumIds: [],
      kind: 'trigger',
      trigger: {
        source:    $('trigger-source').value.trim(),
        emotions:  [...editingTriggerEmotions],
        intensity: parseInt($('trigger-intensity').value, 10),
        body:      $('trigger-body').value.trim(),
        thoughts:  $('trigger-thoughts').value.trim(),
        response:  $('trigger-response').value.trim(),
        reframe:   $('trigger-reframe').value.trim(),
        timeOfDay: $('trigger-time').value,
      },
    };

    if (id) {
      await updateLesson(id, data);
      showToast('Trigger updated');
    } else {
      await createLesson(data);
      showToast('Trigger logged');
    }
    closeModal('trigger-modal');
  });

  $('trigger-delete-btn').addEventListener('click', async () => {
    const id = $('trigger-id').value;
    if (!id) return;
    if (!confirm('Delete this trigger entry?')) return;
    await deleteLesson(id);
    closeModal('trigger-modal');
    closeModal('lesson-view-modal');
    showToast('Trigger deleted');
  });
}

function openTriggerModal(lesson) {
  if (readOnly) return;
  $('trigger-modal-title').textContent = lesson ? 'Edit Trigger' : 'Log Trigger';
  $('trigger-id').value = lesson ? lesson.id : '';
  $('trigger-title').value = lesson ? lesson.title : '';

  // Date defaults to today, or to the lesson's date
  const dateInput = $('trigger-date');
  if (lesson && lesson.date) {
    const d = lesson.date.seconds ? new Date(lesson.date.seconds * 1000)
      : (typeof lesson.date === 'string' ? new Date(lesson.date) : lesson.date);
    dateInput.value = d.toISOString().slice(0, 10);
  } else {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  const t = (lesson && lesson.trigger) || {};
  $('trigger-time').value     = t.timeOfDay || guessTimeOfDay();
  $('trigger-source').value   = t.source   || '';
  $('trigger-body').value     = t.body     || '';
  $('trigger-thoughts').value = t.thoughts || '';
  $('trigger-response').value = t.response || '';
  $('trigger-reframe').value  = t.reframe  || '';
  $('trigger-intensity').value = t.intensity != null ? t.intensity : 5;
  $('trigger-intensity-label').textContent = String(t.intensity != null ? t.intensity : 5);
  $('trigger-tags').value = lesson && lesson.tags ? lesson.tags.join(', ') : 'trigger';

  // Emotion chips state
  editingTriggerEmotions = Array.isArray(t.emotions) ? [...t.emotions] : [];
  document.querySelectorAll('#trigger-emotions .emotion-chip').forEach(btn => {
    btn.classList.toggle('active', editingTriggerEmotions.includes(btn.dataset.key));
  });

  $('trigger-delete-btn').classList.toggle('hidden', !lesson);

  openModal('trigger-modal');
  setTimeout(() => $('trigger-title').focus(), 50);
}

function guessTimeOfDay() {
  const h = new Date().getHours();
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 18) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

// ===== Stoa view modal (read-only embed) =====
function setupStoaViewModal() {
  // No interactivity beyond close button + link to Stoa — already in HTML.
}

function openStoaView(log) {
  $('sv-date').textContent = formatStoaDate(log.date);
  const emotions = Array.isArray(log.emotions) ? log.emotions : [];
  $('sv-emotions').textContent = emotions.length ? emotions.join(' · ') : '(no emotions logged)';

  const sleepRow = $('sv-sleep');
  if (log.sleep != null && log.sleep !== '') {
    sleepRow.innerHTML = `<strong>Sleep:</strong> ${escapeHtml(String(log.sleep))}`;
    sleepRow.classList.remove('hidden');
  } else {
    sleepRow.classList.add('hidden');
  }

  const gratRow = $('sv-gratitudes');
  const grats = Array.isArray(log.gratitudes) ? log.gratitudes.filter(Boolean) : [];
  if (grats.length) {
    gratRow.innerHTML = `<strong>Gratitudes:</strong><ul>${grats.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul>`;
    gratRow.classList.remove('hidden');
  } else {
    gratRow.classList.add('hidden');
  }

  const notesRow = $('sv-notes');
  if (log.notes && log.notes.trim()) {
    notesRow.innerHTML = `<strong>Notes:</strong><div class="sv-note-body">${escapeHtml(log.notes).replace(/\n/g, '<br>')}</div>`;
    notesRow.classList.remove('hidden');
  } else {
    notesRow.classList.add('hidden');
  }

  openModal('stoa-view-modal');
}

function formatStoaDate(raw) {
  const key = dateKeyFromAny(raw);
  if (!key) return '';
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ===== Shadow Work stats =====
function renderShadowStats(pillar) {
  const el = $('shadow-stats');
  const triggers = lessons.filter(l => l.pillarId === pillar.id && l.kind === 'trigger' && l.trigger);
  if (triggers.length === 0) {
    el.innerHTML = `
      <div class="shadow-stats-empty">
        No triggers logged yet. Click <strong>+ Log Trigger</strong> when something stirs you up.
        Intensity will track here as you build the dataset.
      </div>`;
    return;
  }

  // Sort by date desc, take last 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const recent = triggers.filter(l => {
    const ts = dateValue(l);
    return ts && new Date(ts) >= cutoff;
  });

  const allIntensities = triggers.map(l => l.trigger.intensity).filter(n => Number.isFinite(n));
  const recentIntensities = recent.map(l => l.trigger.intensity).filter(n => Number.isFinite(n));
  const avgAll = allIntensities.length
    ? (allIntensities.reduce((a, b) => a + b, 0) / allIntensities.length).toFixed(1) : '—';
  const avgRecent = recentIntensities.length
    ? (recentIntensities.reduce((a, b) => a + b, 0) / recentIntensities.length).toFixed(1) : '—';

  // Top emotions
  const emoCount = new Map();
  triggers.forEach(l => (l.trigger.emotions || []).forEach(e => {
    emoCount.set(e, (emoCount.get(e) || 0) + 1);
  }));
  const topEmotions = [...emoCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  el.innerHTML = `
    <div class="shadow-stat">
      <div class="shadow-stat-num">${triggers.length}</div>
      <div class="shadow-stat-label">total triggers</div>
    </div>
    <div class="shadow-stat">
      <div class="shadow-stat-num">${avgRecent}</div>
      <div class="shadow-stat-label">avg intensity / 30d</div>
    </div>
    <div class="shadow-stat">
      <div class="shadow-stat-num">${avgAll}</div>
      <div class="shadow-stat-label">avg intensity / all</div>
    </div>
    <div class="shadow-stat shadow-stat-emos">
      <div class="shadow-stat-label">most frequent emotions</div>
      <div class="shadow-stat-emo-list">
        ${topEmotions.length
          ? topEmotions.map(([k, n]) => {
              const info = TRIGGER_EMOTIONS.find(e => e.key === k);
              const label = info ? info.label : k;
              const color = info ? info.color : '#888';
              return `<span class="shadow-stat-emo" style="--chip-color:${color}">${escapeHtml(label)} <span class="shadow-stat-emo-n">${n}</span></span>`;
            }).join('')
          : '<span style="color:var(--ink-muted)">—</span>'
        }
      </div>
    </div>
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
  if (readOnly) return;
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
  if (readOnly) return;
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
