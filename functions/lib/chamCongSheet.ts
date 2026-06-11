import {
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
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

type SheetProps = { sheets?: { properties?: { title?: string; sheetId?: number } }[] };

async function getSheetIdByTitle(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<number | null> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`spreadsheets.get ${res.status}: ${await res.text()}`);
  const grid = (await res.json()) as SheetProps;
  for (const s of grid.sheets ?? []) {
    if (s.properties?.title === title && s.properties.sheetId != null) {
      return s.properties.sheetId;
    }
  }
  return null;
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
  if (valueCell !== "" && valueCell != null) return String(valueCell);

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
 * F2 copy công thức từ SUBEO!F2; reset dòng dữ liệu từ hàng 3 và A2:B2.
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

  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetId, [
    { duplicateSheet: { sourceSheetId: sourceId, newSheetName: name } },
  ]);

  const q = quoteSheet(name);
  await sheetsValuesClear(accessToken, spreadsheetId, `${q}!A3:F${MAX_ROW}`);
  const today = formatNgayVietnam();
  await sheetsPutValues(accessToken, spreadsheetId, `${q}!A2:B2`, [[today, "FALSE"]], "USER_ENTERED");
  await copyTemplateF2ToTab(accessToken, spreadsheetId, name, templateTab);
}

export async function deleteChamCongEmployeeTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  templateTab: string = CHAM_CONG_TEMPLATE_TAB,
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
