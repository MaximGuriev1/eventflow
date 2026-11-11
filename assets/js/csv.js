/* ============================================================
   EventFlow — разбор и проверка CSV (этап 3). Всё без библиотек.

   parseCsv: RFC 4180-совместимый парсер — кавычки, "" внутри
   кавычек, запятые и переносы строк внутри кавычек, BOM, \r\n|\n|\r.
   Каждой записи запоминается физический номер строки файла
   (шапка = строка 1), чтобы ошибки в предпросмотре показывались
   с верными номерами, даже если внутри файла есть пустые строки.

   analyzeCsv: проверяет шапку (обязательные name, email, ticket,
   status, checked_in, registered_at; company необязательна,
   лишние колонки игнорируются), затем каждую строку: заполненность
   обязательных полей, формат email, допустимость ticket/status
   по справочнику события, распознавание checked_in, перевод даты
   в ISO, бизнес-правило «приход только у подтверждённых» и
   дубликаты email — внутри файла и против базы.
   Никаких обращений к IndexedDB: входные данные передаются
   аргументами, функции чистые — до подтверждения база не меняется.
   ============================================================ */
(function () {
  'use strict';

  const REQUIRED_COLUMNS = ['name', 'email', 'ticket', 'status', 'checked_in', 'registered_at'];
  const OPTIONAL_COLUMNS = ['company'];

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function stripBom(text) {
    const source = String(text == null ? '' : text);
    if (source.charCodeAt(0) === 0xfeff) return source.slice(1);
    return source;
  }

  function parseCsv(sourceText) {
    const text = stripBom(sourceText);
    const records = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let line = 1;

    const endField = () => {
      row.push(field);
      field = '';
    };
    const endRecord = () => {
      endField();
      records.push({ line, cells: row });
      row = [];
    };

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        endField();
      } else if (ch === '\n') {
        endRecord();
        line += 1;
      } else if (ch === '\r') {
        if (text[i + 1] === '\n') i += 1;
        endRecord();
        line += 1;
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) endRecord();

    /* Пустые строки (в т.ч. завершающая) не попадают в данные,
       но номера физических строк сохранены в каждой записи. */
    return records.filter((record) => record.cells.some((cell) => String(cell).trim() !== ''));
  }

  function parseBoolean(value) {
    const normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (['true', '1', 'yes', 'да'].includes(normalized)) return { ok: true, value: true };
    if (['false', '0', 'no', 'нет'].includes(normalized)) return { ok: true, value: false };
    return { ok: false, value: null };
  }

  function parseDateToIso(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return { ok: false, value: null };
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return { ok: false, value: null };
    return { ok: true, value: date.toISOString() };
  }

  /* existingEmailMap: Map(emailLower → { name }) — против базы. */
  function analyzeCsv(records, settings, existingEmailMap) {
    const result = {
      ok: false,
      fileErrors: [],
      totalRows: 0,
      valid: [],
      errors: [],
      duplicates: 0,
    };

    const headerRecord = records[0];
    if (!headerRecord) {
      result.fileErrors.push('Файл пуст: в нём нет даже строки заголовков.');
      return result;
    }

    const header = headerRecord.cells.map((cell) => String(cell).trim().toLowerCase());
    const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
    if (missing.length) {
      result.fileErrors.push(
        'В шапке файла нет обязательных колонок: ' +
          missing.join(', ') +
          '. Нужны: name, email, ticket, status, checked_in, registered_at.'
      );
      return result;
    }

    result.ok = true;

    const columnBy = {};
    header.forEach((key, index) => {
      if (REQUIRED_COLUMNS.includes(key) || OPTIONAL_COLUMNS.includes(key)) {
        columnBy[key] = index;
      }
    });

    const ticketsList = (settings.tickets || []).map((item) => item.value);
    const ticketsHuman = (settings.tickets || []).map((item) => item.label).join(', ');
    const statusesList = (settings.statuses || []).map((item) => item.value);
    const statusesHuman = (settings.statuses || []).map((item) => item.label).join(', ');
    const seenInFile = new Map();
    let dupNumber = 0;

    records.slice(1).forEach((record) => {
      const cell = (key) => {
        const index = columnBy[key];
        return index == null ? '' : String(record.cells[index] == null ? '' : record.cells[index]).trim();
      };

      const candidate = {
        line: record.line,
        name: cell('name'),
        email: cell('email'),
        emailLower: cell('email').toLowerCase(),
        company: cell('company'),
        ticket: cell('ticket'),
        status: cell('status'),
        checkedInRaw: cell('checked_in'),
        registeredAtRaw: cell('registered_at'),
        problems: [],
      };
      result.totalRows += 1;

      if (!candidate.name) {
        candidate.problems.push('Не заполнено имя — это обязательное поле.');
      }
      if (!candidate.email) {
        candidate.problems.push('Не заполнен email — это обязательное поле.');
      } else if (!EMAIL_PATTERN.test(candidate.email)) {
        candidate.problems.push(
          `Email «${candidate.email}» не похож на адрес: нужен вид «имя@домен», например anna@example.ru.`
        );
      }

      if (!ticketsList.includes(candidate.ticket)) {
        candidate.problems.push(
          `Тип билета «${candidate.ticket}» не входит в справочник события. Разрешены: ${ticketsHuman}.`
        );
      }
      if (!statusesList.includes(candidate.status)) {
        candidate.problems.push(
          `Статус «${candidate.status}» не входит в справочник события. Разрешены: ${statusesHuman}.`
        );
      }

      const checkedIn = parseBoolean(candidate.checkedInRaw);
      if (!checkedIn.ok) {
        candidate.problems.push(
          `Значение checked_in «${candidate.checkedInRaw}» не распознано: используйте true или false.`
        );
      }
      if (checkedIn.ok) {
        candidate.checkedIn = checkedIn.value;
      }

      const registeredAt = parseDateToIso(candidate.registeredAtRaw);
      if (!registeredAt.ok) {
        candidate.problems.push(
          'Дата регистрации не распознана: нужен формат ISO, например 2026-08-24T08:10:00Z.'
        );
      } else {
        candidate.registeredAt = registeredAt.value;
      }

      /* Бизнес-правило: отметка о прибытии только у подтверждённых */
      if (checkedIn.ok && checkedIn.value && statusesList.includes(candidate.status) && candidate.status !== 'confirmed') {
        candidate.problems.push(
          `Отметка о прибытии (checked_in = ${candidate.checkedInRaw}) допустима только при статусе «Подтверждён», а в файле — «${
            (settings.statuses || []).find((item) => item.value === candidate.status)?.label || candidate.status
          }».`
        );
      }

      /* Дубликаты email: сначала внутри файла, затем против базы.
         Строки с отсутствующим/битым email в реестр занятых адресов
         не попадают — они и так содержат ошибку email. */
      const emailUsable = candidate.email && EMAIL_PATTERN.test(candidate.email);
      if (emailUsable) {
        const inFileLine = seenInFile.get(candidate.emailLower);
        if (inFileLine != null) {
          dupNumber += 1;
          candidate.problems.push(
            `Дубликат: этот email уже встретился в строке ${inFileLine} этого файла.`
          );
        } else {
          seenInFile.set(candidate.emailLower, record.line);
          const existing = existingEmailMap && existingEmailMap.get(candidate.emailLower);
          if (existing) {
            dupNumber += 1;
            candidate.problems.push(
              `Дубликат: участник ${existing.name || 'с таким email'} уже есть в базе.`
            );
          }
        }
      }

      if (candidate.problems.length) {
        result.errors.push(candidate);
      } else {
        result.valid.push(candidate);
      }
    });

    result.duplicates = dupNumber;
    return result;
  }

  window.EventFlowCSV = { parseCsv, analyzeCsv, parseDateToIso, parseBoolean };
})();
