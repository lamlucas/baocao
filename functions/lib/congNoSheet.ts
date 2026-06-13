import {
  sheetsBatchGet,
  sheetsGetSheetIdByTitle,
  sheetsSpreadsheetBatchUpdate,
} from "./google";
import { num } from "./thuChiSheet";

const CONG_NO_MAX_ROW = 500;

function quoteSheet(title: string): string {
  const escaped = title.replace(/'/g, "''");
  return `'${escaped}'`;
}

/** Thu (cột B THU_CHI) khớp nợ CONG_NO (cột B) khi chênh lệch < 1. */
function amountMatchesCongNoDebt(thuAmount: number, debtColumnB: string): boolean {
  const debt = num(debtColumnB);
  if (!Number.isFinite(debt) || debt <= 0) return false;
  return Math.abs(thuAmount - debt) < 1;
}

function findRowToDelete(
  rows: unknown[][],
  customerColD: string,
  thuAmount: number,
): number | null {
  const keyLow = customerColD.trim().toLowerCase();
  if (!keyLow) return null;
  for (let i = 0; i < rows.length; i++) {
    const a = String(rows[i][0] ?? "").trim();
    if (!a || a.toLowerCase() !== keyLow) continue;
    const b = String(rows[i][1] ?? "").trim();
    if (!b) continue;
    if (amountMatchesCongNoDebt(thuAmount, b)) return i + 2;
  }
  return null;
}

/**
 * Sau lệnh Thu: nếu tên (ghi chú / cột D) khớp cột A CONG_NO (không phân biệt hoa thường)
 * và số thu chênh nợ < 1 → xóa cả dòng CONG_NO.
 */
export async function maybeDeleteCongNoRowAfterThu(
  accessToken: string,
  spreadsheetIdDebt: string,
  sheetTab: string,
  thuNoteColD: string,
  thuAmount: number,
): Promise<boolean> {
  if (!Number.isFinite(thuAmount) || thuAmount <= 0) return false;
  const name = thuNoteColD.trim();
  if (!name) return false;

  const q = quoteSheet(sheetTab);
  const batch = await sheetsBatchGet(accessToken, spreadsheetIdDebt, [
    `${q}!A2:B${CONG_NO_MAX_ROW}`,
  ]);
  const rows = batch[sheetTab] ?? [];
  const row1Based = findRowToDelete(rows, name, thuAmount);
  if (row1Based == null) return false;

  const sheetId = await sheetsGetSheetIdByTitle(accessToken, spreadsheetIdDebt, sheetTab);
  if (sheetId == null) return false;

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
  return true;
}
