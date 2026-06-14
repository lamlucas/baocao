import type { BaoCaoTkEntry } from "./baoCaoTkReport";
import { baoCaoTkNum } from "./baoCaoTkReport";
import { flexibleDateToIso, num } from "./thuChiSheet";

export const BAO_CAO_THU_CHI_MATCH_EPS = 1;

export type ThuChiCompareSourceRow = {
  ngay: string;
  thu: string | number;
  ten?: string;
  /** Legacy / note-only: đại lý có thể nằm ở cột D (ghi chú) thay vì Tên. */
  ghiChu?: string;
};

export type BaoCaoThuChiCompareRow = {
  ten: string;
  baoCaoThu: number;
  thuChiThu: number;
  chenh: number;
  khop: boolean;
};

export type BaoCaoThuChiCompareDay = {
  date: string;
  rows: BaoCaoThuChiCompareRow[];
};

export type BaoCaoThuChiCompareMonth = {
  thang: string;
  rows: BaoCaoThuChiCompareRow[];
};

export type BaoCaoThuChiCompareReport = {
  byMonth: BaoCaoThuChiCompareMonth[];
  byDay: BaoCaoThuChiCompareDay[];
  daiLyList: string[];
  monthList: string[];
};

export function normalizeCompareTen(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Tên đại lý THU_CHI: ưu tiên cột D (Tên), fallback cột D/E ghi chú (legacy). */
export function resolveThuChiCompareTen(row: { ten?: string; ghiChu?: string }): {
  display: string;
  norm: string;
} {
  const ten = String(row.ten ?? "").trim();
  const ghiChu = String(row.ghiChu ?? "").trim();
  const display = ten || ghiChu;
  return { display, norm: normalizeCompareTen(display) };
}

function pickDisplayTen(prev: string | undefined, next: string): string {
  const n = String(next ?? "").trim();
  if (!n) return prev ?? "";
  if (!prev) return n;
  return n.length >= prev.length ? n : prev;
}

function isKhop(a: number, b: number): boolean {
  return Math.abs(a - b) < BAO_CAO_THU_CHI_MATCH_EPS;
}

function toCompareRow(
  ten: string,
  baoCaoThu: number,
  thuChiThu: number,
): BaoCaoThuChiCompareRow {
  const chenh = Math.round((baoCaoThu - thuChiThu) * 100) / 100;
  return {
    ten,
    baoCaoThu,
    thuChiThu,
    chenh,
    khop: isKhop(baoCaoThu, thuChiThu),
  };
}

function sortCompareRows(rows: BaoCaoThuChiCompareRow[]): BaoCaoThuChiCompareRow[] {
  return [...rows].sort((a, b) => {
    if (a.khop !== b.khop) return a.khop ? 1 : -1;
    const tc = a.ten.localeCompare(b.ten, "vi");
    return tc !== 0 ? tc : Math.abs(b.chenh) - Math.abs(a.chenh);
  });
}

type Bucket = { baoCaoThu: number; thuChiThu: number; displayTen: string };

function addAmount(
  map: Map<string, Bucket>,
  normTen: string,
  displayTen: string,
  field: "baoCaoThu" | "thuChiThu",
  amount: number,
) {
  if (!normTen || amount === 0) return;
  const cur = map.get(normTen) ?? { baoCaoThu: 0, thuChiThu: 0, displayTen: "" };
  cur[field] += amount;
  cur.displayTen = pickDisplayTen(cur.displayTen, displayTen);
  map.set(normTen, cur);
}

function mapToRows(map: Map<string, Bucket>): BaoCaoThuChiCompareRow[] {
  const rows: BaoCaoThuChiCompareRow[] = [];
  for (const [, v] of map) {
    if (v.baoCaoThu === 0 && v.thuChiThu === 0) continue;
    rows.push(toCompareRow(v.displayTen || "—", v.baoCaoThu, v.thuChiThu));
  }
  return sortCompareRows(rows);
}

/** So sánh tổng thu cột I (BAO_CAO_TK) với Thu cột B (THU_CHI), khớp tên (D / ghi chú legacy). */
export function buildBaoCaoThuChiCompareReport(
  baoCaoEntries: BaoCaoTkEntry[],
  thuChiRows: ThuChiCompareSourceRow[],
): BaoCaoThuChiCompareReport {
  const byDayMap = new Map<string, Map<string, Bucket>>();
  const byMonthMap = new Map<string, Map<string, Bucket>>();

  const ensureDay = (day: string) => {
    let m = byDayMap.get(day);
    if (!m) {
      m = new Map();
      byDayMap.set(day, m);
    }
    return m;
  };

  const ensureMonth = (thang: string) => {
    let m = byMonthMap.get(thang);
    if (!m) {
      m = new Map();
      byMonthMap.set(thang, m);
    }
    return m;
  };

  for (const e of baoCaoEntries) {
    const day = e.ngay;
    if (!day || day.length < 7) continue;
    const displayTen = String(e.tenKhach ?? "").trim();
    const norm = normalizeCompareTen(displayTen);
    if (!norm || norm === "—") continue;
    const amount = baoCaoTkNum(e.tongThu);
    if (amount === 0) continue;
    const thang = day.slice(0, 7);
    addAmount(ensureDay(day), norm, displayTen, "baoCaoThu", amount);
    addAmount(ensureMonth(thang), norm, displayTen, "baoCaoThu", amount);
  }

  for (const r of thuChiRows) {
    const day = flexibleDateToIso(String(r.ngay ?? "").trim());
    if (!day || day.length < 7) continue;
    const { display: displayTen, norm } = resolveThuChiCompareTen(r);
    if (!norm) continue;
    const amount = typeof r.thu === "number" && Number.isFinite(r.thu) ? r.thu : num(String(r.thu ?? ""));
    if (amount === 0) continue;
    const thang = day.slice(0, 7);
    addAmount(ensureDay(day), norm, displayTen, "thuChiThu", amount);
    addAmount(ensureMonth(thang), norm, displayTen, "thuChiThu", amount);
  }

  const byDay: BaoCaoThuChiCompareDay[] = [...byDayMap.entries()]
    .map(([date, map]) => ({ date, rows: mapToRows(map) }))
    .filter((d) => d.rows.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const byMonth: BaoCaoThuChiCompareMonth[] = [...byMonthMap.entries()]
    .map(([thang, map]) => ({ thang, rows: mapToRows(map) }))
    .filter((m) => m.rows.length > 0)
    .sort((a, b) => a.thang.localeCompare(b.thang));

  const daiLySet = new Set<string>();
  for (const m of byMonth) {
    for (const r of m.rows) {
      const t = String(r.ten ?? "").trim();
      if (t && t !== "—") daiLySet.add(t);
    }
  }
  for (const r of thuChiRows) {
    const { display } = resolveThuChiCompareTen(r);
    if (display) daiLySet.add(display);
  }
  for (const e of baoCaoEntries) {
    const t = String(e.tenKhach ?? "").trim();
    if (t && t !== "—") daiLySet.add(t);
  }

  return {
    byMonth,
    byDay,
    daiLyList: [...daiLySet].sort((a, b) => a.localeCompare(b, "vi")),
    monthList: byMonth.map((m) => m.thang),
  };
}
