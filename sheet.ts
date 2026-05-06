import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGet, sheetsBatchUpdate } from "../lib/google";
import { verifySession } from "../lib/session";

const SHEETS = {
  tong_quan: "TONG_QUAN",
  thu_chi: "THU_CHI",
  coc: "COC",
  cong_no: "CONG_NO",
} as const;

function num(s: string | undefined): number {
  if (s == null || s === "") return 0;
  let t = String(s).trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(t)) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    t = t.replace(/,/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

const PAD_ROWS = 500;

function padMatrix(rows: (string | number)[][], cols: number): string[][] {
  const out = rows.map((r) => r.map((c) => (c == null ? "" : String(c))));
  const target = Math.max(PAD_ROWS, out.length);
  while (out.length < target) {
    out.push(Array(cols).fill(""));
  }
  return out;
}

function parseRows(rows: string[][], cols: number): string[][] {
  return rows.map((r) => {
    const o = [...r];
    while (o.length < cols) o.push("");
    return o.slice(0, cols).map((c) => (c == null ? "" : String(c)));
  });
}

/** Dòng “mới nhất”: dòng cuối cùng (từ dưới lên) có ít nhất một ô Ngày/Thu/Chi có dữ liệu. */
function latestThuChiRow(thuChiData: string[][]): { thu: number; chi: number } {
  for (let i = thuChiData.length - 1; i >= 0; i--) {
    const r = thuChiData[i];
    const has = Boolean(
      (r[0] ?? "").trim() || (r[1] ?? "").trim() || (r[2] ?? "").trim(),
    );
    if (has) return { thu: num(r[1]), chi: num(r[2]) };
  }
  return { thu: 0, chi: 0 };
}

async function requireUser(env: Env, request: Request): Promise<Response | null> {
  const user = await verifySession(env, request.headers.get("Cookie"));
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const deny = await requireUser(env, request);
  if (deny) return deny;

  const id = env.SPREADSHEET_ID;
  const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const ranges = [
    `'${SHEETS.tong_quan}'!A1:D2`,
    `'${SHEETS.thu_chi}'!A1:C2000`,
    `'${SHEETS.coc}'!A1:D2000`,
    `'${SHEETS.cong_no}'!A1:B2000`,
  ];

  const batch = await sheetsBatchGet(token, id, ranges);

  const tq = batch[SHEETS.tong_quan] ?? [];
  const tc = batch[SHEETS.thu_chi] ?? [];
  const coc = batch[SHEETS.coc] ?? [];
  const cn = batch[SHEETS.cong_no] ?? [];

  const tqRow2 = tq[1] ?? [];
  const a2 = tqRow2[0] ?? "";
  const b2 = tqRow2[1] ?? "";
  const c2 = tqRow2[2] ?? "";
  const d2 = tqRow2[3] ?? "";

  const thuChiData = tc.length > 1 ? parseRows(tc.slice(1), 3) : [];
  const cocData = coc.length > 1 ? parseRows(coc.slice(1), 4) : [];
  const congNoData = cn.length > 1 ? parseRows(cn.slice(1), 2) : [];

  const sumCocB = cocData.reduce((s, r) => s + num(r[1]), 0);
  const sumCocC = cocData.reduce((s, r) => s + num(r[2]), 0);
  const sumCongNoB = congNoData.reduce((s, r) => s + num(r[1]), 0);

  const duDauGoc = num(String(a2));
  const lastTc = latestThuChiRow(thuChiData);
  const soDuSauThuChi = duDauGoc + lastTc.thu - lastTc.chi;

  const byDay = new Map<string, { thu: number; chi: number }>();
  for (const r of thuChiData) {
    const day = (r[0] ?? "").trim();
    if (!day) continue;
    const cur = byDay.get(day) ?? { thu: 0, chi: 0 };
    cur.thu += num(r[1]);
    cur.chi += num(r[2]);
    byDay.set(day, cur);
  }

  const byMonth = new Map<string, { thu: number; chi: number }>();
  for (const [day, v] of byDay) {
    const m = day.length >= 7 ? day.slice(0, 7) : day;
    const cur = byMonth.get(m) ?? { thu: 0, chi: 0 };
    cur.thu += v.thu;
    cur.chi += v.chi;
    byMonth.set(m, cur);
  }

  const reportDays = [...byDay.entries()]
    .map(([date, v]) => ({ date, tongThu: v.thu, tongChi: v.chi }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const reportMonths = [...byMonth.entries()]
    .map(([thang, v]) => ({ thang, tongThu: v.thu, tongChi: v.chi }))
    .sort((a, b) => a.thang.localeCompare(b.thang));

  return Response.json({
    tongQuan: { a2, b2, c2, d2 },
    /** Dữ liệu đọc trực tiếp từ tab TONG_QUAN (ô A2 = dư đầu). */
    docTongQuan: {
      sheet: SHEETS.tong_quan,
      a2_soDuDau: {
        raw: a2 === undefined || a2 === null ? "" : String(a2),
        so: duDauGoc,
      },
    },
    thuChi: thuChiData.map((r) => ({ ngay: r[0], thu: r[1], chi: r[2] })),
    coc: cocData.map((r) => ({ ngay: r[0], thu: r[1], chi: r[2], ghiChu: r[3] })),
    congNo: congNoData.map((r) => ({ ten: r[0], tienNo: r[1] })),
    computed: {
      tongCoc: sumCocB,
      nhanCoc: sumCocC,
      tongCongNo: sumCongNoB,
      soDuSauThuChi,
      duDauNhap: duDauGoc,
    },
    report: { byDay: reportDays, byMonth: reportMonths },
  });
};

type Body = {
  tongQuan?: { a2?: string };
  thuChi?: { ngay: string; thu: string; chi: string }[];
  coc?: { ngay: string; thu: string; chi: string; ghiChu: string }[];
  congNo?: { ten: string; tienNo: string }[];
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const deny = await requireUser(env, request);
  if (deny) return deny;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const thuChi = Array.isArray(body.thuChi) ? body.thuChi : [];
  const coc = Array.isArray(body.coc) ? body.coc : [];
  const congNo = Array.isArray(body.congNo) ? body.congNo : [];

  const sumCocB = coc.reduce((s, r) => s + num(r.thu), 0);
  const sumCocC = coc.reduce((s, r) => s + num(r.chi), 0);
  const sumCongNoB = congNo.reduce((s, r) => s + num(r.tienNo), 0);

  const a2 = body.tongQuan?.a2 != null ? String(body.tongQuan.a2) : "0";
  const b2 = String(sumCocB);
  const c2 = String(sumCocC);
  const d2 = String(sumCongNoB);

  const tqName = SHEETS.tong_quan;
  const thuChiName = SHEETS.thu_chi;
  const cocName = SHEETS.coc;
  const congNoName = SHEETS.cong_no;

  const thuChiRows: string[][] = [["Ngày", "Thu", "Chi"], ...thuChi.map((r) => [
    r.ngay ?? "",
    r.thu ?? "",
    r.chi ?? "",
  ])];
  const cocRows: string[][] = [["Ngày", "Thu", "Chi", "Ghi chú"], ...coc.map((r) => [
    r.ngay ?? "",
    r.thu ?? "",
    r.chi ?? "",
    r.ghiChu ?? "",
  ])];
  const congNoRows: string[][] = [["Tên", "Tiền nợ"], ...congNo.map((r) => [
    r.ten ?? "",
    r.tienNo ?? "",
  ])];

  const tqRows: string[][] = [
    ["Dư đầu", "Tổng cọc", "Nhận cọc", "Tổng công nợ"],
    [a2, b2, c2, d2],
  ];

  const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const id = env.SPREADSHEET_ID;

  const thuChiPadded = padMatrix(thuChiRows, 3);
  const cocPadded = padMatrix(cocRows, 4);
  const congNoPadded = padMatrix(congNoRows, 2);

  await sheetsBatchUpdate(token, id, [
    { range: `'${tqName}'!A1:D2`, values: tqRows },
    { range: `'${thuChiName}'!A1:C${thuChiPadded.length}`, values: thuChiPadded },
    { range: `'${cocName}'!A1:D${cocPadded.length}`, values: cocPadded },
    { range: `'${congNoName}'!A1:B${congNoPadded.length}`, values: congNoPadded },
  ]);

  return Response.json({
    ok: true,
    tongQuan: { a2, b2, c2, d2 },
  });
};
