import { flexibleDateToIso, isoToSheetDateInput, num, sheetsSerialToIsoDate, stringifySheetRow } from "./thuChiSheet";

export const HH_LOAI_TRU_TAB = "HH_LOAI_TRU";

export type HhLoaiTruRule = {
  ngay: string;
  tenDaiLy: string;
  khoanThu: number;
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

/** Khớp rule web với một dòng THU_CHI (A ngày, B thu, D ghi chú). */
export function thuChiRowMatchesHhLoaiTruRule(row: ThuChiMatchRow, rule: HhLoaiTruRule): boolean {
  const thu = num(row.thu);
  if (thu <= 0) return false;
  const iso = flexibleDateToIso(row.ngay ?? "");
  const ruleIso = flexibleDateToIso(rule.ngay ?? "");
  if (!iso || !ruleIso || iso !== ruleIso) return false;
  if (!nameMatches(row.ghiChu ?? "", rule.tenDaiLy ?? "")) return false;
  return Math.abs(thu - (rule.khoanThu ?? 0)) <= 0.009;
}

export function isThuExcludedByHhLoaiTruRules(
  row: ThuChiMatchRow,
  rules: HhLoaiTruRule[],
): boolean {
  return rules.some((rule) => thuChiRowMatchesHhLoaiTruRule(row, rule));
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

/** Đọc tab HH_LOAI_TRU (file chấm công): A ngày, B ghi chú/tên đại lý, C khoản thu. */
export function parseHhLoaiTruSheetRows(raw: unknown[][]): HhLoaiTruRule[] {
  if (!raw.length) return [];
  const start = isHeaderRow(raw[0]) ? 1 : 0;
  const out: HhLoaiTruRule[] = [];
  for (let i = start; i < raw.length; i++) {
    const row = stringifySheetRow(raw[i]);
    const ngay = parseNgayCell(row[0]);
    const tenDaiLy = String(row[1] ?? "").trim();
    const khoanThu = num(row[2]);
    if (!ngay && !tenDaiLy && khoanThu <= 0) continue;
    if (!ngay || !tenDaiLy || khoanThu <= 0) continue;
    out.push({ ngay, tenDaiLy, khoanThu });
  }
  return out;
}

function isHeaderRow(row: unknown): boolean {
  const a = String(row[0] ?? "").trim().toLowerCase();
  const b = String(row[1] ?? "").trim().toLowerCase();
  const c = String(row[2] ?? "").trim().toLowerCase();
  return /ngày|ngay|date/.test(a) || /đại lý|dai ly|tên|ten|ghi chú/.test(b) || /thu|khoản|khoan|số tiền/.test(c);
}

/** Ghi danh sách loại trừ lên tab HH_LOAI_TRU. */
export function buildHhLoaiTruWriteMatrix(rules: HhLoaiTruRule[]): (string | number)[][] {
  const header: (string | number)[] = ["Ngày", "Tên đại lý", "Khoản thu"];
  const body = rules.map((r) => [
    isoToSheetDateInput(flexibleDateToIso(r.ngay)),
    String(r.tenDaiLy ?? "").trim(),
    num(String(r.khoanThu ?? "")),
  ]);
  return [header, ...body];
}

export function normalizeHhLoaiTruInput(raw: unknown): HhLoaiTruRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ngay = flexibleDateToIso(String(o.ngay ?? "").trim());
  const tenDaiLy = String(o.tenDaiLy ?? o.ten ?? "").trim();
  const khoanThu = num(String(o.khoanThu ?? o.thu ?? ""));
  if (!ngay || !tenDaiLy || khoanThu <= 0) return null;
  return { ngay, tenDaiLy, khoanThu };
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
