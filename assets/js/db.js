/* ============================================================
   EventFlow — слой хранения данных (IndexedDB)
   База: eventflow-db, версия 1 (этап 1).

   Хранилища:
   - participants: keyPath "id" (строка-UUID, без автоинкремента),
     индексы: email (по emailLower, уникальный), status,
     registeredAt, archivedAt;
   - settings: keyPath "key" — справочник события и версия схемы;
   - activity: keyPath "id" с автоинкрементом — журнал действий.

   Схема создаётся в onupgradeneeded идемпотентно: при отсутствии
   хранилища/индекса они создаются, существующие не трогаются.
   Индекс email объявлен unique: IndexedDB сам отвергнет запись
   с занятым email (ConstraintError) — проверим его на этапах 2+.
   ============================================================ */
(function () {
  'use strict';

  const DB_NAME = 'eventflow-db';
  const DB_VERSION = 1;

  const STORE = {
    participants: 'participants',
    settings: 'settings',
    activity: 'activity',
  };

  /* Справочник события и разрешённые значения статусов/билетов.
     Источник — data/event-settings.json; данные вшиты, чтобы
     приложение не выполняло сетевых запросов (чтение файла
     браузером было бы запросом). data/ доступно только для чтения. */
  const EVENT_SEED = {
    name: 'Практикум «Продукты с ИИ»',
    venue: 'Учебный центр',
    capacity: 120,
    statuses: [
      { value: 'new', label: 'Новый' },
      { value: 'confirmed', label: 'Подтверждён' },
      { value: 'waitlist', label: 'Лист ожидания' },
      { value: 'cancelled', label: 'Отменён' },
    ],
    tickets: [
      { value: 'standard', label: 'Стандартный' },
      { value: 'business', label: 'Бизнес' },
      { value: 'vip', label: 'VIP' },
    ],
  };

  let dbPromise = null;

  /* IDBRequest → Promise */
  function asPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Ошибка IndexedDB'));
    });
  }

  /* Ожидание завершения транзакции */
  function waitTransaction(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Транзакция прервана'));
      tx.onerror = () => reject(tx.error || new Error('Ошибка транзакции'));
    });
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      let request;
      try {
        if (typeof window.indexedDB === 'undefined' || window.indexedDB === null) {
          throw new Error('IndexedDB недоступен в этом браузере');
        }
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }

      /* Миграция схемы. Сейчас это первичное создание (версия 1);
         при будущих версиях код добавляется сюда. */
      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE.participants)) {
          const participants = db.createObjectStore(STORE.participants, {
            keyPath: 'id',
            autoIncrement: false,
          });
          /* Уникальность email без учёта регистра достигается
             индексом по нормализованному полю emailLower */
          participants.createIndex('email', 'emailLower', { unique: true });
          participants.createIndex('status', 'status', { unique: false });
          participants.createIndex('registeredAt', 'registeredAt', { unique: false });
          participants.createIndex('archivedAt', 'archivedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE.settings)) {
          db.createObjectStore(STORE.settings, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(STORE.activity)) {
          /* Автоинкремент разрешён только для журнала */
          db.createObjectStore(STORE.activity, { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onblocked = () => {
        dbPromise = null;
        reject(new Error('База занята другой вкладкой EventFlow. Закройте её и повторите попытку.'));
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('Не удалось открыть базу данных'));
      };
    });

    return dbPromise;
  }

  /* Разовый идемпотентный сид справочника события и версии схемы.
     Одна readwrite-транзакция; существующие значения не перезаписываются,
     чтобы не затереть данные после восстановления копии (этап 6). */
  async function ensureSettingsSeed(db) {
    const tx = db.transaction(STORE.settings, 'readwrite');
    const settings = tx.objectStore(STORE.settings);

    const eventRequest = settings.get('event');
    const versionRequest = settings.get('schemaVersion');

    eventRequest.onsuccess = () => {
      if (!eventRequest.result) {
        settings.put({ key: 'event', ...EVENT_SEED });
      }
    };
    versionRequest.onsuccess = () => {
      if (!versionRequest.result) {
        settings.put({ key: 'schemaVersion', value: DB_VERSION });
      }
    };

    await waitTransaction(tx);
  }

  /* Открыть базу и убедиться, что справочники существуют */
  function initDatabase() {
    return openDatabase().then(ensureSettingsSeed);
  }

  /* Универсальный запуск транзакции для операций со данными (этапы 2+):
     executor(tx) выполняет запросы, возвращаемое значение — результат. */
  function runTransaction(storeNames, mode, executor) {
    return openDatabase().then((db) => {
      const tx = db.transaction(storeNames, mode);
      const done = waitTransaction(tx);
      return Promise.resolve()
        .then(() => executor(tx))
        .then((result) => done.then(() => result));
    });
  }

  /* ---------- Мутации (одна запись = одна транзакция + журнал) ----------
     Сообщение в журнал пишется внутри той же транзакции, что и данные:
     неудачная запись участника не оставит «успешного» события. */

  /* Уникальный email без учёта регистра: проверка индексом email
     (ключ emailLower) внутри транзакции самой записи. */
  function ensureEmailAvailable(participantsStore, emailLower, excludeId) {
    return new Promise((resolve, reject) => {
      const request = participantsStore.index('email').get(emailLower);
      request.onsuccess = () => {
        const found = request.result;
        if (found && found.id !== excludeId) {
          const error = new Error(`Этот email уже указан у участника ${found.name || ''}`.trim());
          error.field = 'email';
          reject(error);
          return;
        }
        resolve();
      };
      request.onerror = () => reject(request.error || new Error('Ошибка проверки email'));
    });
  }

  function writeParticipant(record, { mode, entry }) {
    return runTransaction([STORE.participants, STORE.activity], 'readwrite', (tx) =>
      (async () => {
        const participants = tx.objectStore(STORE.participants);
        await ensureEmailAvailable(
          participants,
          record.emailLower,
          mode === 'update' ? record.id : undefined
        );
        if (mode === 'update') {
          participants.put(record);
        } else {
          participants.add(record);
        }
        tx.objectStore(STORE.activity).add({ ...entry, ts: new Date().toISOString() });
      })()
    );
  }

  function addParticipant(record, entry) {
    return writeParticipant(record, { mode: 'add', entry });
  }

  function updateParticipant(record, entry) {
    return writeParticipant(record, { mode: 'update', entry });
  }

  /* Частичное обновление (чек-ин, архивация, отмена архивации): сначала
     читаем текущую запись, затем меняем поля и пишем — одним tx. */
  function patchParticipant(id, patch, entry) {
    return runTransaction([STORE.participants, STORE.activity], 'readwrite', (tx) =>
      (async () => {
        const participants = tx.objectStore(STORE.participants);
        const existing = await asPromise(participants.get(id));
        if (!existing) {
          throw new Error('Участник не найден в базе');
        }
        const updated = { ...existing, ...patch };
        if (patch.emailLower && patch.emailLower !== existing.emailLower) {
          await ensureEmailAvailable(participants, updated.emailLower, id);
        }
        participants.put(updated);
        tx.objectStore(STORE.activity).add({ ...entry, ts: new Date().toISOString() });
        return updated;
      })()
    );
  }

  /* Массовый импорт корректных строк: все записи и итог в журнал —
     одна readwrite-транзакция. Перед каждой вставкой перепроверяем
     email по индексу: если конфликт появился после предпросмотра,
     конкретная строка пропускается (счётчик skipped), транзакция
     не прерывается. */
  function addParticipantsBatch(records, entry) {
    return runTransaction([STORE.participants, STORE.activity], 'readwrite', (tx) =>
      (async () => {
        const participants = tx.objectStore(STORE.participants);
        const imported = [];
        const skipped = [];
        for (const record of records) {
          const existing = await asPromise(participants.index('email').get(record.emailLower));
          if (existing && existing.id !== record.id) {
            skipped.push({ email: record.email, name: existing.name || '' });
            continue;
          }
          participants.add(record);
          imported.push(record.id);
        }
        tx.objectStore(STORE.activity).add({
          action: entry.action,
          title: `${entry.title} — добавлено ${imported.length}, пропущено ${skipped.length}`,
          ts: new Date().toISOString(),
          details: {
            ...(entry.details || {}),
            imported: imported.length,
            skipped: skipped.length,
          },
        });
        return { imported: imported.length, skipped: skipped.length, skippedDetails: skipped };
      })()
    );
  }

  /* ---------- Резервная копия (этап 4) ---------- */

  /* Полный срез для экспорта: участники (включая архив), весь журнал
     и справочник события — один readonly-проход, базу не меняет. */
  function getBackupSnapshot() {
    return runTransaction([STORE.participants, STORE.activity, STORE.settings], 'readonly', (tx) =>
      (async () => {
        const participants = await asPromise(tx.objectStore(STORE.participants).getAll());
        const activity = await asPromise(tx.objectStore(STORE.activity).getAll());
        const eventSetting = await asPromise(tx.objectStore(STORE.settings).get('event'));
        return { participants, activity, eventSetting };
      })()
    );
  }

  /* Полная замена: очистка participants и activity, запись копии и
     (если передан) справочника события — одна readwrite-транзакция,
     запись в журнал внутри неё же. Любой сбой откатывает всё: база
     остаётся в исходном состоянии. */
  function restoreBackup(backup, entry) {
    return runTransaction([STORE.participants, STORE.activity, STORE.settings], 'readwrite', (tx) =>
      (async () => {
        const participants = tx.objectStore(STORE.participants);
        const activity = tx.objectStore(STORE.activity);
        const settings = tx.objectStore(STORE.settings);

        participants.clear();
        activity.clear();
        for (const record of backup.participants) {
          participants.put(record);
        }
        for (const record of backup.activity) {
          activity.put(record);
        }
        if (backup.eventSetting) {
          settings.put(backup.eventSetting);
        }

        activity.add({ ...entry, ts: new Date().toISOString() });
        return { participants: backup.participants.length, activity: backup.activity.length };
      })()
    );
  }

  /* Самостоятельная запись в журнал (успешный экспорт копии):
     одна запись — одна транзакция. */
  function addJournalEntry(entry) {
    return runTransaction(STORE.activity, 'readwrite', (tx) => {
      tx.objectStore(STORE.activity).add({ ...entry, ts: new Date().toISOString() });
    });
  }

  /* ---------- Читатели ---------- */

  function getAllParticipants() {
    return runTransaction(STORE.participants, 'readonly', (tx) =>
      asPromise(tx.objectStore(STORE.participants).getAll())
    );
  }

  function getAllActivity() {
    return runTransaction(STORE.activity, 'readonly', (tx) =>
      asPromise(tx.objectStore(STORE.activity).getAll())
    );
  }

  function getSetting(key) {
    return runTransaction(STORE.settings, 'readonly', (tx) =>
      asPromise(tx.objectStore(STORE.settings).get(key))
    );
  }

  window.EventFlowDB = {
    initDatabase,
    runTransaction,
    getAllParticipants,
    getAllActivity,
    getSetting,
    addParticipant,
    updateParticipant,
    patchParticipant,
    addParticipantsBatch,
    getBackupSnapshot,
    restoreBackup,
    addJournalEntry,
    STORE,
    DB_NAME,
    DB_VERSION,
  };
})();
