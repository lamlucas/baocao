import type { Env } from "../env";
import { HH_LOAI_TRU_TAB, parseHhLoaiTruSheetRows } from "./hhLoaiTru";
import {
  listChamCongEmployeeTabs,
  readTyGiaF2,
} from "./chamCongSheet";
import { ensureTodayDateRowsAllTabs } from "./chamCongDateRoll";
import { syncAdvanceCarryToFirstDayAllTabs } from "./tienUngCarrySync";
import { buildLuongNvConfig, CHAM_CONG_TEMPLATE_TAB } from "./luongNvConfig";
import { loadCommissionStartByEmployee } from "./luongNvEmployeeConfig";
import { loadHhNgayOffList, hhNgayOffMapFromRows } from "./hhNgayOff";
import {
  buildLuongNvReport,
  filterAttendanceSheetTitles,
  type AttendanceSheetRows,
  type LuongNvEmployeeRow,
  type LuongNvPeriod,
} from "./luongNvReport";
import {
  getSheetsAccessToken,
  sheetsBatchGetMergeSafe,
  sheetsListTabTitles,
} from "./google";
import { flexibleDateToIso, normalizeThuChiDataRow, num } from "./thuChiSheet";
import { telegramSendMessage } from "./telegramSend";

const CHAT_NOI_BO_DEFAULT = "-1003978420142";

function noiBoChatId(env: Env): string {
  const v = (env as { TELEGRAM_NOI_BO_CHAT_ID?: string }).TELEGRAM_NOI_BO_CHAT_ID;
  return (v && String(v).trim()) || CHAT_NOI_BO_DEFAULT;
}

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

async function loadAttendanceSheets(
  token: string,
  spreadsheetId: string,
): Promise<AttendanceSheetRows[]> {
  const titles = filterAttendanceSheetTitles(await sheetsListTabTitles(token, spreadsheetId));
  if (!titles.length) return [];
  const ranges = titles.map((t) => `${quoteSheetTitle(t)}!A1:F400`);
  const { data: batch } = await sheetsBatchGetMergeSafe(token, spreadsheetId, ranges);
  return titles.map((sheetTitle) => ({
    sheetTitle,
    rows: batch[sheetTitle] ?? [],
  }));
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtUsdOrDash(n: number): string {
  return n > 0.009 ? fmtUsd(n) : "—";
}

function monthLabelVi(monthIso: string): string {
  const m = monthIso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthIso;
  return `${m[2]}/${m[1]}`;
}

function formatEmployeeBlock(emp: LuongNvEmployeeRow, period: LuongNvPeriod): string {
  const tongLuong = emp.tongLuongUsd ?? 0;
  const thucNhan = emp.thucNhanUsd ?? emp.totalSalaryUsd ?? tongLuong - (emp.tienUngUsd ?? 0);
  const lines = [
    `Tên: ${emp.name}`,
    `Ngày Công: ${emp.workingDays} / ${period.daysInMonth}`,
    `Lương CB: ${fmtUsd(emp.baseSalaryUsd)}`,
    `HH: ${fmtUsd(emp.commissionUsd)}`,
    `Tiền Phạt: ${fmtUsdOrDash(emp.tienPhatUsd)}`,
    `Tiền Thưởng: ${fmtUsdOrDash(emp.tienThuongUsd)}`,
    `Tổng Lương: ${fmtUsd(tongLuong)}`,
    `Tiền Ứng: ${fmtUsdOrDash(emp.tienUngUsd)}`,
    `Thực Nhận: ${fmtUsd(thucNhan)}`,
  ];
  return lines.join("\n");
}

export function buildLuongNvMonthlyTelegramText(period: LuongNvPeriod): string {
  const header = `Bảng Lương Tháng ${monthLabelVi(period.month)}`;
  const blocks = (period.employees ?? []).map((emp) => formatEmployeeBlock(emp, period));
  if (!blocks.length) return `${header}\n\n(Chưa có nhân viên trên file chấm công)`;
  return `${header}\n\n${blocks.join("\n\n")}`;
}

/** Gửi bảng lương tháng trước + đồng bộ tiền ứng cột C ngày 1. */
export async function runLuongNvMonthlyBot(env: Env): Promise<{ sent: boolean; month: string }> {
  const botToken = env.TELEGRAM_LUONG_NV_BOT_TOKEN?.trim();
  if (!botToken) {
    console.error("[luongNvMonthlyBot] Thiếu TELEGRAM_LUONG_NV_BOT_TOKEN (@Blackcorp7777_bot)");
    return { sent: false, month: "" };
  }

  const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const idMain = env.SPREADSHEET_ID_MAIN;
  const idChamCong = spreadsheetIdChamCong(env);
  const todayVn = todayIsoVietnam();

  const batchMain = await sheetsBatchGetMergeSafe(token, idMain, [
    `'THU_CHI'!A1:E2000`,
    `${quoteSheetTitle(HH_LOAI_TRU_TAB)}!A1:E500`,
  ]);
  const tcBody = batchMain.data["THU_CHI"] ?? [];
  const thuChiData = tcBody.length > 1 ? tcBody.slice(1).map(normalizeThuChiDataRow) : [];
  const thuChiModels = thuChiData.map((r) => ({
    ngay: r[0] ?? "",
    thu: r[1] ?? "",
    chi: r[2] ?? "",
    ten: r[3] ?? "",
    ghiChu: r[4] ?? "",
  }));

  const hhLoaiTruRaw = batchMain.data[HH_LOAI_TRU_TAB] ?? [];
  let hhLoaiTruFormatted: unknown[][] = [];
  try {
    const hhFmt = await sheetsBatchGetMergeSafe(
      token,
      idMain,
      [`${quoteSheetTitle(HH_LOAI_TRU_TAB)}!A1:E500`],
      "FORMATTED_VALUE",
    );
    hhLoaiTruFormatted = hhFmt.data[HH_LOAI_TRU_TAB] ?? [];
  } catch {
    /* optional formatted read */
  }
  const hhLoaiTru = parseHhLoaiTruSheetRows(hhLoaiTruRaw, hhLoaiTruFormatted);

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
  const luongNvConfig = buildLuongNvConfig(tyGia, sourceTab);
  const commissionStartByEmployee = await loadCommissionStartByEmployee(token, idChamCong);
  const hhNgayOffList = await loadHhNgayOffList(token, idChamCong);
  const hhNgayOffByEmployee = hhNgayOffMapFromRows(
    hhNgayOffList.map((e) => [e.tabName, e.ngay]),
  );

  await ensureTodayDateRowsAllTabs(token, idChamCong);
  let attendanceSheets = await loadAttendanceSheets(token, idChamCong);
  attendanceSheets = await syncAdvanceCarryToFirstDayAllTabs(
    token,
    idChamCong,
    attendanceSheets,
    thuChiModels,
    todayVn,
    hhLoaiTru,
    luongNvConfig,
    () => loadAttendanceSheets(token, idChamCong),
    commissionStartByEmployee,
    hhNgayOffByEmployee,
  );

  const report = buildLuongNvReport(
    attendanceSheets,
    thuChiModels,
    todayVn,
    hhLoaiTru,
    luongNvConfig,
    commissionStartByEmployee,
    hhNgayOffByEmployee,
  );
  const previousPeriod = report.periods.find((p) => p.kind === "previous");
  if (!previousPeriod) {
    console.error("[luongNvMonthlyBot] Không có kỳ tháng trước");
    return { sent: false, month: "" };
  }

  const text = buildLuongNvMonthlyTelegramText(previousPeriod);
  await telegramSendMessage(botToken, noiBoChatId(env), text);
  return { sent: true, month: previousPeriod.month };
}
