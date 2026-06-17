import {
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
} from "./google";
import { flexibleDateToIso } from "./thuChiSheet";

export const CAU_HINH_TAB = "CAU_HINH";
const HEADER_ROW = ["Tab", "Ngày bắt đầu HH"];

export type CommissionStartByEmployee = Record<string, string>;

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function normTabKey(name: string): string {
  return name.trim().toLowerCase();
}

export function normalizeCommissionStartDate(raw: unknown): string {
  const iso = flexibleDateToIso(String(raw ?? "").trim());
  return iso.length >= 10 ? iso : "";
}

export function commissionStartForTab(
  map: CommissionStartByEmployee,
  tabName: string,
): string | null {
  const date = map[normTabKey(tabName)];
  return date || null;
}

export async function ensureCauHinhTab(accessToken: string, spreadsheetId: string): Promise<string> {
  const titles = await sheetsListTabTitles(accessToken, spreadsheetId);
  const existing = titles.find((t) => t.toLowerCase() === CAU_HINH_TAB.toLowerCase());
  if (existing) return existing;
  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [
    { addSheet: { properties: { title: CAU_HINH_TAB } } },
  ]);
  await sheetsPutValues(
    accessToken,
    spreadsheetId,
    `${quoteSheet(CAU_HINH_TAB)}!A1:B1`,
    [HEADER_ROW],
    "USER_ENTERED",
  );
  return CAU_HINH_TAB;
}

/** Đọc tab CAU_HINH: cột A = tên tab NV, cột B = ngày bắt đầu hưởng HH (yyyy-mm-dd). */
export async function loadCommissionStartByEmployee(
  accessToken: string,
  spreadsheetId: string,
): Promise<CommissionStartByEmployee> {
  const titles = await sheetsListTabTitles(accessToken, spreadsheetId);
  const tab = titles.find((t) => t.toLowerCase() === CAU_HINH_TAB.toLowerCase());
  if (!tab) return {};
  const part = await sheetsBatchGet(accessToken, spreadsheetId, [`${quoteSheet(tab)}!A2:B500`]);
  const rows = part[tab] ?? [];
  const out: CommissionStartByEmployee = {};
  for (const row of rows) {
    const name = String(row[0] ?? "").trim();
    const date = normalizeCommissionStartDate(row[1]);
    if (!name || !date) continue;
    out[normTabKey(name)] = date;
  }
  return out;
}

/** Ghi / cập nhật ngày bắt đầu HH cho một tab NV. dateIso rỗng = xóa cấu hình. */
export async function upsertCommissionStartDate(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  dateIso: string,
): Promise<void> {
  const name = tabName.trim();
  if (!name) throw new Error("Thiếu tên tab.");
  const tab = await ensureCauHinhTab(accessToken, spreadsheetId);
  const q = quoteSheet(tab);
  const part = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!A2:B500`]);
  const rows = part[tab] ?? [];
  const norm = normTabKey(name);
  const date = normalizeCommissionStartDate(dateIso);

  let targetRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (normTabKey(String(rows[i]?.[0] ?? "")) === norm) {
      targetRow = i + 2;
      break;
    }
  }

  if (!date) {
    if (targetRow > 0) {
      await sheetsPutValues(accessToken, spreadsheetId, `${q}!A${targetRow}:B${targetRow}`, [["", ""]], "USER_ENTERED");
    }
    return;
  }

  if (targetRow > 0) {
    await sheetsPutValues(
      accessToken,
      spreadsheetId,
      `${q}!A${targetRow}:B${targetRow}`,
      [[name, date]],
      "USER_ENTERED",
    );
    return;
  }

  const nextRow = Math.max(2, rows.length + 2);
  await sheetsPutValues(
    accessToken,
    spreadsheetId,
    `${q}!A${nextRow}:B${nextRow}`,
    [[name, date]],
    "USER_ENTERED",
  );
}

/** Map keyed by tab name (gốc) để trả API — giữ nguyên tên tab từ Sheet. */
export function commissionStartMapForTabs(
  map: CommissionStartByEmployee,
  tabNames: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tab of tabNames) {
    const date = commissionStartForTab(map, tab);
    if (date) out[tab] = date;
  }
  return out;
}
