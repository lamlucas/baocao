import {
  sheetsBatchGet,
  sheetsGetSheetIdByTitle,
  sheetsPutValues,
  sheetsSpreadsheetBatchUpdate,
} from "./google";
import { num } from "./thuChiSheet";

const CONG_NO_MAX_ROW = 500;

export type CongNoAfterThuResult = "deleted" | "updated" | "none";

function quoteSheet(title: string): string {
  const escaped = title.replace(/'/g, "''");
  return `'${escaped}'`;
}

type CongNoRowMatch = { row1Based: number; debt: number };

function findCongNoRowByName(rows: unknown[][], customerColD: string): CongNoRowMatch | null {
  const keyLow = customerColD.trim().toLowerCase();
  if (!keyLow) return null;
  for (let i = 0; i < rows.length; i++) {
    const a = String(rows[i][0] ?? "").trim();
    if (!a || a.toLowerCase() !== keyLow) continue;
    const bRaw = String(rows[i][1] ?? "").trim();
    if (!bRaw) continue;
    const debt = num(bRaw);
    if (!Number.isFinite(debt) || debt <= 0) continue;
    return { row1Based: i + 2, debt };
  }
  return null;
}

async function deleteCongNoRow(
  accessToken: string,
  spreadsheetIdDebt: string,
  sheetTab: string,
  row1Based: number,
): Promise<void> {
  const sheetId = await sheetsGetSheetIdByTitle(accessToken, spreadsheetIdDebt, sheetTab);
  if (sheetId == null) throw new Error(`Không tìm thấy sheetId tab ${sheetTab}`);
  await sheetsSpreadsheetBatchUpdate(accessToken, spreadsheetIdDebt, [
    {
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: row1Based - 1,
          endIndex: row1Based,
        },
      },
    },
  ]);
}

/**
 * Sau lệnh Thu (THU_CHI cột D = tên, cột B = số thu):
 * - Tên khớp cột A CONG_NO (không phân biệt hoa thường)
 * - |thu − nợ| < 1 → xóa dòng CONG_NO
 * - |thu − nợ| ≥ 1 → cột B CONG_NO = nợ − thu (nợ còn lại; nếu < 1 thì xóa dòng)
 */
export async function applyCongNoAfterThu(
  accessToken: string,
  spreadsheetIdDebt: string,
  sheetTab: string,
  thuNoteColD: string,
  thuAmount: number,
): Promise<CongNoAfterThuResult> {
  if (!Number.isFinite(thuAmount) || thuAmount <= 0) return "none";
  const name = thuNoteColD.trim();
  if (!name) return "none";

  const q = quoteSheet(sheetTab);
  const batch = await sheetsBatchGet(accessToken, spreadsheetIdDebt, [
    `${q}!A2:B${CONG_NO_MAX_ROW}`,
  ]);
  const rows = batch[sheetTab] ?? [];
  const match = findCongNoRowByName(rows, name);
  if (!match) return "none";

  const { row1Based, debt } = match;
  const diff = Math.abs(thuAmount - debt);

  if (diff < 1) {
    await deleteCongNoRow(accessToken, spreadsheetIdDebt, sheetTab, row1Based);
    return "deleted";
  }

  const newDebt = debt - thuAmount;
  if (newDebt < 1) {
    await deleteCongNoRow(accessToken, spreadsheetIdDebt, sheetTab, row1Based);
    return "deleted";
  }

  await sheetsPutValues(
    accessToken,
    spreadsheetIdDebt,
    `${q}!B${row1Based}`,
    [[newDebt]],
    "USER_ENTERED",
  );
  return "updated";
}

/** @deprecated Dùng applyCongNoAfterThu */
export async function maybeDeleteCongNoRowAfterThu(
  accessToken: string,
  spreadsheetIdDebt: string,
  sheetTab: string,
  thuNoteColD: string,
  thuAmount: number,
): Promise<boolean> {
  const r = await applyCongNoAfterThu(
    accessToken,
    spreadsheetIdDebt,
    sheetTab,
    thuNoteColD,
    thuAmount,
  );
  return r === "deleted";
}
