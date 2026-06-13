import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGet, sheetsBatchGetMergeSafe, sheetsBatchUpdate, sheetsValuesAppend } from "../lib/google";
import {
  buildCocAppendRows,
  buildCongNoAppendRows,
  buildThuChiAppendRow,
  isoToSheetDateInput,
  normalizeCocDataRow,
  num,
  rateNumericOrEmpty,
  stringifySheetRow,
} from "../lib/thuChiSheet";

const SHEET_TQ = "TONG_QUAN";
const SHEET_TC = "THU_CHI";
const SHEET_COC = "COC";
const SHEET_CN = "CONG_NO";
const SHEET_BAO_CAO_TK = "BAO_CAO_TK";

const CHAT_THU_CHI_DEFAULT = "-1003727898214";
const CHAT_BAO_CAO_DEFAULT = "-1003992397667";

function thuChiChatId(env: Env): string {
  const v = (env as { TELEGRAM_THU_CHI_CHAT_ID?: string }).TELEGRAM_THU_CHI_CHAT_ID;
  return (v && String(v).trim()) || CHAT_THU_CHI_DEFAULT;
}
function baoCaoChatId(env: Env): string {
  const v = (env as { TELEGRAM_BAO_CAO_CHAT_ID?: string }).TELEGRAM_BAO_CAO_CHAT_ID;
  return (v && String(v).trim()) || CHAT_BAO_CAO_DEFAULT;
}

/** THU: số - ghi chú / CHI: số - ghi chú */
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

/** Tab COC: dòng mới — A ngày (GMT+7), B Thu, C Chi, D Tên, E Ghi chú.
 * Cú pháp mới: `CỌC - THU - 1000 - VL - THẲNG` / `CỌC - CHI - ...` (nhóm Thu chi).
 * Legacy: `CỌC:` + `THU|CHI - số - ghi chú` (D/E để trống / gộp vào note). */
type CocParsedLine = {
  kind: "THU" | "CHI";
  amountStr: string;
  ten: string;
  note: string;
};

function parseCocDashLine(line: string): CocParsedLine | null {
  const m = line.match(/^CỌC\s*-\s*(THU|CHI)\s*-\s*([\d\s.,]+)\s*-\s*(.+?)\s*-\s*(.+)$/i);
  if (!m) return null;
  const kind = m[1]!.toUpperCase() === "THU" ? "THU" : "CHI";
  const amountStr = m[2]!.trim();
  const ten = m[3]!.trim();
  const note = m[4]!.trim();
  if (!amountStr || !ten || !note || !Number.isFinite(num(amountStr))) return null;
  return { kind, amountStr, ten, note };
}

function parseCocMessage(text: string): { lines: CocParsedLine[] } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const dashParsed = lines.map(parseCocDashLine);
  if (dashParsed.every((x) => x != null)) {
    return { lines: dashParsed as CocParsedLine[] };
  }

  const pushThuChiLine = (line: string, out: CocParsedLine[]) => {
    const m = line.match(/^(THU|CHI)\s*-\s*([\d\s.,]+)\s*-\s*(.+)$/i);
    if (!m) return;
    const kind = m[1]!.toUpperCase() === "THU" ? "THU" : "CHI";
    const amountStr = m[2]!.trim();
    const note = m[3]!.trim();
    if (!amountStr || !note || !Number.isFinite(num(amountStr))) return;
    out.push({ kind, amountStr, ten: "", note });
  };

  if (lines.length === 1) {
    const m = lines[0]!.match(/^CỌC\s*:\s*(THU|CHI)\s*-\s*([\d\s.,]+)\s*-\s*(.+)$/i);
    if (!m) return null;
    const kind = m[1]!.toUpperCase() === "THU" ? "THU" : "CHI";
    const amountStr = m[2]!.trim();
    const note = m[3]!.trim();
    if (!amountStr || !note || !Number.isFinite(num(amountStr))) return null;
    return { lines: [{ kind, amountStr, ten: "", note }] };
  }

  if (!/^CỌC\s*:/i.test(lines[0]!)) return null;
  const out: CocParsedLine[] = [];

  const afterCoc = lines[0]!.replace(/^CỌC\s*:/i, "").trim();
  if (afterCoc) pushThuChiLine(afterCoc, out);

  for (let i = 1; i < lines.length; i++) {
    pushThuChiLine(lines[i]!, out);
  }
  return out.length ? { lines: out } : null;
}

/** Dòng đầu CÔNG NỢ: rồi Tên - số */
function parseCongNoMessage(text: string): { pairs: { name: string; amountStr: string }[] } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  if (!/^CÔNG\s*NỢ\s*:/i.test(lines[0]!)) return null;
  const pairs: { name: string; amountStr: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const idx = line.lastIndexOf("-");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const amountStr = line.slice(idx + 1).trim();
    if (!name || !amountStr || !Number.isFinite(num(amountStr))) continue;
    pairs.push({ name, amountStr });
  }
  return pairs.length ? { pairs } : null;
}

function parseBaoCaoMessage(text: string): {
  mcc: string;
  taiKhoan: string[];
  tenPairs: { d: string; e: string }[];
} | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let mcc = "";
  const tk: string[] = [];
  const tenPairs: { d: string; e: string }[] = [];
  let phase: "none" | "mcc" | "tk" | "ten" = "none";

  for (const line of lines) {
    if (!line) continue;
    if (/^MCC\s*:/i.test(line)) {
      phase = "mcc";
      mcc = line.replace(/^MCC\s*:\s*/i, "").trim();
      continue;
    }
    if (/^TÀI\s*KHOẢN\s*:/i.test(line) || /^TAI\s*KHOAN\s*:/i.test(line)) {
      phase = "tk";
      const r = line.replace(/^TÀI\s*KHOẢN\s*:\s*/i, "").replace(/^TAI\s*KHOAN\s*:\s*/i, "").trim();
      if (r) tk.push(r);
      continue;
    }
    if (/^TÊN\s*:/i.test(line)) {
      phase = "ten";
      const r = line.replace(/^TÊN\s*:\s*/i, "").trim();
      if (r) {
        for (const part of r.split(/[,;]/)) {
          const p = part.trim();
          const m = p.match(/^(.+?)\s*-\s*([\d\s.,]+)\s*$/);
          if (m) tenPairs.push({ d: m[1]!.trim(), e: m[2]!.trim() });
        }
      }
      continue;
    }
    if (phase === "tk") tk.push(line);
    else if (phase === "ten") {
      const m = line.match(/^(.+?)\s*-\s*([\d\s.,]+)\s*$/);
      if (m) tenPairs.push({ d: m[1]!.trim(), e: m[2]!.trim() });
    }
  }
  if (!mcc && tk.length === 0 && tenPairs.length === 0) return null;
  return { mcc, taiKhoan: tk, tenPairs };
}

/** Chỉ các dòng mới gửi lên API append (không đọc/ghi lại toàn bảng — giữ % cột E, định dạng ngày cột A). */
function buildBaoCaoTkNewRowsOnly(
  mcc: string,
  taiKhoan: string[],
  tenPairs: { d: string; e: string }[],
  ngay: string,
): (string | number)[][] {
  const n = Math.max(taiKhoan.length, tenPairs.length, 1);
  const rows: (string | number)[][] = [];
  for (let i = 0; i < n; i++) {
    rows.push([
      isoToSheetDateInput(ngay),
      mcc,
      taiKhoan[i] ?? "",
      tenPairs[i]?.d ?? "",
      rateNumericOrEmpty(tenPairs[i]?.e ?? ""),
    ]);
  }
  return rows;
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

async function telegramCopyMessage(
  botToken: string,
  toChatId: number,
  fromChatId: number,
  messageId: number,
): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/copyMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("telegram copyMessage", res.status, err);
    return false;
  }
  return true;
}

type TelegramMessage = {
  message_id?: number;
  chat?: { id?: number };
  text?: string;
  date?: number;
  photo?: { file_id: string }[];
  document?: { mime_type?: string };
};

function replyHasForwardableImage(reply: TelegramMessage | undefined): boolean {
  if (!reply) return false;
  if (reply.photo?.length) return true;
  const mime = reply.document?.mime_type ?? "";
  return mime.startsWith("image/");
}

type TelegramUpdate = {
  message?: TelegramMessage & {
    reply_to_message?: TelegramMessage;
  };
};

type ThuChiParsed = { kind: "THU" | "CHI"; amountStr: string; note: string };

/** Ghi một dòng THU_CHI + cập nhật TONG_QUAN A2:C2 (cùng logic nhóm Thu chi). */
async function writeThuChiEntryToSheet(env: Env, unix: number, thuChiOne: ThuChiParsed): Promise<void> {
  const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const idMain = env.SPREADSHEET_ID_MAIN;

  const batchTq = await sheetsBatchGet(token, idMain, [`'${SHEET_TQ}'!A1:E2`]);
  const batchCoc = await sheetsBatchGetMergeSafe(token, idMain, [`'${SHEET_COC}'!A1:E2000`]);
  const cocRaw = batchCoc.data[SHEET_COC] ?? [];
  const tq = (batchTq[SHEET_TQ] ?? []).map(stringifySheetRow);

  const a2Raw = (tq[1] ?? [])[0] ?? "0";
  const a2Num = num(String(a2Raw));
  const cocData = cocRaw.length > 1 ? cocRaw.slice(1).map(normalizeCocDataRow) : [];

  const sumFromCoc = (rows: string[][]) =>
    rows.reduce(
      (s, r) => ({ b2Chi: s.b2Chi + num(r[2]), c2Thu: s.c2Thu + num(r[1]) }),
      { b2Chi: 0, c2Thu: 0 },
    );
  const cocRowsForSum = cocData.map((r) => [
    String(r[0] ?? ""),
    String(r[1] ?? ""),
    String(r[2] ?? ""),
    String(r[3] ?? ""),
    String(r[4] ?? ""),
  ]);
  const sumCoc = sumFromCoc(cocRowsForSum);
  const tqRow2 = [[a2Num, sumCoc.b2Chi, sumCoc.c2Thu]] as (string | number)[][];

  const ngay = formatNgayFromTelegram(unix);
  const amount = String(num(thuChiOne.amountStr));
  const thu = thuChiOne.kind === "THU" ? amount : "";
  const chi = thuChiOne.kind === "CHI" ? amount : "";
  const appendRow = buildThuChiAppendRow({ ngay, thu, chi, ghiChu: thuChiOne.note });

  await sheetsValuesAppend(token, idMain, `'${SHEET_TC}'!A:D`, [appendRow], "USER_ENTERED");
  await sheetsBatchUpdate(token, idMain, [{ range: `'${SHEET_TQ}'!A2:C2`, values: tqRow2 }]);
}

export const onRequestGet: PagesFunction<Env> = async () => {
  return new Response("Telegram webhook (POST)", {
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

  const sid = String(chatId);
  const thuChiDest = thuChiChatId(env);
  const thuChiParsed = parseThuChiMessage(text);
  const replyTo = msg?.reply_to_message;

  /** Thu:/Chi: mọi nhóm (trừ nhóm Thu chi) → chuyển ảnh (nếu reply ảnh) + tin nhắn sang Thu chi + ghi Sheet. */
  if (thuChiParsed && sid !== thuChiDest) {
    const destId = Number(thuChiDest);
    try {
      if (replyHasForwardableImage(replyTo) && replyTo?.message_id != null) {
        const copied = await telegramCopyMessage(botToken, destId, chatId, replyTo.message_id);
        if (!copied) {
          await telegramSendMessage(
            botToken,
            chatId,
            "Không chuyển được ảnh sang nhóm Thu chi. Kiểm tra bot có trong nhóm đích và quyền gửi tin.",
          );
          return Response.json({ ok: false, error: "copyMessage failed" }, { status: 500 });
        }
      }
      await telegramSendMessage(botToken, destId, text);
      await writeThuChiEntryToSheet(env, unix, thuChiParsed);
      await telegramSendMessage(botToken, chatId, "Đã nhận thông tin");
      return Response.json({ ok: true, kind: "thu_chi_forward" });
    } catch (e) {
      const msgErr = e instanceof Error ? e.message : String(e);
      console.error("telegram thu_chi_forward", msgErr);
      await telegramSendMessage(botToken, chatId, `Lỗi ghi Sheet: ${msgErr}`);
      return Response.json({ ok: false, error: msgErr }, { status: 500 });
    }
  }

  if (sid === baoCaoChatId(env)) {
    const parsed = parseBaoCaoMessage(text);
    if (!parsed) {
      await telegramSendMessage(
        botToken,
        chatId,
        "Gửi theo khối:\nMCC: …\nTÀI KHOẢN:\n(id dòng 1)\n(id dòng 2)\nTÊN:\nTP - 57\nAKR - 57",
      );
      return Response.json({ ok: true, ignored: true });
    }
    try {
      const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const ngay = formatNgayFromTelegram(unix);
      const addedRows = Math.max(parsed.taiKhoan.length, parsed.tenPairs.length, 1);
      const newRows = buildBaoCaoTkNewRowsOnly(parsed.mcc, parsed.taiKhoan, parsed.tenPairs, ngay);
      await sheetsValuesAppend(
        token,
        env.SPREADSHEET_ID_DEBT_SALES,
        `'${SHEET_BAO_CAO_TK}'!A:E`,
        newRows,
        "USER_ENTERED",
      );
      await telegramSendMessage(
        botToken,
        chatId,
        `Đã thêm ${addedRows} dòng vào BAO_CAO_TK (append — không ghi đè định dạng % / ngày).`,
      );
      return Response.json({ ok: true, kind: "bao_cao" });
    } catch (e) {
      const msgErr = e instanceof Error ? e.message : String(e);
      console.error("telegram bao_cao", msgErr);
      await telegramSendMessage(botToken, chatId, `Lỗi ghi BAO_CAO_TK: ${msgErr}`);
      return Response.json({ ok: false, error: msgErr }, { status: 500 });
    }
  }

  if (sid !== thuChiChatId(env)) {
    return Response.json({ ok: true, ignored: true });
  }

  const congNoBlock = parseCongNoMessage(text);
  const cocBlock = parseCocMessage(text);
  const thuChiOne = parseThuChiMessage(text);

  if (!congNoBlock && !cocBlock && !thuChiOne) {
    return Response.json({ ok: true, ignored: true });
  }

  try {
    const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const idMain = env.SPREADSHEET_ID_MAIN;

    const batchTq = await sheetsBatchGet(token, idMain, [`'${SHEET_TQ}'!A1:E2`]);
    const batchMainTabs = await sheetsBatchGetMergeSafe(token, idMain, [`'${SHEET_COC}'!A1:E2000`]);
    const cocRaw = batchMainTabs.data[SHEET_COC] ?? [];
    const tq = (batchTq[SHEET_TQ] ?? []).map(stringifySheetRow);

    const a2Raw = (tq[1] ?? [])[0] ?? "0";
    const a2Num = num(String(a2Raw));

    const cocData = cocRaw.length > 1 ? cocRaw.slice(1).map(normalizeCocDataRow) : [];

    const sumFromCoc = (rows: string[][]) =>
      rows.reduce(
        (s, r) => ({ b2Chi: s.b2Chi + num(r[2]), c2Thu: s.c2Thu + num(r[1]) }),
        { b2Chi: 0, c2Thu: 0 },
      );
    /** Chỉ cập nhật A2:C2 (Dư đầu / Tổng cọc / Nhận cọc). Không ghi D2 (Tổng công nợ) hay E2 (Biến động). */
    const tqUpdateRow2ABC = (cocBodyRows: string[][]) => {
      const sumCoc = sumFromCoc(cocBodyRows);
      return [[a2Num, sumCoc.b2Chi, sumCoc.c2Thu]] as (string | number)[][];
    };

    if (congNoBlock) {
      const cocRowsForSum = cocData.map((r) => [
        String(r[0] ?? ""),
        String(r[1] ?? ""),
        String(r[2] ?? ""),
        String(r[3] ?? ""),
        String(r[4] ?? ""),
      ]);
      const tqRow2 = tqUpdateRow2ABC(cocRowsForSum);
      await sheetsValuesAppend(
        token,
        env.SPREADSHEET_ID_DEBT_SALES,
        `'${SHEET_CN}'!A:B`,
        buildCongNoAppendRows(congNoBlock.pairs),
        "USER_ENTERED",
      );
      await sheetsBatchUpdate(token, idMain, [{ range: `'${SHEET_TQ}'!A2:C2`, values: tqRow2 }]);
      await telegramSendMessage(
        botToken,
        chatId,
        `Đã nối ${congNoBlock.pairs.length} dòng vào CONG_NO (file theo dõi tài khoản).`,
      );
      return Response.json({ ok: true, kind: "cong_no" });
    }

    if (cocBlock) {
      const ngayOnly = formatNgayFromTelegram(unix);
      const newCocRows = cocBlock.lines.map((line) => ({
        ngay: ngayOnly,
        thu: line.kind === "THU" ? String(num(line.amountStr)) : "",
        chi: line.kind === "CHI" ? String(num(line.amountStr)) : "",
        ten: line.ten,
        note: line.note,
      }));
      await sheetsValuesAppend(
        token,
        idMain,
        `'${SHEET_COC}'!A:E`,
        buildCocAppendRows(newCocRows),
        "USER_ENTERED",
      );
      const cocRowsForSum = [
        ...cocData.map((r) => [
          String(r[0] ?? ""),
          String(r[1] ?? ""),
          String(r[2] ?? ""),
          String(r[3] ?? ""),
          String(r[4] ?? ""),
        ]),
        ...newCocRows.map((r) => [r.ngay, r.thu, r.chi, r.ten, r.note]),
      ];
      const tqRow2 = tqUpdateRow2ABC(cocRowsForSum);
      await sheetsBatchUpdate(token, idMain, [{ range: `'${SHEET_TQ}'!A2:C2`, values: tqRow2 }]);
      await telegramSendMessage(
        botToken,
        chatId,
        `Đã ghi CỌC (${cocBlock.lines.length} dòng) — nối cuối tab COC (MAIN), ngày GMT+7.`,
      );
      return Response.json({ ok: true, kind: "coc" });
    }

    if (thuChiOne) {
      await writeThuChiEntryToSheet(env, unix, thuChiOne);
      const ngay = formatNgayFromTelegram(unix);
      const amount = String(num(thuChiOne.amountStr));
      const label = thuChiOne.kind === "THU" ? "Thu" : "Chi";
      await telegramSendMessage(
        botToken,
        chatId,
        `Đã ghi ${label} ${amount} — ${thuChiOne.note} (ngày ${ngay}); nối cuối THU_CHI.`,
      );
      return Response.json({ ok: true, kind: "thu_chi" });
    }

    return Response.json({ ok: true, ignored: true });
  } catch (e) {
    const msgErr = e instanceof Error ? e.message : String(e);
    console.error("telegram-webhook sheet error", msgErr);
    await telegramSendMessage(botToken, chatId, `Lỗi ghi Sheet: ${msgErr}`);
    return Response.json({ ok: false, error: msgErr }, { status: 500 });
  }
};
