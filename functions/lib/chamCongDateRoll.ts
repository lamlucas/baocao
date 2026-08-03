import {
  isChamCongSystemTab,
  listChamCongEmployeeTabs,
  formatNgayVietnam,
} from "./chamCongSheet";
import {
  sheetsAppendTableRow,
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
  sheetsSpreadsheetTables,
  sheetsValuesAppend,
  sheetsValuesClear,
} from "./google";

const MAX_SCAN_ROW = 500;
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
  // Giới hạn 62 ngày — tránh vòng lặp nếu parse ngày lỗi
  let guard = 0;
  while (cursorK < todayK && guard < 62) {
    cursor = addCalendarDay(cursor);
    cursorK = dateKey(cursor);
    out.push(formatParts(cursor));
    guard++;
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

function cellHasValue(cell: unknown): boolean {
  return cell !== "" && cell != null && cell !== false;
}

function mergeChamCongDateRow(existing: unknown[], incoming: unknown[]): unknown[] {
  const pick = (a: unknown, b: unknown): unknown => {
    if (typeof b === "number" && Number.isFinite(b) && b !== 0) return b;
    if (typeof a === "number" && Number.isFinite(a) && a !== 0) return a;
    const bs = String(b ?? "").trim();
    if (bs) return b;
    const as = String(a ?? "").trim();
    if (as) return a;
    return b ?? a;
  };
  return [
    incoming[0] ?? existing[0],
    incoming[1] === true || existing[1] === true,
    pick(existing[2], incoming[2]),
    pick(existing[3], incoming[3]),
    pick(existing[4], incoming[4]),
    pick(existing[5], incoming[5]),
  ];
}

function countParseableDateRows(rows: unknown[][]): number {
  let n = 0;
  const dataStart = firstDataRowIndex(rows);
  for (let i = dataStart; i < rows.length; i++) {
    if (parseVietnamDateCell(rows[i]?.[0])) n++;
  }
  return n;
}

function hasDuplicateOrGapDateRows(rows: unknown[][]): boolean {
  const dataStart = firstDataRowIndex(rows);
  const seen = new Set<number>();
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const p = parseVietnamDateCell(row[0]);
    if (!p) {
      if (row.some((c) => cellHasValue(c))) return true;
      continue;
    }
    const k = dateKey(p);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

function filterNewDateLabels(rows: unknown[][], dateLabels: string[]): string[] {
  return dateLabels.filter((ngay) => {
    const p = parseVietnamDateCell(ngay);
    return p != null && !dateExistsInRows(rows, p);
  });
}

async function loadTabRows(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<unknown[][]> {
  const q = quoteSheet(tabName);
  const batch = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!A1:F${MAX_SCAN_ROW}`]);
  return batch[tabName] ?? [];
}

function collectDateDataRows(rows: unknown[][]): {
  dataStart: number;
  firstDateIdx: number;
  dateRows: unknown[][];
} {
  const dataStart = firstDataRowIndex(rows);
  const byKey = new Map<number, unknown[]>();
  let firstDateIdx = -1;
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const p = parseVietnamDateCell(row[0]);
    if (!p) continue;
    if (firstDateIdx < 0) firstDateIdx = i;
    const k = dateKey(p);
    const formatted: unknown[] = [
      formatParts(p),
      row[1] ?? false,
      row[2] ?? "",
      row[3] ?? "",
      row[4] ?? "",
      "",
    ];
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeChamCongDateRow(prev, formatted) : formatted);
  }
  const dateRows = [...byKey.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, r]) => r);
  if (dateRows.length > 0 && firstDateIdx < 0) firstDateIdx = dataStart;
  return { dataStart, firstDateIdx, dateRows };
}

function findLastNonemptyRowIndex(rows: unknown[][]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] ?? [];
    if (row.some((c) => c !== "" && c != null && c !== false)) return i;
  }
  return 0;
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

async function deleteTablesOnTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<void> {
  const tables = await sheetsSpreadsheetTables(accessToken, spreadsheetId);
  const onTab = tables.filter((t) => t.sheetTitle === tabName);
  if (!onTab.length) return;
  await sheetsSpreadsheetBatchUpdate(
    accessToken,
    spreadsheetId,
    onTab.map((t) => ({ deleteTable: { tableId: t.tableId } })),
  );
}

async function findTableOnTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<{ tableId: string; sheetId: number } | null> {
  const tables = await sheetsSpreadsheetTables(accessToken, spreadsheetId);
  const t = tables.find((x) => x.sheetTitle === tabName);
  if (!t?.tableId || t.sheetId == null) return null;
  return { tableId: t.tableId, sheetId: t.sheetId };
}

/**
 * Gom các dòng ngày lên sát header (hàng 2).
 * Nếu có Google Table thì xóa Table trước (không thể cắt/chèn hàng trong Table).
 */
export async function compactChamCongDateRowsToTop(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<boolean> {
  const q = quoteSheet(tabName);
  const rows = await loadTabRows(accessToken, spreadsheetId, tabName);
  const { dataStart, firstDateIdx, dateRows } = collectDateDataRows(rows);
  if (firstDateIdx < 0) return false;
  const rawDateCount = countParseableDateRows(rows);
  const needsDedupe = rawDateCount > dateRows.length || hasDuplicateOrGapDateRows(rows);
  const needsCompact = firstDateIdx > dataStart;
  if (!needsDedupe && !needsCompact) return false;

  const sheetId = await sheetIdForTitle(accessToken, spreadsheetId, tabName);
  if (sheetId == null) return false;

  try {
    await deleteTablesOnTab(accessToken, spreadsheetId, tabName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ChamCong] delete table before compact ${tabName}: ${msg}`);
  }

  // Giữ F2: chỉ clear A:E rồi ghi lại A:E; F giữ nguyên
  await sheetsValuesClear(accessToken, spreadsheetId, `${q}!A${dataStart + 1}:E${MAX_SCAN_ROW}`);
  if (dateRows.length > 0) {
    const aeOnly = dateRows.map((r) => r.slice(0, 5));
    await sheetsPutValues(
      accessToken,
      spreadsheetId,
      `${q}!A${dataStart + 1}`,
      aeOnly,
      "USER_ENTERED",
    );
  }

  const oldLast = findLastNonemptyRowIndex(rows);
  const newLast = dataStart + dateRows.length - 1;
  if (oldLast > newLast) {
    try {
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[ChamCong] compact delete rows ${tabName}: ${msg}`);
    }
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

/**
 * Thêm dòng ngày:
 * - Có Google Table → appendCells (đúng cho SUBEO)
 * - Không Table → insertDimension sau dòng ngày cuối
 */
async function insertDateRowsAt(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  insertAt: number,
  dateLabels: string[],
): Promise<void> {
  if (!dateLabels.length) return;
  const q = quoteSheet(tabName);

  const table = await findTableOnTab(accessToken, spreadsheetId, tabName);
  if (table?.tableId) {
    try {
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[ChamCong] table append ${tabName} failed, fallback insert: ${msg}`);
    }
  }

  const sheetId = table?.sheetId ?? (await sheetIdForTitle(accessToken, spreadsheetId, tabName));
  if (sheetId == null) {
    for (const ngay of dateLabels) {
      await sheetsValuesAppend(
        accessToken,
        spreadsheetId,
        `${q}!A:F`,
        [[ngay, false, "", "", "", ""]],
        "USER_ENTERED",
      );
    }
    return;
  }

  try {
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ChamCong] insertDimension ${tabName} failed, values.append: ${msg}`);
    for (const ngay of dateLabels) {
      await sheetsValuesAppend(
        accessToken,
        spreadsheetId,
        `${q}!A:F`,
        [[ngay, false, "", "", "", ""]],
        "USER_ENTERED",
      );
    }
  }
}

/** Sửa tab chấm công: gom ngày lên đầu, xóa trùng / dòng trống lẻ. */
export async function repairChamCongDateRowsForTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<boolean> {
  return compactChamCongDateRowsToTop(accessToken, spreadsheetId, tabName);
}

/** Đảm bảo một ngày cụ thể có dòng trên tab (chèn nếu thiếu). */
export async function ensureDateRowForTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  target: DateParts,
): Promise<boolean> {
  await compactChamCongDateRowsToTop(accessToken, spreadsheetId, tabName);
  const rows = await loadTabRows(accessToken, spreadsheetId, tabName);
  if (dateExistsInRows(rows, target)) return false;

  const ngay = formatParts(target);
  const toAdd = filterNewDateLabels(rows, [ngay]);
  if (!toAdd.length) return false;
  const insertAt = findInsertIndexForNewDates(rows);
  await insertDateRowsAt(accessToken, spreadsheetId, tabName, insertAt, toAdd);
  return true;
}

/** Thêm dòng ngày tới hôm nay (SUBEO + tab NV). */
export async function ensureTodayDateRowsForTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  unixSec?: number,
  preloadedRows?: unknown[][],
): Promise<number> {
  const today = todayParts(unixSec);
  if (today.y <= 0) return 0;

  let rows = preloadedRows;
  const preHasToday = rows ? dateExistsInRows(rows, today) : false;
  const preNeedsRepair = rows ? hasDuplicateOrGapDateRows(rows) : false;

  if (!rows || preNeedsRepair) {
    try {
      await compactChamCongDateRowsToTop(accessToken, spreadsheetId, tabName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[ChamCong] compact ${tabName}: ${msg}`);
    }
    rows = await loadTabRows(accessToken, spreadsheetId, tabName);
  } else {
    const { firstDateIdx, dataStart } = collectDateDataRows(rows);
    if (firstDateIdx >= 0 && firstDateIdx > dataStart) {
      try {
        await compactChamCongDateRowsToTop(accessToken, spreadsheetId, tabName);
        rows = await loadTabRows(accessToken, spreadsheetId, tabName);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[ChamCong] compact ${tabName}: ${msg}`);
      }
    }
  }

  if (dateExistsInRows(rows, today)) return 0;

  // Preload có thể cũ — đọc lại trước khi chèn để tránh ngày trùng (Set, SUBEO…)
  if (preloadedRows && !preHasToday) {
    rows = await loadTabRows(accessToken, spreadsheetId, tabName);
    if (dateExistsInRows(rows, today)) return 0;
  }

  const last = findLastDateInRows(rows);
  const toAdd = filterNewDateLabels(rows, datesToAddUntilToday(last, today));
  if (!toAdd.length) return 0;

  const insertAt = findInsertIndexForNewDates(rows);
  await insertDateRowsAt(accessToken, spreadsheetId, tabName, insertAt, toAdd);
  return toAdd.length;
}

/** Thêm dòng ngày mới cho mọi tab nhân viên (SUBEO gồm). */
export async function ensureTodayDateRowsAllTabs(
  accessToken: string,
  spreadsheetId: string,
  unixSec?: number,
  preloaded?: Map<string, unknown[][]>,
): Promise<{ tabs: number; rowsAdded: number }> {
  const titles = listChamCongEmployeeTabs(
    preloaded && preloaded.size > 0
      ? [...preloaded.keys()]
      : await sheetsListTabTitles(accessToken, spreadsheetId),
  );
  let rowsAdded = 0;
  for (const tab of titles) {
    if (isChamCongSystemTab(tab)) continue;
    try {
      rowsAdded += await ensureTodayDateRowsForTab(
        accessToken,
        spreadsheetId,
        tab,
        unixSec,
        preloaded?.get(tab),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ChamCong] roll dates ${tab}: ${msg}`);
    }
  }
  return { tabs: titles.length, rowsAdded };
}
