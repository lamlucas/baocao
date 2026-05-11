/** Logic chung tab THU_CHI (Google Sheet + bot Telegram). */

export const THU_CHI_PAD_ROWS = 500;

export function num(s: string | undefined): number {
  if (s == null || s === "") return 0;
  const raw = String(s).trim().replace(/\s/g, "");
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  let t = raw;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    t = raw.replace(new RegExp(`\\${thousandSep}`, "g"), "").replace(decimalSep, ".");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = raw.split(sep);
    if (parts.length > 2 && parts.slice(1).every((p) => p.length === 3)) {
      t = parts.join("");
    } else if (
      parts.length === 2 &&
      parts[1].length === 3 &&
      parts[0].length >= 1 &&
      /^\d+$/.test(parts[0]) &&
      /^\d+$/.test(parts[1])
    ) {
      t = parts.join("");
    } else {
      t = raw.replace(sep, ".");
    }
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Chuẩn bị ma trận ghi Sheet: giữ kiểu number cho ô số để API Sheets lưu số thật,
 * tránh USER_ENTERED + chuỗi "12345.67" bị hiểu sai theo locale (dấu chấm = nghìn).
 */
export function padMatrix(rows: (string | number)[][], cols: number): (string | number)[][] {
  const out = rows.map((r) =>
    r.map((c) => {
      if (c == null) return "";
      if (typeof c === "number") {
        if (!Number.isFinite(c)) return "";
        return c;
      }
      return String(c);
    }),
  );
  const target = Math.max(THU_CHI_PAD_ROWS, out.length);
  while (out.length < target) {
    out.push(Array(cols).fill("") as (string | number)[]);
  }
  return out;
}

export function parseRows(rows: string[][], cols: number): string[][] {
  return rows.map((r) => {
    const o = [...r];
    while (o.length < cols) o.push("");
    return o.slice(0, cols).map((c) => (c == null ? "" : String(c)));
  });
}

/** Dòng “mới nhất”: dòng cuối cùng (từ dưới lên) có ít nhất một ô Ngày/Thu/Chi có dữ liệu. */
export function latestThuChiRow(thuChiData: string[][]): { thu: number; chi: number } {
  for (let i = thuChiData.length - 1; i >= 0; i--) {
    const r = thuChiData[i];
    const has = Boolean(
      (r[0] ?? "").trim() || (r[1] ?? "").trim() || (r[2] ?? "").trim(),
    );
    if (has) return { thu: num(r[1]), chi: num(r[2]) };
  }
  return { thu: 0, chi: 0 };
}

/** E2 biến động tổng quan: bắt đầu từ A2 rồi cộng dồn Thu - Chi theo thứ tự từ trên xuống. */
export function bienDongE2(duDau: number, thuChiData: string[][]): number {
  let x = duDau;
  for (const r of thuChiData) {
    const has = Boolean((r[0] ?? "").trim() || (r[1] ?? "").trim() || (r[2] ?? "").trim());
    if (!has) continue;
    x += num(r[1]) - num(r[2]);
  }
  return x;
}

export function buildThuChiRowsWithBalance(
  rows: { ngay: string; thu: string; chi: string; ghiChu: string }[],
  duDau: number,
): (string | number)[][] {
  const out: (string | number)[][] = [["Ngày", "Thu", "Chi", "Ghi chú", "Balance fluctuations"]];
  let balance = duDau;
  for (const r of rows) {
    const ngay = r.ngay ?? "";
    const thu = r.thu ?? "";
    const chi = r.chi ?? "";
    const ghiChu = r.ghiChu ?? "";
    const hasValue = `${ngay}${thu}${chi}${ghiChu}`.trim() !== "";
    if (hasValue) {
      balance += num(thu) - num(chi);
      const rounded = Math.round(balance * 100) / 100;
      const thuCell: string | number = thu.trim() === "" ? "" : num(thu);
      const chiCell: string | number = chi.trim() === "" ? "" : num(chi);
      out.push([ngay, thuCell, chiCell, ghiChu, rounded]);
    } else {
      out.push([ngay, thu, chi, ghiChu, ""]);
    }
  }
  return out;
}

export function sheetRowsToThuChiModels(dataRows: string[][]): {
  ngay: string;
  thu: string;
  chi: string;
  ghiChu: string;
}[] {
  return dataRows.map((r) => ({
    ngay: r[0] ?? "",
    thu: r[1] ?? "",
    chi: r[2] ?? "",
    ghiChu: r[3] ?? "",
  }));
}

/** Số dư lũy kế ở cột E của dòng dữ liệu cuối cùng (bỏ header). */
export function latestBalanceFromBuiltMatrix(
  thuChiRows: (string | number)[][],
  fallbackDuDau: number,
): number {
  let last = fallbackDuDau;
  for (let i = 1; i < thuChiRows.length; i++) {
    const r = thuChiRows[i];
    const has = Boolean(
      `${r[0] ?? ""}${r[1] ?? ""}${r[2] ?? ""}${r[3] ?? ""}`.trim(),
    );
    if (!has) continue;
    const e = r[4];
    if ((e ?? "").toString().trim() !== "") last = num(String(e));
  }
  return last;
}
