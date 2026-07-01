import type { Env } from "../env";
import { HH_LOAI_TRU_TAB, parseHhLoaiTruSheetRows } from "../lib/hhLoaiTru";
import { listChamCongEmployeeTabs, readTyGiaF2, CHAM_CONG_TEMPLATE_TAB } from "../lib/chamCongSheet";
import { loadCommissionStartByEmployee } from "../lib/luongNvEmployeeConfig";
import { buildLuongNvConfig } from "../lib/luongNvConfig";
import { buildLuongNvReport, type LuongNvEmployeeRow } from "../lib/luongNvReport";
import {
  deductAdvanceForEmployee,
  loadPayrollStatusMap,
  markSalaryPaid,
  payrollStatusFor,
} from "../lib/luongNvPayrollStatus";
import {
  getSheetsAccessToken,
  sheetsBatchGetMergeSafe,
  sheetsListTabTitles,
} from "../lib/google";
import { normalizeThuChiDataRow } from "../lib/thuChiSheet";
import { verifySession } from "../lib/session";

const DEFAULT_SPREADSHEET_ID_CHAM_CONG = "1rZYkgdY6C4Tf1tOjqBw0hwkVE7pLGQlQSNS21ikjZ-w";

function spreadsheetIdChamCong(env: Env): string {
  const v = (env as { SPREADSHEET_ID_CHAM_CONG?: string }).SPREADSHEET_ID_CHAM_CONG?.trim();
  return v || DEFAULT_SPREADSHEET_ID_CHAM_CONG;
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function todayIsoVietnam(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function previousMonthIso(monthIso: string): string {
  const m = monthIso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthIso;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, "0")}`;
}

async function requireUser(env: Env, request: Request): Promise<Response | null> {
  const user = await verifySession(env, request.headers.get("Cookie"));
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

type EmployeePayrollContext = {
  emp: LuongNvEmployeeRow;
  attendanceRows: unknown[][];
};

async function loadEmployeePayrollContext(
  token: string,
  idMain: string,
  idChamCong: string,
  monthIso: string,
  tabName: string,
  todayVn: string,
): Promise<EmployeePayrollContext> {
  const batchMain = await sheetsBatchGetMergeSafe(token, idMain, [
    `'THU_CHI'!A1:E2000`,
    `${quoteSheetTitle(HH_LOAI_TRU_TAB)}!A1:E500`,
  ]);
  const tcBody = batchMain.data["THU_CHI"] ?? [];
  const thuChiModels =
    tcBody.length > 1
      ? tcBody.slice(1).map(normalizeThuChiDataRow).map((r) => ({
          ngay: r[0] ?? "",
          thu: r[1] ?? "",
          chi: r[2] ?? "",
          ten: r[3] ?? "",
          ghiChu: r[4] ?? "",
        }))
      : [];
  const hhLoaiTru = parseHhLoaiTruSheetRows(batchMain.data[HH_LOAI_TRU_TAB] ?? [], []);

  const titles = await sheetsListTabTitles(token, idChamCong);
  const employeeTitles = listChamCongEmployeeTabs(titles);
  const ranges = employeeTitles.map((t) => `${quoteSheetTitle(t)}!A1:F400`);
  const { data: batch } = await sheetsBatchGetMergeSafe(token, idChamCong, ranges);
  const attendanceSheets = employeeTitles.map((sheetTitle) => ({
    sheetTitle,
    rows: batch[sheetTitle] ?? [],
  }));

  const commissionStartByEmployee = await loadCommissionStartByEmployee(token, idChamCong);
  let tyGia = 0;
  let sourceTab = CHAM_CONG_TEMPLATE_TAB;
  for (const tab of [CHAM_CONG_TEMPLATE_TAB, "SU_BEO", ...employeeTitles]) {
    const v = await readTyGiaF2(token, idChamCong, tab);
    if (v > 0) {
      tyGia = v;
      sourceTab = tab;
      break;
    }
  }
  const luongNvConfig = buildLuongNvConfig(tyGia, sourceTab);
  const report = buildLuongNvReport(
    attendanceSheets,
    thuChiModels,
    todayVn,
    hhLoaiTru,
    luongNvConfig,
    commissionStartByEmployee,
  );
  const period = report.periods.find((p) => p.month === monthIso);
  const emp = period?.employees.find((e) => e.name === tabName);
  if (!emp) {
    throw new Error(`Không tìm thấy lương ${monthIso} cho «${tabName}».`);
  }
  const sheet = attendanceSheets.find((s) => s.sheetTitle === tabName);
  if (!sheet) {
    throw new Error(`Không tìm thấy tab «${tabName}».`);
  }
  return { emp, attendanceRows: sheet.rows };
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const deny = await requireUser(context.env, context.request);
  if (deny) return deny;
  if (!context.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    return Response.json({ error: "Thiếu GOOGLE_SERVICE_ACCOUNT_JSON." }, { status: 503 });
  }

  let body: { action?: string; tabName?: string; month?: string };
  try {
    body = (await context.request.json()) as { action?: string; tabName?: string; month?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  const tabName = String(body.tabName ?? "").trim();
  if (!tabName) return Response.json({ error: "Thiếu tabName." }, { status: 400 });

  const todayVn = todayIsoVietnam();
  const currentMonth = todayVn.slice(0, 7);
  const monthIso = String(body.month ?? "").trim().slice(0, 7) || previousMonthIso(currentMonth);

  try {
    const token = await getSheetsAccessToken(context.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const idChamCong = spreadsheetIdChamCong(context.env);
    const idMain = context.env.SPREADSHEET_ID_MAIN;

    let statusMap = await loadPayrollStatusMap(token, idChamCong);
    const existing = payrollStatusFor(statusMap, monthIso, tabName);

    if (action === "mark_paid") {
      if (existing?.paid) {
        return Response.json({ error: "Đã đánh dấu thanh toán cho kỳ này." }, { status: 409 });
      }
      if (existing?.advanceDeducted) {
        return Response.json({ error: "Đã khấu trừ tiền ứng — không thể đánh dấu thanh toán kiểu giữ nguyên ứng." }, { status: 409 });
      }

      const { emp, attendanceRows } = await loadEmployeePayrollContext(
        token,
        idMain,
        idChamCong,
        monthIso,
        tabName,
        todayVn,
      );
      const tienUngCu = emp.tienUngUsd ?? 0;
      const row = await markSalaryPaid(
        token,
        idChamCong,
        monthIso,
        tabName,
        tienUngCu,
        attendanceRows,
        todayVn,
        statusMap,
      );

      return Response.json({
        ok: true,
        action,
        carryUsd: tienUngCu,
        status: row,
        message:
          tienUngCu > 0.009
            ? `Đã thanh toán — giữ nguyên ứng ${tienUngCu.toFixed(2)} USD (ghi cột C ngày 01 tháng ${currentMonth}).`
            : `Đã thanh toán lương ${monthIso} — ${tabName}.`,
      });
    }

    if (action === "deduct_advance") {
      if (existing?.paid) {
        return Response.json({ error: "Đã thanh toán (giữ nguyên ứng) — không khấu trừ thêm." }, { status: 409 });
      }
      if (existing?.advanceDeducted) {
        return Response.json({ error: "Đã khấu trừ tiền ứng cho kỳ này." }, { status: 409 });
      }

      const { emp, attendanceRows } = await loadEmployeePayrollContext(
        token,
        idMain,
        idChamCong,
        monthIso,
        tabName,
        todayVn,
      );
      const tongLuong = emp.tongLuongUsd ?? 0;
      const tienUngCu = emp.tienUngUsd ?? 0;
      const { carryRemainingUsd, row } = await deductAdvanceForEmployee(
        token,
        idChamCong,
        monthIso,
        tabName,
        tienUngCu,
        tongLuong,
        attendanceRows,
        todayVn,
        statusMap,
      );

      return Response.json({
        ok: true,
        action,
        carryRemainingUsd,
        newAdvanceUsd: carryRemainingUsd > 0.009 ? carryRemainingUsd : 0,
        status: row,
        message:
          carryRemainingUsd > 0.009
            ? `Đã khấu trừ — ứng còn ${carryRemainingUsd.toFixed(2)} USD (ghi cột C ngày 01 tháng ${currentMonth}).`
            : `Đã khấu trừ hết ứng — cột C ngày 01 = 0.`,
      });
    }

    return Response.json({ error: "action phải là mark_paid hoặc deduct_advance." }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Không tìm thấy") ? 404 : 500;
    return Response.json({ error: msg }, { status });
  }
};
