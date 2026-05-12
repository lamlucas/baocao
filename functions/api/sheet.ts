import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGet } from "../lib/google";
import {
  bienDongE2,
  flexibleDateToIso,
  normalizeBanDaoDataRow,
  normalizeThuChiDataRow,
  num,
  parseRows,
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
  const byDayMap = new Map<string, number>();
  for (const r of rows) {
    const day = flexibleDateToIso(r.day ?? "");
    if (!day) continue;
    byDayMap.set(day, (byDayMap.get(day) ?? 0) + (r.amount ?? 0));
  }
  const byMonthMap = new Map<string, number>();
  for (const [day, total] of byDayMap) {
    const iso = day.length >= 10 && day[4] === "-" ? day : flexibleDateToIso(day);
    const m = iso.length >= 7 && iso[4] === "-" ? iso.slice(0, 7) : iso;
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
    `'${SHEETS.cong_no}'!A1:B2000`,
  ];

  const rangesDebtSales = [`'${SHEETS.ban_dao}'!A1:F2000`];

  const batchMain = await sheetsBatchGet(token, env.SPREADSHEET_ID_MAIN, rangesMain);
  const batchDebtSales = await sheetsBatchGet(token, env.SPREADSHEET_ID_DEBT_SALES, rangesDebtSales);

  const tq = (batchMain[SHEETS.tong_quan] ?? []).map(stringifySheetRow);
  const tcBody = batchMain[SHEETS.thu_chi] ?? [];
  const cocRaw = batchMain[SHEETS.coc] ?? [];
  const cn = (batchMain[SHEETS.cong_no] ?? []).map(stringifySheetRow);
  const bdRaw = batchDebtSales[SHEETS.ban_dao] ?? [];

  const tqRow2 = tq[1] ?? [];
  const a2 = tqRow2[0] ?? "";
  const b2 = tqRow2[1] ?? "";
  const c2 = tqRow2[2] ?? "";
  const d2 = tqRow2[3] ?? "";
  const e2 = tqRow2[4] ?? "";

  const thuChiData = tcBody.length > 1 ? tcBody.slice(1).map(normalizeThuChiDataRow) : [];
  const cocData =
    cocRaw.length > 1 ? parseRows(cocRaw.slice(1).map(normalizeThuChiDataRow), 4) : [];
  const congNoData = cn.length > 1 ? parseRows(cn.slice(1), 2) : [];
  const banDaoData = bdRaw.length > 1 ? bdRaw.slice(1).map(normalizeBanDaoDataRow) : [];

  const sumCocB = cocData.reduce((s, r) => s + num(r[1]), 0);
  const sumCocC = cocData.reduce((s, r) => s + num(r[2]), 0);
  const sumCongNoB = congNoData.reduce((s, r) => s + num(r[1]), 0);

  const duDauGoc = num(String(a2));
  const e2BienDong = bienDongE2(duDauGoc, thuChiData);

  const byDay = new Map<string, { thu: number; chi: number }>();
  for (const r of thuChiData) {
    const day = flexibleDateToIso((r[0] ?? "").trim());
    if (!day) continue;
    const cur = byDay.get(day) ?? { thu: 0, chi: 0 };
    cur.thu += num(r[1]);
    cur.chi += num(r[2]);
    byDay.set(day, cur);
  }

  const byMonth = new Map<string, { thu: number; chi: number }>();
  for (const [day, v] of byDay) {
    const iso = day.length >= 10 && day[4] === "-" ? day : flexibleDateToIso(day);
    const m = iso.length >= 7 && iso[4] === "-" ? iso.slice(0, 7) : iso;
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
      duDauNhap: duDauGoc,
      bienDongE2: e2BienDong,
    },
    report: { byDay: reportDays, byMonth: reportMonths },
    reportBanDao: banDaoTotals,
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const deny = await requireUser(context.env, context.request);
  if (deny) return deny;
  return Response.json(
    {
      error:
        "Ghi Sheet từ web đã tắt. Chỉnh trên Google Sheet hoặc bot Telegram (Thu chi / Cọc / Công nợ).",
    },
    { status: 405 },
  );
};
