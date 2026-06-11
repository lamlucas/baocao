import {
  sheetsBatchGet,
  sheetsListTabTitles,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
  sheetsValuesClear,
} from "./google";
import { num } from "./thuChiSheet";

export const CHAM_CONG_TEMPLATE_TAB = "SU_BEO";
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

/** Tab mẫu / hệ thống — không tính lương, không xóa. */
export function isChamCongSystemTab(title: string): boolean {
  const s = title.trim();
  if (!s) return true;
  const low = s.toLowerCase();
  if (low === CHAM_CONG_TEMPLATE_TAB.toLowerCase()) return true;
  if (low === "sheet1" || low === "sheet 1") return true;
  if (/^tổng hợp$|^tong hop$/i.test(low)) return true;
  if (low === "cau_hinh" || low === "cấu hình") return true;
  return false;
}

export function listChamCongEmployeeTabs(allTitles: string[]): string[] {
  return allTitles.filter((t) => !isChamCongSystemTab(t)).sort((a, b) => a.localeCompare(b, "vi"));
}

/**
 * Tạo tab nhân viên — duplicate SU_BEO (giữ F2 tỉ giá, cấu trúc D/E…).
 * Chỉ reset dòng dữ liệu từ hàng 3 và dòng ngày đầu A2:B2.
 */
export async function createChamCongEmployeeTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  templateTab: string = CHAM_CONG_TEMPLATE_TAB,
): Promise<void> {
  const name = tabName.trim();
  if (!name) throw new Error("Thiếu tên tab.");
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
}

export async function deleteChamCongEmployeeTab(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  templateTab: string = CHAM_CONG_TEMPLATE_TAB,
): Promise<void> {
  const name = tabName.trim();
  if (!name) throw new Error("Thiếu tên tab.");
  if (name === templateTab || isChamCongSystemTab(name)) {
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
