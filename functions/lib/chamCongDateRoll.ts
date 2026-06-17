import {
  isChamCongSystemTab,
  listChamCongEmployeeTabs,
  formatNgayVietnam,
} from "./chamCongSheet";
import {
  sheetsAppendTableRow,
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsSpreadsheetBatchUpdate,
  sheetsSpreadsheetTables,
} from "./google";

const MAX_SCAN_ROW = 400;
const DATA_COLS = 6;

type DateParts = { y: number; m: number; d: number };

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function parseVietnamDateCell(cell: unknown): DateParts | null {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number" && Number.isFinite(cell)) {
    if (cell > 35_000 && cell < 65_000 && Math.floor(cell) === cell) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const dt = new Date(epoch.getTime() + cell * 86_400_000);
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }
  }
  const t = String(cell).trim();
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return null;
  return { y, m: mo, d };
}

function dateKey(p: DateParts): number {
  return p.y * 10_000 + p.m * 100 + p.d;
}

function todayParts(unixSec?: number): DateParts {
  const s = formatNgayVietnam(unixSec);
  return parseVietnamDateCell(s) ?? { y: 0, m: 0, d: 0 };
}

function formatParts(p: DateParts): string {
  return `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`;
}

function addCalendarDay(p: DateParts): DateParts {
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function isChamCongHeaderRow(row: unknown[]): boolean {
  const a = String(row[0] ?? "").trim().toLowerCase();
  const b = String(row[1] ?? "").trim().toLowerCase();
  return /ngày|ngay|date/.test(a) && /chấm công|cham cong|đi làm|di lam/.test(b);
}

function datesToAddUntilToday(last: DateParts | null, today: DateParts): string[] {
  const todayK = dateKey(today);
  const out: string[] = [];
  if (!last) {
    out.push(formatParts(today));
    return out;
  }
  let cursor = last;
  let cursorK = dateKey(cursor);
  while (cursorK < todayK) {
    cursor = addCalendarDay(cursor);
    cursorK = dateKey(cursor);
    out.push(formatParts(cursor));
  }
  return out;
}

function findLastDateInRows(rows: unknown[][]): DateParts | null {
  let last: DateParts | null = null;
  let lastKey = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (isChamCongHeaderRow(row)) continue;
    const p = parseVietnamDateCell(row[0]);
    if (!p) continue;
    const k = dateKey(p);
    if (k >= lastKey) {
      lastKey = k;
      last = p;
    }
  }
  return last;
}

function dateExistsInRows(rows: unknown[][], target: DateParts): boolean {
  const tk = dateKey(target);
  for (const row of rows) {
    if (isChamCongHeaderRow(row ?? [])) continue;
    const p = parseVietnamDateCell(row?.[0]);
    if (p && dateKey(p) === tk) return true;
  }
  return false;
}

function findInsertIndexForDate(rows: unknown[][], target: DateParts): number {
  const targetKey = dateKey(target);
  let insertAfter = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (isChamCongHeaderRow(row)) {
      insertAfter = i + 1;
      continue;
    }
    const p = parseVietnamDateCell(row[0]);
    if (!p) continue;
    if (dateKey(p) >= targetKey) return i;
    insertAfter = i + 1;
  }
  return insertAfter;
}

async function insertDateRowsAt(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  rows: unknown[][],
  insertAt: number,
  dateLabels: string[],
): Promise<void> {
  if (!dateLabels.length) return;
  const tables = await sheetsSpreadsheetTables(accessToken, spreadsheetId);
  const table = tables.find((t) => t.sheetTitle === tabName);
  if (table?.tableId) {
    for (const ngay of dateLabels) {
      await sheetsAppendTableRow(accessToken, spreadsheetId, table.tableId, [
        ngay,
        false,
        "",
        "",
        "",
        "",
      ]);
    }
    return;
  }

  const sheetId = table?.sheetId ?? (await sheetIdForTitle(accessToken, spreadsheetId, tabName));
  if (sheetId == null) return;

  const requests: unknown[] = [];
  for (let n = 0; n < dateLabels.length; n++) {
    const at = insertAt + n;
    requests.push({
      insertDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: at,
          endIndex: at + 1,
        },
        inheritFromBefore: at > 0,
      },
    });
  }
  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, requests);

  const valueRows = dateLabels.map((ngay) => [ngay, false, "", "", "", ""]);
  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [
    {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: insertAt,
          endRowIndex: insertAt + dateLabels.length,
          startColumnIndex: 0,
          endColumnIndex: DATA_COLS,
        },
        rows: valueRows.map((cells) => ({
          values: cells.map((v) => {
            if (typeof v === "boolean") return { userEnteredValue: { boolValue: v } };
            return { userEnteredValue: { stringValue: String(v) } };
          }),
        })),
        fields: "userEnteredValue",
      },
    },
  ]);
}

/** Đảm bảo một ngày cụ thể có dòng trên tab (chèn nếu thiếu). */
export async function ensureDateRowForTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  target: DateParts,
): Promise<boolean> {
  const q = quoteSheet(tabName);
  const batch = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!A1:F${MAX_SCAN_ROW}`]);
  const rows = batch[tabName] ?? [];
  if (dateExistsInRows(rows, target)) return false;

  const ngay = formatParts(target);
  const insertAt = findInsertIndexForDate(rows, target);
  await insertDateRowsAt(accessToken, spreadsheetId, tabName, rows, insertAt, [ngay]);
  return true;
}

/** Thêm dòng ngày vào Bảng chấm công (appendCells) hoặc chèn hàng + copy định dạng. */
export async function ensureTodayDateRowsForTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  unixSec?: number,
): Promise<number> {
  const q = quoteSheet(tabName);
  const batch = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!A1:F${MAX_SCAN_ROW}`]);
  const rows = batch[tabName] ?? [];
  const today = todayParts(unixSec);
  if (today.y <= 0) return 0;
  if (dateExistsInRows(rows, today)) return 0;

  const last = findLastDateInRows(rows);
  const toAdd = datesToAddUntilToday(last, today);
  if (!toAdd.length) return 0;

  let insertAfter = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const p = parseVietnamDateCell(rows[i]?.[0]);
    if (p) {
      insertAfter = i + 1;
      break;
    }
  }
  if (insertAfter <= 0) {
    for (let i = 0; i < rows.length; i++) {
      if (isChamCongHeaderRow(rows[i] ?? [])) {
        insertAfter = i + 1;
        break;
      }
    }
  }
  if (insertAfter <= 0) insertAfter = 1;

  await insertDateRowsAt(accessToken, spreadsheetId, tabName, rows, insertAfter, toAdd);
  return toAdd.length;
}

async function sheetIdForTitle(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<number | null> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title,sheetId))`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    sheets?: { properties?: { title?: string; sheetId?: number } }[];
  };
  for (const s of json.sheets ?? []) {
    if (s.properties?.title === title && s.properties.sheetId != null) {
      return s.properties.sheetId;
    }
  }
  return null;
}

/** Thêm dòng ngày mới cho mọi tab nhân viên (SUBEO gồm). */
export async function ensureTodayDateRowsAllTabs(
  accessToken: string,
  spreadsheetId: string,
  unixSec?: number,
  preloaded?: Map<string, unknown[][]>,
): Promise<{ tabs: number; rowsAdded: number }> {
  const titles = listChamCongEmployeeTabs(
    preloaded
      ? [...preloaded.keys()]
      : await sheetsListTabTitles(accessToken, spreadsheetId),
  );
  let rowsAdded = 0;
  for (const tab of titles) {
    if (isChamCongSystemTab(tab)) continue;
    try {
      const rows = preloaded?.get(tab);
      if (rows) {
        rowsAdded += await ensureTodayDateRowsForTabWithRows(
          accessToken,
          spreadsheetId,
          tab,
          rows,
          unixSec,
        );
      } else {
        rowsAdded += await ensureTodayDateRowsForTab(accessToken, spreadsheetId, tab, unixSec);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ChamCong] roll dates ${tab}: ${msg}`);
    }
  }
  return { tabs: titles.length, rowsAdded };
}

async function ensureTodayDateRowsForTabWithRows(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  rows: unknown[][],
  unixSec?: number,
): Promise<number> {
  const today = todayParts(unixSec);
  if (today.y <= 0) return 0;
  if (dateExistsInRows(rows, today)) return 0;

  const last = findLastDateInRows(rows);
  const toAdd = datesToAddUntilToday(last, today);
  if (!toAdd.length) return 0;

  let insertAfter = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const p = parseVietnamDateCell(rows[i]?.[0]);
    if (p) {
      insertAfter = i + 1;
      break;
    }
  }
  if (insertAfter <= 0) {
    for (let i = 0; i < rows.length; i++) {
      if (isChamCongHeaderRow(rows[i] ?? [])) {
        insertAfter = i + 1;
        break;
      }
    }
  }
  if (insertAfter <= 0) insertAfter = 1;

  await insertDateRowsAt(accessToken, spreadsheetId, tabName, rows, insertAfter, toAdd);
  return toAdd.length;
}
