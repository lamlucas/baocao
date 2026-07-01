import {
  isChamCongSystemTab,
  listChamCongEmployeeTabs,
  formatNgayVietnam,
} from "./chamCongSheet";
import {
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
  sheetsValuesClear,
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

function headerRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    if (isChamCongHeaderRow(rows[i] ?? [])) return i;
  }
  return 0;
}

/** Dòng dữ liệu đầu tiên (0-based) — ngay sau header, thường là hàng 2 sheet. */
function firstDataRowIndex(rows: unknown[][]): number {
  return headerRowIndex(rows) + 1;
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

function collectDateDataRows(rows: unknown[][]): {
  dataStart: number;
  firstDateIdx: number;
  dateRows: unknown[][];
} {
  const dataStart = firstDataRowIndex(rows);
  const dateRows: unknown[][] = [];
  let firstDateIdx = -1;
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const p = parseVietnamDateCell(row[0]);
    if (!p) continue;
    if (firstDateIdx < 0) firstDateIdx = i;
    dateRows.push([
      formatParts(p),
      row[1] ?? false,
      row[2] ?? "",
      row[3] ?? "",
      row[4] ?? "",
      row[5] ?? "",
    ]);
  }
  return { dataStart, firstDateIdx, dateRows };
}

function findLastNonemptyRowIndex(rows: unknown[][]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] ?? [];
    if (row.some((c) => c !== "" && c != null && c !== false)) return i;
  }
  return 0;
}

/**
 * Gom các dòng ngày lên sát header (bắt đầu hàng 2) — sửa tab bị trống phía trên.
 */
export async function compactChamCongDateRowsToTop(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<boolean> {
  const q = quoteSheet(tabName);
  const batch = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!A1:F${MAX_SCAN_ROW}`]);
  const rows = batch[tabName] ?? [];
  const { dataStart, firstDateIdx, dateRows } = collectDateDataRows(rows);
  if (firstDateIdx < 0) return false;
  if (firstDateIdx === dataStart) return false;

  const sheetId = await sheetIdForTitle(accessToken, spreadsheetId, tabName);
  if (sheetId == null) return false;

  await sheetsValuesClear(accessToken, spreadsheetId, `${q}!A${dataStart + 1}:F${MAX_SCAN_ROW}`);
  if (dateRows.length > 0) {
    await sheetsPutValues(
      accessToken,
      spreadsheetId,
      `${q}!A${dataStart + 1}`,
      dateRows,
      "USER_ENTERED",
    );
  }

  const oldLast = findLastNonemptyRowIndex(rows);
  const newLast = dataStart + dateRows.length - 1;
  if (oldLast > newLast) {
    await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [
      {
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: newLast + 1,
            endIndex: oldLast + 1,
          },
        },
      },
    ]);
  }
  return true;
}

function findInsertIndexForNewDates(rows: unknown[][]): number {
  const dataStart = firstDataRowIndex(rows);
  let lastDateIdx = -1;
  for (let i = dataStart; i < rows.length; i++) {
    const p = parseVietnamDateCell(rows[i]?.[0]);
    if (p) lastDateIdx = i;
  }
  if (lastDateIdx >= dataStart) return lastDateIdx + 1;
  return dataStart;
}

async function insertDateRowsAt(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  insertAt: number,
  dateLabels: string[],
): Promise<void> {
  if (!dateLabels.length) return;
  const sheetId = await sheetIdForTitle(accessToken, spreadsheetId, tabName);
  if (sheetId == null) {
    throw new Error(`Không tìm thấy sheetId tab «${tabName}».`);
  }

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
  await compactChamCongDateRowsToTop(accessToken, spreadsheetId, tabName);
  const q = quoteSheet(tabName);
  const batch = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!A1:F${MAX_SCAN_ROW}`]);
  const rows = batch[tabName] ?? [];
  if (dateExistsInRows(rows, target)) return false;

  const ngay = formatParts(target);
  const insertAt = findInsertIndexForNewDates(rows);
  await insertDateRowsAt(accessToken, spreadsheetId, tabName, insertAt, [ngay]);
  return true;
}

/** Thêm dòng ngày — luôn chèn sát header (hàng 2), không append cuối Table. */
export async function ensureTodayDateRowsForTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  unixSec?: number,
): Promise<number> {
  await compactChamCongDateRowsToTop(accessToken, spreadsheetId, tabName);

  const q = quoteSheet(tabName);
  const batch = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!A1:F${MAX_SCAN_ROW}`]);
  const rows = batch[tabName] ?? [];
  const today = todayParts(unixSec);
  if (today.y <= 0) return 0;
  if (dateExistsInRows(rows, today)) return 0;

  const last = findLastDateInRows(rows);
  const toAdd = datesToAddUntilToday(last, today);
  if (!toAdd.length) return 0;

  const insertAt = findInsertIndexForNewDates(rows);
  await insertDateRowsAt(accessToken, spreadsheetId, tabName, insertAt, toAdd);
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
  _preloaded?: Map<string, unknown[][]>,
): Promise<{ tabs: number; rowsAdded: number }> {
  const titles = listChamCongEmployeeTabs(
    await sheetsListTabTitles(accessToken, spreadsheetId),
  );
  let rowsAdded = 0;
  for (const tab of titles) {
    if (isChamCongSystemTab(tab)) continue;
    try {
      rowsAdded += await ensureTodayDateRowsForTab(accessToken, spreadsheetId, tab, unixSec);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ChamCong] roll dates ${tab}: ${msg}`);
    }
  }
  return { tabs: titles.length, rowsAdded };
}
