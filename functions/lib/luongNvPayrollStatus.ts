import {
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
  sheetsSpreadsheetTables,
  sheetsValuesAppend,
  sheetsValuesClear,
} from "./google";
import { flexibleDateToIso, num } from "./thuChiSheet";

export const LUONG_TT_TAB = "LUONG_TT";
const HEADER = ["Tháng lương", "Tab NV", "Đã TT", "Đã khấu trừ ứng", "Ứng còn", "Ghi chú"];

export type LuongPayrollStatusRow = {
  month: string;
  tabName: string;
  paid: boolean;
  advanceDeducted: boolean;
  carryRemainingUsd: number;
  note: string;
};

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function normTab(name: string): string {
  return name.trim().toLowerCase();
}

function isHeaderRow(row: unknown[]): boolean {
  const a = String(row[0] ?? "").toLowerCase();
  return a.includes("tháng") || a.includes("thang");
}

function parseBool(cell: unknown): boolean {
  if (cell === true) return true;
  const s = String(cell ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "x" || s === "✓" || s === "có" || s === "co" || s === "yes";
}

/** Tab NV hợp lệ — loại bỏ FALSE/checkbox và dòng chấm công lẫn vào LUONG_TT. */
export function isValidPayrollTabName(tabName: unknown): boolean {
  if (tabName === true || tabName === false) return false;
  const s = String(tabName ?? "").trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (low === "false" || low === "true") return false;
  if (/^tab nv$/i.test(s)) return false;
  return true;
}

function isCorruptLuongTtDataRow(row: unknown[]): boolean {
  if (!Array.isArray(row)) return true;
  const monthRaw = row[0];
  const monthStr = String(monthRaw ?? "").trim();
  const tabRaw = row[1];
  const iso = flexibleDateToIso(monthStr);
  if (iso.length >= 10 && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return true;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(monthStr)) return true;
  if (tabRaw === false || tabRaw === true) return true;
  if (String(tabRaw).trim().toLowerCase() === "false") return true;
  if (!isValidPayrollTabName(tabRaw)) return true;
  if (!/^\d{4}-\d{2}$/.test(monthStr.slice(0, 7))) return true;
  return false;
}

function rowToPayrollStatus(row: unknown[]): LuongPayrollStatusRow | null {
  const month = String(row[0] ?? "").trim().slice(0, 7);
  const tabName = String(row[1] ?? "").trim();
  if (!month || !isValidPayrollTabName(tabName)) return null;
  return {
    month,
    tabName,
    paid: parseBool(row[2]),
    advanceDeducted: parseBool(row[3]),
    carryRemainingUsd: num(row[4]),
    note: String(row[5] ?? "").trim(),
  };
}

async function deleteTablesOnLuongTtTab(
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

export function payrollStatusMapFromRows(rows: unknown[][]): Record<string, LuongPayrollStatusRow> {
  const out: Record<string, LuongPayrollStatusRow> = {};
  const start = rows.length > 0 && isHeaderRow(rows[0] ?? []) ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const parsed = rowToPayrollStatus(row);
    if (!parsed) continue;
    const key = `${parsed.month}|${normTab(parsed.tabName)}`;
    out[key] = parsed;
  }
  return out;
}

export function payrollStatusFor(
  map: Record<string, LuongPayrollStatusRow>,
  monthIso: string,
  tabName: string,
): LuongPayrollStatusRow | null {
  return map[`${monthIso}|${normTab(tabName)}`] ?? null;
}

async function ensureLuongTtTab(accessToken: string, spreadsheetId: string): Promise<string> {
  const titles = await sheetsListTabTitles(accessToken, spreadsheetId);
  const existing = titles.find((t) => t.toLowerCase() === LUONG_TT_TAB.toLowerCase());
  if (existing) {
    try {
      await deleteTablesOnLuongTtTab(accessToken, spreadsheetId, existing);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[LUONG_TT] delete table: ${msg}`);
    }
    return existing;
  }
  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [
    { addSheet: { properties: { title: LUONG_TT_TAB } } },
  ]);
  await sheetsPutValues(
    accessToken,
    spreadsheetId,
    `${quoteSheet(LUONG_TT_TAB)}!A1:F1`,
    [HEADER],
    "USER_ENTERED",
  );
  return LUONG_TT_TAB;
}

async function loadLuongTtRows(accessToken: string, spreadsheetId: string): Promise<unknown[][]> {
  const titles = await sheetsListTabTitles(accessToken, spreadsheetId);
  const tab = titles.find((t) => t.toLowerCase() === LUONG_TT_TAB.toLowerCase());
  if (!tab) return [];
  const part = await sheetsBatchGet(accessToken, spreadsheetId, [`${quoteSheet(tab)}!A1:F500`]);
  return part[tab] ?? [];
}

async function upsertLuongTtRow(
  accessToken: string,
  spreadsheetId: string,
  row: LuongPayrollStatusRow,
): Promise<void> {
  const tab = await ensureLuongTtTab(accessToken, spreadsheetId);
  const q = quoteSheet(tab);
  const rows = await loadLuongTtRows(accessToken, spreadsheetId);
  const start = rows.length > 0 && isHeaderRow(rows[0] ?? []) ? 1 : 0;
  let targetRow = -1;
  for (let i = start; i < rows.length; i++) {
    const m = String(rows[i]?.[0] ?? "").trim().slice(0, 7);
    const t = normTab(String(rows[i]?.[1] ?? ""));
    if (m === row.month && t === normTab(row.tabName)) {
      targetRow = i + 1;
      break;
    }
  }
  const values = [
    row.month,
    row.tabName,
    row.paid ? "TRUE" : "",
    row.advanceDeducted ? "TRUE" : "",
    row.carryRemainingUsd > 0.009 ? row.carryRemainingUsd : "",
    row.note || "",
  ];
  if (targetRow > 0) {
    await sheetsPutValues(accessToken, spreadsheetId, `${q}!A${targetRow}:F${targetRow}`, [values], "USER_ENTERED");
    return;
  }
  await sheetsValuesAppend(accessToken, spreadsheetId, `${q}!A:F`, [values], "USER_ENTERED");
}

/**
 * Xóa dòng lỗi trên LUONG_TT (Tab NV = FALSE, dòng chấm công nhầm tab, v.v.).
 * Trả về số dòng đã xóa.
 */
export async function repairLuongTtTab(
  accessToken: string,
  spreadsheetId: string,
): Promise<number> {
  const titles = await sheetsListTabTitles(accessToken, spreadsheetId);
  const tab = titles.find((t) => t.toLowerCase() === LUONG_TT_TAB.toLowerCase());
  if (!tab) return 0;

  await deleteTablesOnLuongTtTab(accessToken, spreadsheetId, tab);

  const q = quoteSheet(tab);
  const part = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!A1:F500`]);
  const rows = part[tab] ?? [];
  if (rows.length <= 1) return 0;

  const hasHeader = rows.length > 0 && isHeaderRow(rows[0] ?? []);
  const headerRow: string[] = hasHeader
    ? (rows[0] ?? []).map((c) => String(c ?? ""))
    : [...HEADER];
  const start = hasHeader ? 1 : 0;
  const validBody: (string | number)[][] = [];
  let removed = 0;

  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (isCorruptLuongTtDataRow(row)) {
      removed++;
      continue;
    }
    const parsed = rowToPayrollStatus(row);
    if (!parsed) {
      removed++;
      continue;
    }
    validBody.push([
      parsed.month,
      parsed.tabName,
      parsed.paid ? "TRUE" : "",
      parsed.advanceDeducted ? "TRUE" : "",
      parsed.carryRemainingUsd > 0.009 ? parsed.carryRemainingUsd : "",
      parsed.note || "",
    ]);
  }

  if (removed <= 0) return 0;

  await sheetsPutValues(accessToken, spreadsheetId, `${q}!A1:F1`, [headerRow], "USER_ENTERED");
  if (validBody.length > 0) {
    await sheetsPutValues(accessToken, spreadsheetId, `${q}!A2:F${validBody.length + 1}`, validBody, "USER_ENTERED");
  }
  await sheetsValuesClear(accessToken, spreadsheetId, `${q}!A${validBody.length + 2}:F500`);
  return removed;
}

/**
 * Ghi nhận thanh toán lương qua Telegram Chi/Lương — không đụng cột C tab NV.
 */
export async function recordLuongChiPayment(
  accessToken: string,
  spreadsheetIdChamCong: string,
  monthIso: string,
  tabName: string,
  amountUsd: number,
  payDateIso: string,
  existingMap: Record<string, LuongPayrollStatusRow>,
  carryRemainingUsd = 0,
): Promise<LuongPayrollStatusRow> {
  const prev = payrollStatusFor(existingMap, monthIso, tabName);
  const [y, mo, d] = payDateIso.slice(0, 10).split("-");
  const ngayVn = d && mo && y ? `${d}/${mo}/${y}` : payDateIso;
  const note = `Chi ${amountUsd.toFixed(2)} USD — TT lương ${monthIso} ngày ${ngayVn}`;
  const row: LuongPayrollStatusRow = {
    month: monthIso,
    tabName,
    paid: true,
    advanceDeducted: prev?.advanceDeducted ?? false,
    carryRemainingUsd: prev?.carryRemainingUsd ?? carryRemainingUsd,
    note,
  };
  await upsertLuongTtRow(accessToken, spreadsheetIdChamCong, row);
  return row;
}

function isChamCongHeaderRow(row: unknown[]): boolean {
  const a = String(row[0] ?? "").trim().toLowerCase();
  const b = String(row[1] ?? "").trim().toLowerCase();
  return /ngày|ngay|date/.test(a) && /chấm công|cham cong|đi làm|di lam/.test(b);
}

export function findRowIndexForMonthDay(
  rows: unknown[][],
  monthIso: string,
  day: number,
): number | null {
  const start = rows.length > 0 && isChamCongHeaderRow(rows[0]) ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const iso = flexibleDateToIso(String(rows[i]?.[0] ?? ""));
    if (iso.length < 10 || iso.slice(0, 7) !== monthIso) continue;
    if (Number(iso.slice(8, 10)) === day) return i;
  }
  return null;
}

export async function loadPayrollStatusMap(
  accessToken: string,
  spreadsheetId: string,
): Promise<Record<string, LuongPayrollStatusRow>> {
  try {
    await repairLuongTtTab(accessToken, spreadsheetId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[LUONG_TT] repair skipped: ${msg}`);
  }
  const rows = await loadLuongTtRows(accessToken, spreadsheetId);
  return payrollStatusMapFromRows(rows);
}

async function writeAdvanceToFirstDay(
  accessToken: string,
  spreadsheetIdChamCong: string,
  tabName: string,
  attendanceRows: unknown[][],
  todayIso: string,
  amountUsd: number,
): Promise<void> {
  const currentMonth = todayIso.slice(0, 7);
  const rowIdx = findRowIndexForMonthDay(attendanceRows, currentMonth, 1);
  if (rowIdx == null) {
    throw new Error(
      `Chưa có dòng ngày 01/${currentMonth.slice(5, 7)}/${currentMonth.slice(0, 4)} trên tab «${tabName}».`,
    );
  }
  const sheetRow = rowIdx + 1;
  const newCUsd = amountUsd > 0.009 ? amountUsd : 0;
  // Chỉ ghi cột C (tiền ứng). Không ghi cột F — F là TỈ GIÁ; ghi chú lưu tab LUONG_TT.
  await sheetsPutValues(
    accessToken,
    spreadsheetIdChamCong,
    `${quoteSheet(tabName)}!C${sheetRow}`,
    [[newCUsd]],
    "RAW",
  );
}

/**
 * Đánh dấu đã thanh toán — không khấu trừ ứng; ghi nguyên tiền ứng sang cột C ngày 01 tháng mới.
 */
export async function markSalaryPaid(
  accessToken: string,
  spreadsheetIdChamCong: string,
  monthIso: string,
  tabName: string,
  tienUngCu: number,
  attendanceRows: unknown[][],
  todayIso: string,
  existingMap: Record<string, LuongPayrollStatusRow>,
): Promise<LuongPayrollStatusRow> {
  const prev = payrollStatusFor(existingMap, monthIso, tabName);
  const carryUsd = Math.max(0, tienUngCu);
  const note =
    carryUsd > 0.009
      ? `Giữ nguyên ứng ${carryUsd.toFixed(2)} USD — đã TT lương ${monthIso}`
      : `Đã TT lương ${monthIso} — không có tiền ứng`;

  if (carryUsd > 0.009) {
    await writeAdvanceToFirstDay(
      accessToken,
      spreadsheetIdChamCong,
      tabName,
      attendanceRows,
      todayIso,
      carryUsd,
    );
  }

  const row: LuongPayrollStatusRow = {
    month: monthIso,
    tabName,
    paid: true,
    advanceDeducted: false,
    carryRemainingUsd: carryUsd,
    note,
  };
  await upsertLuongTtRow(accessToken, spreadsheetIdChamCong, row);
  return row;
}

/**
 * Khấu trừ tiền ứng: ứng mới = ứng cũ − tổng lương.
 * Ghi cột C ngày 01 tháng hiện tại trên tab NV (ghi chú lưu LUONG_TT).
 */
export async function deductAdvanceForEmployee(
  accessToken: string,
  spreadsheetIdChamCong: string,
  payrollMonthIso: string,
  tabName: string,
  tienUngCu: number,
  tongLuongUsd: number,
  attendanceRows: unknown[][],
  todayIso: string,
  existingMap: Record<string, LuongPayrollStatusRow>,
): Promise<{ carryRemainingUsd: number; row: LuongPayrollStatusRow }> {
  const carryRemainingUsd = Math.max(0, tienUngCu - tongLuongUsd);
  const note =
    carryRemainingUsd > 0.009
      ? `Ứng còn ${carryRemainingUsd.toFixed(2)} USD (sau khấu trừ lương ${payrollMonthIso})`
      : `Đã khấu trừ hết ứng — lương ${payrollMonthIso}`;

  await writeAdvanceToFirstDay(
    accessToken,
    spreadsheetIdChamCong,
    tabName,
    attendanceRows,
    todayIso,
    carryRemainingUsd > 0.009 ? carryRemainingUsd : 0,
  );

  const prev = payrollStatusFor(existingMap, payrollMonthIso, tabName);
  const statusRow: LuongPayrollStatusRow = {
    month: payrollMonthIso,
    tabName,
    paid: prev?.paid ?? false,
    advanceDeducted: true,
    carryRemainingUsd,
    note,
  };
  await upsertLuongTtRow(accessToken, spreadsheetIdChamCong, statusRow);
  return { carryRemainingUsd, row: statusRow };
}
