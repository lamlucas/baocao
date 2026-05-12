import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGetMergeSafe } from "../lib/google";
import {
  bienDongE2,
  flexibleDateToIso,
  latestThuChiRow,
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

/**
 * File VK8: THU_CHI + COC + CONG_NO + BAN_DAO cùng một spreadsheet.
 * `null` = layout giống bản BAOCAO cũ: THU_CHI/COC trên MAIN, CONG_NO/BAN_DAO trên DEBT_SALES.
 */
function spreadsheetIdLedger(env: Env): string | null {
  const v = (env as { SPREADSHEET_ID_BAN_DAO?: string }).SPREADSHEET_ID_BAN_DAO?.trim();
  return v || null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const deny = await requireUser(env, request);
    if (deny) return deny;

    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
      return jsonResponse(
        { error: "Thiếu GOOGLE_SERVICE_ACCOUNT_JSON (đặt Secret trên Cloudflare Pages)." },
        503,
      );
    }

    let token: string;
    try {
      token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: `Lỗi xác thực Google: ${msg}` }, 502);
    }

    const idMain = env.SPREADSHEET_ID_MAIN;
    const idVkLedger = spreadsheetIdLedger(env);

    let tq: string[][];
    let tcBody: unknown[][];
    let cocRaw: unknown[][];
    let cn: string[][];
    let bdRaw: unknown[][];
    const splitLayout = idVkLedger == null;

    if (idVkLedger) {
      const batchTq = await sheetsBatchGetMergeSafe(token, idMain, [`'${SHEETS.tong_quan}'!A1:E2`]);
      const batchLedger = await sheetsBatchGetMergeSafe(token, idVkLedger, [
        `'${SHEETS.thu_chi}'!A1:D2000`,
        `'${SHEETS.coc}'!A1:D2000`,
        `'${SHEETS.cong_no}'!A1:B2000`,
        `'${SHEETS.ban_dao}'!A1:G2000`,
      ]);
      tq = (batchTq[SHEETS.tong_quan] ?? []).map(stringifySheetRow);
      tcBody = batchLedger[SHEETS.thu_chi] ?? [];
      cocRaw = batchLedger[SHEETS.coc] ?? [];
      cn = (batchLedger[SHEETS.cong_no] ?? []).map(stringifySheetRow);
      bdRaw = batchLedger[SHEETS.ban_dao] ?? [];
    } else {
      const batchMain = await sheetsBatchGetMergeSafe(token, idMain, [
        `'${SHEETS.tong_quan}'!A1:E2`,
        `'${SHEETS.thu_chi}'!A1:E2000`,
        `'${SHEETS.coc}'!A1:D2000`,
      ]);
      const batchDebt = await sheetsBatchGetMergeSafe(token, env.SPREADSHEET_ID_DEBT_SALES, [
        `'${SHEETS.cong_no}'!A1:B2000`,
        `'${SHEETS.ban_dao}'!A1:F2000`,
      ]);
      tq = (batchMain[SHEETS.tong_quan] ?? []).map(stringifySheetRow);
      tcBody = batchMain[SHEETS.thu_chi] ?? [];
      cocRaw = batchMain[SHEETS.coc] ?? [];
      cn = (batchDebt[SHEETS.cong_no] ?? []).map(stringifySheetRow);
      bdRaw = batchDebt[SHEETS.ban_dao] ?? [];
    }

    const tqRow2 = tq[1] ?? [];
    const a2 = tqRow2[0] ?? "";
    const b2 = tqRow2[1] ?? "";
    const c2 = tqRow2[2] ?? "";
    const d2 = tqRow2[3] ?? "";
    const e2 = tqRow2[4] ?? "";

    const thuChiData = tcBody.length > 1 ? tcBody.slice(1).map(normalizeThuChiDataRow) : [];
    const cocData =
      cocRaw.length > 1
        ? splitLayout
          ? parseRows(cocRaw.slice(1).map(stringifySheetRow), 4)
          : parseRows(cocRaw.slice(1).map(normalizeThuChiDataRow), 4)
        : [];
    const congNoData = cn.length > 1 ? parseRows(cn.slice(1), 2) : [];
    const banDao7 =
      bdRaw.length > 1 && !splitLayout ? bdRaw.slice(1).map(normalizeBanDaoDataRow) : [];
    const banDao6: string[][] =
      bdRaw.length > 1 && splitLayout
        ? parseRows(bdRaw.slice(1).map(stringifySheetRow), 6)
        : [];

    const sumCocB = cocData.reduce((s, r) => s + num(r[1]), 0);
    const sumCocC = cocData.reduce((s, r) => s + num(r[2]), 0);
    const sumCongNoB = congNoData.reduce((s, r) => s + num(r[1]), 0);

    const duDauGoc = num(String(a2));
    const e2BienDong = bienDongE2(duDauGoc, thuChiData);
    const lastTc = latestThuChiRow(thuChiData);
    const soDuSauThuChi = duDauGoc + lastTc.thu - lastTc.chi;

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

    const banDaoTotals = splitLayout
      ? groupByDayMonth(banDao6.map((r) => ({ day: r[0] ?? "", amount: num(r[2]) })))
      : groupByDayMonth(
          banDao7.map((r) => {
            const th = num(r[6]);
            const amount =
              th !== 0
                ? th
                : num(r[4]) && num(r[5])
                  ? num(r[4]) * num(r[5])
                  : num(r[2]);
            return { day: r[0] ?? "", amount };
          }),
        );

    const thuChiPayload = thuChiData.map((r) => ({
      ngay: r[0],
      thu: r[1],
      chi: r[2],
      ghiChu: r[3],
      ...(splitLayout ? { bienDong: r[4] ?? "" } : {}),
    }));

    const banDaoPayload = splitLayout
      ? banDao6.map((r) => ({
          ngay: r[0],
          tenKh: r[1],
          tienUs: r[2],
          tienVnd: r[3],
          thu: r[4],
          chi: r[5],
        }))
      : banDao7.map((r) => ({
          ngay: r[0],
          ten: r[1],
          diaChi: r[2],
          sdt: r[3],
          soLuong: r[4],
          gia: r[5],
          thanhTien: r[6],
        }));

    const computedPayload: Record<string, unknown> = {
      tongCoc: sumCocC,
      nhanCoc: sumCocB,
      tongCongNo: sumCongNoB,
      duDauNhap: duDauGoc,
      bienDongE2: e2BienDong,
    };
    if (splitLayout) {
      computedPayload.soDuSauThuChi = soDuSauThuChi;
    }

    return jsonResponse({
      tongQuan: { a2, b2, c2, d2, e2 },
      docTongQuan: {
        sheet: SHEETS.tong_quan,
        a2_soDuDau: {
          raw: a2 === undefined || a2 === null ? "" : String(a2),
          so: duDauGoc,
        },
      },
      thuChi: thuChiPayload,
      coc: cocData.map((r) => ({ ngay: r[0], thu: r[1], chi: r[2], ghiChu: r[3] })),
      congNo: congNoData.map((r) => ({ ten: r[0], tienNo: r[1] })),
      banDao: banDaoPayload,
      computed: computedPayload,
      report: { byDay: reportDays, byMonth: reportMonths },
      reportBanDao: banDaoTotals,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/sheet]", msg);
    try {
      return jsonResponse({ error: msg }, 500);
    } catch {
      return new Response('{"error":"Lỗi server"}', {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  }
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
