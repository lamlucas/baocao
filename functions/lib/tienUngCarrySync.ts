import type { HhLoaiTruRule } from "./hhLoaiTru";
import { sheetsPutValues } from "./google";
import type { LuongNvConfig } from "./luongNvConfig";
import {
  computeAdvanceCarryOutForMonth,
  type AttendanceSheetRows,
  type ThuChiRow,
} from "./luongNvReport";
import { flexibleDateToIso, num } from "./thuChiSheet";

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function previousMonthIso(monthIso: string): string {
  const m = monthIso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthIso;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, "0")}`;
}

function isChamCongHeaderRow(row: unknown[]): boolean {
  const a = String(row[0] ?? "").trim().toLowerCase();
  const b = String(row[1] ?? "").trim().toLowerCase();
  return /ngày|ngay|date/.test(a) && /chấm công|cham cong|đi làm|di lam/.test(b);
}

function findRowIndexForMonthDay(
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

/**
 * Ghi phần ứng còn lại tháng trước vào cột C ngày 1 tháng hiện tại (SUBEO + tab NV).
 * Chỉ ghi khi đã có dòng ngày 01 — không tự tạo dòng mới.
 */
export async function syncAdvanceCarryToFirstDayAllTabs(
  accessToken: string,
  spreadsheetId: string,
  attendanceSheets: AttendanceSheetRows[],
  thuChi: ThuChiRow[],
  todayIso: string,
  hhLoaiTruRules: HhLoaiTruRule[],
  config: LuongNvConfig,
  reloadSheets: () => Promise<AttendanceSheetRows[]>,
): Promise<AttendanceSheetRows[]> {
  const currentMonth = todayIso.slice(0, 7);
  const previousMonth = previousMonthIso(currentMonth);
  let updated = 0;

  for (const sheet of attendanceSheets) {
    const carryOut = computeAdvanceCarryOutForMonth(
      sheet.rows,
      previousMonth,
      thuChi,
      hhLoaiTruRules,
      config,
    );
    const rowIdx = findRowIndexForMonthDay(sheet.rows, currentMonth, 1);
    if (rowIdx == null) continue;

    const currentC = num(sheet.rows[rowIdx]?.[2]);
    // Chỉ ghi cột C ngày 1 khi Thực nhận (Tổng lương − Tiền ứng) ≤ 0 — phần ứng còn lại.
    if (carryOut <= 0.009) continue;
    if (Math.abs(currentC - carryOut) < 0.009) continue;

    await sheetsPutValues(
      accessToken,
      spreadsheetId,
      `${quoteSheet(sheet.sheetTitle)}!C${rowIdx + 1}`,
      [[carryOut]],
      "RAW",
    );
    updated++;
  }

  if (updated > 0) return reloadSheets();
  return attendanceSheets;
}
