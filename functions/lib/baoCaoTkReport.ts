import { flexibleDateToIso, num, sheetsSerialToIsoDate } from "./thuChiSheet";

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

export type ChiTieuDaiLyTotals = {
  daiLy: string;
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
  daiLyList: string[];
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

/** Ô A là dòng tổng phụ (chỉ số tiền), không phải ngày — serial Sheet (35000–65000) vẫn là ngày. */
function isSubtotalDateCell(a: string): boolean {
  const t = (a ?? "").trim();
  if (!t) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return false;
  if (/^\d{1,2}-\d{1,2}\/\d{1,2}/.test(t)) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return false;
  const n = num(t);
  if (Number.isFinite(n) && n > 35000 && n < 65000 && Math.floor(n) === n) return false;
  return n !== 0 && /^[\d\s.,]+$/.test(t.replace(/\s/g, ""));
}

/** Parse ô ngày (chuỗi, serial UNFORMATTED, dạng 13-14/5/2026). */
export function parseBaoCaoNgayFromCell(raw: unknown, fallbackYear?: number): string {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 35000 && raw < 65000 && Math.floor(raw) === raw) {
      return sheetsSerialToIsoDate(Math.floor(raw));
    }
    return "";
  }
  return parseBaoCaoNgayCell(String(raw).trim(), fallbackYear);
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
  /** Cột TÊN KHÁCH (D) — đại lý / khách. */
  tenKhach: number;
  /** Cột QUY ĐỔI USD (H) — Tổng tiêu trên web. */
  tieuUsd: number;
  /** Cột TỔNG THU (I). */
  tongThu: number;
  nguon: number;
};

/** Chỉ đọc A, B, D, H, I, L — gộp theo chỉ số dòng. */
export function mergeBaoCaoTkColumnRanges(parts: {
  colA: unknown[][];
  colB: unknown[][];
  colD: unknown[][];
  colH: unknown[][];
  colI: unknown[][];
  colL: unknown[][];
}): unknown[][] {
  const maxLen = Math.max(
    parts.colA.length,
    parts.colB.length,
    parts.colD.length,
    parts.colH.length,
    parts.colI.length,
    parts.colL.length,
  );
  const rows: unknown[][] = [];
  for (let i = 0; i < maxLen; i++) {
    rows.push([
      parts.colA[i]?.[0] ?? "",
      parts.colB[i]?.[0] ?? "",
      parts.colD[i]?.[0] ?? "",
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

/** Map cột sau khi gộp A,B,D,H,I,L → [0,1,2,3,4,5]. */
export const BAO_CAO_TK_SLIM_COLS: BaoCaoTkColMap = {
  ngay: 0,
  mcc: 1,
  tenKhach: 2,
  tieuUsd: 3,
  tongThu: 4,
  nguon: 5,
};

function normalizeHeaderLabel(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();
}

/** Tìm hàng tiêu đề NGÀY/MCC (sheet có thể có dòng rác trước hàng dữ liệu). */
export function findBaoCaoTkDataStart(mergedRows: unknown[][]): { headerRow: unknown[]; bodyRows: unknown[][] } {
  for (let i = 0; i < mergedRows.length; i++) {
    const row = mergedRows[i] ?? [];
    const a = normalizeHeaderLabel(String(row[0] ?? ""));
    const b = normalizeHeaderLabel(String(row[1] ?? ""));
    if ((a === "ngay" || a.startsWith("ngay")) && (b === "mcc" || b.includes("mcc"))) {
      return { headerRow: row, bodyRows: mergedRows.slice(i + 1) };
    }
  }
  return { headerRow: mergedRows[0] ?? [], bodyRows: mergedRows.length > 1 ? mergedRows.slice(1) : [] };
}

/** Xác nhận tiêu đề hàng 1 (chỉ A,B,D,H,I,L). */
export function detectBaoCaoTkColumns(headerRow: unknown[]): BaoCaoTkColMap {
  const cols = { ...BAO_CAO_TK_SLIM_COLS };
  for (let i = 0; i < headerRow.length; i++) {
    const h = normalizeHeaderLabel(String(headerRow[i] ?? ""));
    if (!h) continue;
    if (h === "ngay" || h.startsWith("ngay")) cols.ngay = i;
    else if (h === "mcc") cols.mcc = i;
    else if (h.includes("ten khach") || h.includes("tên khách") || h === "khach" || h === "khách")
      cols.tenKhach = i;
    else if (h.includes("quy doi") || h.includes("quy đổi")) cols.tieuUsd = i;
    else if (h.includes("tong thu") || h.includes("tổng thu")) cols.tongThu = i;
    else if (h.includes("nguon") || h.includes("nguồn")) cols.nguon = i;
  }
  return cols;
}

/** Parse số BAO_CAO_TK — ưu tiên số thô UNFORMATTED (kết quả công thức cột I); chuỗi VN 1.234,56. */
export function baoCaoTkNum(cell: unknown): number {
  if (cell == null || cell === "") return 0;
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  const s = String(cell).trim();
  if (!s || /%/.test(s)) return 0;
  if (/^[A-Za-zÀ-ỹ\s_-]+$/.test(s) && !/^\d/.test(s)) return 0;
  const n = num(s);
  return Number.isFinite(n) ? n : 0;
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

/** Đọc sheet BAO_CAO_TK: A=ngày, B=MCC (cùng B = cùng MCC+nguồn), H/I tổng tiêu/thu. */
export function parseBaoCaoTkSheetRows(rawRows: unknown[][], headerRow?: unknown[]): BaoCaoTkEntry[] {
  const cols = detectBaoCaoTkColumns(headerRow ?? []);
  const byDayMccNguon = new Map<string, BaoCaoTkEntry>();
  let currentDate = "";
  let currentNguon = "";
  let yearHint = new Date().getFullYear();

  for (const raw of rawRows) {
    const row = Array.isArray(raw) ? raw : [];
    const bRaw = String(row[cols.mcc] ?? "").trim();
    /** Không tính H/I khi cột B trống. */
    if (!bRaw) continue;

    const dateCell = row[cols.ngay];
    const aText = dateCell == null ? "" : String(dateCell).trim();
    if (aText && !isSubtotalDateCell(aText)) {
      const d = parseBaoCaoNgayFromCell(dateCell, yearHint);
      if (d) {
        currentDate = d;
        yearHint = Number(d.slice(0, 4)) || yearHint;
      }
    } else if (typeof dateCell === "number" && Number.isFinite(dateCell)) {
      const d = parseBaoCaoNgayFromCell(dateCell, yearHint);
      if (d) {
        currentDate = d;
        yearHint = Number(d.slice(0, 4)) || yearHint;
      }
    }

    const nguonCell = extractNguonFromRow(row, cols);
    if (nguonCell) currentNguon = nguonCell;

    if (!currentDate) continue;

    const { tieuUsd, tongThu: iVal } = extractBaoCaoAmounts(row, cols);
    if (tieuUsd === 0 && iVal === 0) continue;

    const nguon = nguonCell || currentNguon || "—";
    const tenKhach = String(row[cols.tenKhach] ?? "").trim() || "—";
    const key = `${currentDate}\0${bRaw}\0${nguon}\0${tenKhach}`;
    /** Cùng ngày + B + nguồn + tên khách (D): cộng H/I từ mọi dòng tài khoản. */
    const prev = byDayMccNguon.get(key);
    if (prev) {
      prev.tongTieu += tieuUsd;
      prev.tongThu += iVal;
    } else {
      byDayMccNguon.set(key, {
        ngay: currentDate,
        mcc: bRaw,
        taiKhoan: "",
        tenKhach,
        tongTieu: tieuUsd,
        tongThu: iVal,
        nguon,
      });
    }
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
  const daiLyMap = new Map<string, string>();

  for (const e of entries) {
    const day = e.ngay;
    if (!day) continue;
    const thang = day.slice(0, 7);
    const nguon = e.nguon || "—";
    const daiLy = e.tenKhach || "—";
    nguonSet.add(nguon);
    if (daiLy !== "—") {
      const norm = daiLy.trim().toLowerCase().replace(/\s+/g, " ");
      const prev = daiLyMap.get(norm);
      daiLyMap.set(norm, !prev || daiLy.length >= prev.length ? daiLy : prev);
    }

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
    daiLyList: [...daiLyMap.values()].sort((a, b) => a.localeCompare(b, "vi")),
  };
}

/** Gom theo MCC cho một ngày (dùng trên client hoặc API). */
export function mccGroupsForDay(entries: BaoCaoTkEntry[], isoDay: string, nguonFilter?: string): ChiTieuMccGroup[] {
  return groupMccForDay(
    entries.filter((e) => e.ngay === isoDay),
    nguonFilter,
  );
}
