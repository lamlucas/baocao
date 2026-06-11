import { flexibleDateToIso, isoToSheetDateSerial, num, sheetsSerialToIsoDate, stringifySheetRow } from "./thuChiSheet";

export const HH_LOAI_TRU_TAB = "HH_LOAI_TRU";

export type HhLoaiTruRule = {
  ngay: string;
  tenDaiLy: string;
  /** Khớp THU_CHI cột B (thu) — loại khỏi thu HH. */
  khoanThu: number;
  /** Khớp THU_CHI cột C (chi) — loại khỏi chi HH (banking, ứng NV…). */
  khoanChi: number;
  /** Hiển thị web — đúng FORMATTED_VALUE trên Sheet. */
  khoanThuDisplay?: string;
  khoanChiDisplay?: string;
  ngayDisplay?: string;
};

export type ThuChiMatchRow = { ngay: string; thu: string; chi: string; ghiChu: string };

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

/** Khớp rule web với một dòng THU_CHI (A ngày, B thu, D ghi chú). */
export function thuChiRowMatchesHhLoaiTruThuRule(row: ThuChiMatchRow, rule: HhLoaiTruRule): boolean {
  const thu = num(row.thu);
  const khoanThu = num(rule.khoanThu);
  if (thu <= 0 || khoanThu <= 0) return false;
  if (!datesMatch(row.ngay ?? "", rule.ngay ?? "")) return false;
  if (!nameMatches(row.ghiChu ?? "", rule.tenDaiLy ?? "")) return false;
  return Math.abs(thu - khoanThu) <= 0.009;
}

/** Khớp rule web với một dòng THU_CHI (A ngày, C chi, D ghi chú). */
export function thuChiRowMatchesHhLoaiTruChiRule(row: ThuChiMatchRow, rule: HhLoaiTruRule): boolean {
  const chi = num(row.chi);
  const khoanChi = num(rule.khoanChi);
  if (chi <= 0 || khoanChi <= 0) return false;
  if (!datesMatch(row.ngay ?? "", rule.ngay ?? "")) return false;
  if (!nameMatches(row.ghiChu ?? "", rule.tenDaiLy ?? "")) return false;
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

/** Đọc tab HH_LOAI_TRU: A ngày, B ghi chú, C khoản thu, D khoản chi. */
export function parseHhLoaiTruSheetRows(
  raw: unknown[][],
  formattedRows?: unknown[][],
): HhLoaiTruRule[] {
  if (!raw.length) return [];
  const start = isHeaderRow(raw[0]) ? 1 : 0;
  const out: HhLoaiTruRule[] = [];
  for (let i = start; i < raw.length; i++) {
    const row = stringifySheetRow(raw[i]);
    const fmt = formattedRows?.[i] ?? null;
    const ngay = parseNgayCell(row[0]);
    const tenDaiLy = String(row[1] ?? "").trim();
    const { khoanThu, khoanChi } = normalizeRuleAmounts(num(row[2]), num(row[3]));
    if (!ngay && !tenDaiLy && khoanThu <= 0 && khoanChi <= 0) continue;
    if (!ngay || !tenDaiLy || (khoanThu <= 0 && khoanChi <= 0)) continue;
    const fmtRow = Array.isArray(fmt) ? fmt : null;
    out.push({
      ngay,
      tenDaiLy,
      khoanThu,
      khoanChi,
      ngayDisplay: fmtRow ? sheetCellDisplayText(fmtRow[0]) : "",
      khoanThuDisplay: fmtRow ? sheetCellDisplayText(fmtRow[2]) : "",
      khoanChiDisplay: fmtRow ? sheetCellDisplayText(fmtRow[3]) : "",
    });
  }
  return out;
}

function isHeaderRow(row: unknown): boolean {
  const a = String(row[0] ?? "").trim().toLowerCase();
  const b = String(row[1] ?? "").trim().toLowerCase();
  const c = String(row[2] ?? "").trim().toLowerCase();
  const d = String(row[3] ?? "").trim().toLowerCase();
  return (
    /ngày|ngay|date/.test(a) ||
    /đại lý|dai ly|tên|ten|ghi chú/.test(b) ||
    /thu|khoản thu|khoan thu|số tiền thu/.test(c) ||
    /chi|khoản chi|khoan chi|số tiền chi/.test(d)
  );
}

/** Khóa duy nhất: ngày + ghi chú + khoản thu + khoản chi. */
export function hhLoaiTruRuleKey(rule: HhLoaiTruRule): string {
  const ngay = flexibleDateToIso(rule.ngay ?? "");
  const ten = normalizeName(rule.tenDaiLy ?? "");
  const thu = num(String(rule.khoanThu ?? "")).toFixed(2);
  const chi = num(String(rule.khoanChi ?? "")).toFixed(2);
  return `${ngay}|${ten}|${thu}|${chi}`;
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

/** Một dòng append Sheet — RAW (số thuần, giữ định dạng cột C/D đã cài). */
export function hhLoaiTruRowValues(rule: HhLoaiTruRule): (string | number)[] {
  const thu = num(String(rule.khoanThu ?? ""));
  const chi = num(String(rule.khoanChi ?? ""));
  return [
    isoToSheetDateSerial(flexibleDateToIso(rule.ngay)),
    String(rule.tenDaiLy ?? "").trim(),
    thu > 0 ? thu : "",
    chi > 0 ? chi : "",
  ];
}

/** Ghi header + toàn bộ (chỉ dùng khi cần rebuild — không xóa lịch sử khi lưu web). */
export function buildHhLoaiTruWriteMatrix(rules: HhLoaiTruRule[]): (string | number)[][] {
  const header: (string | number)[] = ["Ngày", "Ghi chú", "Khoản thu", "Khoản chi"];
  const body = rules.map((r) => hhLoaiTruRowValues(r));
  return [header, ...body];
}

export function normalizeHhLoaiTruInput(raw: unknown): HhLoaiTruRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ngay = flexibleDateToIso(String(o.ngay ?? "").trim());
  const tenDaiLy = String(o.tenDaiLy ?? o.ten ?? "").trim();
  const { khoanThu, khoanChi } = normalizeRuleAmounts(
    num(String(o.khoanThu ?? o.thu ?? "")),
    num(String(o.khoanChi ?? o.chi ?? "")),
  );
  if (!ngay || !tenDaiLy || (khoanThu <= 0 && khoanChi <= 0)) return null;
  const thuDisplay = khoanThu > 0 ? String(o.khoanThuDisplay ?? o.khoanThu ?? o.thu ?? "").trim() : "";
  const chiDisplay = khoanChi > 0 ? String(o.khoanChiDisplay ?? o.khoanChi ?? o.chi ?? "").trim() : "";
  return { ngay, tenDaiLy, khoanThu, khoanChi, khoanThuDisplay: thuDisplay, khoanChiDisplay: chiDisplay };
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
