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

/** Serial ngày Google Sheet (ô định dạng Ngày) → YYYY-MM-DD (UTC theo serial). */
export function sheetsSerialToIsoDate(serial: number): string {
  const days = Math.floor(serial);
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + days * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 1970 || y > 2100) return String(serial);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function stringifySheetRow(cells: unknown[]): string[] {
  return cells.map((c) => {
    if (c == null || c === "") return "";
    if (typeof c === "boolean") return c ? "TRUE" : "FALSE";
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
    return String(c);
  });
}

/** Chuẩn hóa một dòng THU_CHI sau batchGet UNFORMATTED. */
export function normalizeThuChiDataRow(cells: unknown[]): string[] {
  const row = [...cells];
  while (row.length < 4) row.push("");
  const a = row[0];
  let ngay = "";
  if (typeof a === "number" && Number.isFinite(a)) {
    ngay = sheetsSerialToIsoDate(a);
  } else {
    ngay = String(a ?? "").trim();
  }
  const th = row[1];
  const thu = typeof th === "number" && Number.isFinite(th) ? String(th) : String(th ?? "").trim();
  const ch = row[2];
  const chi = typeof ch === "number" && Number.isFinite(ch) ? String(ch) : String(ch ?? "").trim();
  const ghiChu = String(row[3] ?? "").trim();
  return [ngay, thu, chi, ghiChu];
}

/** Chuẩn bị ma trận ghi Sheet: giữ kiểu number cho ô số (B, C) để tránh locale. */
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

export function isThuChiModelEmpty(m: {
  ngay: string;
  thu: string;
  chi: string;
  ghiChu: string;
}): boolean {
  return `${m.ngay ?? ""}${m.thu ?? ""}${m.chi ?? ""}${m.ghiChu ?? ""}`.trim() === "";
}

/** Bỏ các dòng trống hoàn toàn ở cuối (tránh kéo công thức E xuống hàng pad không có dữ liệu). */
export function trimTrailingEmptyThuChiModels(
  rows: { ngay: string; thu: string; chi: string; ghiChu: string }[],
): { ngay: string; thu: string; chi: string; ghiChu: string }[] {
  const o = [...rows];
  while (o.length > 0 && isThuChiModelEmpty(o[o.length - 1]!)) o.pop();
  return o;
}

/** Ma trận tab THU_CHI: header + dòng dữ liệu A-D, phần pad phía dưới để trống. */
export function buildThuChiPaddedMatrix(
  rows: { ngay: string; thu: string; chi: string; ghiChu: string }[],
): (string | number)[][] {
  const header: (string | number)[] = ["Ngày", "Thu", "Chi", "Ghi chú"];
  const out: (string | number)[][] = [header];
  const trimmed = trimTrailingEmptyThuChiModels(rows);
  const dataCount = trimmed.length;
  const totalBody = Math.max(THU_CHI_PAD_ROWS - 1, Math.max(1, dataCount));

  for (let i = 0; i < totalBody; i++) {
    if (i < dataCount) {
      const model = trimmed[i]!;
      const ngay = model.ngay ?? "";
      const thu = model.thu ?? "";
      const chi = model.chi ?? "";
      const ghiChu = model.ghiChu ?? "";
      const thuCell: string | number = thu.trim() === "" ? "" : num(thu);
      const chiCell: string | number = chi.trim() === "" ? "" : num(chi);
      out.push([ngay, thuCell, chiCell, ghiChu]);
    } else if (dataCount === 0 && i === 0) {
      out.push(["", "", "", ""]);
    } else {
      out.push(["", "", "", ""]);
    }
  }
  return out;
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
