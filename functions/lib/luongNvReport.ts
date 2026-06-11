import { type HhLoaiTruRule, isThuExcludedByHhLoaiTruRules } from "./hhLoaiTru";
import { flexibleDateToIso, num } from "./thuChiSheet";

/** Lương cơ bản tháng (VND). */
export const LUONG_CO_BAN_VND = 10_000_000;

/** Hoa hồng = (thu − chi) × 1%. */
export const HOA_HONG_RATE = 0.01;

/** Khoản công nợ khi khách trả — không tính vào thu (tab CONG_NO). */
export const CONG_NO_THU_EXCLUSIONS = [
  { name: "ROKER", amount: 3000 },
  { name: "GM", amount: 8000 },
] as const;

export type ThuChiRow = { ngay: string; thu: string; chi: string; ghiChu: string };

export type AttendanceSheetRows = { sheetTitle: string; rows: unknown[][] };

export type LuongNvEmployeeRow = {
  name: string;
  workingDays: number;
  daysInMonth: number;
  baseSalaryVnd: number;
  commissionUsd: number;
  /** Tổng tiền phạt cột D trong tháng (USD). */
  tienPhatUsd: number;
  /** Tổng thưởng cột E trong tháng (USD). */
  tienThuongUsd: number;
  /** Tiền ứng ô C2 trên tab nhân viên (USD). */
  tienUngUsd: number;
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
    thuExcludedCongNo: number;
    thuExcludedHhLoaiTru: number;
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

/** Tổng tiền phạt cột D theo tháng (tuỳ chọn cắt tới ngày cutoff). */
export function sumFinesInMonth(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
): number {
  return sumUsdColumnInMonth(rows, monthIso, cutoffDay, 3);
}

/** Tiền ứng tại ô C2 (hàng 2, cột C) trên tab nhân viên (USD). */
export function readTienUngCellC2(rows: unknown[][]): number {
  const row = rows[1];
  if (!row) return 0;
  return num(row[2]);
}

/** Tổng thưởng cột E theo tháng (tuỳ chọn cắt tới ngày cutoff). */
export function sumBonusInMonth(
  rows: unknown[][],
  monthIso: string,
  cutoffDay: number | null,
): number {
  return sumUsdColumnInMonth(rows, monthIso, cutoffDay, 4);
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

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameMatches(haystack: string, needle: string): boolean {
  const h = normalizeName(haystack);
  const n = normalizeName(needle);
  if (!h || !n) return false;
  return h === n || h.includes(n) || n.includes(h);
}

/** Thu từ THU_CHI bị loại khi khách trả công nợ ROKER / GM. */
export function isExcludedCongNoThuPayment(thu: number, ghiChu: string): boolean {
  if (thu <= 0) return false;
  for (const ex of CONG_NO_THU_EXCLUSIONS) {
    if (Math.abs(thu - ex.amount) > 0.009) continue;
    if (nameMatches(ghiChu, ex.name)) return true;
  }
  return false;
}

export function aggregateThuChiMonth(
  thuChi: ThuChiRow[],
  monthIso: string,
  cutoffDay: number | null,
  hhLoaiTruRules: HhLoaiTruRule[] = [],
): {
  tongThu: number;
  tongChi: number;
  thuExcludedCongNo: number;
  thuExcludedHhLoaiTru: number;
  thuExcluded: number;
  netThu: number;
} {
  let tongThu = 0;
  let tongChi = 0;
  let thuExcludedCongNo = 0;
  let thuExcludedHhLoaiTru = 0;
  for (const r of thuChi) {
    const iso = flexibleDateToIso(r.ngay ?? "");
    if (!iso || monthFromIsoDate(iso) !== monthIso) continue;
    const day = dayOfMonthFromIso(iso);
    if (cutoffDay != null && day > cutoffDay) continue;
    const thu = num(r.thu);
    const chi = num(r.chi);
    tongChi += chi;
    if (isExcludedCongNoThuPayment(thu, r.ghiChu ?? "")) {
      thuExcludedCongNo += thu;
      continue;
    }
    if (isThuExcludedByHhLoaiTruRules(r, hhLoaiTruRules)) {
      thuExcludedHhLoaiTru += thu;
      continue;
    }
    tongThu += thu;
  }
  const thuExcluded = thuExcludedCongNo + thuExcludedHhLoaiTru;
  return { tongThu, tongChi, thuExcludedCongNo, thuExcludedHhLoaiTru, thuExcluded, netThu: tongThu };
}

function calcBaseSalaryVnd(workingDays: number, daysInMonth: number): number {
  if (daysInMonth <= 0) return 0;
  return (LUONG_CO_BAN_VND / daysInMonth) * workingDays;
}

function currentMonthFromContext(todayIso: string): string {
  return todayIso.slice(0, 7);
}

function formatMonthLabel(monthIso: string): string {
  const m = monthIso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthIso;
  return `Tháng ${m[2]}/${m[1]}`;
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

function buildPeriod(
  kind: "previous" | "current",
  monthIso: string,
  cutoffDay: number | null,
  attendanceSheets: AttendanceSheetRows[],
  thuChi: ThuChiRow[],
  todayIso: string,
  hhLoaiTruRules: HhLoaiTruRule[],
): LuongNvPeriod {
  const dim = daysInCalendarMonth(monthIso);
  const thuChiAgg = aggregateThuChiMonth(thuChi, monthIso, cutoffDay, hhLoaiTruRules);
  const profit = thuChiAgg.netThu - thuChiAgg.tongChi;
  const commissionUsd = Math.max(0, profit) * HOA_HONG_RATE;

  const employees: LuongNvEmployeeRow[] = attendanceSheets.map((sheet) => {
    const workingDays = countWorkingDaysInMonth(sheet.rows, monthIso, cutoffDay);
    const tienPhatUsd = sumFinesInMonth(sheet.rows, monthIso, cutoffDay);
    const tienThuongUsd = sumBonusInMonth(sheet.rows, monthIso, cutoffDay);
    const tienUngUsd = readTienUngCellC2(sheet.rows);
    return {
      name: sheet.sheetTitle,
      workingDays,
      daysInMonth: dim,
      baseSalaryVnd: calcBaseSalaryVnd(workingDays, dim),
      commissionUsd,
      tienPhatUsd,
      tienThuongUsd,
      tienUngUsd,
    };
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
): LuongNvReport {
  const currentMonth = todayIso.slice(0, 7);
  const previousMonth = previousMonthIso(currentMonth);
  const todayDay = dayOfMonthFromIso(todayIso);

  return {
    todayVietnam: todayIso,
    currentMonth,
    previousMonth,
    periods: [
      buildPeriod("previous", previousMonth, null, attendanceSheets, thuChi, todayIso, hhLoaiTruRules),
      buildPeriod("current", currentMonth, todayDay, attendanceSheets, thuChi, todayIso, hhLoaiTruRules),
    ],
  };
}

/** Bỏ tab hệ thống / trống tên. */
export function filterAttendanceSheetTitles(titles: string[]): string[] {
  return titles.filter((t) => {
    const s = t.trim();
    if (!s) return false;
    const low = s.toLowerCase();
    if (low === "sheet1" || low === "sheet 1") return false;
    if (/^tổng hợp$|^tong hop$/i.test(low)) return false;
    return true;
  });
}
