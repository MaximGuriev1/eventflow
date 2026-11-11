/* ============================================================
   EventFlow — контроллер интерфейса (этапы 1–4)

   Этап 1: загрузка из IndexedDB, каркас, KPI, журнал, состояния.
   Этап 2: полный CRUD (одна форма для просмотра/создания/правки),
   поиск, фильтры, сортировка, архивация с кнопкой «Отменить».
   Этап 3: импорт CSV (файл → предпросмотр → подтверждение).
   Этап 4: экспорт резервной копии JSON и восстановление
   (проверка файла → предпросмотр → отдельное подтверждение).

   Порядок операций: IndexedDB (одна транзакция) → чтение свежих
   данных → KPI → таблица → журнал. Данные участников и журнала
   держатся в памяти только в виде кэша последнего чтения;
   персистентность — только IndexedDB.
   ============================================================ */
(function () {
  'use strict';

  const DB = window.EventFlowDB;

  const els = {
    title: document.getElementById('event-title'),
    meta: document.getElementById('event-meta'),
    kpi: {
      total: document.getElementById('kpi-total'),
      confirmed: document.getElementById('kpi-confirmed'),
      checkedIn: document.getElementById('kpi-checked-in'),
      waitlist: document.getElementById('kpi-waitlist'),
    },
    filterStatus: document.getElementById('filter-status'),
    filterTicket: document.getElementById('filter-ticket'),
    sortSelect: document.getElementById('sort'),
    searchInput: document.getElementById('search-input'),
    participantsBody: document.getElementById('participants-body'),
    activityList: document.getElementById('activity-list'),
    toastRegion: document.getElementById('toast-region'),
    fatal: document.getElementById('fatal'),
    fatalText: document.getElementById('fatal-text'),
    retry: document.getElementById('retry'),
    // Импорт CSV
    importDialog: document.getElementById('import-dialog'),
    importForm: document.getElementById('import-form'),
    importClose: document.getElementById('import-close'),
    importChoose: document.getElementById('import-choose'),
    importFileTrigger: document.getElementById('import-file-trigger'),
    importFile: document.getElementById('import-file'),
    importFileName: document.getElementById('import-file-name'),
    importPreview: document.getElementById('import-preview'),
    importFileNamePreview: document.getElementById('import-file-name-preview'),
    importStats: document.getElementById('import-stats'),
    importLegend: document.getElementById('import-legend'),
    importIssuesTitle: document.getElementById('import-issues-title'),
    importIssuesOk: document.getElementById('import-issues-ok'),
    importIssuesList: document.getElementById('import-issues-list'),
    importFileError: document.getElementById('import-file-error'),
    importCancel: document.getElementById('import-cancel'),
    importSubmit: document.getElementById('import-submit'),
    // Восстановление копии
    restoreDialog: document.getElementById('restore-dialog'),
    restoreForm: document.getElementById('restore-form'),
    restoreClose: document.getElementById('restore-close'),
    restoreChoose: document.getElementById('restore-choose'),
    restoreFileTrigger: document.getElementById('restore-file-trigger'),
    restoreFile: document.getElementById('restore-file'),
    restoreFileName: document.getElementById('restore-file-name'),
    restorePreview: document.getElementById('restore-preview'),
    restoreFileNamePreview: document.getElementById('restore-file-name-preview'),
    restoreStats: document.getElementById('restore-stats'),
    restoreLegend: document.getElementById('restore-legend'),
    restoreWarningCurrent: document.getElementById('restore-current'),
    restoreSaveCurrent: document.getElementById('restore-save-current'),
    restoreFileError: document.getElementById('restore-file-error'),
    restoreCancel: document.getElementById('restore-cancel'),
    restoreSubmit: document.getElementById('restore-submit'),
    // Форма участника
    dialog: document.getElementById('participant-dialog'),
    form: document.getElementById('participant-form'),
    formTitle: document.getElementById('form-title'),
    formFields: document.getElementById('form-fields'),
    fieldName: document.getElementById('field-name'),
    fieldEmail: document.getElementById('field-email'),
    fieldCompany: document.getElementById('field-company'),
    fieldTicket: document.getElementById('field-ticket'),
    fieldStatus: document.getElementById('field-status'),
    fieldChecked: document.getElementById('field-checked'),
    checkedNote: document.getElementById('checked-note'),
    errorName: document.getElementById('error-name'),
    errorEmail: document.getElementById('error-email'),
    errorChecked: document.getElementById('error-checked'),
    formEdit: document.getElementById('form-edit'),
    formCancel: document.getElementById('form-cancel'),
    formSubmit: document.getElementById('form-submit'),
    formClose: document.getElementById('form-close'),
  };

  /* Инлайновые SVG-иконки для блоков, которые собираются из JS */
  const ICONS = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    users:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    plus:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    import:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>',
    empty:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><path d="M19 8v6"/><path d="M16 11h6"/></svg>',
    filterOff:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
    eye:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    pencil:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    archive:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>',
  };

  function createIcon(name, className) {
    const template = document.createElement('template');
    template.innerHTML = ICONS[name].trim();
    const svg = template.content.firstElementChild;
    if (className) svg.setAttribute('class', className);
    return svg;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setBodyState(state) {
    document.body.dataset.state = state;
  }

  /* ---------- Утилиты ---------- */

  /* ISO-строки из CSV хранятся в UTC (оканчиваются на Z) —
     показываем то же время, а не локальную зону машины */
  function formatDateTime(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    try {
      return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      });
    } catch (err) {
      return value;
    }
  }

  function labelText(dictionary, value) {
    const item = (dictionary || []).find((entry) => entry.value === value);
    return item ? item.label : String(value == null ? '' : value);
  }

  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* Мелкие настройки интерфейса (выбранная сортировка) —
     только localStorage, как разрешают правила проекта */
  const SORT_PREF_KEY = 'eventflow.ui.sort';
  const ALLOWED_SORTS = ['registeredAt-desc', 'registeredAt-asc', 'name-asc', 'name-desc'];

  function loadSortPref() {
    try {
      const stored = window.localStorage.getItem(SORT_PREF_KEY);
      return ALLOWED_SORTS.includes(stored) ? stored : 'registeredAt-desc';
    } catch (err) {
      return 'registeredAt-desc';
    }
  }

  function saveSortPref(value) {
    try {
      window.localStorage.setItem(SORT_PREF_KEY, value);
    } catch (err) {
      /* приватный режим — настройки просто не сохранятся */
    }
  }

  /* ---------- Состояние интерфейса ---------- */

  const state = {
    event: null,
    participants: [], // весь неархивный + архивный кэш последнего чтения
    activity: [],
    query: '',
    statusFilter: 'all',
    ticketFilter: 'all',
    sort: loadSortPref(),
    formMode: null, // 'view' | 'create' | 'edit'
    editingId: null,
    importPending: null, // { fileName, analysis } — до подтверждения базу не трогаем
    restorePending: null, // { fileName, backup } — проверенная копия до подтверждения замены
  };

  /* ---------- Тосты ---------- */

  const TOAST_LIFETIME_MS = 4000;
  const TOAST_UNDO_MS = 7000;

  function showToast(message, options) {
    const { variant = 'success', action = null, lifetime = TOAST_LIFETIME_MS } = options || {};
    const toast = el('div', `toast${variant === 'error' ? ' toast--error' : ''}`);
    if (action) toast.classList.add('toast--with-action');
    toast.appendChild(el('span', null, message));

    let timer = null;
    const dismiss = () => {
      if (timer) window.clearTimeout(timer);
      toast.remove();
    };

    if (action) {
      const button = el('button', 'toast-action', action.label);
      button.type = 'button';
      button.addEventListener('click', () => {
        dismiss();
        action.run();
      });
      toast.appendChild(button);
    }

    timer = window.setTimeout(dismiss, lifetime);

    /* не держим больше трёх тостов */
    while (els.toastRegion.children.length >= 3) {
      els.toastRegion.firstElementChild.remove();
    }
    els.toastRegion.appendChild(toast);
  }

  /* ---------- KPI ---------- */

  function computeKpi(participants) {
    const active = participants.filter((p) => !p.archivedAt);
    const counters = { total: active.length, confirmed: 0, checkedIn: 0, waitlist: 0 };
    for (const participant of active) {
      if (participant.status === 'confirmed') counters.confirmed += 1;
      if (participant.checkedIn === true) counters.checkedIn += 1;
      if (participant.status === 'waitlist') counters.waitlist += 1;
    }
    return counters;
  }

  /* ---------- Обновление после операций: IndexedDB → KPI → таблица → журнал ---------- */

  async function refresh() {
    const [participantsData, activityData] = await Promise.all([
      DB.getAllParticipants(),
      DB.getAllActivity(),
    ]);
    state.participants = participantsData;
    state.activity = activityData;
    renderKpi(state.participants);
    renderList();
    renderActivity(state.activity);
  }

  /* ---------- Рендер шапки и фильтров ---------- */

  function renderEvent(event) {
    const title = els.title;
    title.replaceChildren(document.createTextNode(event.name || 'Событие'));

    const meta = els.meta;
    meta.replaceChildren();

    if (event.venue) {
      const venueItem = el('span', 'event-meta-item');
      venueItem.appendChild(createIcon('pin'));
      venueItem.appendChild(document.createTextNode(event.venue));
      meta.appendChild(venueItem);
    }
    if (event.capacity != null) {
      const capacityItem = el('span', 'event-meta-item');
      capacityItem.appendChild(createIcon('users'));
      capacityItem.appendChild(document.createTextNode(`${event.capacity} мест`));
      meta.appendChild(capacityItem);
    }
  }

  function fillSelect(select, dictionary, allLabel) {
    const seen = new Set();
    select.replaceChildren();
    if (allLabel) select.appendChild(new Option(allLabel, 'all'));
    (dictionary || []).forEach((item) => {
      if (!seen.has(item.value)) {
        seen.add(item.value);
        select.appendChild(new Option(item.label, item.value));
      }
    });
    if (allLabel) select.value = 'all';
  }

  function renderFilterOptions(event) {
    fillSelect(els.filterStatus, event.statuses, 'Все статусы');
    els.filterStatus.value = state.statusFilter;
    fillSelect(els.filterTicket, event.tickets, 'Все билеты');
    els.filterTicket.value = state.ticketFilter;
    els.sortSelect.value = state.sort;
  }

  function renderKpi(participants) {
    const counters = computeKpi(participants);
    els.kpi.total.replaceChildren(document.createTextNode(String(counters.total)));
    els.kpi.confirmed.replaceChildren(document.createTextNode(String(counters.confirmed)));
    els.kpi.checkedIn.replaceChildren(document.createTextNode(String(counters.checkedIn)));
    els.kpi.waitlist.replaceChildren(document.createTextNode(String(counters.waitlist)));
  }

  /* ---------- Список: фильтрация, поиск, сортировка ---------- */

  function applyFilters(participants) {
    const query = state.query.trim().toLowerCase();
    return participants.filter((p) => {
      if (p.archivedAt) return false;
      if (state.statusFilter !== 'all' && p.status !== state.statusFilter) return false;
      if (state.ticketFilter !== 'all' && p.ticket !== state.ticketFilter) return false;
      if (!query) return true;
      const haystack = [p.name, p.email, p.company]
        .map((field) => String(field == null ? '' : field).toLowerCase());
      return haystack.some((field) => field.includes(query));
    });
  }

  function compareParticipants(a, b, sort) {
    let result = 0;
    if (sort === 'name-asc') {
      result = String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    } else if (sort === 'name-desc') {
      result = String(b.name || '').localeCompare(String(a.name || ''), 'ru');
    } else if (sort === 'registeredAt-asc') {
      result = String(a.registeredAt || '').localeCompare(String(b.registeredAt || ''));
    } else {
      result = String(b.registeredAt || '').localeCompare(String(a.registeredAt || ''));
    }
    if (result === 0) {
      /* стабильный порядок при равных ключах */
      result = String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    }
    return result;
  }

  function makeActionButton(action, modifier, label, iconName) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${modifier}`;
    button.dataset.action = action;
    button.appendChild(createIcon(iconName, 'btn-icon'));
    button.appendChild(document.createTextNode(label));
    return button;
  }

  function buildEmptyStateRow() {
    const row = el('tr', 'empty-row');
    const cell = el('td');
    cell.colSpan = 8;

    const box = el('div', 'empty-state');
    const iconHolder = el('span', 'empty-icon');
    iconHolder.appendChild(createIcon('empty'));
    box.appendChild(iconHolder);

    box.appendChild(el('h3', null, 'Пока нет участников'));
    box.appendChild(
      el(
        'p',
        null,
        'Добавьте первого участника вручную или импортируйте CSV-файл с уже зарегистрированными. Данные хранятся локально в браузере.'
      )
    );

    const actions = el('div', 'empty-actions');
    actions.appendChild(makeActionButton('add-participant', 'btn--primary', 'Добавить участника', 'plus'));
    actions.appendChild(makeActionButton('import-csv', 'btn--outline', 'Импорт CSV', 'import'));
    box.appendChild(actions);

    cell.appendChild(box);
    row.appendChild(cell);
    return row;
  }

  function buildEmptyFilterRow() {
    const row = el('tr', 'empty-row');
    const cell = el('td');
    cell.colSpan = 8;

    const box = el('div', 'empty-state empty-state--filter');
    const iconHolder = el('span', 'empty-icon');
    iconHolder.appendChild(createIcon('filterOff'));
    box.appendChild(iconHolder);

    box.appendChild(el('h3', null, 'Ничего не найдено'));
    box.appendChild(
      el(
        'p',
        null,
        'По этим условиям участников нет. Измените поиск и фильтры или сбросьте их.'
      )
    );
    const actions = el('div', 'empty-actions');
    actions.appendChild(makeActionButton('reset-filters', 'btn--outline', 'Сбросить фильтры', 'check'));
    box.appendChild(actions);

    cell.appendChild(box);
    row.appendChild(cell);
    return row;
  }

  function rowIconButton({ action = null, label, iconName, disabled = false, title = null }) {
    const button = el('button', 'icon-btn');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = title || label;
    button.appendChild(createIcon(iconName));
    if (action) button.dataset.action = action;
    if (disabled) button.disabled = true;
    return button;
  }

  function buildParticipantRow(participant) {
    const event = state.event;
    const row = el('tr', 'participant-row');
    row.dataset.id = participant.id;

    const whoCell = el('td', 'participant-cell');
    whoCell.appendChild(el('div', 'participant-name', participant.name || ''));
    row.appendChild(whoCell);

    row.appendChild(el('td', 'cell-email cell-muted', participant.email || ''));
    row.appendChild(el('td', 'cell-company cell-muted', participant.company || '—'));
    row.appendChild(el('td', null, labelText(event.tickets, participant.ticket)));

    const statusCell = el('td');
    statusCell.appendChild(
      el('span', `badge badge--${participant.status || 'new'}`, labelText(event.statuses, participant.status))
    );
    row.appendChild(statusCell);

    row.appendChild(el('td', 'cell-muted', formatDateTime(participant.registeredAt)));
    row.appendChild(el('td', participant.checkedIn ? 'cell-checked' : 'cell-muted', participant.checkedIn ? 'Да' : '—'));

    const actionsCell = el('td');
    const actions = el('div', 'row-actions');
    const name = participant.name || 'участник';

    actions.appendChild(rowIconButton({ action: 'open-participant', label: `Открыть участника: ${name}`, iconName: 'eye' }));
    actions.appendChild(rowIconButton({ action: 'edit-participant', label: `Изменить участника: ${name}`, iconName: 'pencil' }));

    const canCheckIn = participant.status === 'confirmed' && participant.checkedIn !== true;
    const checkInButton = rowIconButton({
      action: canCheckIn ? 'check-in' : null,
      label: canCheckIn
        ? `Отметить приход: ${name}`
        : `Приход отмечается только у участников со статусом «Подтверждён»: ${name}`,
      iconName: 'check',
      disabled: !canCheckIn,
    });
    actions.appendChild(checkInButton);

    actions.appendChild(rowIconButton({ action: 'archive-participant', label: `Архивировать участника: ${name}`, iconName: 'archive' }));
    actionsCell.appendChild(actions);
    row.appendChild(actionsCell);
    return row;
  }

  function renderList() {
    const tbody = els.participantsBody;
    tbody.replaceChildren();

    if (!state.participants.length) {
      tbody.appendChild(buildEmptyStateRow());
      return;
    }

    const visible = applyFilters(state.participants);
    if (!visible.length) {
      tbody.appendChild(buildEmptyFilterRow());
      return;
    }
    visible.sort((a, b) => compareParticipants(a, b, state.sort));
    for (const participant of visible) {
      tbody.appendChild(buildParticipantRow(participant));
    }
  }
  /* ---------- Журнал ---------- */

  /* Маркер в журнале различает тип действия — как в референсе */
  const ACTIVITY_DOT_VARIANTS = {
    'participants-imported': 'success',
    'participant-checked-in': 'success',
    'participant-created': 'primary',
    'participant-updated': 'primary',
    'backup-exported': 'primary',
    'backup-restored': 'warn',
    'participant-archived': 'muted',
    'participant-restored': 'muted',
  };

  function renderActivity(entries) {
    const list = els.activityList;
    list.replaceChildren();

    if (!entries || !entries.length) {
      list.appendChild(
        el(
          'li',
          'activity-empty',
          'Действий пока нет. Здесь появятся добавления, изменения, импорты и резервные копии.'
        )
      );
      return;
    }

    const recent = entries
      .slice()
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, 10);

    for (const entry of recent) {
      const variant = ACTIVITY_DOT_VARIANTS[entry.action] || 'primary';
      const item = el('li', 'activity-item');
      item.appendChild(el('span', variant === 'primary' ? 'activity-dot' : `activity-dot activity-dot--${variant}`));
      const text = el('div', 'activity-text');
      text.appendChild(el('span', 'activity-action', entry.title || entry.action || 'Действие'));
      text.appendChild(el('span', 'activity-time', formatDateTime(entry.ts)));
      item.appendChild(text);
      list.appendChild(item);
    }
  }

  /* ---------- Форма участника ---------- */

  const STATUS_VALUE = 'confirmed';

  function defaultFormValues() {
    return {
      name: '',
      email: '',
      company: '',
      ticket: state.event.tickets[0] ? state.event.tickets[0].value : 'standard',
      status: state.event.statuses[0] ? state.event.statuses[0].value : 'new',
      checkedIn: false,
    };
  }

  function readFormValues() {
    return {
      name: els.fieldName.value.trim(),
      email: els.fieldEmail.value.trim(),
      company: els.fieldCompany.value.trim(),
      ticket: els.fieldTicket.value,
      status: els.fieldStatus.value,
      checkedIn: els.fieldChecked.checked,
    };
  }

  function fillFormFromParticipant(participant) {
    els.fieldName.value = participant.name || '';
    els.fieldEmail.value = participant.email || '';
    els.fieldCompany.value = participant.company || '';
    els.fieldTicket.value = participant.ticket;
    els.fieldStatus.value = participant.status;
    els.fieldChecked.checked = participant.checkedIn === true;
  }

  function setError(field, input, message) {
    if (message) {
      field.textContent = message;
      field.hidden = false;
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
    } else {
      field.hidden = true;
      field.textContent = '';
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
    }
  }

  function emailLooksValid(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /* БР-1: отметка о прибытии возможна только у подтверждённых.
     Ошибочная пара в форме предотвращается заранее: чекбокс недоступен,
     пока статус другой; при смене статуса отметка сбрасывается. */
  function syncCheckedField(messages) {
    const status = els.fieldStatus.value;
    const isConfirmed = status === STATUS_VALUE;
    els.fieldChecked.disabled = !isConfirmed || state.formMode === 'view';
    if (!isConfirmed && els.fieldChecked.checked) {
      els.fieldChecked.checked = false;
      if (messages) {
        els.checkedNote.textContent = 'Отметка о прибытии сброшена: действует только для статуса «Подтверждён».';
        els.checkedNote.hidden = false;
      }
    } else if (els.checkedNote.textContent && messages) {
      els.checkedNote.hidden = true;
      els.checkedNote.textContent = '';
    }
  }

  function validateForm() {
    const values = readFormValues();
    const errors = { name: null, email: null, checked: null };

    if (!values.name) {
      errors.name = 'Укажите имя участника, например «Анна Волкова».';
    }
    if (!values.email) {
      errors.email = 'Укажите email — по нему мы находим участника.';
    } else if (!emailLooksValid(values.email)) {
      errors.email = 'Формат email неверный: нужен вид «имя@домен», например anna@example.ru.';
    }
    if (values.checkedIn && values.status !== STATUS_VALUE) {
      errors.checked = 'Отметку о прибытии можно ставить только участникам со статусом «Подтверждён».';
    }
    return errors;
  }

  function renderValidation() {
    const errors = validateForm();
    setError(els.errorName, els.fieldName, errors.name);
    setError(els.errorEmail, els.fieldEmail, errors.email);
    setError(els.errorChecked, els.fieldChecked, errors.checked);
    const isValid = !errors.name && !errors.email && !errors.checked;
    els.formSubmit.disabled = !isValid;
    return isValid;
  }

  function focusFirstError() {
    if (!els.errorName.hidden) els.fieldName.focus();
    else if (!els.errorEmail.hidden) els.fieldEmail.focus();
    else if (!els.errorChecked.hidden) els.fieldChecked.focus();
    else els.fieldName.focus();
  }

  function buildRecord(values, previous) {
    const isoNow = new Date().toISOString();
    return {
      id: previous ? previous.id : generateId(),
      name: values.name,
      email: values.email,
      emailLower: values.email.toLowerCase(),
      company: values.company,
      ticket: values.ticket,
      status: values.status,
      checkedIn: values.checkedIn === true,
      registeredAt: previous && previous.registeredAt ? previous.registeredAt : isoNow,
      archivedAt: previous && previous.archivedAt ? previous.archivedAt : null,
    };
  }

  function applyMode(mode, participant) {
    state.formMode = mode;
    state.editingId = participant ? participant.id : null;

    els.formFields.disabled = mode === 'view';
    els.formSubmit.hidden = mode === 'view';
    els.formEdit.hidden = mode !== 'view';
    els.formCancel.textContent = mode === 'view' ? 'Закрыть' : 'Отмена';

    if (mode === 'create') {
      els.formTitle.textContent = 'Добавление участника';
      const values = defaultFormValues();
      els.fieldName.value = values.name;
      els.fieldEmail.value = values.email;
      els.fieldCompany.value = values.company;
      els.fieldTicket.value = values.ticket;
      els.fieldStatus.value = values.status;
      els.fieldChecked.checked = values.checkedIn;
    } else {
      els.formTitle.textContent = mode === 'edit' ? 'Изменение участника' : `Участник: ${participant.name}`;
      fillFormFromParticipant(participant);
    }

    els.errorName.hidden = true;
    els.errorEmail.hidden = true;
    els.errorChecked.hidden = true;
    els.checkedNote.hidden = true;
    els.checkedNote.textContent = '';
    [els.fieldName, els.fieldEmail, els.fieldChecked].forEach((input) => {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
    });

    els.fieldTicket.replaceChildren();
    fillSelect(els.fieldTicket, state.event.tickets, null);
    fillSelect(els.fieldStatus, state.event.statuses, null);
    if (mode !== 'create') {
      els.fieldTicket.value = participant.ticket;
      els.fieldStatus.value = participant.status;
    }

    syncCheckedField(false);
    els.formSubmit.disabled = mode === 'create'; // форма пуста — заведомо невалидна

    if (mode !== 'view') renderValidation();
  }

  function openForm(mode, participant) {
    applyMode(mode, participant);
    els.dialog.showModal();

    if (mode === 'view') {
      els.formEdit.focus();
    } else if (!renderValidation()) {
      focusFirstError();
    } else {
      els.fieldName.focus();
    }
  }

  function closeForm() {
    if (els.dialog.open) els.dialog.close();
    /* Событие close не во всех окружениях доставляется надёжно —
       состояние формы сбрасываем явно, слушатель close остаётся дублёром. */
    state.formMode = null;
    state.editingId = null;
  }

  /* ---------- Операции CRUD ---------- */

  async function submitForm() {
    const mode = state.formMode;
    if (!mode || mode === 'view') return;
    if (!renderValidation()) {
      focusFirstError();
      return;
    }

    const values = readFormValues();
    const previous =
      mode === 'edit'
        ? state.participants.find((p) => p.id === state.editingId)
        : null;

    const record = buildRecord(values, previous);
    const title = mode === 'edit' ? 'Изменён участник' : 'Добавлен участник';
    const entry = {
      action: mode === 'edit' ? 'participant-updated' : 'participant-created',
      title: `${title}: ${record.name}`,
      details: { participantId: record.id, email: record.email },
    };

    els.formSubmit.disabled = true;
    try {
      if (mode === 'edit') {
        await DB.updateParticipant(record, entry);
      } else {
        await DB.addParticipant(record, entry);
      }
      closeForm();
      await refresh();
      showToast(mode === 'edit' ? `Изменения сохранены: ${record.name}` : `Участник добавлен: ${record.name}`);
    } catch (error) {
      if (error.field === 'email') {
        setError(els.errorEmail, els.fieldEmail, `${error.message}.`);
        els.fieldEmail.focus();
        els.formSubmit.disabled = false;
      } else {
        console.error('EventFlow: операция не выполнена', error);
        showToast('Не удалось сохранить участника. Данные не изменены.', { variant: 'error' });
        els.formSubmit.disabled = false;
      }
    }
  }

  async function checkIn(participant) {
    /* Внутренний guard: БР-1 — приход допустим только подтверждённому
       и ещё не отмеченному участнику. UI такой вызов не даёт
       (кнопка disabled и правило в форме), guard страхует остальные пути. */
    if (participant.checkedIn) return;
    if (participant.status !== 'confirmed') {
      showToast('Приход отмечается только у участников со статусом «Подтверждён».', { variant: 'error' });
      return;
    }
    const entry = {
      action: 'participant-checked-in',
      title: `Отмечен приход: ${participant.name}`,
      details: { participantId: participant.id },
    };
    try {
      await DB.patchParticipant(participant.id, { checkedIn: true }, entry);
      await refresh();
      showToast(`Приход отмечен: ${participant.name}`);
    } catch (error) {
      console.error('EventFlow: чек-ин не выполнен', error);
      showToast('Не удалось отметить приход. Данные не изменены.', { variant: 'error' });
    }
  }

  async function archiveParticipant(participant) {
    const entry = {
      action: 'participant-archived',
      title: `Участник архивирован: ${participant.name}`,
      details: { participantId: participant.id },
    };
    try {
      await DB.patchParticipant(participant.id, { archivedAt: new Date().toISOString() }, entry);
      await refresh();
      showToast(`Участник архивирован: ${participant.name}`, {
        lifetime: TOAST_UNDO_MS,
        action: {
          label: 'Отменить',
          run: () => undoArchive(participant),
        },
      });
    } catch (error) {
      console.error('EventFlow: архивация не выполнена', error);
      showToast('Не удалось архивировать участника. Данные не изменены.', { variant: 'error' });
    }
  }

  async function undoArchive(participant) {
    const entry = {
      action: 'participant-restored',
      title: `Архивация отменена: ${participant.name}`,
      details: { participantId: participant.id },
    };
    try {
      await DB.patchParticipant(participant.id, { archivedAt: null }, entry);
      await refresh();
      showToast(`Архивация отменена: ${participant.name}`);
    } catch (error) {
      console.error('EventFlow: не удалось отменить архивацию', error);
      showToast('Не удалось отменить архивацию. Участник остался в архиве.', { variant: 'error' });
    }
  }

  async function openParticipant(participant) {
    openForm('view', participant);
  }

  /* ---------- Импорт CSV: файл → предпросмотр → подтверждение → база ---------- */

  function openImportDialog() {
    resetImport();
    els.importDialog.showModal();
    els.importFileTrigger.focus();
  }

  function resetImport() {
    state.importPending = null;
    els.importChoose.hidden = false;
    els.importPreview.hidden = true;
    els.importFileError.hidden = true;
    els.importFileName.hidden = true;
    els.importFileName.textContent = '';
    els.importFileError.textContent = '';
    els.importStats.replaceChildren();
    els.importLegend.hidden = true;
    els.importLegend.textContent = '';
    els.importIssuesList.replaceChildren();
    els.importIssuesTitle.textContent = 'Ошибки';
    els.importSubmit.disabled = true;
    els.importSubmit.textContent = 'Импортировать корректные строки';
    if (els.importFile.value) els.importFile.value = '';
  }

  /* Явное закрытие импорта: сами сбрасываем состояние, не доверяя
     событию close (в части окружений оно не доставляется). */
  function closeImportDialog() {
    if (els.importDialog.open) els.importDialog.close();
    resetImport();
  }

  function pluralRu(count, one, few, many) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function buildImportLegend(analysis) {
    const total = analysis.totalRows;
    const valid = analysis.valid.length;
    const errors = analysis.errors.length;
    const duplicates = analysis.duplicates;

    let composition;
    if (errors === 0) {
      composition = `Всего ${total} строк, все корректны. База изменится только после подтверждения ниже.`;
    } else if (duplicates === 0) {
      composition = `Всего ${total} строк = ${valid} ${pluralRu(valid, 'корректная', 'корректных', 'корректных')} + ${errors} ${pluralRu(errors, 'с ошибкой', 'с ошибками', 'с ошибками')}. Ошибочные строки в базу не попадут.`;
    } else {
      const dupWord = pluralRu(duplicates, 'дубликат', 'дубликата', 'дубликатов');
      composition = `Всего ${total} строк = ${valid} ${pluralRu(valid, 'корректная', 'корректных', 'корректных')} + ${errors} ${pluralRu(errors, 'с ошибкой', 'с ошибками', 'с ошибками')} (из них ${duplicates} ${dupWord}). Ошибочные строки в базу не попадут.`;
    }
    return composition;
  }

  function renderImportStats(analysis) {
    const stats = [
      { label: 'Всего строк', value: analysis.totalRows, variant: '' },
      { label: 'Корректных', value: analysis.valid.length, variant: 'import-stat--ok' },
      { label: 'С ошибками', value: analysis.errors.length, variant: 'import-stat--error' },
      { label: 'Из ошибок — дубликаты', value: analysis.duplicates, variant: 'import-stat--dup' },
    ];
    els.importStats.replaceChildren(
      ...stats.map((item) => {
        const stat = el('div', `import-stat ${item.variant}`.trim());
        stat.appendChild(el('span', 'import-stat-value', String(item.value)));
        stat.appendChild(el('span', 'import-stat-label', item.label));
        return stat;
      })
    );
    const legend = buildImportLegend(analysis);
    els.importLegend.textContent = legend;
    els.importLegend.hidden = false;
  }

  function renderImportIssues(analysis) {
    const list = els.importIssuesList;
    list.replaceChildren();

    if (!analysis.errors.length) {
      els.importIssuesTitle.textContent = 'Ошибки';
      els.importIssuesOk.hidden = false;
      list.hidden = true;
      return;
    }

    els.importIssuesOk.hidden = true;
    list.hidden = false;
    els.importIssuesTitle.textContent = `Ошибки (${analysis.errors.length})`;
    for (const row of analysis.errors) {
      for (const problem of row.problems) {
        const item = el('li');
        item.appendChild(el('span', 'import-issue-line', `Строка ${row.line}: `));
        item.appendChild(document.createTextNode(problem));
        list.appendChild(item);
      }
    }
  }

  function renderImportPreview() {
    const analysis = state.importPending.analysis;
    renderImportStats(analysis);
    renderImportIssues(analysis);
    els.importFileNamePreview.textContent = `Файл: ${state.importPending.fileName}`;
    els.importSubmit.textContent = `Импортировать корректные строки (${analysis.valid.length})`;
    els.importSubmit.disabled = analysis.valid.length === 0;
  }

  async function handleImportFile(file) {
    if (!file) return;
    els.importFileError.hidden = true;
    try {
      const text = await file.text();
      const CSV = window.EventFlowCSV;
      const records = CSV.parseCsv(text);
      /* срез базы на момент предпросмотра: дубликаты против существующих участников */
      const existing = await DB.getAllParticipants();
      const existingEmailMap = new Map(existing.map((p) => [p.emailLower, p]));
      const analysis = CSV.analyzeCsv(records, state.event, existingEmailMap);

      state.importPending = { fileName: file.name, analysis };

      if (analysis.fileErrors.length) {
        els.importChoose.hidden = false;
        els.importPreview.hidden = true;
        els.importFileError.textContent = `${analysis.fileErrors.join(' ')}`;
        els.importSubmit.disabled = true;
        return;
      }

      els.importChoose.hidden = true;
      els.importPreview.hidden = false;
      els.importFileNamePreview.textContent = `Файл: ${file.name}`;
      renderImportPreview();
    } catch (error) {
      console.error('EventFlow: не удалось прочитать файл', error);
      state.importPending = null;
      els.importPreview.hidden = true;
      els.importFileError.hidden = false;
      els.importFileError.textContent = 'Не удалось прочитать файл. Проверьте, что это текстовый CSV, и выберите его снова.';
    } finally {
      if (els.importFile.value) els.importFile.value = '';
    }
  }

  async function confirmImport() {
    const pending = state.importPending;
    if (!pending) return;
    const analysis = pending.analysis;
    if (!analysis.ok || !analysis.valid.length) return;

    const records = analysis.valid.map((candidate) => ({
      id: generateId(),
      name: candidate.name,
      email: candidate.email,
      emailLower: candidate.emailLower,
      company: candidate.company,
      ticket: candidate.ticket,
      status: candidate.status,
      checkedIn: candidate.checkedIn === true,
      registeredAt: candidate.registeredAt,
      archivedAt: null,
    }));

    els.importSubmit.disabled = true;
    try {
      const outcome = await DB.addParticipantsBatch(records, {
        action: 'participants-imported',
        title: `Импорт CSV: ${pending.fileName}`,
        details: { file: pending.fileName, rows: analysis.totalRows, errors: analysis.errors.length },
      });
      closeImportDialog();
      await refresh();
      const skippedNote = outcome.skipped
        ? ` Пропущено ${outcome.skipped} (появились дубликаты уже во время импорта).`
        : '';
      showToast(`Импортировано ${outcome.imported}. ${skippedNote}`.trim());
    } catch (error) {
      console.error('EventFlow: импорт не выполнен', error);
      showToast('Не удалось импортировать строки. База не изменена.', { variant: 'error' });
      els.importSubmit.disabled = false;
    }
  }

  /* ---------- Резервная копия: экспорт JSON и восстановление ---------- */

  const BACKUP_SCHEMA_VERSION = 1;
  const RESTORE_SHOWN_PROBLEMS = 8;

  function buildBackupFileName(exportedAt) {
    const date = new Date(exportedAt);
    const pad = (value) => String(value).padStart(2, '0');
    return (
      `eventflow-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `_${pad(date.getHours())}-${pad(date.getMinutes())}.json`
    );
  }

  function backupEventFromSetting(eventSetting) {
    return {
      name: eventSetting.name,
      venue: eventSetting.venue,
      capacity: eventSetting.capacity,
      statuses: eventSetting.statuses,
      tickets: eventSetting.tickets,
    };
  }

  /* Скачивание файла на диск — без журнала и тостов: общий шаг
     и для «Экспорт JSON», и для страховки перед заменой. */
  function downloadBackup(payload, fileName) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function createBackupPayload() {
    const snapshot = await DB.getBackupSnapshot();
    if (!snapshot.eventSetting) {
      throw new Error('В базе нет справочника события');
    }
    const exportedAt = new Date().toISOString();
    return {
      payload: {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt,
        event: backupEventFromSetting(snapshot.eventSetting),
        participants: snapshot.participants,
        activity: snapshot.activity,
      },
      fileName: buildBackupFileName(exportedAt),
    };
  }

  async function runExport() {
    try {
      const { payload, fileName } = await createBackupPayload();
      downloadBackup(payload, fileName);
      await DB.addJournalEntry({
        action: 'backup-exported',
        title: `Экспорт копии: ${fileName}`,
        details: {
          file: fileName,
          participants: payload.participants.length,
          activity: payload.activity.length,
        },
      });
      await refresh();
      showToast(`Резервная копия сохранена: ${fileName}`);
    } catch (error) {
      console.error('EventFlow: экспорт не выполнен', error);
      showToast('Не удалось создать резервную копию. Данные не изменены.', { variant: 'error' });
    }
  }

  /* ---------- Проверка файла копии: до подтверждения базу не трогаем ---------- */

  function parseIsoDate(value) {
    if (typeof value !== 'string' || !value.trim()) return { ok: false, value: null };
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { ok: false, value: null };
    return { ok: true, value: date.toISOString() };
  }

  function sameValueSet(list, expected) {
    if (!Array.isArray(list) || list.length !== expected.length) return false;
    const unique = new Set(list);
    return unique.size === expected.length && expected.every((value) => unique.has(value));
  }

  function validateDictionary(list, kind) {
    if (!Array.isArray(list) || !list.length) {
      return { ok: false, problem: `В event нет корректного списка: ${kind}.` };
    }
    const values = [];
    const seen = new Set();
    for (const item of list) {
      if (!item || typeof item !== 'object' || typeof item.value !== 'string' || !item.value ||
          typeof item.label !== 'string' || !item.label) {
        return { ok: false, problem: `Список «${kind}» повреждён: нужны пары value и label.` };
      }
      if (seen.has(item.value)) {
        return { ok: false, problem: `Список «${kind}» содержит повтор значения «${item.value}».` };
      }
      seen.add(item.value);
      values.push(item.value);
    }
    return { ok: true, values };
  }

  function validateBackupFile(text) {
    const problems = [];
    const fail = () => ({ ok: false, problems });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      problems.push('Файл не является корректным JSON' + (error && error.message ? `: ${error.message}` : '.'));
      return fail();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push('Структура не распознана: ожидается объект резервной копии.');
      return fail();
    }

    if (parsed.schemaVersion === undefined) {
      problems.push('В копии нет поля schemaVersion.');
    } else if (parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      const shown = typeof parsed.schemaVersion === 'string' ? `«${parsed.schemaVersion}»` : String(parsed.schemaVersion);
      problems.push(`Версия схемы копии — ${shown}; приложение работает с версией ${BACKUP_SCHEMA_VERSION}.`);
    }

    const exportedAt = parseIsoDate(parsed.exportedAt);
    if (!exportedAt.ok) {
      problems.push('Поле exportedAt отсутствует или не содержит корректную дату.');
    }

    const event = parsed.event;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      problems.push('В копии нет раздела event со справочником события.');
      return fail();
    }
    if (typeof event.name !== 'string' || !event.name.trim()) {
      problems.push('В event нет названия события (name).');
    }
    const statuses = validateDictionary(event.statuses, 'статусы');
    if (!statuses.ok) problems.push(statuses.problem);
    const tickets = validateDictionary(event.tickets, 'типы билетов');
    if (!tickets.ok) problems.push(tickets.problem);
    if (statuses.ok && tickets.ok) {
      if (!sameValueSet(statuses.values, state.event.statuses.map((item) => item.value))) {
        problems.push('Статусы в копии не совпадают с текущими: копия от другого события или изменённого справочника.');
      }
      if (!sameValueSet(tickets.values, state.event.tickets.map((item) => item.value))) {
        problems.push('Типы билетов в копии не совпадают с текущими.');
      }
    }

    if (!Array.isArray(parsed.participants)) {
      problems.push('Раздел participants отсутствует или не является массивом.');
      return fail();
    }
    if (!Array.isArray(parsed.activity)) {
      problems.push('Раздел activity отсутствует или не является массивом.');
      return fail();
    }

    const statusValues = statuses.ok ? new Set(statuses.values) : null;
    const ticketValues = tickets.ok ? new Set(tickets.values) : null;
    const seenIds = new Map();
    const seenEmails = new Map();
    const normalizedParticipants = [];

    parsed.participants.forEach((record, index) => {
      const number = index + 1;
      const before = problems.length;
      const add = (reason) => problems.push(`Участник ${number}: ${reason}`);

      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        add('запись не является объектом.');
        return;
      }
      if (typeof record.id !== 'string' || !record.id.trim()) {
        add('не задан идентификатор id.');
        return;
      }
      const firstWithId = seenIds.get(record.id);
      if (firstWithId != null) {
        add(`id повторяет запись ${firstWithId} этой копии.`);
      } else {
        seenIds.set(record.id, number);
      }

      if (typeof record.name !== 'string' || !record.name.trim()) {
        add('имя отсутствует или пустое.');
      }
      if (typeof record.email !== 'string' || !record.email.trim()) {
        add('email отсутствует или пустой.');
      } else if (!emailLooksValid(record.email.trim())) {
        add(`email «${record.email.trim()}» не похож на адрес.`);
      }

      const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
      if (email && emailLooksValid(email)) {
        const firstWithEmail = seenEmails.get(email);
        if (firstWithEmail != null) {
          add(`email повторяет запись ${firstWithEmail} этой копии.`);
        } else {
          seenEmails.set(email, number);
        }
      }

      if (ticketValues && !ticketValues.has(record.ticket)) {
        add(`тип билета «${record.ticket == null ? '' : record.ticket}» не входит в справочник события.`);
      }
      if (statusValues && !statusValues.has(record.status)) {
        add(`статус «${record.status == null ? '' : record.status}» не входит в справочник события.`);
      }
      if (typeof record.checkedIn !== 'boolean') {
        add('отметка о прибытии (checkedIn) должна быть true или false.');
      }
      const registeredAt = parseIsoDate(record.registeredAt);
      if (!registeredAt.ok) {
        add('дата регистрации (registeredAt) отсутствует или некорректна.');
      }
      let archivedAt = null;
      if (record.archivedAt != null) {
        const parsedArchived = parseIsoDate(record.archivedAt);
        if (!parsedArchived.ok) {
          add('дата архивации (archivedAt) некорректна: ожидается null или дата.');
        } else {
          archivedAt = parsedArchived.value;
        }
      }
      if (record.checkedIn === true && record.status !== 'confirmed') {
        add('отметка о прибытии допустима только при статусе «Подтверждён».');
      }

      if (problems.length === before) {
        normalizedParticipants.push({
          id: record.id,
          name: record.name.trim(),
          email: record.email.trim(),
          emailLower: email,
          company: typeof record.company === 'string' ? record.company.trim() : '',
          ticket: record.ticket,
          status: record.status,
          checkedIn: record.checkedIn === true,
          registeredAt: registeredAt.value,
          archivedAt,
        });
      }
    });

    const seenActivityIds = new Set();
    const normalizedActivity = [];
    parsed.activity.forEach((record, index) => {
      const number = index + 1;
      const before = problems.length;
      const add = (reason) => problems.push(`Запись журнала ${number}: ${reason}`);

      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        add('запись не является объектом.');
        return;
      }
      if (!Number.isInteger(record.id) || record.id < 1) {
        add('нет корректного числового id.');
        return;
      }
      if (seenActivityIds.has(record.id)) {
        add(`id ${record.id} повторяется в копии.`);
      } else {
        seenActivityIds.add(record.id);
      }
      if (typeof record.action !== 'string' || !record.action.trim()) {
        add('не задан тип действия (action).');
      }
      if (typeof record.title !== 'string' || !record.title.trim()) {
        add('не задан текст действия (title).');
      }
      const ts = parseIsoDate(record.ts);
      if (!ts.ok) {
        add('некорректное время действия (ts).');
      }
      if (record.details != null && (typeof record.details !== 'object' || Array.isArray(record.details))) {
        add('details должен быть объектом или отсутствовать.');
      }

      if (problems.length === before) {
        const entry = { id: record.id, action: record.action, title: record.title, ts: ts.value };
        if (record.details != null) entry.details = record.details;
        normalizedActivity.push(entry);
      }
    });

    if (problems.length) {
      return { ok: false, problems };
    }

    const eventSetting = {
      key: 'event',
      name: event.name.trim(),
      venue: typeof event.venue === 'string' ? event.venue : '',
      capacity: typeof event.capacity === 'number' ? event.capacity : null,
      statuses: event.statuses,
      tickets: event.tickets,
    };

    return {
      ok: true,
      problems,
      backup: {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: exportedAt.value,
        event: backupEventFromSetting(eventSetting),
        participants: normalizedParticipants,
        activity: normalizedActivity,
        eventSetting,
        counts: {
          participants: normalizedParticipants.length,
          archived: normalizedParticipants.filter((p) => p.archivedAt).length,
          activity: normalizedActivity.length,
        },
      },
    };
  }

  function buildRestoreProblemText(problems) {
    const shown = problems
      .slice(0, RESTORE_SHOWN_PROBLEMS)
      .map((problem) => `— ${problem}`)
      .join(' ');
    const rest = problems.length > RESTORE_SHOWN_PROBLEMS
      ? ` Ещё проблем: ${problems.length - RESTORE_SHOWN_PROBLEMS}.`
      : '';
    return `Файл отклонён, база не изменена. ${shown}${rest}`;
  }

  /* ---------- Диалог восстановления ---------- */

  function openRestoreDialog() {
    resetRestore();
    els.restoreDialog.showModal();
    els.restoreFileTrigger.focus();
  }

  function resetRestore() {
    state.restorePending = null;
    els.restoreChoose.hidden = false;
    els.restorePreview.hidden = true;
    els.restoreFileError.hidden = true;
    els.restoreFileError.textContent = '';
    els.restoreFileName.hidden = true;
    els.restoreFileName.textContent = '';
    els.restoreStats.replaceChildren();
    els.restoreLegend.hidden = true;
    els.restoreLegend.textContent = '';
    els.restoreWarningCurrent.textContent = '';
    els.restoreSaveCurrent.checked = true;
    els.restoreSubmit.disabled = true;
    els.restoreSubmit.textContent = 'Заменить данные';
    els.restoreCancel.disabled = false;
    if (els.restoreFile.value) els.restoreFile.value = '';
  }

  /* Явное закрытие: сброс не доверяем событию close (в части
     окружений оно не доставляется, см. комментарий к импорту). */
  function closeRestoreDialog() {
    if (els.restoreDialog.open) els.restoreDialog.close();
    resetRestore();
  }

  function renderRestoreStats(backup) {
    const counts = backup.counts;
    const tiles = [
      { label: 'Участников', value: String(counts.participants), variant: '' },
      { label: 'В архиве', value: String(counts.archived), variant: '' },
      { label: 'Записей журнала', value: String(counts.activity), variant: '' },
      { label: 'Копия создана', value: formatDateTime(backup.exportedAt), variant: 'import-stat--date' },
    ];
    els.restoreStats.replaceChildren(
      ...tiles.map((tile) => {
        const stat = el('div', `import-stat ${tile.variant}`.trim());
        stat.appendChild(el('span', 'import-stat-value', tile.value));
        stat.appendChild(el('span', 'import-stat-label', tile.label));
        return stat;
      })
    );
  }

  function renderRestorePreview() {
    const { backup } = state.restorePending;
    renderRestoreStats(backup);

    els.restoreLegend.textContent = `Событие: ${backup.event.name}. Схема копии v${backup.schemaVersion}.`;
    els.restoreLegend.hidden = false;

    const activeNow = state.participants.filter((p) => !p.archivedAt).length;
    const archivedNow = state.participants.length - activeNow;
    els.restoreWarningCurrent.textContent =
      `Сейчас в базе: ${activeNow} активных, ${archivedNow} в архиве и ${state.activity.length} записей журнала. После замены останется только содержимое копии.`;

    const count = backup.counts.participants;
    els.restoreSubmit.textContent = `Заменить базу (${count} ${pluralRu(count, 'участник', 'участника', 'участников')})`;
    els.restoreSubmit.disabled = false;
  }

  async function handleRestoreFile(file) {
    if (!file) return;
    els.restoreFileError.hidden = true;
    els.restoreFileError.textContent = '';
    try {
      const text = await file.text();
      const report = validateBackupFile(text);
      state.restorePending = report.ok ? { fileName: file.name, backup: report.backup } : null;

      if (!report.ok) {
        els.restoreChoose.hidden = false;
        els.restorePreview.hidden = true;
        els.restoreFileError.hidden = false;
        els.restoreFileError.textContent = buildRestoreProblemText(report.problems);
        els.restoreSubmit.disabled = true;
        return;
      }

      els.restoreChoose.hidden = true;
      els.restorePreview.hidden = false;
      els.restoreFileNamePreview.textContent = `Файл: ${file.name}`;
      renderRestorePreview();
    } catch (error) {
      console.error('EventFlow: не удалось прочитать файл копии', error);
      state.restorePending = null;
      els.restorePreview.hidden = true;
      els.restoreFileError.hidden = false;
      els.restoreFileError.textContent = 'Не удалось прочитать файл. Выберите JSON-файл резервной копии ещё раз.';
    } finally {
      if (els.restoreFile.value) els.restoreFile.value = '';
    }
  }

  async function confirmRestore() {
    const pending = state.restorePending;
    if (!pending) return;

    const previousLabel = els.restoreSubmit.textContent;
    els.restoreSubmit.disabled = true;
    els.restoreCancel.disabled = true;
    els.restoreSubmit.textContent = 'Заменяем данные…';

    try {
      /* Страховка: текущая копия на диск до замены (по умолчанию включена) */
      if (els.restoreSaveCurrent.checked) {
        try {
          const { payload, fileName } = await createBackupPayload();
          downloadBackup(payload, fileName);
          showToast(`Текущая копия сохранена перед заменой: ${fileName}`);
        } catch (error) {
          console.error('EventFlow: не удалось скачать текущую копию', error);
          showToast('Не удалось скачать текущую копию, замена отменена. Данные не изменены.', { variant: 'error' });
          els.restoreSubmit.textContent = previousLabel;
          els.restoreSubmit.disabled = false;
          els.restoreCancel.disabled = false;
          return;
        }
      }

      const counts = pending.backup.counts;
      await DB.restoreBackup(
        {
          participants: pending.backup.participants,
          activity: pending.backup.activity,
          eventSetting: pending.backup.eventSetting,
        },
        {
          action: 'backup-restored',
          title: `Восстановление из копии: ${pending.fileName}`,
          details: {
            file: pending.fileName,
            participants: counts.participants,
            archived: counts.archived,
            activity: counts.activity,
          },
        }
      );

      closeRestoreDialog();
      await refresh();
      showToast(
        `База восстановлена: ${counts.participants} ${pluralRu(counts.participants, 'участник', 'участника', 'участников')}, ` +
        `${counts.activity} ${pluralRu(counts.activity, 'запись', 'записи', 'записей')} журнала.`
      );
    } catch (error) {
      console.error('EventFlow: восстановление не выполнено', error);
      showToast('Не удалось восстановить копию. Данные не изменены.', { variant: 'error' });
      els.restoreSubmit.textContent = previousLabel;
      els.restoreSubmit.disabled = false;
      els.restoreCancel.disabled = false;
    }
  }

  /* ---------- Ошибка открытия базы ---------- */

  function showFatal(error) {
    const reason = error && error.message ? error.message : 'неизвестная ошибка';
    els.fatalText.textContent =
      `EventFlow хранит данные в локальной базе IndexedDB вашего браузера. ` +
      `Открыть её не удалось (${reason}). Данные не изменены, можно повторить попытку.`;
    els.fatal.hidden = false;
  }

  /* ---------- Делегирование действий ---------- */

  function handleAction(action, target) {
    const row = target.closest('tr');
    const id = row && row.dataset.id;
    const participant = state.participants.find((p) => p.id === id);
    switch (action) {
      case 'add-participant':
        openForm('create');
        break;
      case 'open-participant':
        if (participant) openParticipant(participant);
        break;
      case 'edit-participant':
        if (participant) openForm('edit', participant);
        break;
      case 'check-in':
        if (participant) checkIn(participant);
        break;
      case 'archive-participant':
        if (participant) archiveParticipant(participant);
        break;
      case 'reset-filters':
        resetFilters();
        break;
      case 'import-csv':
        openImportDialog();
        break;
      case 'export-json':
        runExport();
        break;
      case 'restore-json':
        openRestoreDialog();
        break;
      default:
        break;
    }
  }

  function resetFilters() {
    state.query = '';
    state.statusFilter = 'all';
    state.ticketFilter = 'all';
    els.searchInput.value = '';
    els.filterStatus.value = 'all';
    els.filterTicket.value = 'all';
    renderList();
    els.searchInput.focus();
  }

  /* ---------- Запуск ---------- */

  function wireEvents() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      if (button.disabled) return;
      handleAction(button.dataset.action, button);
    });

    els.searchInput.addEventListener('input', debounce(() => {
      state.query = els.searchInput.value;
      renderList();
    }, 140));

    els.filterStatus.addEventListener('change', () => {
      state.statusFilter = els.filterStatus.value;
      renderList();
    });

    els.filterTicket.addEventListener('change', () => {
      state.ticketFilter = els.filterTicket.value;
      renderList();
    });

    els.sortSelect.addEventListener('change', () => {
      state.sort = ALLOWED_SORTS.includes(els.sortSelect.value) ? els.sortSelect.value : state.sort;
      saveSortPref(state.sort);
      renderList();
    });

    /* Форма */
    els.fieldName.addEventListener('input', renderValidation);
    els.fieldEmail.addEventListener('input', renderValidation);
    els.fieldChecked.addEventListener('change', renderValidation);
    els.fieldStatus.addEventListener('change', () => {
      syncCheckedField(true);
      renderValidation();
    });

    els.form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitForm();
    });

    els.formCancel.addEventListener('click', closeForm);
    els.formClose.addEventListener('click', closeForm);
    els.formEdit.addEventListener('click', () => {
      const participant = state.participants.find((p) => p.id === state.editingId);
      if (participant) applyMode('edit', participant);
    });

    els.dialog.addEventListener('close', () => {
      state.formMode = null;
      state.editingId = null;
    });
    els.dialog.addEventListener('cancel', () => {
      state.formMode = null;
      state.editingId = null;
    });

    /* Импорт CSV */
    els.importFileTrigger.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      handleImportFile(file);
    });
    els.importSubmit.addEventListener('click', confirmImport);
    els.importCancel.addEventListener('click', closeImportDialog);
    els.importClose.addEventListener('click', closeImportDialog);
    /* close — для браузеров, где событие доставляется; cancel — для Esc;
       в обоих случаях resetImport идемпотентен. */
    els.importDialog.addEventListener('close', resetImport);
    els.importDialog.addEventListener('cancel', resetImport);
    els.importForm.addEventListener('submit', (event) => event.preventDefault());

    /* Восстановление копии */
    els.restoreFileTrigger.addEventListener('click', () => els.restoreFile.click());
    els.restoreFile.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      handleRestoreFile(file);
    });
    els.restoreSubmit.addEventListener('click', confirmRestore);
    els.restoreCancel.addEventListener('click', closeRestoreDialog);
    els.restoreClose.addEventListener('click', closeRestoreDialog);
    els.restoreDialog.addEventListener('close', resetRestore);
    els.restoreDialog.addEventListener('cancel', resetRestore);
    els.restoreForm.addEventListener('submit', (event) => event.preventDefault());

    els.retry.addEventListener('click', () => window.location.reload());
  }

  async function init() {
    setBodyState('loading');
    els.fatal.hidden = true;

    try {
      await DB.initDatabase();

      const [participantsData, activityData, event] = await Promise.all([
        DB.getAllParticipants(),
        DB.getAllActivity(),
        DB.getSetting('event'),
      ]);

      if (!event) {
        throw new Error('в базе нет справочника события');
      }

      state.event = event;
      state.participants = participantsData;
      state.activity = activityData;

      wireEvents();
      renderEvent(event);
      renderFilterOptions(event);
      renderKpi(state.participants);
      renderList();
      renderActivity(state.activity);

      setBodyState('ready');
    } catch (error) {
      console.error('EventFlow: не удалось инициализировать приложение', error);
      setBodyState('error');
      showFatal(error);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
