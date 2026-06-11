import { flexibleDateToIso, isoToSheetDateSerial, num, sheetsSerialToIsoDate, stringifySheetRow } from "./thuChiSheet";

export const HH_LOAI_TRU_TAB = "HH_LOAI_TRU";

export type HhLoaiTruRule = {
  ngay: string;
  /** Cột D Tên — khớp THU_CHI ghi chú (cột D). */
  tenDaiLy: string;
  /** Cột B — khớp THU_CHI cột B (thu). */
  khoanThu: number;
  /** Cột C — khớp THU_CHI cột C (chi). */
  khoanChi: number;
  /** Cột E Note — cũng dùng khớp THU_CHI ghi chú (Ứng, BANK…). */
  note?: string;
  /** Hiển thị web — đúng FORMATTED_VALUE trên Sheet. */
  khoanThuDisplay?: string;
  khoanChiDisplay?: string;
  ngayDisplay?: string;
};

export type ThuChiMatchRow = { ngay: string; thu: string; chi: string; ghiChu: string };

type HhLoaiTruLayout = "sheet" | "legacy";

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameMatches(haystack: string, needle: string): boolean {
  const h = normalizeName(haystack);
  const n = normalizeName(needle);
  if (!h || !n) return false;
  return h === n || h.includes(n) || n.includes(h);
}

function datesMatch(rowNgay: string, ruleNgay: string): boolean {
  const iso = flexibleDateToIso(rowNgay ?? "");
  const ruleIso = flexibleDateToIso(ruleNgay ?? "");
  return Boolean(iso && ruleIso && iso === ruleIso);
}

/** Khớp Tên hoặc Note với THU_CHI cột D (ghi chú). */
function ruleMatchesGhiChu(rule: HhLoaiTruRule, ghiChu: string): boolean {
  if (rule.tenDaiLy && nameMatches(ghiChu, rule.tenDaiLy)) return true;
  if (rule.note && nameMatches(ghiChu, rule.note)) return true;
  return false;
}

/** Khớp rule với một dòng THU_CHI (A ngày, B thu, D ghi chú). */
export function thuChiRowMatchesHhLoaiTruThuRule(row: ThuChiMatchRow, rule: HhLoaiTruRule): boolean {
  const thu = num(row.thu);
  const khoanThu = num(rule.khoanThu);
  if (thu <= 0 || khoanThu <= 0) return false;
  if (!datesMatch(row.ngay ?? "", rule.ngay ?? "")) return false;
  if (!ruleMatchesGhiChu(rule, row.ghiChu ?? "")) return false;
  return Math.abs(thu - khoanThu) <= 0.009;
}

/** Khớp rule với một dòng THU_CHI (A ngày, C chi, D ghi chú). */
export function thuChiRowMatchesHhLoaiTruChiRule(row: ThuChiMatchRow, rule: HhLoaiTruRule): boolean {
  const chi = num(row.chi);
  const khoanChi = num(rule.khoanChi);
  if (chi <= 0 || khoanChi <= 0) return false;
  if (!datesMatch(row.ngay ?? "", rule.ngay ?? "")) return false;
  if (!ruleMatchesGhiChu(rule, row.ghiChu ?? "")) return false;
  return Math.abs(chi - khoanChi) <= 0.009;
}

export function isThuExcludedByHhLoaiTruRules(
  row: ThuChiMatchRow,
  rules: HhLoaiTruRule[],
): boolean {
  return rules.some((rule) => thuChiRowMatchesHhLoaiTruThuRule(row, rule));
}

export function isChiExcludedByHhLoaiTruRules(
  row: ThuChiMatchRow,
  rules: HhLoaiTruRule[],
): boolean {
  return rules.some((rule) => thuChiRowMatchesHhLoaiTruChiRule(row, rule));
}

function parseNgayCell(cell: unknown): string {
  if (cell == null || cell === "") return "";
  if (typeof cell === "number" && Number.isFinite(cell)) {
    if (cell > 35_000 && cell < 65_000 && Math.floor(cell) === cell) {
      return sheetsSerialToIsoDate(Math.floor(cell));
    }
  }
  return flexibleDateToIso(String(cell));
}

function normalizeRuleAmounts(khoanThu: number, khoanChi: number): { khoanThu: number; khoanChi: number } {
  return {
    khoanThu: khoanThu > 0 ? khoanThu : 0,
    khoanChi: khoanChi > 0 ? khoanChi : 0,
  };
}

function sheetCellDisplayText(cell: unknown): string {
  if (cell == null || cell === "") return "";
  return String(cell).trim();
}

function detectHhLoaiTruLayout(header: unknown[]): HhLoaiTruLayout {
  const b = String(header[1] ?? "").trim().toLowerCase();
  const d = String(header[3] ?? "").trim().toLowerCase();
  if (/khoản thu|khoan thu|thu/.test(b)) return "sheet";
  if (/tên|ten|name/.test(d)) return "sheet";
  return "legacy";
}

function parseRuleRow(
  row: string[],
  fmt: unknown[] | null,
  layout: HhLoaiTruLayout,
): HhLoaiTruRule | null {
  const ngay = parseNgayCell(row[0]);
  let tenDaiLy = "";
  let note = "";
  let khoanThu = 0;
  let khoanChi = 0;

  if (layout === "sheet") {
    khoanThu = num(row[1]);
    khoanChi = num(row[2]);
    tenDaiLy = String(row[3] ?? "").trim();
    note = String(row[4] ?? "").trim();
  } else {
    tenDaiLy = String(row[1] ?? "").trim();
    khoanThu = num(row[2]);
    khoanChi = num(row[3]);
  }

  const amounts = normalizeRuleAmounts(khoanThu, khoanChi);
  if (!ngay || (!tenDaiLy && !note) || (amounts.khoanThu <= 0 && amounts.khoanChi <= 0)) return null;

  const fmtRow = Array.isArray(fmt) ? fmt : null;
  const thuCol = layout === "sheet" ? 1 : 2;
  const chiCol = layout === "sheet" ? 2 : 3;

  return {
    ngay,
    tenDaiLy,
    khoanThu: amounts.khoanThu,
    khoanChi: amounts.khoanChi,
    note: note || undefined,
    ngayDisplay: fmtRow ? sheetCellDisplayText(fmtRow[0]) : "",
    khoanThuDisplay: fmtRow ? sheetCellDisplayText(fmtRow[thuCol]) : "",
    khoanChiDisplay: fmtRow ? sheetCellDisplayText(fmtRow[chiCol]) : "",
  };
}

/** Đọc tab HH_LOAI_TRU — layout Sheet: A ngày, B thu, C chi, D tên, E note. */
export function parseHhLoaiTruSheetRows(
  raw: unknown[][],
  formattedRows?: unknown[][],
): HhLoaiTruRule[] {
  if (!raw.length) return [];
  const hasHeader = isHeaderRow(raw[0]);
  const layout = hasHeader ? detectHhLoaiTruLayout(stringifySheetRow(raw[0])) : "sheet";
  const start = hasHeader ? 1 : 0;
  const out: HhLoaiTruRule[] = [];
  for (let i = start; i < raw.length; i++) {
    const row = stringifySheetRow(raw[i]);
    const fmt = formattedRows?.[i] ?? null;
    const rule = parseRuleRow(row, Array.isArray(fmt) ? stringifySheetRow(fmt) : null, layout);
    if (rule) out.push(rule);
  }
  return out;
}

function isHeaderRow(row: unknown): boolean {
  if (!Array.isArray(row)) return false;
  const a = String(row[0] ?? "").trim().toLowerCase();
  const b = String(row[1] ?? "").trim().toLowerCase();
  const c = String(row[2] ?? "").trim().toLowerCase();
  const d = String(row[3] ?? "").trim().toLowerCase();
  return (
    /ngày|ngay|date/.test(a) ||
    /khoản thu|khoan thu|thu/.test(b) ||
    /khoản chi|khoan chi|chi/.test(c) ||
    /tên|ten|name|đại lý|dai ly|ghi chú|ghi chu/.test(d) ||
    /đại lý|dai ly|tên|ten|ghi chú/.test(b)
  );
}

/** Khóa duy nhất: ngày + tên + note + khoản thu + khoản chi. */
export function hhLoaiTruRuleKey(rule: HhLoaiTruRule): string {
  const ngay = flexibleDateToIso(rule.ngay ?? "");
  const ten = normalizeName(rule.tenDaiLy ?? "");
  const note = normalizeName(rule.note ?? "");
  const thu = num(String(rule.khoanThu ?? "")).toFixed(2);
  const chi = num(String(rule.khoanChi ?? "")).toFixed(2);
  return `${ngay}|${ten}|${note}|${thu}|${chi}`;
}

/** Gộp danh sách — giữ mọi dòng (dedupe), sắp xếp theo ngày. */
export function mergeHhLoaiTruRules(...groups: HhLoaiTruRule[][]): HhLoaiTruRule[] {
  const map = new Map<string, HhLoaiTruRule>();
  for (const group of groups) {
    for (const r of group) {
      map.set(hhLoaiTruRuleKey(r), r);
    }
  }
  return [...map.values()].sort((a, b) => {
    const cmp = flexibleDateToIso(a.ngay).localeCompare(flexibleDateToIso(b.ngay));
    if (cmp !== 0) return cmp;
    return a.tenDaiLy.localeCompare(b.tenDaiLy, "vi");
  });
}

/** Dòng trong incoming chưa có trên Sheet. */
export function newHhLoaiTruRulesOnly(existing: HhLoaiTruRule[], incoming: HhLoaiTruRule[]): HhLoaiTruRule[] {
  const keys = new Set(existing.map(hhLoaiTruRuleKey));
  return incoming.filter((r) => !keys.has(hhLoaiTruRuleKey(r)));
}

/** Một dòng append Sheet — A ngày, B thu, C chi, D tên, E note. */
export function hhLoaiTruRowValues(rule: HhLoaiTruRule): (string | number)[] {
  const thu = num(String(rule.khoanThu ?? ""));
  const chi = num(String(rule.khoanChi ?? ""));
  return [
    isoToSheetDateSerial(flexibleDateToIso(rule.ngay)),
    thu > 0 ? thu : "",
    chi > 0 ? chi : "",
    String(rule.tenDaiLy ?? "").trim(),
    String(rule.note ?? "").trim(),
  ];
}

/** Ghi header + toàn bộ (chỉ dùng khi cần rebuild — không xóa lịch sử khi lưu web). */
export function buildHhLoaiTruWriteMatrix(rules: HhLoaiTruRule[]): (string | number)[][] {
  const header: (string | number)[] = ["Ngày", "Khoản thu", "Khoản chi", "Tên", "Note"];
  const body = rules.map((r) => hhLoaiTruRowValues(r));
  return [header, ...body];
}

export function normalizeHhLoaiTruInput(raw: unknown): HhLoaiTruRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ngay = flexibleDateToIso(String(o.ngay ?? "").trim());
  const tenDaiLy = String(o.tenDaiLy ?? o.ten ?? "").trim();
  const note = String(o.note ?? "").trim();
  const { khoanThu, khoanChi } = normalizeRuleAmounts(
    num(String(o.khoanThu ?? o.thu ?? "")),
    num(String(o.khoanChi ?? o.chi ?? "")),
  );
  if (!ngay || (!tenDaiLy && !note) || (khoanThu <= 0 && khoanChi <= 0)) return null;
  const thuDisplay = khoanThu > 0 ? String(o.khoanThuDisplay ?? o.khoanThu ?? o.thu ?? "").trim() : "";
  const chiDisplay = khoanChi > 0 ? String(o.khoanChiDisplay ?? o.khoanChi ?? o.chi ?? "").trim() : "";
  return {
    ngay,
    tenDaiLy,
    khoanChi,
    khoanThu,
    note: note || undefined,
    khoanThuDisplay: thuDisplay,
    khoanChiDisplay: chiDisplay,
  };
}

export function normalizeHhLoaiTruList(raw: unknown): HhLoaiTruRule[] {
  if (!Array.isArray(raw)) return [];
  const out: HhLoaiTruRule[] = [];
  for (const item of raw) {
    const rule = normalizeHhLoaiTruInput(item);
    if (rule) out.push(rule);
  }
  return out;
}
