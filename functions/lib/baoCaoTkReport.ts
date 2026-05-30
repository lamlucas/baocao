import { flexibleDateToIso, num } from "./thuChiSheet";

export type BaoCaoTkEntry = {
  ngay: string;
  mcc: string;
  taiKhoan: string;
  tenKhach: string;
  tongTieu: number;
  tongThu: number;
  nguon: string;
};

export type ChiTieuNguonTotals = {
  nguon: string;
  tongTieu: number;
  tongThu: number;
};

export type ChiTieuDayTotals = {
  date: string;
  tongTieu: number;
  tongThu: number;
  byNguon: ChiTieuNguonTotals[];
};

export type ChiTieuMonthTotals = {
  thang: string;
  tongTieu: number;
  tongThu: number;
  byNguon: ChiTieuNguonTotals[];
};

export type ChiTieuMccGroup = {
  mcc: string;
  tongTieu: number;
  tongThu: number;
  nguon: string;
};

export type ChiTieuReport = {
  byMonth: ChiTieuMonthTotals[];
  byDay: ChiTieuDayTotals[];
  todayVietnam: {
    date: string;
    tongTieu: number;
    tongThu: number;
    byNguon: ChiTieuNguonTotals[];
    byMcc: ChiTieuMccGroup[];
  };
  nguonList: string[];
};

/** Ô B là tên MCC (không phải mã tài khoản ngắn). */
export function isBaoCaoMccCell(b: string): boolean {
  const t = (b ?? "").trim();
  if (!t) return false;
  if (/mcc/i.test(t)) return true;
  if (/\d{3}[-\s]\d{3}[-\s]\d{4}/.test(t)) return true;
  if (t.length > 10 && /\d/.test(t)) return true;
  return false;
}

/** Ô A là dòng tổng phụ (chỉ số), không phải ngày. */
function isSubtotalDateCell(a: string): boolean {
  const t = (a ?? "").trim();
  if (!t) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return false;
  if (/^\d{1,2}-\d{1,2}\/\d{1,2}/.test(t)) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return false;
  const n = num(t);
  return n !== 0 && /^[\d\s.,]+$/.test(t.replace(/\s/g, ""));
}

/** Parse ngày BAO_CAO_TK (kể cả dạng 13-14/5/2026). */
export function parseBaoCaoNgayCell(raw: string, fallbackYear?: number): string {
  const t = (raw ?? "").trim();
  if (!t || isSubtotalDateCell(t)) return "";
  const iso = flexibleDateToIso(t);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const range = t.match(/^(\d{1,2})(?:-\d{1,2})?[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (range) {
    let year = range[3] ? Number(range[3]) : fallbackYear ?? new Date().getFullYear();
    if (year < 100) year += 2000;
    return `${year}-${range[2].padStart(2, "0")}-${range[1].padStart(2, "0")}`;
  }
  return "";
}

function sortNguon(a: ChiTieuNguonTotals[]): ChiTieuNguonTotals[] {
  return [...a].sort((x, y) => x.nguon.localeCompare(y.nguon, "vi"));
}

function addToNguonMap(map: Map<string, { tongTieu: number; tongThu: number }>, nguon: string, tieu: number, thu: number) {
  const key = nguon || "—";
  const cur = map.get(key) ?? { tongTieu: 0, tongThu: 0 };
  cur.tongTieu += tieu;
  cur.tongThu += thu;
  map.set(key, cur);
}

function mapToNguonList(map: Map<string, { tongTieu: number; tongThu: number }>): ChiTieuNguonTotals[] {
  return sortNguon(
    [...map.entries()].map(([nguon, v]) => ({
      nguon,
      tongTieu: v.tongTieu,
      tongThu: v.tongThu,
    })),
  );
}

const STATUS_MARKERS = new Set(["DONE"]);

export type BaoCaoTkColMap = {
  ngay: number;
  mcc: number;
  /** Cột QUY ĐỔI USD (H) — Tổng tiêu trên web. */
  tieuUsd: number;
  /** Cột TỔNG THU (I). */
  tongThu: number;
  nguon: number;
};

/** Chỉ đọc A, B, H, I, L — gộp theo chỉ số dòng. */
export function mergeBaoCaoTkColumnRanges(parts: {
  colA: unknown[][];
  colB: unknown[][];
  colH: unknown[][];
  colI: unknown[][];
  colL: unknown[][];
}): unknown[][] {
  const maxLen = Math.max(
    parts.colA.length,
    parts.colB.length,
    parts.colH.length,
    parts.colI.length,
    parts.colL.length,
  );
  const rows: unknown[][] = [];
  for (let i = 0; i < maxLen; i++) {
    rows.push([
      parts.colA[i]?.[0] ?? "",
      parts.colB[i]?.[0] ?? "",
      parts.colH[i]?.[0] ?? "",
      parts.colI[i]?.[0] ?? "",
      parts.colL[i]?.[0] ?? "",
    ]);
  }
  return rows;
}

export function baoCaoTkColValues(ranges: { range: string; values: unknown[][] }[], col: string): unknown[][] {
  const letter = col.toUpperCase();
  const hit = ranges.find((r) => new RegExp(`!${letter}1:${letter}`, "i").test(r.range.replace(/'/g, "")));
  return hit?.values ?? [];
}

/** Map cột sau khi gộp A,B,H,I,L → [0,1,2,3,4]. */
export const BAO_CAO_TK_SLIM_COLS: BaoCaoTkColMap = {
  ngay: 0,
  mcc: 1,
  tieuUsd: 2,
  tongThu: 3,
  nguon: 4,
};

function normalizeHeaderLabel(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();
}

/** Xác nhận tiêu đề hàng 1 (chỉ A,B,H,I,L). */
export function detectBaoCaoTkColumns(headerRow: unknown[]): BaoCaoTkColMap {
  const cols = { ...BAO_CAO_TK_SLIM_COLS };
  for (let i = 0; i < headerRow.length; i++) {
    const h = normalizeHeaderLabel(String(headerRow[i] ?? ""));
    if (!h) continue;
    if (h === "ngay" || h.startsWith("ngay")) cols.ngay = i;
    else if (h === "mcc") cols.mcc = i;
    else if (h.includes("quy doi") || h.includes("quy đổi")) cols.tieuUsd = i;
    else if (h.includes("tong thu") || h.includes("tổng thu")) cols.tongThu = i;
    else if (h.includes("nguon") || h.includes("nguồn")) cols.nguon = i;
  }
  return cols;
}

/** Parse số BAO_CAO_TK — ưu tiên số thô UNFORMATTED; chuỗi kiểu Việt Nam 1.234,56. */
export function baoCaoTkNum(cell: unknown): number {
  if (cell == null || cell === "") return 0;
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  const s = String(cell).trim();
  if (!s || /%/.test(s)) return 0;
  if (/^[A-Za-zÀ-ỹ\s_-]+$/.test(s) && !/^\d/.test(s)) return 0;
  return num(s);
}

/** Lấy Tổng tiêu (H) và Tổng thu (I) theo map cột từ tiêu đề sheet. */
export function extractBaoCaoAmounts(rawRow: unknown[], cols: BaoCaoTkColMap): { tieuUsd: number; tongThu: number } {
  const row = Array.isArray(rawRow) ? rawRow : [];
  return {
    tieuUsd: baoCaoTkNum(row[cols.tieuUsd]),
    tongThu: baoCaoTkNum(row[cols.tongThu]),
  };
}

/** Nguồn — cột L. */
function extractNguonFromRow(rawRow: unknown[], cols: BaoCaoTkColMap): string {
  const row = Array.isArray(rawRow) ? rawRow : [];
  const nguon = String(row[cols.nguon] ?? "").trim();
  if (nguon && !STATUS_MARKERS.has(nguon.toUpperCase())) return nguon;
  return "";
}

/** Chỉ xử lý dòng B là MCC (bỏ dòng mã đại lý/Tên khách). Một ngày + MCC + Nguồn = một tổng. */
export function parseBaoCaoTkSheetRows(rawRows: unknown[][], headerRow?: unknown[]): BaoCaoTkEntry[] {
  const cols = detectBaoCaoTkColumns(headerRow ?? []);
  const byDayMccNguon = new Map<string, BaoCaoTkEntry>();
  let currentDate = "";
  let currentNguon = "";
  const yearHint = new Date().getFullYear();

  for (const raw of rawRows) {
    const row = Array.isArray(raw) ? raw : [];
    const bRaw = String(row[cols.mcc] ?? "").trim();
    if (!bRaw) continue;

    const aRaw = String(row[cols.ngay] ?? "").trim();
    if (aRaw && !isSubtotalDateCell(aRaw)) {
      const d = parseBaoCaoNgayCell(aRaw, yearHint);
      if (d) currentDate = d;
    }

    /** Dòng Tên khách / mã đại lý (B = AT, KIN, …) — không cộng vào báo cáo. */
    if (!isBaoCaoMccCell(bRaw)) continue;

    const nguonCell = extractNguonFromRow(row, cols);
    if (nguonCell) currentNguon = nguonCell;

    if (!currentDate) continue;

    const { tieuUsd, tongThu: iVal } = extractBaoCaoAmounts(row, cols);
    if (tieuUsd === 0 && iVal === 0) continue;

    const nguon = nguonCell || currentNguon || "—";
    const key = `${currentDate}\0${bRaw}\0${nguon}`;
    byDayMccNguon.set(key, {
      ngay: currentDate,
      mcc: bRaw,
      taiKhoan: "",
      tenKhach: "",
      tongTieu: tieuUsd,
      tongThu: iVal,
      nguon,
    });
  }

  return [...byDayMccNguon.values()];
}

function groupMccForDay(rows: BaoCaoTkEntry[], nguonFilter?: string): ChiTieuMccGroup[] {
  const filtered = nguonFilter
    ? rows.filter((r) => (r.nguon || "—") === nguonFilter)
    : rows;
  return filtered
    .map((r) => ({
      mcc: r.mcc.trim() || "—",
      nguon: r.nguon || "—",
      tongTieu: r.tongTieu,
      tongThu: r.tongThu,
    }))
    .sort((a, b) => {
      const mc = a.mcc.localeCompare(b.mcc, "vi");
      return mc !== 0 ? mc : a.nguon.localeCompare(b.nguon, "vi");
    });
}

export function buildChiTieuReport(entries: BaoCaoTkEntry[], todayVn: string): ChiTieuReport {
  const byDayMap = new Map<string, Map<string, { tongTieu: number; tongThu: number }>>();
  const byMonthNguon = new Map<string, Map<string, { tongTieu: number; tongThu: number }>>();
  const nguonSet = new Set<string>();

  for (const e of entries) {
    const day = e.ngay;
    if (!day) continue;
    const thang = day.slice(0, 7);
    const nguon = e.nguon || "—";
    nguonSet.add(nguon);

    let dayNguon = byDayMap.get(day);
    if (!dayNguon) {
      dayNguon = new Map();
      byDayMap.set(day, dayNguon);
    }
    addToNguonMap(dayNguon, nguon, e.tongTieu, e.tongThu);

    let monthNguon = byMonthNguon.get(thang);
    if (!monthNguon) {
      monthNguon = new Map();
      byMonthNguon.set(thang, monthNguon);
    }
    addToNguonMap(monthNguon, nguon, e.tongTieu, e.tongThu);
  }

  const byDay: ChiTieuDayTotals[] = [...byDayMap.entries()]
    .map(([date, nguonMap]) => {
      const byNguon = mapToNguonList(nguonMap);
      return {
        date,
        tongTieu: byNguon.reduce((s, x) => s + x.tongTieu, 0),
        tongThu: byNguon.reduce((s, x) => s + x.tongThu, 0),
        byNguon,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const byMonth: ChiTieuMonthTotals[] = [...byMonthNguon.entries()]
    .map(([thang, nguonMap]) => {
      const byNguon = mapToNguonList(nguonMap);
      return {
        thang,
        tongTieu: byNguon.reduce((s, x) => s + x.tongTieu, 0),
        tongThu: byNguon.reduce((s, x) => s + x.tongThu, 0),
        byNguon,
      };
    })
    .sort((a, b) => a.thang.localeCompare(b.thang));

  const todayRows = entries.filter((e) => e.ngay === todayVn);
  const todayNguonMap = new Map<string, { tongTieu: number; tongThu: number }>();
  for (const e of todayRows) {
    addToNguonMap(todayNguonMap, e.nguon || "—", e.tongTieu, e.tongThu);
  }
  const todayByNguon = mapToNguonList(todayNguonMap);

  return {
    byMonth,
    byDay,
    todayVietnam: {
      date: todayVn,
      tongTieu: todayByNguon.reduce((s, x) => s + x.tongTieu, 0),
      tongThu: todayByNguon.reduce((s, x) => s + x.tongThu, 0),
      byNguon: todayByNguon,
      byMcc: groupMccForDay(todayRows),
    },
    nguonList: [...nguonSet].sort((a, b) => a.localeCompare(b, "vi")),
  };
}

/** Gom theo MCC cho một ngày (dùng trên client hoặc API). */
export function mccGroupsForDay(entries: BaoCaoTkEntry[], isoDay: string, nguonFilter?: string): ChiTieuMccGroup[] {
  return groupMccForDay(
    entries.filter((e) => e.ngay === isoDay),
    nguonFilter,
  );
}
