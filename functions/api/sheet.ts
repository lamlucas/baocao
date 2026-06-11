import type { Env } from "../env";
import {
  getSheetsAccessToken,
  sheetsBatchGetMergeSafe,
  sheetsBatchGetValueRanges,
  sheetsListTabTitles,
} from "../lib/google";
import { HH_LOAI_TRU_TAB, parseHhLoaiTruSheetRows } from "../lib/hhLoaiTru";
import {
  listChamCongEmployeeTabs,
  readTyGiaF2,
} from "../lib/chamCongSheet";
import { ensureTodayDateRowsAllTabs } from "../lib/chamCongDateRoll";
import { buildLuongNvConfig, CHAM_CONG_TEMPLATE_TAB } from "../lib/luongNvConfig";
import {
  buildLuongNvReport,
  filterAttendanceSheetTitles,
  type AttendanceSheetRows,
} from "../lib/luongNvReport";
import {
  baoCaoTkColValues,
  buildChiTieuReport,
  findBaoCaoTkDataStart,
  mergeBaoCaoTkColumnRanges,
  parseBaoCaoTkSheetRows,
} from "../lib/baoCaoTkReport";
import {
  flexibleDateToIso,
  normalizeBanDaoDataRow,
  normalizeCocDataRow,
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
  bao_cao_tk: "BAO_CAO_TK",
} as const;

/** yyyy-mm-dd theo múi Việt Nam (trùng logic hiển thị web). */
function todayIsoVietnam(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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

/** File chứa tab BAN_DAO (đơn dao). Mặc định DEBT_SALES nếu không set SPREADSHEET_ID_BAN_DAO. */
function spreadsheetIdBanDao(env: Env): string {
  const v = (env as { SPREADSHEET_ID_BAN_DAO?: string }).SPREADSHEET_ID_BAN_DAO?.trim();
  return v || env.SPREADSHEET_ID_DEBT_SALES;
}

const DEFAULT_SPREADSHEET_ID_CHAM_CONG = "1rZYkgdY6C4Tf1tOjqBw0hwkVE7pLGQlQSNS21ikjZ-w";

function spreadsheetIdChamCong(env: Env): string {
  const v = (env as { SPREADSHEET_ID_CHAM_CONG?: string }).SPREADSHEET_ID_CHAM_CONG?.trim();
  return v || DEFAULT_SPREADSHEET_ID_CHAM_CONG;
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function loadAttendanceSheets(
  token: string,
  spreadsheetId: string,
): Promise<AttendanceSheetRows[]> {
  let titles: string[] = [];
  try {
    titles = filterAttendanceSheetTitles(await sheetsListTabTitles(token, spreadsheetId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Sheets] ${spreadsheetId} metadata: ${msg}`);
    return [];
  }
  if (!titles.length) return [];

  const ranges = titles.map((t) => `${quoteSheetTitle(t)}!A1:F400`);
  const batch = await sheetsBatchGetMergeSafe(token, spreadsheetId, ranges);
  return titles.map((sheetTitle) => ({
    sheetTitle,
    rows: batch[sheetTitle] ?? [],
  }));
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
    const idDebt = env.SPREADSHEET_ID_DEBT_SALES;
    const idBanDao = spreadsheetIdBanDao(env);

    const batchMain = await sheetsBatchGetMergeSafe(token, idMain, [
      `'${SHEETS.tong_quan}'!A1:E2`,
      `'${SHEETS.thu_chi}'!A1:E2000`,
      `'${SHEETS.coc}'!A1:E2000`,
    ]);
    const batchDebtCn = await sheetsBatchGetMergeSafe(token, idDebt, [`'${SHEETS.cong_no}'!A1:B2000`]);
    let baoCaoTkMerged: unknown[][] = [];
    try {
      const baoCaoRanges = await sheetsBatchGetValueRanges(token, idDebt, [
        `'${SHEETS.bao_cao_tk}'!A1:A5000`,
        `'${SHEETS.bao_cao_tk}'!B1:B5000`,
        `'${SHEETS.bao_cao_tk}'!H1:H5000`,
        `'${SHEETS.bao_cao_tk}'!I1:I5000`,
        `'${SHEETS.bao_cao_tk}'!L1:L5000`,
      ]);
      baoCaoTkMerged = mergeBaoCaoTkColumnRanges({
        colA: baoCaoTkColValues(baoCaoRanges, "A"),
        colB: baoCaoTkColValues(baoCaoRanges, "B"),
        colH: baoCaoTkColValues(baoCaoRanges, "H"),
        colI: baoCaoTkColValues(baoCaoRanges, "I"),
        colL: baoCaoTkColValues(baoCaoRanges, "L"),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Sheets] ${idDebt} BAO_CAO_TK columns: ${msg}`);
    }
    const batchBd = await sheetsBatchGetMergeSafe(token, idBanDao, [`'${SHEETS.ban_dao}'!A1:G2000`]);

    const tq = (batchMain[SHEETS.tong_quan] ?? []).map(stringifySheetRow);
    const tcBody = batchMain[SHEETS.thu_chi] ?? [];
    const cocRaw = batchMain[SHEETS.coc] ?? [];
    const cn = (batchDebtCn[SHEETS.cong_no] ?? []).map(stringifySheetRow);
    const bdRaw = batchBd[SHEETS.ban_dao] ?? [];

    const tqRow2 = tq[1] ?? [];
    const a2 = tqRow2[0] ?? "";
    const b2 = tqRow2[1] ?? "";
    const c2 = tqRow2[2] ?? "";
    const d2 = tqRow2[3] ?? "";
    const e2 = tqRow2[4] ?? "";

    const thuChiData = tcBody.length > 1 ? tcBody.slice(1).map(normalizeThuChiDataRow) : [];
    const cocData =
      cocRaw.length > 1 ? parseRows(cocRaw.slice(1).map(normalizeCocDataRow), 5) : [];
    const congNoData = cn.length > 1 ? parseRows(cn.slice(1), 2) : [];
    const banDaoData = bdRaw.length > 1 ? bdRaw.slice(1).map(normalizeBanDaoDataRow) : [];

    const sumCocB = cocData.reduce((s, r) => s + num(r[1]), 0);
    const sumCocC = cocData.reduce((s, r) => s + num(r[2]), 0);
    const sumCongNoB = congNoData.reduce((s, r) => s + num(r[1]), 0);

    const duDauGoc = num(String(a2));
    const bienDongSheetE2 = num(String(e2));

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

    const todayVn = todayIsoVietnam();
    const todayThuChi = byDay.get(todayVn) ?? { thu: 0, chi: 0 };
    let tongBanDaoGHomNay = 0;
    for (const r of banDaoData) {
      const day = flexibleDateToIso((r[0] ?? "").trim());
      if (day === todayVn) tongBanDaoGHomNay += num(r[6]);
    }

    /** Báo cáo bán dao: chỉ cộng cột G (Thành tiền). */
    const banDaoTotals = groupByDayMonth(
      banDaoData.map((r) => ({ day: r[0] ?? "", amount: num(r[6]) })),
    );

    const { headerRow: baoCaoTkHeader, bodyRows: baoCaoTkBody } = findBaoCaoTkDataStart(baoCaoTkMerged);
    const baoCaoTkEntries = parseBaoCaoTkSheetRows(baoCaoTkBody, baoCaoTkHeader);
    const reportChiTieu = buildChiTieuReport(baoCaoTkEntries, todayVn);

    const thuChiModels = thuChiData.map((r) => ({
      ngay: r[0] ?? "",
      thu: r[1] ?? "",
      chi: r[2] ?? "",
      ghiChu: r[3] ?? "",
    }));

    const hhLoaiTru = parseHhLoaiTruSheetRows(
      (
        await sheetsBatchGetMergeSafe(token, spreadsheetIdChamCong(env), [
          `${quoteSheetTitle(HH_LOAI_TRU_TAB)}!A1:C500`,
        ])
      )[HH_LOAI_TRU_TAB] ?? [],
    );

    let luongNvConfig = buildLuongNvConfig(0, CHAM_CONG_TEMPLATE_TAB);
    try {
      const idChamCong = spreadsheetIdChamCong(env);
      let tyGia = 0;
      let sourceTab = CHAM_CONG_TEMPLATE_TAB;
      const tyGiaTabs = [CHAM_CONG_TEMPLATE_TAB, "SU_BEO"];
      for (const tab of tyGiaTabs) {
        const v = await readTyGiaF2(token, idChamCong, tab);
        if (v > 0) {
          tyGia = v;
          sourceTab = tab;
          break;
        }
      }
      if (tyGia <= 0) {
        const titles = await sheetsListTabTitles(token, idChamCong);
        for (const t of listChamCongEmployeeTabs(titles)) {
          const v = await readTyGiaF2(token, idChamCong, t);
          if (v > 0) {
            tyGia = v;
            sourceTab = t;
            break;
          }
        }
      }
      luongNvConfig = buildLuongNvConfig(tyGia, sourceTab);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Sheets] ty gia F2: ${msg}`);
    }

    let reportLuongNv = buildLuongNvReport([], thuChiModels, todayVn, hhLoaiTru, luongNvConfig);
    try {
      const idChamCong = spreadsheetIdChamCong(env);
      await ensureTodayDateRowsAllTabs(token, idChamCong);
      const attendanceSheets = await loadAttendanceSheets(token, idChamCong);
      reportLuongNv = buildLuongNvReport(
        attendanceSheets,
        thuChiModels,
        todayVn,
        hhLoaiTru,
        luongNvConfig,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Sheets] cham cong: ${msg}`);
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
      thuChi: thuChiData.map((r) => ({
        ngay: r[0],
        thu: r[1],
        chi: r[2],
        ghiChu: r[3],
      })),
      coc: cocData.map((r) => ({
        ngay: r[0],
        thu: r[1],
        chi: r[2],
        ten: r[3],
        ghiChu: r[4],
      })),
      congNo: congNoData.map((r) => ({ ten: r[0], tienNo: r[1] })),
      banDao: banDaoData.map((r) => ({
        ngay: r[0],
        ten: r[1],
        diaChi: r[2],
        sdt: r[3],
        soLuong: r[4],
        gia: r[5],
        thanhTien: r[6],
      })),
      computed: {
        tongCoc: sumCocC,
        nhanCoc: sumCocB,
        tongCongNo: sumCongNoB,
        duDauNhap: duDauGoc,
        bienDongE2: bienDongSheetE2,
      },
      report: {
        byDay: reportDays,
        byMonth: reportMonths,
        todayVietnam: {
          date: todayVn,
          tongThu: todayThuChi.thu,
          tongChi: todayThuChi.chi,
        },
      },
      reportBanDao: {
        ...banDaoTotals,
        todayVietnam: { date: todayVn, tong: tongBanDaoGHomNay },
      },
      baoCaoTk: baoCaoTkEntries.map((e) => ({
        ngay: e.ngay,
        mcc: e.mcc,
        taiKhoan: e.taiKhoan,
        tenKhach: e.tenKhach,
        tongTieu: e.tongTieu,
        tongThu: e.tongThu,
        nguon: e.nguon,
      })),
      reportChiTieu,
      reportLuongNv,
      hhLoaiTru,
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
