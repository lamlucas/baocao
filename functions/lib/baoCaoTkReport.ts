import { flexibleDateToIso, normalizeBaoCaoTkDataRow, num } from "./thuChiSheet";

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

/** Nguồn ưu tiên cột L; fallback K/J khi sheet chưa điền đủ cột. */
function extractNguonFromRow(row: string[]): string {
  const l = (row[11] ?? "").trim();
  if (l) return l;
  const k = (row[10] ?? "").trim();
  if (k && !STATUS_MARKERS.has(k.toUpperCase())) return k;
  const j = (row[9] ?? "").trim();
  if (j && j.length <= 24 && !/^\d/.test(j) && !STATUS_MARKERS.has(j.toUpperCase())) return j;
  return "";
}

/** Đọc sheet BAO_CAO_TK → dòng đã gán ngày/MCC/nguồn kế thừa. */
export function parseBaoCaoTkSheetRows(rawRows: unknown[][]): BaoCaoTkEntry[] {
  const out: BaoCaoTkEntry[] = [];
  let currentDate = "";
  let currentMcc = "";
  let currentNguon = "";
  const yearHint = new Date().getFullYear();

  for (const raw of rawRows) {
    const row = normalizeBaoCaoTkDataRow(raw);
    const aRaw = row[0] ?? "";
    const bRaw = row[1] ?? "";
    const cRaw = row[2] ?? "";
    const tieuUsd = num(row[7]);
    const iVal = num(row[8]);
    const nguonCell = extractNguonFromRow(row);

    if (aRaw.trim() && !isSubtotalDateCell(aRaw)) {
      const d = parseBaoCaoNgayCell(aRaw, yearHint);
      if (d) currentDate = d;
    }

    if (bRaw && isBaoCaoMccCell(bRaw)) {
      currentMcc = bRaw;
    }

    if (nguonCell) currentNguon = nguonCell;

    if (!currentDate || !currentMcc) continue;

    /** B trống: kế thừa MCC/ngày nhưng không cộng F và I. */
    if (!bRaw.trim()) continue;

    if (tieuUsd === 0 && iVal === 0) continue;

    const taiKhoan = !isBaoCaoMccCell(bRaw) ? bRaw : cRaw;

    out.push({
      ngay: currentDate,
      mcc: currentMcc,
      taiKhoan,
      tenKhach: row[3] ?? "",
      tongTieu: tieuUsd,
      tongThu: iVal,
      nguon: currentNguon || nguonCell || "—",
    });
  }

  return out;
}

function groupMccForDay(rows: BaoCaoTkEntry[], nguonFilter?: string): ChiTieuMccGroup[] {
  const filtered = nguonFilter
    ? rows.filter((r) => (r.nguon || "—") === nguonFilter)
    : rows;
  const map = new Map<string, { tongTieu: number; tongThu: number; nguons: Set<string> }>();
  for (const r of filtered) {
    const key = r.mcc.trim() || "—";
    const cur = map.get(key) ?? { tongTieu: 0, tongThu: 0, nguons: new Set<string>() };
    cur.tongTieu += r.tongTieu;
    cur.tongThu += r.tongThu;
    if (r.nguon) cur.nguons.add(r.nguon);
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([mcc, v]) => ({
      mcc,
      tongTieu: v.tongTieu,
      tongThu: v.tongThu,
      nguon: [...v.nguons].sort((a, b) => a.localeCompare(b, "vi")).join(", "),
    }))
    .sort((a, b) => a.mcc.localeCompare(b.mcc, "vi"));
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
