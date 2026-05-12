import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGet, sheetsBatchGetMergeSafe, sheetsBatchUpdate } from "../lib/google";
import {
  buildBanDaoAppendedMatrix,
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
const SHEET_BAN_DAO = "BAN_DAO";
const SHEET_BAO_CAO_TK = "BAO_CAO_TK";

const CHAT_THU_CHI_DEFAULT = "-1003727898214";
const CHAT_BAN_DAO_DEFAULT = "-5091396609";
const CHAT_BAO_CAO_DEFAULT = "-1003992397667";

function thuChiChatId(env: Env): string {
  const v = (env as { TELEGRAM_THU_CHI_CHAT_ID?: string }).TELEGRAM_THU_CHI_CHAT_ID;
  return (v && String(v).trim()) || CHAT_THU_CHI_DEFAULT;
}
function banDaoChatId(env: Env): string {
  const v = (env as { TELEGRAM_BAN_DAO_CHAT_ID?: string }).TELEGRAM_BAN_DAO_CHAT_ID;
  return (v && String(v).trim()) || CHAT_BAN_DAO_DEFAULT;
}
function baoCaoChatId(env: Env): string {
  const v = (env as { TELEGRAM_BAO_CAO_CHAT_ID?: string }).TELEGRAM_BAO_CAO_CHAT_ID;
  return (v && String(v).trim()) || CHAT_BAO_CAO_DEFAULT;
}

/** File chứa tab BAN_DAO (đơn dao). */
function spreadsheetIdBanDao(env: Env): string {
  const v = (env as { SPREADSHEET_ID_BAN_DAO?: string }).SPREADSHEET_ID_BAN_DAO?.trim();
  return v || env.SPREADSHEET_ID_DEBT_SALES;
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

type BanDaoFields = {
  ten: string;
  diaChi: string;
  sdt: string;
  soLuong: string;
  gia: string;
  thanhTien: string;
};

/** Mỗi dòng dạng TÊN: …, ĐỊA CHỈ: … (nhóm Báo Đơn Dao US). */
function parseBanDaoMessage(text: string): BanDaoFields | null {
  const out: BanDaoFields = { ten: "", diaChi: "", sdt: "", soLuong: "", gia: "", thanhTien: "" };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let m = line.match(/^\s*TÊN\s*:\s*(.+)$/i);
    if (m) {
      out.ten = m[1]!.trim();
      continue;
    }
    m = line.match(/^\s*ĐỊA\s*CHỈ\s*:\s*(.+)$/i);
    if (m) {
      out.diaChi = m[1]!.trim();
      continue;
    }
    m = line.match(/^\s*SỐ\s*ĐIỆN\s*THOẠI\s*:\s*(.+)$/i);
    if (m) {
      out.sdt = m[1]!.trim();
      continue;
    }
    m = line.match(/^\s*SỐ\s*LƯỢNG\s*:\s*(.+)$/i);
    if (m) {
      out.soLuong = m[1]!.trim();
      continue;
    }
    m = line.match(/^\s*GIÁ\s*:\s*(.+)$/i);
    if (m) {
      out.gia = m[1]!.trim();
      continue;
    }
    m = line.match(/^\s*THÀNH\s*TIỀN\s*:\s*(.+)$/i);
    if (m) {
      out.thanhTien = m[1]!.trim();
      continue;
    }
  }
  const has = `${out.ten}${out.diaChi}${out.sdt}${out.soLuong}${out.gia}${out.thanhTien}`.trim();
  return has ? out : null;
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

function buildBaoCaoAppendMatrix(
  existing: unknown[][],
  mcc: string,
  taiKhoan: string[],
  tenPairs: { d: string; e: string }[],
  ngay: string,
): (string | number)[][] {
  const header = existing[0]?.length
    ? stringifySheetRow(existing[0] as unknown[])
    : ["Ngày", "MCC", "Tài khoản", "Tên", "Giá trị"];
  while (header.length < 5) header.push("");
  const h = header.slice(0, 5).map(String);

  const body: (string | number)[][] = [];
  for (let r = 1; r < existing.length; r++) {
    const row = stringifySheetRow(existing[r] as unknown[]).slice(0, 5);
    while (row.length < 5) row.push("");
    body.push(row.map((c) => (typeof c === "number" && Number.isFinite(c) ? c : String(c ?? ""))) as (string | number)[]);
  }

  const n = Math.max(taiKhoan.length, tenPairs.length, 1);
  const newRows: (string | number)[][] = [];
  for (let i = 0; i < n; i++) {
    const eRaw = tenPairs[i]?.e ?? "";
    const eNum = eRaw.trim() === "" ? "" : num(eRaw);
    newRows.push([
      ngay,
      mcc,
      taiKhoan[i] ?? "",
      tenPairs[i]?.d ?? "",
      eNum === 0 && eRaw.trim() === "" ? "" : eNum,
    ]);
  }

  const cellBlank = (c: string | number | null | undefined) => {
    if (c == null || c === "") return true;
    if (typeof c === "number") return !Number.isFinite(c);
    return !String(c).trim();
  };
  const rowEmpty = (row: (string | number)[]) => row.every(cellBlank);

  let insertAt = body.findIndex(rowEmpty);
  if (insertAt < 0) insertAt = body.length;

  for (let j = 0; j < newRows.length; j++) {
    const idx = insertAt + j;
    const nr = newRows[j]!;
    if (idx < body.length) body[idx] = nr;
    else body.push(nr);
  }

  return padMatrix([h, ...body], 5);
}

function formatNgayFromTelegram(unixSec: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSec * 1000));
}

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

  const sid = String(chatId);

  if (sid === banDaoChatId(env)) {
    const fields = parseBanDaoMessage(text);
    if (!fields) {
      await telegramSendMessage(
        botToken,
        chatId,
        "Gửi đơn theo từng dòng:\nTÊN: …\nĐỊA CHỈ: …\nSỐ ĐIỆN THOẠI: …\nSỐ LƯỢNG: …\nGIÁ: …\nTHÀNH TIỀN: …",
      );
      return Response.json({ ok: true, ignored: true });
    }
    try {
      const token = await getSheetsAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const idBd = spreadsheetIdBanDao(env);
      const batchBd = await sheetsBatchGet(token, idBd, [`'${SHEET_BAN_DAO}'!A1:G2000`]);
      const existing = batchBd[SHEET_BAN_DAO] ?? [];
      const ngay = formatNgayFromTelegram(unix);
      const newRow: (string | number)[] = [
        ngay,
        fields.ten,
        fields.diaChi,
        fields.sdt,
        fields.soLuong.trim() === "" ? "" : num(fields.soLuong),
        fields.gia.trim() === "" ? "" : num(fields.gia),
        fields.thanhTien.trim() === "" ? "" : num(fields.thanhTien),
      ];
      const matrix = buildBanDaoAppendedMatrix(existing, [newRow]);
      await sheetsBatchUpdate(token, idBd, [
        { range: `'${SHEET_BAN_DAO}'!A1:G${matrix.length}`, values: matrix },
      ]);
      await telegramSendMessage(botToken, chatId, "Đã thêm 1 dòng vào BAN_DAO.");
      return Response.json({ ok: true, kind: "ban_dao" });
    } catch (e) {
      const msgErr = e instanceof Error ? e.message : String(e);
      console.error("telegram ban_dao", msgErr);
      await telegramSendMessage(botToken, chatId, `Lỗi ghi BAN_DAO: ${msgErr}`);
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
      const batch = await sheetsBatchGet(token, env.SPREADSHEET_ID_DEBT_SALES, [
        `'${SHEET_BAO_CAO_TK}'!A1:E50000`,
      ]);
      const existing = batch[SHEET_BAO_CAO_TK] ?? [];
      const ngay = formatNgayFromTelegram(unix);
      const addedRows = Math.max(parsed.taiKhoan.length, parsed.tenPairs.length, 1);
      const matrix = buildBaoCaoAppendMatrix(
        existing,
        parsed.mcc,
        parsed.taiKhoan,
        parsed.tenPairs,
        ngay,
      );
      await sheetsBatchUpdate(token, env.SPREADSHEET_ID_DEBT_SALES, [
        { range: `'${SHEET_BAO_CAO_TK}'!A1:E${matrix.length}`, values: matrix },
      ]);
      await telegramSendMessage(
        botToken,
        chatId,
        `Đã thêm ${addedRows} dòng vào BAO_CAO_TK (ghi tiếp, không ghi đè dữ liệu cũ).`,
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
    const batchMainTabs = await sheetsBatchGetMergeSafe(token, idMain, [
      `'${SHEET_TC}'!A1:E2000`,
      `'${SHEET_COC}'!A1:D2000`,
      `'${SHEET_CN}'!A1:B2000`,
    ]);
    const tc = batchMainTabs[SHEET_TC] ?? [];
    const cocRaw = batchMainTabs[SHEET_COC] ?? [];
    const cnRaw = batchMainTabs[SHEET_CN] ?? [];
    const tq = (batchTq[SHEET_TQ] ?? []).map(stringifySheetRow);

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
      await sheetsBatchUpdate(token, idMain, [
        { range: `'${SHEET_CN}'!A1:B${paddedCn.length}`, values: paddedCn },
      ]);
      await sheetsBatchUpdate(token, idMain, [
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
      await sheetsBatchUpdate(token, idMain, [
        { range: `'${SHEET_COC}'!A1:D${cocPadded.length}`, values: cocPadded },
      ]);
      await sheetsBatchUpdate(token, idMain, [
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
      await sheetsBatchUpdate(token, idMain, [
        { range: `'${SHEET_TC}'!A1:D${thuChiPadded.length}`, values: thuChiPadded },
      ]);
      await sheetsBatchUpdate(token, idMain, [
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
