import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGet, sheetsBatchUpdate } from "../lib/google";
import {
  buildThuChiRowsWithBalance,
  latestBalanceFromBuiltMatrix,
  num,
  padMatrix,
  parseRows,
  sheetRowsToThuChiModels,
} from "../lib/thuChiSheet";

const SHEET_TQ = "TONG_QUAN";
const SHEET_TC = "THU_CHI";
const SHEET_COC = "COC";
const SHEET_CN = "CONG_NO";

const DEFAULT_CHAT_ID = "-1003727898214";

function allowedChatId(env: Env): string {
  const v = (env as { TELEGRAM_THU_CHI_CHAT_ID?: string }).TELEGRAM_THU_CHI_CHAT_ID;
  return (v && String(v).trim()) || DEFAULT_CHAT_ID;
}

function parseThuChiMessage(text: string): { kind: "THU" | "CHI"; amountStr: string; note: string } | null {
  const t = text.trim();
  const head = t.match(/^(THU|CHI)\s*:\s*(.+)$/i);
  if (!head) return null;
  const kind = head[1].toUpperCase() === "THU" ? "THU" : "CHI";
  const rest = head[2].trim();
  const idx = rest.search(/\s-\s/);
  if (idx === -1) return null;
  const amountStr = rest.slice(0, idx).trim();
  const note = rest.slice(idx + 3).trim();
  if (!amountStr || !note) return null;
  if (!/\d/.test(amountStr.replace(/\s/g, ""))) return null;
  if (!Number.isFinite(num(amountStr))) return null;
  return { kind, amountStr, note };
}

function formatNgayFromTelegram(unixSec: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSec * 1000));
}

async function telegramSendMessage(botToken: string, chatId: number, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("telegram sendMessage", res.status, err);
  }
}

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
    date?: number;
  };
};

export const onRequestGet: PagesFunction<Env> = async () => {
  return new Response("THU_CHI Telegram webhook (POST)", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const botToken = (env as { TELEGRAM_BOT_TOKEN?: string }).TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN chưa cấu hình" });
  }

  const secret = (env as { TELEGRAM_WEBHOOK_SECRET?: string }).TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret) {
    const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (got !== secret) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim();
  const unix = msg?.date;

  if (chatId == null || !text || unix == null) {
    return Response.json({ ok: true, ignored: true });
  }

  if (String(chatId) !== allowedChatId(env)) {
    return Response.json({ ok: true, ignored: true });
  }

  const parsed = parseThuChiMessage(text);
  if (!parsed) {
    return Response.json({ ok: true, ignored: true });
  }

  const ngay = formatNgayFromTelegram(unix);
  const amount = String(num(parsed.amountStr));
  const thu = parsed.kind === "THU" ? amount : "";
  const chi = parsed.kind === "CHI" ? amount : "";

  try {
    const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const rangesMain = [
      `'${SHEET_TQ}'!A1:E2`,
      `'${SHEET_TC}'!A1:E2000`,
      `'${SHEET_COC}'!A1:D2000`,
    ];
    const batchMain = await sheetsBatchGet(token, env.SPREADSHEET_ID_MAIN, rangesMain);
    const tq = batchMain[SHEET_TQ] ?? [];
    const tc = batchMain[SHEET_TC] ?? [];
    const coc = batchMain[SHEET_COC] ?? [];

    const a2 = (tq[1] ?? [])[0] ?? "0";
    const duDau = num(String(a2));

    const thuChiData = tc.length > 1 ? parseRows(tc.slice(1), 5) : [];
    const models = sheetRowsToThuChiModels(thuChiData);
    models.push({
      ngay,
      thu,
      chi,
      ghiChu: parsed.note,
    });

    const thuChiRows = buildThuChiRowsWithBalance(models, duDau);
    const thuChiPadded = padMatrix(thuChiRows, 5);

    const cocData = coc.length > 1 ? parseRows(coc.slice(1), 4) : [];
    const sumCocB = cocData.reduce((s, r) => s + num(r[1]), 0);
    const sumCocC = cocData.reduce((s, r) => s + num(r[2]), 0);
    const b2 = String(sumCocC);
    const c2 = String(sumCocB);

    const debtRanges = [`'${SHEET_CN}'!A1:B2000`];
    const debtData = await sheetsBatchGet(token, env.SPREADSHEET_ID_DEBT_SALES, debtRanges);
    const congNoRows = debtData[SHEET_CN] ?? [];
    const congNoData = congNoRows.length > 1 ? parseRows(congNoRows.slice(1), 2) : [];
    const sumCongNoB = congNoData.reduce((s, r) => s + num(r[1]), 0);
    const d2 = String(sumCongNoB);
    const latestBalance = latestBalanceFromBuiltMatrix(thuChiRows, duDau);
    const e2 = String(latestBalance);

    const tqRows: string[][] = [
      ["Dư đầu", "Tổng cọc", "Nhận cọc", "Tổng công nợ", "Biến động"],
      [String(a2), b2, c2, d2, e2],
    ];

    await sheetsBatchUpdate(token, env.SPREADSHEET_ID_MAIN, [
      { range: `'${SHEET_TQ}'!A1:E2`, values: tqRows },
      { range: `'${SHEET_TC}'!A1:E${thuChiPadded.length}`, values: thuChiPadded },
    ]);

    const label = parsed.kind === "THU" ? "Thu" : "Chi";
    await telegramSendMessage(
      botToken,
      chatId,
      `Đã ghi ${label} ${amount} — ${parsed.note} (ngày ${ngay}).`,
    );
    return Response.json({ ok: true });
  } catch (e) {
    const msgErr = e instanceof Error ? e.message : String(e);
    console.error("telegram-webhook sheet error", msgErr);
    await telegramSendMessage(botToken, chatId, `Lỗi ghi Sheet: ${msgErr}`);
    return Response.json({ ok: false, error: msgErr }, { status: 500 });
  }
};
