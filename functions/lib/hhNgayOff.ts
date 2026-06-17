import {
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
  sheetsValuesClear,
} from "./google";
import { flexibleDateToIso } from "./thuChiSheet";

export const HH_NGAY_OFF_TAB = "HH_NGAY_OFF";
const HEADER_ROW = ["Tab", "Ngày nghỉ/off"];
const MAX_ROW = 500;

export type HhNgayOffEntry = {
  tabName: string;
  ngay: string;
  ngayDisplay?: string;
};

/** normTab → danh sách ngày yyyy-mm-dd */
export type HhNgayOffByEmployee = Record<string, string[]>;

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function normTabKey(name: string): string {
  return name.trim().toLowerCase();
}

export function normalizeHhNgayOffDate(raw: unknown): string {
  const iso = flexibleDateToIso(String(raw ?? "").trim());
  return iso.length >= 10 ? iso.slice(0, 10) : "";
}

export function offDaysForTab(map: HhNgayOffByEmployee, tabName: string): string[] {
  return map[normTabKey(tabName)] ?? [];
}

export function normalizeHhNgayOffList(raw: unknown): HhNgayOffEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HhNgayOffEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const tabName = String((item as HhNgayOffEntry).tabName ?? "").trim();
    const ngay = normalizeHhNgayOffDate((item as HhNgayOffEntry).ngay);
    if (!tabName || !ngay) continue;
    const key = `${normTabKey(tabName)}|${ngay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry: HhNgayOffEntry = { tabName, ngay };
    const disp = String((item as HhNgayOffEntry).ngayDisplay ?? "").trim();
    if (disp) entry.ngayDisplay = disp;
    out.push(entry);
  }
  out.sort((a, b) => a.ngay.localeCompare(b.ngay) || a.tabName.localeCompare(b.tabName, "vi"));
  return out;
}

export function hhNgayOffMapFromRows(rows: unknown[][]): HhNgayOffByEmployee {
  const out: HhNgayOffByEmployee = {};
  const start =
    rows.length > 0 && String(rows[0]?.[0] ?? "").toLowerCase().includes("tab") ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const tabName = String(row[0] ?? "").trim();
    const ngay = normalizeHhNgayOffDate(row[1]);
    if (!tabName || !ngay) continue;
    const key = normTabKey(tabName);
    if (!out[key]) out[key] = [];
    if (!out[key].includes(ngay)) out[key].push(ngay);
  }
  for (const key of Object.keys(out)) {
    out[key].sort();
  }
  return out;
}

export function hhNgayOffListFromMap(
  map: HhNgayOffByEmployee,
  tabNames: string[],
): HhNgayOffEntry[] {
  const out: HhNgayOffEntry[] = [];
  const tabs = new Set(tabNames.map((t) => normTabKey(t)));
  for (const tab of tabNames) {
    for (const ngay of offDaysForTab(map, tab)) {
      out.push({ tabName: tab, ngay });
    }
  }
  for (const [norm, dates] of Object.entries(map)) {
    if (tabs.has(norm)) continue;
    const tabName = norm;
    for (const ngay of dates) out.push({ tabName, ngay });
  }
  return normalizeHhNgayOffList(out);
}

async function ensureHhNgayOffTab(accessToken: string, spreadsheetId: string): Promise<string> {
  const titles = await sheetsListTabTitles(accessToken, spreadsheetId);
  const existing = titles.find((t) => t.toLowerCase() === HH_NGAY_OFF_TAB.toLowerCase());
  if (existing) return existing;
  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [
    { addSheet: { properties: { title: HH_NGAY_OFF_TAB } } },
  ]);
  await sheetsPutValues(
    accessToken,
    spreadsheetId,
    `${quoteSheet(HH_NGAY_OFF_TAB)}!A1:B1`,
    [HEADER_ROW],
    "USER_ENTERED",
  );
  return HH_NGAY_OFF_TAB;
}

export async function loadHhNgayOffList(
  accessToken: string,
  spreadsheetId: string,
): Promise<HhNgayOffEntry[]> {
  const titles = await sheetsListTabTitles(accessToken, spreadsheetId);
  const tab = titles.find((t) => t.toLowerCase() === HH_NGAY_OFF_TAB.toLowerCase());
  if (!tab) return [];
  const part = await sheetsBatchGet(accessToken, spreadsheetId, [
    `${quoteSheet(tab)}!A1:B${MAX_ROW}`,
  ]);
  const rows = part[tab] ?? [];
  const map = hhNgayOffMapFromRows(rows);
  const list: HhNgayOffEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const tabName = String(row[0] ?? "").trim();
    const ngay = normalizeHhNgayOffDate(row[1]);
    if (!tabName || !ngay) continue;
    if (i === 0 && tabName.toLowerCase().includes("tab")) continue;
    list.push({ tabName, ngay });
  }
  if (list.length) return normalizeHhNgayOffList(list);
  return hhNgayOffListFromMap(map, []);
}

/** Ghi đè toàn bộ danh sách ngày nghỉ/off. */
export async function saveHhNgayOffList(
  accessToken: string,
  spreadsheetId: string,
  entries: HhNgayOffEntry[],
): Promise<void> {
  const tab = await ensureHhNgayOffTab(accessToken, spreadsheetId);
  const q = quoteSheet(tab);
  const normalized = normalizeHhNgayOffList(entries);
  const values = [HEADER_ROW, ...normalized.map((e) => [e.tabName, e.ngay])];
  await sheetsPutValues(
    accessToken,
    spreadsheetId,
    `${q}!A1:B${Math.max(values.length, 2)}`,
    values,
    "USER_ENTERED",
  );
  if (values.length < MAX_ROW) {
    await sheetsValuesClear(
      accessToken,
      spreadsheetId,
      `${q}!A${values.length + 1}:B${MAX_ROW}`,
    );
  }
}
