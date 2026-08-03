import { type HhLoaiTruRule, isChiExcludedByHhLoaiTruRules, isThuExcludedByHhLoaiTruRules } from "./hhLoaiTru";
import { isChamCongSystemTab } from "./chamCongSheet";
import { calcBaseSalaryUsd, type LuongNvConfig } from "./luongNvConfig";
import {
  commissionStartForTab,
  type CommissionStartByEmployee,
} from "./luongNvEmployeeConfig";
import { flexibleDateToIso, num } from "./thuChiSheet";

/** Hoa hồng = (thu − chi) × 1%. */
export const HOA_HONG_RATE = 0.01;

export type ThuChiRow = { ngay: string; thu: string; chi: string; ten?: string; ghiChu: string };

export type AttendanceSheetRows = { sheetTitle: string; rows: unknown[][] };

export type LuongNvEmployeeRow = {
  name: string;
  workingDays: number;
  daysInMonth: number;
  baseSalaryUsd: number;
  commissionUsd: number;
  /** Ngày bắt đầu hưởng HH (yyyy-mm-dd) — chỉ tính THU_CHI từ ngày này. */
  commissionStartDate?: string;
  /** Tổng lương = Lương CB + HH − Phạt + Thưởng (chưa trừ ứng). */
  tongLuongUsd: number;
  /** Thực nhận = Tổng lương − Tiền ứng − Chi Lương (THU_CHI). */
  thucNhanUsd: number;
  /** @deprecated Dùng thucNhanUsd — giữ tương thích JSON cũ. */
  totalSalaryUsd?: number;
  /** Tổng tiền phạt cột D trong tháng (USD). */
  tienPhatUsd: number;
  /** Tổng thưởng cột E trong tháng (USD). */
  tienThuongUsd: number;
  /** Tiền ứng trừ trong kỳ (USD) — tổng cột C theo tháng (carry ngày 1 do bot ghi). */
  tienUngUsd: number;
  /** Tổng Chi «Lương» THU_CHI khớp tên NV trong kỳ (USD). */
  luongChiPaidUsd?: number;
  /** Phần ứng chưa trừ hết — ghi vào cột C ngày đầu tháng sau (chỉ tháng trước). */
  tienUngCarryOutUsd?: number;
};

export type LuongNvPeriod = {
  month: string;
  label: string;
  kind: "previous" | "current";
  payNote: string;
  cutoffDay: number | null;
  daysInMonth: number;
  commissionBase: {
    tongThu: number;
    tongChi: number;
    thuExcludedHhLoaiTru: number;
    chiExcludedHhLoaiTru: number;
    thuExcluded: number;
    netThu: number;
    profit: number;
    commissionUsd: number;
  };
  employees: LuongNvEmployeeRow[];
};

export type LuongNvReport = {
  todayVietnam: string;
  currentMonth: string;
  previousMonth: string;
  config: LuongNvConfig;
  periods: LuongNvPeriod[];
};

function daysInCalendarMonth(monthIso: string): number {
  const m = monthIso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return 30;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return new Date(y, mo, 0).getDate();
}

function monthFromIsoDate(iso: string): string {
  const d = flexibleDateToIso(iso);
  return d.length >= 7 ? d.slice(0, 7) : "";
}

function dayOfMonthFromIso(iso: string): number {
  const d = flexibleDateToIso(iso);
  const m = d.match(/^\d{4}-\d{2}-(\d{2})$/);
  return m ? Number(m[1]) : 0;
}

/** Ô chấm công: tick / TRUE / x / ✓ … */
export function isAttendanceTick(cell: unknown): boolean {
  if (cell === true) return true;
  if (cell === false || cell == null) return false;
  if (typeof cell === "number") return Number.isFinite(cell) && cell !== 0;
  const s = String(cell).trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (low === "false" || low === "0" || low === "-" || low === "không" || low === "khong") return false;
  return /^(true|x|✓|✔|v|1|có|co|ok|yes)$/i.test(s);
}

function parseDayFromColumnA(cell: unknown, monthIso: string): { month: string; day: number } | null {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number" && Number.isFinite(cell)) {
    if (cell > 35000 && cell < 65000 && Math.floor(cell) === cell) {
      const iso = flexibleDateToIso(String(cell));
      const month = monthFromIsoDate(iso);
      const day = dayOfMonthFromIso(iso);
      return month && day ? { month, day } : null;
    }
    const day = Math.floor(cell);
    if (day >= 1 && day <= 31) return { month: monthIso, day };
    return null;
  }
  const raw = String(cell).trim();
  if (!raw) return null;
  const iso = flexibleDateToIso(raw);
  if (iso.length >= 10) {
    return { month: monthFromIsoDate(iso), day: dayOfMonthFromIso(iso) };
  }
  const dm = raw.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (dm) {
    const day = Number(dm[1]);
    const mo = Number(dm[2]);
    const y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(monthIso.slice(0, 4));
    const month = `${y}-${String(mo).padStart(2, "0")}`;
    return day >= 1 && day <= 31 ? { month, day } : null;
  }
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && n >= 1 && n <= 31 && Math.floor(n) === n) {
    return { month: monthIso, day: n };
  }
  return null;
}

function dataRowStartIndex(rows: unknown[][]): number {
  return rows.length > 0 && isHeaderRow(rows[0]) ? 1 : 0;
}

function rowInMonthScope(
  row: unknown[],
  monthIso: string,
  cutoffDay: number | null,
): { month: string; day: number } | null {
  const parsed = parseDayFromColumnA(row[0], monthIso);
  if (!parsed || parsed.month !== monthIso) return null;
  if (cutoffDay != null && parsed.day > cutoffDay) return null;
  return parsed;
}

/** Đếm ngày công cột B theo tháng (tuỳ chọn cắt tới ngày cutoff). */
export function countWorkingDaysInMonth(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
): number {
  let count = 0;
  const start = dataRowStartIndex(rows);
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!rowInMonthScope(row, monthIso, cutoffDay)) continue;
    if (!isAttendanceTick(row[1])) continue;
    count++;
  }
  return count;
}

/** Ngày trong tháng (tới cutoff) không có tick chấm công cột B — không tính thu HH. */
export function datesWithoutAttendanceInMonth(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
): string[] {
  const dim = daysInCalendarMonth(monthIso);
  const maxDay = cutoffDay ?? dim;
  const workedDays = new Set<number>();
  const start = dataRowStartIndex(rows);
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const parsed = rowInMonthScope(row, monthIso, cutoffDay);
    if (!parsed) continue;
    if (isAttendanceTick(row[1])) workedDays.add(parsed.day);
  }
  const out: string[] = [];
  for (let d = 1; d <= maxDay; d++) {
    if (!workedDays.has(d)) {
      out.push(`${monthIso}-${String(d).padStart(2, "0")}`);
    }
  }
  return out;
}

/** Tổng tiền phạt cột D theo tháng (tuỳ chọn cắt tới ngày cutoff). */
export function sumFinesInMonth(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
): number {
  return sumUsdColumnInMonth(rows, monthIso, cutoffDay, 3);
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

/** Tổng tiền ứng cột C theo tháng (chỉ dòng có ngày hợp lệ — không dùng C2 mặc định). */
export function sumAdvanceInMonth(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
): number {
  return sumUsdColumnInMonth(rows, monthIso, cutoffDay, 2);
}

/** @deprecated Chỉ giữ tương thích — tính lương dùng sumAdvanceInMonth. */
export function readTienUngCellC2(rows: unknown[][]): number {
  const row = rows[1];
  if (!row) return 0;
  return num(row[2]);
}

function commissionForMonth(
  thuChi: ThuChiRow[],
  monthIso: string,
  cutoffDay: number | null,
  hhLoaiTruRules: HhLoaiTruRule[],
  commissionStartIso: string | null = null,
  excludeThuDatesIso: string[] = [],
): number {
  const agg = aggregateThuChiMonth(
    thuChi,
    monthIso,
    cutoffDay,
    hhLoaiTruRules,
    commissionStartIso,
    excludeThuDatesIso,
  );
  return Math.max(0, agg.netThu - agg.tongChi) * HOA_HONG_RATE;
}

function calcEmployeeGrossBeforeAdvance(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
  commissionUsd: number,
  config: LuongNvConfig,
): number {
  const dim = daysInCalendarMonth(monthIso);
  const workingDays = countWorkingDaysInMonth(rows, monthIso, cutoffDay);
  const baseSalaryUsd = calcBaseSalaryUsd(workingDays, dim, config.luongCoBanUsdThang);
  const tienPhatUsd = sumFinesInMonth(rows, monthIso, cutoffDay);
  const tienThuongUsd = sumBonusInMonth(rows, monthIso, cutoffDay);
  return baseSalaryUsd + commissionUsd - tienPhatUsd + tienThuongUsd;
}

/**
 * Phần ứng chưa trừ hết sau lương tháng đủ (ghi bot vào cột C ngày 1 tháng sau).
 * Pool tháng = tổng cột C (đã gồm carry ngày 1 từ tháng trước nếu bot đã ghi).
 */
export function computeAdvanceCarryOutForMonth(
  rows: unknown[][],
  monthIso: string,
  thuChi: ThuChiRow[],
  hhLoaiTruRules: HhLoaiTruRule[],
  config: LuongNvConfig,
  commissionStartIso: string | null = null,
  excludeThuDatesIso: string[] = [],
): number {
  const commissionUsd = commissionForMonth(
    thuChi,
    monthIso,
    null,
    hhLoaiTruRules,
    commissionStartIso,
    excludeThuDatesIso,
  );
  const gross = calcEmployeeGrossBeforeAdvance(rows, monthIso, null, commissionUsd, config);
  const pool = sumAdvanceInMonth(rows, monthIso, null);
  return Math.max(0, pool - gross);
}

function calcTienUngForPeriod(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
  thuChi: ThuChiRow[],
  hhLoaiTruRules: HhLoaiTruRule[],
  config: LuongNvConfig,
  commissionStartIso: string | null = null,
  excludeThuDatesIso: string[] = [],
): { tienUngUsd: number; carryOutUsd: number } {
  const commissionUsd = commissionForMonth(
    thuChi,
    monthIso,
    cutoffDay,
    hhLoaiTruRules,
    commissionStartIso,
    excludeThuDatesIso,
  );
  const gross = calcEmployeeGrossBeforeAdvance(rows, monthIso, cutoffDay, commissionUsd, config);
  const tienUngUsd = sumAdvanceInMonth(rows, monthIso, cutoffDay);
  return { tienUngUsd, carryOutUsd: Math.max(0, tienUngUsd - gross) };
}

/** Tổng thưởng cột E theo tháng (tuỳ chọn cắt tới ngày cutoff). */
export function sumBonusInMonth(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
): number {
  return sumUsdColumnInMonth(rows, monthIso, cutoffDay, 4);
}

function employeeNameMatches(haystack: string, employeeTabName: string): boolean {
  const h = haystack.trim().toLowerCase().replace(/\s+/g, " ");
  const n = employeeTabName.trim().toLowerCase().replace(/\s+/g, " ");
  if (!h || !n) return false;
  return h === n || h.includes(n) || n.includes(h);
}

function isLuongChiNote(note: string): boolean {
  return /^lương$/i.test(String(note ?? "").trim());
}

/** Tổng Chi THU_CHI ghi chú «Lương» khớp tên tab NV trong kỳ lương. */
export function sumSalaryChiPaidInMonth(
  thuChi: ThuChiRow[],
  monthIso: string,
  employeeTabName: string,
  cutoffDay: number | null,
): number {
  let total = 0;
  for (const r of thuChi) {
    const iso = flexibleDateToIso(r.ngay ?? "");
    if (!iso || monthFromIsoDate(iso) !== monthIso) continue;
    const day = dayOfMonthFromIso(iso);
    if (cutoffDay != null && day > cutoffDay) continue;
    const chi = num(r.chi);
    if (chi <= 0) continue;
    if (!isLuongChiNote(r.ghiChu ?? "")) continue;
    const ten = String(r.ten ?? "").trim();
    if (!ten || !employeeNameMatches(ten, employeeTabName)) continue;
    total += chi;
  }
  return total;
}

function sumUsdColumnInMonth(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
  colIndex: number,
): number {
  let total = 0;
  const start = dataRowStartIndex(rows);
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!rowInMonthScope(row, monthIso, cutoffDay)) continue;
    total += num(row[colIndex]);
  }
  return total;
}

function isHeaderRow(row: unknown[]): boolean {
  const a = String(row[0] ?? "").trim().toLowerCase();
  const b = String(row[1] ?? "").trim().toLowerCase();
  const d = String(row[3] ?? "").trim().toLowerCase();
  const e = String(row[4] ?? "").trim().toLowerCase();
  if (!a && !b && !d && !e) return false;
  return (
    /ngày|ngay|date|stt|thứ|thu/.test(a) ||
    /chấm công|cham cong|đi làm|di lam|tick|cc/.test(b) ||
    /phạt|phat|tiền phạt|tien phat/.test(d) ||
    /thưởng|thuong|bonus/.test(e)
  );
}

export function aggregateThuChiMonth(
  thuChi: ThuChiRow[],
  monthIso: string,
  cutoffDay: number | null,
  hhLoaiTruRules: HhLoaiTruRule[] = [],
  minDateIso: string | null = null,
  excludeThuDatesIso: string[] = [],
): {
  tongThu: number;
  tongChi: number;
  thuExcludedHhLoaiTru: number;
  chiExcludedHhLoaiTru: number;
  thuExcluded: number;
  netThu: number;
} {
  const noThuDaySet = new Set(excludeThuDatesIso.filter(Boolean));
  let tongThu = 0;
  let tongChi = 0;
  let thuExcludedHhLoaiTru = 0;
  let chiExcludedHhLoaiTru = 0;
  for (const r of thuChi) {
    const iso = flexibleDateToIso(r.ngay ?? "");
    if (!iso || monthFromIsoDate(iso) !== monthIso) continue;
    if (minDateIso && iso < minDateIso) continue;
    const day = dayOfMonthFromIso(iso);
    if (cutoffDay != null && day > cutoffDay) continue;
    const thu = num(r.thu);
    const chi = num(r.chi);
    if (chi > 0 && isChiExcludedByHhLoaiTruRules(
      { ngay: r.ngay, thu: r.thu, chi: r.chi, ten: r.ten, ghiChu: r.ghiChu },
      hhLoaiTruRules,
    )) {
      chiExcludedHhLoaiTru += chi;
    } else {
      tongChi += chi;
    }
    if (noThuDaySet.has(iso)) continue;
    if (isThuExcludedByHhLoaiTruRules(
      { ngay: r.ngay, thu: r.thu, chi: r.chi, ten: r.ten, ghiChu: r.ghiChu },
      hhLoaiTruRules,
    )) {
      thuExcludedHhLoaiTru += thu;
      continue;
    }
    tongThu += thu;
  }
  const thuExcluded = thuExcludedHhLoaiTru;
  return {
    tongThu,
    tongChi,
    thuExcludedHhLoaiTru,
    chiExcludedHhLoaiTru,
    thuExcluded,
    netThu: tongThu,
  };
}

function currentMonthFromContext(todayIso: string): string {
  return todayIso.slice(0, 7);
}

function formatMonthLabel(monthIso: string): string {
  const m = monthIso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthIso;
  return `Tháng ${m[2]}/${m[1]}`;
}

function buildPeriod(
  kind: "previous" | "current",
  monthIso: string,
  cutoffDay: number | null,
  attendanceSheets: AttendanceSheetRows[],
  thuChi: ThuChiRow[],
  todayIso: string,
  hhLoaiTruRules: HhLoaiTruRule[],
  config: LuongNvConfig,
  commissionStartByEmployee: CommissionStartByEmployee = {},
): LuongNvPeriod {
  const dim = daysInCalendarMonth(monthIso);
  const thuChiAgg = aggregateThuChiMonth(thuChi, monthIso, cutoffDay, hhLoaiTruRules);
  const profit = thuChiAgg.netThu - thuChiAgg.tongChi;
  const commissionUsd = Math.max(0, profit) * HOA_HONG_RATE;

  const employees: LuongNvEmployeeRow[] = attendanceSheets.map((sheet) => {
    const commissionStartIso = commissionStartForTab(commissionStartByEmployee, sheet.sheetTitle);
    const excludeThuDatesIso = datesWithoutAttendanceInMonth(sheet.rows, monthIso, cutoffDay);
    const empCommissionUsd = commissionForMonth(
      thuChi,
      monthIso,
      cutoffDay,
      hhLoaiTruRules,
      commissionStartIso,
      excludeThuDatesIso,
    );
    const workingDays = countWorkingDaysInMonth(sheet.rows, monthIso, cutoffDay);
    const tienPhatUsd = sumFinesInMonth(sheet.rows, monthIso, cutoffDay);
    const tienThuongUsd = sumBonusInMonth(sheet.rows, monthIso, cutoffDay);
    const baseSalaryUsd = calcBaseSalaryUsd(workingDays, dim, config.luongCoBanUsdThang);
    const { tienUngUsd, carryOutUsd } = calcTienUngForPeriod(
      sheet.rows,
      monthIso,
      cutoffDay,
      thuChi,
      hhLoaiTruRules,
      config,
      commissionStartIso,
      excludeThuDatesIso,
    );
    const tongLuongUsd = baseSalaryUsd + empCommissionUsd - tienPhatUsd + tienThuongUsd;
    const luongChiPaidUsd = sumSalaryChiPaidInMonth(
      thuChi,
      monthIso,
      sheet.sheetTitle,
      cutoffDay,
    );
    const thucNhanUsd = tongLuongUsd - tienUngUsd - luongChiPaidUsd;
    const row: LuongNvEmployeeRow = {
      name: sheet.sheetTitle,
      workingDays,
      daysInMonth: dim,
      baseSalaryUsd,
      commissionUsd: empCommissionUsd,
      tongLuongUsd,
      thucNhanUsd,
      totalSalaryUsd: thucNhanUsd,
      tienPhatUsd,
      tienThuongUsd,
      tienUngUsd,
    };
    if (luongChiPaidUsd > 0.009) row.luongChiPaidUsd = luongChiPaidUsd;
    if (commissionStartIso) row.commissionStartDate = commissionStartIso;
    if (kind === "previous" && carryOutUsd > 0.009) {
      row.tienUngCarryOutUsd = carryOutUsd;
    }
    return row;
  });

  employees.sort((a, b) => a.name.localeCompare(b.name, "vi"));

  const mo = monthIso.slice(5, 7);
  const yr = monthIso.slice(0, 4);
  let label = formatMonthLabel(monthIso);
  let payNote = "";
  if (kind === "previous") {
    const payMo = currentMonthFromContext(todayIso).slice(5, 7);
    const payYr = currentMonthFromContext(todayIso).slice(0, 4);
    payNote = `Lương tháng trước — chi trả kỳ ngày 01/${payMo}/${payYr}`;
    label = `${formatMonthLabel(monthIso)} (đủ tháng)`;
  } else {
    const d = cutoffDay ?? dim;
    payNote = `Lương tháng hiện tại — tính tới ngày ${String(d).padStart(2, "0")}/${mo}/${yr}`;
    label = `${formatMonthLabel(monthIso)} (tới ngày ${String(d).padStart(2, "0")}/${mo})`;
  }

  return {
    month: monthIso,
    label,
    kind,
    payNote,
    cutoffDay,
    daysInMonth: dim,
    commissionBase: {
      ...thuChiAgg,
      profit,
      commissionUsd,
    },
    employees,
  };
}

export function buildLuongNvReport(
  attendanceSheets: AttendanceSheetRows[],
  thuChi: ThuChiRow[],
  todayIso: string,
  hhLoaiTruRules: HhLoaiTruRule[] = [],
  config: LuongNvConfig,
  commissionStartByEmployee: CommissionStartByEmployee = {},
): LuongNvReport {
  const currentMonth = todayIso.slice(0, 7);
  const previousMonth = previousMonthIso(currentMonth);
  const todayDay = dayOfMonthFromIso(todayIso);

  return {
    todayVietnam: todayIso,
    currentMonth,
    previousMonth,
    config,
    periods: [
      buildPeriod(
        "previous",
        previousMonth,
        null,
        attendanceSheets,
        thuChi,
        todayIso,
        hhLoaiTruRules,
        config,
        commissionStartByEmployee,
      ),
      buildPeriod(
        "current",
        currentMonth,
        todayDay,
        attendanceSheets,
        thuChi,
        todayIso,
        hhLoaiTruRules,
        config,
        commissionStartByEmployee,
      ),
    ],
  };
}

/** Bỏ tab hệ thống / trống tên. */
export function filterAttendanceSheetTitles(titles: string[]): string[] {
  return titles.filter((t) => !isChamCongSystemTab(t));
}
