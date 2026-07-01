import type { HhLoaiTruRule } from "./hhLoaiTru";
import { payrollStatusFor, type LuongPayrollStatusRow } from "./luongNvPayrollStatus";
import { sheetsPutValues } from "./google";
import type { LuongNvConfig } from "./luongNvConfig";
import { commissionStartForTab, type CommissionStartByEmployee } from "./luongNvEmployeeConfig";
import {
  computeAdvanceCarryOutForMonth,
  datesWithoutAttendanceInMonth,
  sumAdvanceInMonth,
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
  commissionStartByEmployee: CommissionStartByEmployee = {},
  payrollStatusMap: Record<string, LuongPayrollStatusRow> = {},
): Promise<AttendanceSheetRows[]> {
  const currentMonth = todayIso.slice(0, 7);
  const previousMonth = previousMonthIso(currentMonth);
  let updated = 0;

  for (const sheet of attendanceSheets) {
    const status = payrollStatusFor(payrollStatusMap, previousMonth, sheet.sheetTitle);
    if (status?.advanceDeducted) continue;

    const commissionStart = commissionStartForTab(commissionStartByEmployee, sheet.sheetTitle);
    const excludeThuDates = datesWithoutAttendanceInMonth(sheet.rows, previousMonth, null);
    const pool = sumAdvanceInMonth(sheet.rows, previousMonth, null);

    let targetC: number;
    if (status?.paid) {
      // Đã thanh toán: giữ nguyên tiền ứng, không trừ lương.
      targetC = pool;
    } else {
      targetC = computeAdvanceCarryOutForMonth(
        sheet.rows,
        previousMonth,
        thuChi,
        hhLoaiTruRules,
        config,
        commissionStart,
        excludeThuDates,
      );
    }

    const rowIdx = findRowIndexForMonthDay(sheet.rows, currentMonth, 1);
    if (rowIdx == null) continue;

    if (targetC <= 0.009) continue;
    const currentC = num(sheet.rows[rowIdx]?.[2]);
    if (Math.abs(currentC - targetC) < 0.009) continue;

    await sheetsPutValues(
      accessToken,
      spreadsheetId,
      `${quoteSheet(sheet.sheetTitle)}!C${rowIdx + 1}`,
      [[targetC]],
      "RAW",
    );
    updated++;
  }

  if (updated > 0) return reloadSheets();
  return attendanceSheets;
}
