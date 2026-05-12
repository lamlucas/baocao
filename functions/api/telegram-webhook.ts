import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGet, sheetsBatchUpdate } from "../lib/google";
import {
  buildThuChiPaddedMatrix,
  normalizeThuChiDataRow,
  num,
  padMatrix,
  sheetRowsToThuChiModels,
  stringifySheetRow,
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

/** Dòng đầu CỌC: rồi THU - số - ghi chú / CHI - số - ghi chú */
function parseCocMessage(text: string): { lines: { kind: "THU" | "CHI"; amountStr: string; note: string }[] } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  if (!/^CỌC\s*:/i.test(lines[0]!)) return null;
  const out: { kind: "THU" | "CHI"; amountStr: string; note: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(THU|CHI)\s*-\s*([\d\s.,]+)\s*-\s*(.+)$/i);
    if (!m) continue;
    const kind = m[1]!.toUpperCase() === "THU" ? "THU" : "CHI";
    const amountStr = m[2]!.trim();
    const note = m[3]!.trim();
    if (!Number.isFinite(num(amountStr))) continue;
    out.push({ kind, amountStr, note });
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

function formatNgayFromTelegram(unixSec: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSec * 1000));
}

/** Ngày giờ Việt Nam (ghi cột A tab COC). */
function formatNgayGioVietnam(unixSec: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(unixSec * 1000))
    .replace(" ", " ");
}

function mergeCongNoRows(header: string[], body: string[][], pairs: { name: string; amountStr: string }[]): string[][] {
  const norm = (s: string) => s.trim().toLowerCase();
  const rows = body.map((r) => {
    const o = [...r];
    while (o.length < 2) o.push("");
    return o.slice(0, 2).map((c) => String(c ?? ""));
  });
  for (const p of pairs) {
    const amt = String(num(p.amountStr));
    const j = rows.findIndex((r) => norm(r[0] ?? "") === norm(p.name));
    if (j >= 0) rows[j]![1] = amt;
    else rows.push([p.name.trim(), amt]);
  }
  while (rows.length && !`${rows[rows.length - 1]![0]}${rows[rows.length - 1]![1]}`.trim()) {
    rows.pop();
  }
  return [header, ...rows];
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

  if (String(chatId) !== allowedChatId(env)) {
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
    const rangesMain = [
      `'${SHEET_TQ}'!A1:E2`,
      `'${SHEET_TC}'!A1:D2000`,
      `'${SHEET_COC}'!A1:D2000`,
      `'${SHEET_CN}'!A1:B2000`,
    ];
    const batchMain = await sheetsBatchGet(token, env.SPREADSHEET_ID_MAIN, rangesMain);
    const tq = (batchMain[SHEET_TQ] ?? []).map(stringifySheetRow);
    const tc = batchMain[SHEET_TC] ?? [];
    const cocRaw = batchMain[SHEET_COC] ?? [];
    const cnRaw = batchMain[SHEET_CN] ?? [];

    const a2Raw = (tq[1] ?? [])[0] ?? "0";
    const a2Num = num(String(a2Raw));

    const thuChiData = tc.length > 1 ? tc.slice(1).map(normalizeThuChiDataRow) : [];
    const cocData = cocRaw.length > 1 ? cocRaw.slice(1).map(normalizeThuChiDataRow) : [];
    const cnRows = (cnRaw ?? []).map(stringifySheetRow);
    const cnBodyForSum =
      cnRows.length > 1
        ? cnRows.slice(1).map((r) => {
            const o = [...r.map(String)];
            while (o.length < 2) o.push("");
            return o.slice(0, 2);
          })
        : [];

    /** B2 = tổng Chi (cột C sheet COC), C2 = tổng Thu (cột B). */
    const sumFromCoc = (rows: string[][]) =>
      rows.reduce(
        (s, r) => ({ b2Chi: s.b2Chi + num(r[2]), c2Thu: s.c2Thu + num(r[1]) }),
        { b2Chi: 0, c2Thu: 0 },
      );
    const sumCongBody = (body: string[][]) => body.reduce((s, r) => s + num(r[1] ?? ""), 0);

    const tqUpdateValues = (cocBodyRows: string[][], cnBodyRows: string[][]) => {
      const sumCoc = sumFromCoc(cocBodyRows);
      const sumCn = sumCongBody(cnBodyRows);
      return [
        ["Dư đầu", "Tổng cọc", "Nhận cọc", "Tổng công nợ"],
        [a2Num, sumCoc.b2Chi, sumCoc.c2Thu, sumCn],
      ] as (string | number)[][];
    };

    if (congNoBlock) {
      const header = cnRows[0]?.length ? cnRows[0]!.map(String) : ["Tên", "Tiền nợ"];
      while (header.length < 2) header.push("");
      const bodyBefore =
        cnRows.length > 1
          ? cnRows.slice(1).map((r) => {
              const o = [...r.map(String)];
              while (o.length < 2) o.push("");
              return o.slice(0, 2);
            })
          : [];
      const merged = mergeCongNoRows(header, bodyBefore, congNoBlock.pairs);
      const cocRowsForSum = cocData.map((r) => [
        String(r[0] ?? ""),
        String(r[1] ?? ""),
        String(r[2] ?? ""),
        String(r[3] ?? ""),
      ]);
      const paddedCn = padMatrix(merged, 2);
      const tqRows = tqUpdateValues(cocRowsForSum, merged.slice(1));
      await sheetsBatchUpdate(token, env.SPREADSHEET_ID_MAIN, [
        { range: `'${SHEET_CN}'!A1:B${paddedCn.length}`, values: paddedCn },
        { range: `'${SHEET_TQ}'!A1:D2`, values: tqRows },
      ]);
      await telegramSendMessage(botToken, chatId, `Đã cập nhật CÔNG NỢ (${congNoBlock.pairs.length} dòng).`);
      return Response.json({ ok: true, kind: "cong_no" });
    }

    if (cocBlock) {
      const cocModels = sheetRowsToThuChiModels(cocData);
      const ngayGio = formatNgayGioVietnam(unix);
      for (const line of cocBlock.lines) {
        const amount = String(num(line.amountStr));
        cocModels.push({
          ngay: ngayGio,
          thu: line.kind === "THU" ? amount : "",
          chi: line.kind === "CHI" ? amount : "",
          ghiChu: line.note,
        });
      }
      const cocPadded = buildThuChiPaddedMatrix(cocModels);
      const cocRowsForSum = cocPadded
        .slice(1)
        .map((row) => row.map((c) => String(c ?? "")));
      const tqRows = tqUpdateValues(cocRowsForSum, cnBodyForSum);
      await sheetsBatchUpdate(token, env.SPREADSHEET_ID_MAIN, [
        { range: `'${SHEET_COC}'!A1:D${cocPadded.length}`, values: cocPadded },
        { range: `'${SHEET_TQ}'!A1:D2`, values: tqRows },
      ]);
      await telegramSendMessage(botToken, chatId, `Đã ghi CỌC (${cocBlock.lines.length} dòng).`);
      return Response.json({ ok: true, kind: "coc" });
    }

    if (thuChiOne) {
      const ngay = formatNgayFromTelegram(unix);
      const amount = String(num(thuChiOne.amountStr));
      const thu = thuChiOne.kind === "THU" ? amount : "";
      const chi = thuChiOne.kind === "CHI" ? amount : "";
      const models = sheetRowsToThuChiModels(thuChiData);
      models.push({ ngay, thu, chi, ghiChu: thuChiOne.note });
      const thuChiPadded = buildThuChiPaddedMatrix(models);
      const cocRowsForSum = cocData.map((r) => [
        String(r[0] ?? ""),
        String(r[1] ?? ""),
        String(r[2] ?? ""),
        String(r[3] ?? ""),
      ]);
      const tqRows = tqUpdateValues(cocRowsForSum, cnBodyForSum);
      await sheetsBatchUpdate(token, env.SPREADSHEET_ID_MAIN, [
        { range: `'${SHEET_TC}'!A1:D${thuChiPadded.length}`, values: thuChiPadded },
        { range: `'${SHEET_TQ}'!A1:D2`, values: tqRows },
      ]);
      const label = thuChiOne.kind === "THU" ? "Thu" : "Chi";
      await telegramSendMessage(
        botToken,
        chatId,
        `Đã ghi ${label} ${amount} — ${thuChiOne.note} (ngày ${ngay}).`,
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
