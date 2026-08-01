import {
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
  sheetsSpreadsheetTables,
  sheetsValuesClear,
} from "./google";
import { num } from "./thuChiSheet";

export const CHAM_CONG_TEMPLATE_TAB = "SUBEO";
/** Tab mẫu cũ — không tính lương. */
const LEGACY_TEMPLATE_TABS = ["SU_BEO"];

const DEFAULT_TY_GIA_FORMULA = '=GOOGLEFINANCE("CURRENCY:USDVND")';
const MAX_ROW = 2000;

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function formatNgayVietnam(unixSec?: number): string {
  const d = unixSec != null ? new Date(unixSec * 1000) : new Date();
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

type SheetProps = {
  sheets?: { properties?: { title?: string; sheetId?: number; gridProperties?: { rowCount?: number } } }[];
};

async function getSheetMeta(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<{ sheetId: number; rowCount: number } | null> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`spreadsheets.get ${res.status}: ${await res.text()}`);
  const grid = (await res.json()) as SheetProps;
  for (const s of grid.sheets ?? []) {
    if (s.properties?.title === title && s.properties.sheetId != null) {
      return {
        sheetId: s.properties.sheetId,
        rowCount: s.properties.gridProperties?.rowCount ?? 2,
      };
    }
  }
  return null;
}

async function getSheetIdByTitle(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<number | null> {
  const meta = await getSheetMeta(accessToken, spreadsheetId, title);
  return meta?.sheetId ?? null;
}

/** Xóa Google Tables trên tab — tránh lỗi deleteDimension khi cắt hàng. */
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

/**
 * Xóa chữ ghi chú nhầm vào cột F (TỈ GIÁ) — vd. «Giữ nguyên ứng».
 * Giữ F2 (công thức tỉ giá) và ô số.
 */
export async function clearAccidentalNotesFromTyGiaColumn(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<number> {
  const q = quoteSheet(tabName);
  const formulaPart = await sheetsBatchGet(accessToken, spreadsheetId, [`${q}!F1:F${MAX_ROW}`], "FORMULA");
  const cells = formulaPart[tabName] ?? [];
  const clearTargets: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (i === 0) continue; // header
    if (i === 1) continue; // F2 tỉ giá
    const raw = cells[i]?.[0];
    if (raw == null || raw === "") continue;
    if (typeof raw === "number") continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (s.startsWith("=")) continue;
    if (/^[\d.,\s$₫usdVND-]+$/i.test(s)) continue;
    clearTargets.push(`${q}!F${i + 1}`);
  }
  for (const range of clearTargets) {
    await sheetsValuesClear(accessToken, spreadsheetId, range);
  }
  return clearTargets.length;
}

/** Giữ header (hàng 1) + 1 hàng dữ liệu — xóa phần thừa copy từ tab mẫu. */
async function trimChamCongSheetToTwoRows(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<void> {
  await deleteTablesOnTab(accessToken, spreadsheetId, tabName);
  const meta = await getSheetMeta(accessToken, spreadsheetId, tabName);
  if (!meta || meta.rowCount <= 2) return;
  try {
    await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [
      {
        deleteDimension: {
          range: {
            sheetId: meta.sheetId,
            dimension: "ROWS",
            startIndex: 2,
            endIndex: meta.rowCount,
          },
        },
      },
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ChamCong] trim rows ${tabName} failed, clear values: ${msg}`);
    await sheetsValuesClear(accessToken, spreadsheetId, `${quoteSheet(tabName)}!A3:F${MAX_ROW}`);
  }
}

/** Tab mẫu copy khi tạo tab NV mới (SUBEO vẫn tính lương như NV). */
export function isChamCongTemplateTab(title: string): boolean {
  return title.trim().toLowerCase() === CHAM_CONG_TEMPLATE_TAB.toLowerCase();
}

/** Tab hệ thống — không tính lương, không xóa. */
export function isChamCongSystemTab(title: string): boolean {
  const s = title.trim();
  if (!s) return true;
  const low = s.toLowerCase();
  if (LEGACY_TEMPLATE_TABS.some((t) => t.toLowerCase() === low)) return true;
  if (low === "sheet1" || low === "sheet 1") return true;
  if (/^tổng hợp$|^tong hop$/i.test(low)) return true;
  if (low === "cau_hinh" || low === "cấu hình") return true;
  if (low === "hh_loai_tru") return true;
  if (low === "luong_tt") return true;
  return false;
}

export function listChamCongEmployeeTabs(allTitles: string[]): string[] {
  return allTitles.filter((t) => !isChamCongSystemTab(t)).sort((a, b) => a.localeCompare(b, "vi"));
}

/** Đọc công thức hoặc giá trị ô F2 tab mẫu (ưu tiên công thức). */
async function readTemplateF2ForCopy(
  accessToken: string,
  spreadsheetId: string,
  templateTab: string,
): Promise<string> {
  const range = `${quoteSheet(templateTab)}!F2`;
  const formulaPart = await sheetsBatchGet(accessToken, spreadsheetId, [range], "FORMULA");
  const formulaCell = formulaPart[templateTab]?.[0]?.[0];
  if (typeof formulaCell === "string" && formulaCell.startsWith("=")) return formulaCell;

  const valuePart = await sheetsBatchGet(accessToken, spreadsheetId, [range]);
  const valueCell = valuePart[templateTab]?.[0]?.[0];
  if (typeof valueCell === "number" && valueCell > 0) return String(valueCell);
  if (
    typeof valueCell === "string" &&
    valueCell.trim() &&
    !/giữ nguyên|khấu trừ|đã tt/i.test(valueCell)
  ) {
    return valueCell;
  }

  return DEFAULT_TY_GIA_FORMULA;
}

/** Ghi F2 tab NV — copy công thức/giá trị từ tab mẫu SUBEO. */
async function copyTemplateF2ToTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  templateTab: string,
): Promise<void> {
  const f2 = await readTemplateF2ForCopy(accessToken, spreadsheetId, templateTab);
  await sheetsPutValues(
    accessToken,
    spreadsheetId,
    `${quoteSheet(tabName)}!F2`,
    [[f2]],
    "USER_ENTERED",
  );
}

/**
 * Tạo tab nhân viên — duplicate SUBEO (cấu trúc D/E…).
 * Xóa Table + cắt còn 2 hàng; F2 = công thức tỉ giá.
 */
export async function createChamCongEmployeeTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  templateTab: string = CHAM_CONG_TEMPLATE_TAB,
): Promise<void> {
  const name = tabName.trim();
  if (!name) throw new Error("Thiếu tên tab.");
  if (isChamCongTemplateTab(name)) {
    throw new Error(`Tab « ${name} » là tab mẫu — chọn tên khác.`);
  }
  if (isChamCongSystemTab(name)) {
    throw new Error(`Tên tab « ${name} » trùng tab hệ thống.`);
  }

  const titles = await sheetsListTabTitles(accessToken, spreadsheetId);
  if (titles.includes(name)) {
    throw new Error(`Tab « ${name} » đã tồn tại.`);
  }

  const sourceId = await getSheetIdByTitle(accessToken, spreadsheetId, templateTab);
  if (sourceId == null) {
    throw new Error(`Không tìm thấy tab mẫu « ${templateTab} ».`);
  }

  try {
    await clearAccidentalNotesFromTyGiaColumn(accessToken, spreadsheetId, templateTab);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ChamCong] clear F notes on ${templateTab}: ${msg}`);
  }

  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [
    { duplicateSheet: { sourceSheetId: sourceId, newSheetName: name } },
  ]);

  await trimChamCongSheetToTwoRows(accessToken, spreadsheetId, name);

  const q = quoteSheet(name);
  await sheetsValuesClear(accessToken, spreadsheetId, `${q}!A2:F2`);
  const today = formatNgayVietnam();
  await sheetsPutValues(accessToken, spreadsheetId, `${q}!A2:B2`, [[today, "FALSE"]], "USER_ENTERED");
  await copyTemplateF2ToTab(accessToken, spreadsheetId, name, templateTab);
}

export async function deleteChamCongEmployeeTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  _templateTab: string = CHAM_CONG_TEMPLATE_TAB,
): Promise<void> {
  const name = tabName.trim();
  if (!name) throw new Error("Thiếu tên tab.");
  if (isChamCongTemplateTab(name)) {
    throw new Error(`Không thể xóa tab mẫu « ${name} ».`);
  }
  if (isChamCongSystemTab(name)) {
    throw new Error(`Không thể xóa tab « ${name} ».`);
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`spreadsheets.get ${res.status}: ${await res.text()}`);
  const grid = (await res.json()) as SheetProps;
  const sheets = grid.sheets ?? [];
  if (sheets.length <= 1) throw new Error("Sheet chỉ còn một tab.");

  const target = sheets.find((s) => s.properties?.title === name);
  const sheetId = target?.properties?.sheetId;
  if (sheetId == null) throw new Error(`Không tìm thấy tab « ${name} ».`);

  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [{ deleteSheet: { sheetId } }]);
}

/** Đọc ô F2 tỉ giá từ tab (USD/VND). */
export async function readTyGiaF2(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
): Promise<number> {
  const part = await sheetsBatchGet(accessToken, spreadsheetId, [`${quoteSheet(tabName)}!F2`]);
  const row = part[tabName]?.[0];
  return num(row?.[0]);
}
