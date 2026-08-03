import { appendHhLoaiTruRulesToSheet, type HhLoaiTruRule } from "./hhLoaiTru";
import { listChamCongEmployeeTabs } from "./chamCongSheet";
import {
  getSheetsAccessToken,
  sheetsBatchGet,
  sheetsBatchUpdate,
  sheetsListTabTitles,
  sheetsValuesAppend,
} from "./google";
import {
  loadPayrollStatusMap,
  payrollStatusFor,
  recordLuongChiPayment,
} from "./luongNvPayrollStatus";
import { buildThuChiAppendRow, flexibleDateToIso, num } from "./thuChiSheet";

export type LuongChiParsed = {
  amountStr: string;
  employeeInput: string;
};

const LUONG_NOTE_RE = /^lương$/i;

/** Cú pháp 4 dòng: Chi / số tiền / Tên NV / Lương */
export function parseLuongChiBlockMessage(text: string): LuongChiParsed | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 4) return null;
  if (lines[0]!.toUpperCase() !== "CHI") return null;
  if (!LUONG_NOTE_RE.test(lines[3]!)) return null;
  const amountStr = lines[1]!.replace(/\s/g, "");
  const employeeInput = lines[2]!.trim();
  if (!amountStr || !employeeInput || !Number.isFinite(num(amountStr))) return null;
  return { amountStr, employeeInput };
}

export function isLuongChiNote(note: string): boolean {
  return LUONG_NOTE_RE.test(String(note ?? "").trim());
}

export function resolveEmployeeTabName(input: string, employeeTabs: string[]): string | null {
  const needle = input.trim().toLowerCase();
  if (!needle) return null;
  const exact = employeeTabs.find((t) => t.toLowerCase() === needle);
  if (exact) return exact;
  const partial = employeeTabs.filter(
    (t) => t.toLowerCase().includes(needle) || needle.includes(t.toLowerCase()),
  );
  if (partial.length === 1) return partial[0]!;
  return null;
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

function formatNgayVn(isoDate: string): string {
  const iso = flexibleDateToIso(isoDate);
  if (iso.length < 10) return isoDate;
  const [y, mo, d] = iso.split("-");
  return `${d}/${mo}/${y}`;
}

export type ProcessLuongChiResult = {
  tabName: string;
  amountUsd: number;
  payrollMonth: string;
  payDateIso: string;
};

/** Ghi THU_CHI + HH_LOAI_TRU + LUONG_TT cho lệnh Chi/Lương Telegram. */
export async function processLuongChiTelegramPayment(
  serviceAccountJson: string,
  spreadsheetIdMain: string,
  spreadsheetIdChamCong: string,
  parsed: LuongChiParsed,
  payDateIso: string,
): Promise<ProcessLuongChiResult> {
  const token = await getSheetsAccessToken(serviceAccountJson);
  const amountUsd = num(parsed.amountStr);
  const employeeTabs = listChamCongEmployeeTabs(
    await sheetsListTabTitles(token, spreadsheetIdChamCong),
  );
  const tabName = resolveEmployeeTabName(parsed.employeeInput, employeeTabs);
  if (!tabName) {
    throw new Error(
      `Không tìm thấy tab NV «${parsed.employeeInput}». Tab có: ${employeeTabs.join(", ") || "(trống)"}`,
    );
  }

  const payrollMonth = previousMonthIso(payDateIso.slice(0, 7));

  const batchTq = await sheetsBatchGet(token, spreadsheetIdMain, [`'TONG_QUAN'!A1:E2`]);
  const tq = batchTq["TONG_QUAN"] ?? [];
  const a2Num = num(String(tq[1]?.[0] ?? "0"));
  const batchCoc = await sheetsBatchGet(token, spreadsheetIdMain, [`'COC'!A1:E2000`]);
  const cocRaw = batchCoc["COC"] ?? [];
  const cocData = cocRaw.length > 1 ? cocRaw.slice(1) : [];
  let b2Chi = 0;
  let c2Thu = 0;
  for (const r of cocData) {
    b2Chi += num(r[2]);
    c2Thu += num(r[1]);
  }

  const thuChiRow = buildThuChiAppendRow({
    ngay: payDateIso,
    thu: "",
    chi: String(amountUsd),
    ten: tabName,
    ghiChu: "Lương",
  });
  await sheetsValuesAppend(token, spreadsheetIdMain, `'THU_CHI'!A:E`, [thuChiRow], "USER_ENTERED");
  await sheetsBatchUpdate(token, spreadsheetIdMain, [
    { range: `'TONG_QUAN'!A2:C2`, values: [[a2Num, b2Chi, c2Thu]] },
  ]);

  const hhRule: HhLoaiTruRule = {
    ngay: payDateIso,
    tenDaiLy: tabName,
    khoanThu: 0,
    khoanChi: amountUsd,
    note: "Lương",
  };
  await appendHhLoaiTruRulesToSheet(token, spreadsheetIdMain, [hhRule]);

  const statusMap = await loadPayrollStatusMap(token, spreadsheetIdChamCong);
  const prev = payrollStatusFor(statusMap, payrollMonth, tabName);
  await recordLuongChiPayment(
    token,
    spreadsheetIdChamCong,
    payrollMonth,
    tabName,
    amountUsd,
    payDateIso,
    statusMap,
    prev?.carryRemainingUsd ?? 0,
  );

  return { tabName, amountUsd, payrollMonth, payDateIso };
}

export function formatLuongChiTelegramReply(result: ProcessLuongChiResult): string {
  return (
    `Đã ghi Chi ${result.amountUsd} — ${result.tabName} (Lương)\n` +
    `• THU_CHI ngày ${formatNgayVn(result.payDateIso)}\n` +
    `• HH_LOAI_TRU loại trừ HH\n` +
    `• LUONG_TT: đã TT lương ${result.payrollMonth} (${formatNgayVn(result.payDateIso)})`
  );
}
