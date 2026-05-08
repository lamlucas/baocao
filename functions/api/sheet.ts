import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGet, sheetsBatchUpdate } from "../lib/google";
import { verifySession } from "../lib/session";

const SHEETS = {
  tong_quan: "TONG_QUAN",
  thu_chi: "THU_CHI",
  coc: "COC",
  cong_no: "CONG_NO",
  ban_dao: "BAN_DAO",
} as const;

function num(s: string | undefined): number {
  if (s == null || s === "") return 0;
  let t = String(s).trim().replace(/\s/g, "");
  t = t.replace(/,/g, ".");
  const firstDot = t.indexOf(".");
  const lastDot = t.lastIndexOf(".");
  if (firstDot !== -1 && firstDot !== lastDot) {
    t = `${t.slice(0, lastDot).replace(/\./g, "")}.${t.slice(lastDot + 1)}`;
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

/** E2 biến động: bắt đầu từ A2 rồi cộng dồn Thu - Chi theo thứ tự từ trên xuống. */
function bienDongE2(duDau: number, thuChiData: string[][]): number {
  let x = duDau;
  for (const r of thuChiData) {
    const has = Boolean((r[0] ?? "").trim() || (r[1] ?? "").trim() || (r[2] ?? "").trim());
    if (!has) continue;
    x += num(r[1]) - num(r[2]);
  }
  return x;
}

function groupByDayMonth(rows: { day: string; amount: number }[]): {
  byDay: { date: string; tong: number }[];
  byMonth: { thang: string; tong: number }[];
} {
  const byDayMap = new Map<string, number>();
  for (const r of rows) {
    const day = (r.day ?? "").trim();
    if (!day) continue;
    byDayMap.set(day, (byDayMap.get(day) ?? 0) + (r.amount ?? 0));
  }
  const byMonthMap = new Map<string, number>();
  for (const [day, total] of byDayMap) {
    const m = day.length >= 7 ? day.slice(0, 7) : day;
    byMonthMap.set(m, (byMonthMap.get(m) ?? 0) + total);
  }
  return {
    byDay: [...byDayMap.entries()]
      .map(([date, tong]) => ({ date, tong }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byMonth: [...byMonthMap.entries()]
      .map(([thang, tong]) => ({ thang, tong }))
      .sort((a, b) => a.thang.localeCompare(b.thang)),
  };
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

  const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const rangesMain = [
    `'${SHEETS.tong_quan}'!A1:E2`,
    `'${SHEETS.thu_chi}'!A1:D2000`,
    `'${SHEETS.coc}'!A1:D2000`,
  ];

  const rangesDebtSales = [
    `'${SHEETS.cong_no}'!A1:B2000`,
    `'${SHEETS.ban_dao}'!A1:F2000`,
  ];

  const batchMain = await sheetsBatchGet(token, env.SPREADSHEET_ID_MAIN, rangesMain);
  const batchDebtSales = await sheetsBatchGet(token, env.SPREADSHEET_ID_DEBT_SALES, rangesDebtSales);

  const tq = batchMain[SHEETS.tong_quan] ?? [];
  const tc = batchMain[SHEETS.thu_chi] ?? [];
  const coc = batchMain[SHEETS.coc] ?? [];
  const cn = batchDebtSales[SHEETS.cong_no] ?? [];
  const bd = batchDebtSales[SHEETS.ban_dao] ?? [];

  const tqRow2 = tq[1] ?? [];
  const a2 = tqRow2[0] ?? "";
  const b2 = tqRow2[1] ?? "";
  const c2 = tqRow2[2] ?? "";
  const d2 = tqRow2[3] ?? "";
  const e2 = tqRow2[4] ?? "";

  const thuChiData = tc.length > 1 ? parseRows(tc.slice(1), 4) : [];
  const cocData = coc.length > 1 ? parseRows(coc.slice(1), 4) : [];
  const congNoData = cn.length > 1 ? parseRows(cn.slice(1), 2) : [];
  const banDaoData = bd.length > 1 ? parseRows(bd.slice(1), 6) : [];

  const sumCocB = cocData.reduce((s, r) => s + num(r[1]), 0);
  const sumCocC = cocData.reduce((s, r) => s + num(r[2]), 0);
  const sumCongNoB = congNoData.reduce((s, r) => s + num(r[1]), 0);

  const duDauGoc = num(String(a2));
  const lastTc = latestThuChiRow(thuChiData);
  const soDuSauThuChi = duDauGoc + lastTc.thu - lastTc.chi;
  const e2BienDong = bienDongE2(duDauGoc, thuChiData);

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

  // BAN_DAO: tổng USD theo cột C (TIỀN US) và nhóm theo ngày/tháng (cột A).
  const banDaoTotals = groupByDayMonth(
    banDaoData.map((r) => ({ day: r[0] ?? "", amount: num(r[2]) })),
  );

  return Response.json({
    tongQuan: { a2, b2, c2, d2, e2 },
    /** Dữ liệu đọc trực tiếp từ tab TONG_QUAN (ô A2 = dư đầu). */
    docTongQuan: {
      sheet: SHEETS.tong_quan,
      a2_soDuDau: {
        raw: a2 === undefined || a2 === null ? "" : String(a2),
        so: duDauGoc,
      },
    },
    thuChi: thuChiData.map((r) => ({ ngay: r[0], thu: r[1], chi: r[2], ghiChu: r[3] })),
    coc: cocData.map((r) => ({ ngay: r[0], thu: r[1], chi: r[2], ghiChu: r[3] })),
    congNo: congNoData.map((r) => ({ ten: r[0], tienNo: r[1] })),
    banDao: banDaoData.map((r) => ({
      ngay: r[0],
      tenKh: r[1],
      tienUs: r[2],
      tienVnd: r[3],
      thu: r[4],
      chi: r[5],
    })),
    computed: {
      tongCoc: sumCocB,
      nhanCoc: sumCocC,
      tongCongNo: sumCongNoB,
      soDuSauThuChi,
      duDauNhap: duDauGoc,
      bienDongE2: e2BienDong,
    },
    report: { byDay: reportDays, byMonth: reportMonths },
    reportBanDao: banDaoTotals,
  });
};

type Body = {
  tongQuan?: { a2?: string };
  thuChi?: { ngay: string; thu: string; chi: string; ghiChu: string }[];
  coc?: { ngay: string; thu: string; chi: string; ghiChu: string }[];
  // CONG_NO hiện đọc từ sheet riêng (read-only), không nhận ghi từ web.
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

  const sumCocB = coc.reduce((s, r) => s + num(r.thu), 0);
  const sumCocC = coc.reduce((s, r) => s + num(r.chi), 0);

  const a2 = body.tongQuan?.a2 != null ? String(body.tongQuan.a2) : "0";
  const b2 = String(sumCocB);
  const c2 = String(sumCocC);
  const d2 = '=LOOKUP(2;1/(THU_CHI!D2:D<>"");THU_CHI!D2:D)';
  const e2 = String(bienDongE2(num(a2), thuChi.map((r) => [r.ngay, r.thu, r.chi, r.ghiChu])));

  const tqName = SHEETS.tong_quan;
  const thuChiName = SHEETS.thu_chi;
  const cocName = SHEETS.coc;

  const thuChiRows: string[][] = [["Ngày", "Thu", "Chi", "Ghi chú"], ...thuChi.map((r) => [
    r.ngay ?? "",
    r.thu ?? "",
    r.chi ?? "",
    r.ghiChu ?? "",
  ])];
  const cocRows: string[][] = [["Ngày", "Thu", "Chi", "Ghi chú"], ...coc.map((r) => [
    r.ngay ?? "",
    r.thu ?? "",
    r.chi ?? "",
    r.ghiChu ?? "",
  ])];
  // CONG_NO: read-only từ sheet khác, không ghi ở đây.

  const tqRows: string[][] = [
    ["Dư đầu", "Tổng cọc", "Nhận cọc", "Tổng công nợ", "Biến động"],
    [a2, b2, c2, d2, e2],
  ];

  const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const thuChiPadded = padMatrix(thuChiRows, 4);
  const cocPadded = padMatrix(cocRows, 4);

  await sheetsBatchUpdate(token, env.SPREADSHEET_ID_MAIN, [
    { range: `'${tqName}'!A1:E2`, values: tqRows },
    { range: `'${thuChiName}'!A1:D${thuChiPadded.length}`, values: thuChiPadded },
    {
      range: `'${thuChiName}'!E1:E3`,
      values: [
        ["Balance fluctuations"],
        ["=A2"],
        [
          '=ARRAYFORMULA(IF((B2:B="")*(C2:C="");;TONG_QUAN!A2+SCAN(0;N(B2:B)-N(C2:C);LAMBDA(a;b;a+b))))',
        ],
      ],
    },
    { range: `'${cocName}'!A1:D${cocPadded.length}`, values: cocPadded },
  ]);

  return Response.json({
    ok: true,
    tongQuan: { a2, b2, c2, d2, e2 },
  });
};
