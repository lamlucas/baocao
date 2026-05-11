import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGet, sheetsBatchUpdate } from "../lib/google";
import {
  bienDongE2,
  buildThuChiPaddedMatrix,
  latestThuChiRow,
  normalizeThuChiDataRow,
  num,
  padMatrix,
  parseRows,
  sheetRowsToThuChiModels,
  stringifySheetRow,
} from "../lib/thuChiSheet";
import { verifySession } from "../lib/session";

const SHEETS = {
  tong_quan: "TONG_QUAN",
  thu_chi: "THU_CHI",
  coc: "COC",
  cong_no: "CONG_NO",
  ban_dao: "BAN_DAO",
} as const;

function groupByDayMonth(rows: { day: string; amount: number }[]): {
  byDay: { date: string; tong: number }[];
  byMonth: { thang: string; tong: number }[];
} {
  const toIsoDate = (input: string): string => {
    const d = (input ?? "").trim();
    if (!d) return "";
    const core = d.split(" ")[0];
    const iso = core.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    const dmy = core.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    const dmyShort = core.match(/^(\d{1,2})[-/](\d{1,2})$/);
    if (dmyShort) {
      const y = new Date().getFullYear();
      return `${y}-${dmyShort[2].padStart(2, "0")}-${dmyShort[1].padStart(2, "0")}`;
    }
    return core;
  };

  const normalizeDate = (day: string): string => {
    const d = (day ?? "").trim();
    if (!d) return "";
    return toIsoDate(d);
  };

  const byDayMap = new Map<string, number>();
  for (const r of rows) {
    const day = normalizeDate(r.day ?? "");
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
    `'${SHEETS.thu_chi}'!A1:E2000`,
    `'${SHEETS.coc}'!A1:D2000`,
  ];

  const rangesDebtSales = [
    `'${SHEETS.cong_no}'!A1:B2000`,
    `'${SHEETS.ban_dao}'!A1:F2000`,
  ];

  const batchMain = await sheetsBatchGet(token, env.SPREADSHEET_ID_MAIN, rangesMain);
  const batchDebtSales = await sheetsBatchGet(token, env.SPREADSHEET_ID_DEBT_SALES, rangesDebtSales);

  const tq = (batchMain[SHEETS.tong_quan] ?? []).map(stringifySheetRow);
  const tcBody = batchMain[SHEETS.thu_chi] ?? [];
  const cocRaw = batchMain[SHEETS.coc] ?? [];
  const cn = (batchDebtSales[SHEETS.cong_no] ?? []).map(stringifySheetRow);
  const bdRaw = batchDebtSales[SHEETS.ban_dao] ?? [];

  const tqRow2 = tq[1] ?? [];
  const a2 = tqRow2[0] ?? "";
  const b2 = tqRow2[1] ?? "";
  const c2 = tqRow2[2] ?? "";
  const d2 = tqRow2[3] ?? "";
  const e2 = tqRow2[4] ?? "";

  const thuChiData = tcBody.length > 1 ? tcBody.slice(1).map(normalizeThuChiDataRow) : [];
  const cocData = cocRaw.length > 1 ? parseRows(cocRaw.slice(1).map(stringifySheetRow), 4) : [];
  const congNoData = cn.length > 1 ? parseRows(cn.slice(1), 2) : [];
  const banDaoData = bdRaw.length > 1 ? parseRows(bdRaw.slice(1).map(stringifySheetRow), 6) : [];

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

  const banDaoTotals = groupByDayMonth(
    banDaoData.map((r) => ({ day: r[0] ?? "", amount: num(r[2]) })),
  );

  return Response.json({
    tongQuan: { a2, b2, c2, d2, e2 },
    docTongQuan: {
      sheet: SHEETS.tong_quan,
      a2_soDuDau: {
        raw: a2 === undefined || a2 === null ? "" : String(a2),
        so: duDauGoc,
      },
    },
    thuChi: thuChiData.map((r) => ({
      ngay: r[0],
      thu: r[1],
      chi: r[2],
      ghiChu: r[3],
      bienDong: r[4] ?? "",
    })),
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
      tongCoc: sumCocC,
      nhanCoc: sumCocB,
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
  /** true: không ghi đè tab THU_CHI (dữ liệu do bot Telegram ghi). */
  skipThuChi?: boolean;
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

  const skipThuChi = body.skipThuChi === true;
  const coc = Array.isArray(body.coc) ? body.coc : [];

  const sumCocB = coc.reduce((s, r) => s + num(r.thu), 0);
  const sumCocC = coc.reduce((s, r) => s + num(r.chi), 0);

  const a2 = body.tongQuan?.a2 != null ? String(body.tongQuan.a2) : "0";
  const b2 = String(sumCocC);
  const c2 = String(sumCocB);
  const tqName = SHEETS.tong_quan;
  const thuChiName = SHEETS.thu_chi;
  const cocName = SHEETS.coc;

  const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const rangesForSkip = [`'${SHEETS.thu_chi}'!A1:E2000`];
  const sheetThuChiBatch = skipThuChi
    ? await sheetsBatchGet(token, env.SPREADSHEET_ID_MAIN, rangesForSkip)
    : {};
  const tcFromSheet = sheetThuChiBatch[SHEETS.thu_chi] ?? [];
  const thuChiDataFromSheet =
    skipThuChi && tcFromSheet.length > 1
      ? tcFromSheet.slice(1).map(normalizeThuChiDataRow)
      : [];

  const thuChiModels = skipThuChi
    ? sheetRowsToThuChiModels(thuChiDataFromSheet)
    : Array.isArray(body.thuChi)
      ? body.thuChi
      : [];

  const thuChiPadded = buildThuChiPaddedMatrix(thuChiModels);

  const cocRows: string[][] = [["Ngày", "Thu", "Chi", "Ghi chú"], ...coc.map((r) => [
    r.ngay ?? "",
    r.thu ?? "",
    r.chi ?? "",
    r.ghiChu ?? "",
  ])];

  const debtRanges = [`'${SHEETS.cong_no}'!A1:B2000`];
  const debtData = await sheetsBatchGet(token, env.SPREADSHEET_ID_DEBT_SALES, debtRanges);
  const congNoRows = (debtData[SHEETS.cong_no] ?? []).map(stringifySheetRow);
  const congNoData = congNoRows.length > 1 ? parseRows(congNoRows.slice(1), 2) : [];
  const sumCongNoB = congNoData.reduce((s, r) => s + num(r[1]), 0);
  const d2 = String(sumCongNoB);

  /** Chỉ ghi A–D dòng 2: giữ nguyên ô E2 (công thức tay lấy giá trị cuối cột E tab THU_CHI). */
  const tqRows: string[][] = [
    ["Dư đầu", "Tổng cọc", "Nhận cọc", "Tổng công nợ"],
    [a2, b2, c2, d2],
  ];

  const cocPadded = padMatrix(cocRows, 4);

  const updates: { range: string; values: (string | number)[][] }[] = [
    { range: `'${tqName}'!A1:D2`, values: tqRows },
    { range: `'${cocName}'!A1:D${cocPadded.length}`, values: cocPadded },
  ];
  if (!skipThuChi) {
    updates.unshift({
      range: `'${thuChiName}'!A1:E${thuChiPadded.length}`,
      values: thuChiPadded,
    });
  }

  await sheetsBatchUpdate(token, env.SPREADSHEET_ID_MAIN, updates);

  const tqE2Batch = await sheetsBatchGet(token, env.SPREADSHEET_ID_MAIN, [`'${tqName}'!E2`]);
  const e2Row = stringifySheetRow(tqE2Batch[tqName]?.[0] ?? []);
  const e2 = e2Row[0] ?? "";

  return Response.json({
    ok: true,
    tongQuan: { a2, b2, c2, d2, e2 },
  });
};
