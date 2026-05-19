/**
 * Tab CONG_NO (THEO DÕI TÀI KHOẢN): upsert theo mã đại lý cột A, nợ cột B;
 * sau THU — xóa nợ nếu |Thu − B| ≤ 2.
 */
import { sheetsBatchGetMergeSafe, sheetsBatchUpdate, sheetsValuesAppend } from "./google";
import { num, stringifySheetRow } from "./thuChiSheet";

export function normalizeCongNoAgentKey(s: string): string {
  return String(s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase();
}

/** Dòng kiểu `TỔNG TIỀN CẦN THANH TOÁN: a + b = c` → lấy số sau dấu `=` cuối cùng trên dòng đó. */
export function parseTongTienCanThanhToanTotal(text: string): number | null {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isTong =
      /TỔNG\s*TIỀN\s*CẦN\s*THANH\s*TOÁN\s*:/iu.test(line) ||
      /TONG\s*TIEN\s*CAN\s*THANH\s*TOAN\s*:/iu.test(line);
    if (!isTong) continue;
    const eq = line.lastIndexOf("=");
    if (eq === -1) continue;
    const tail = line.slice(eq + 1).trim();
    const v = num(tail);
    if (!Number.isFinite(v)) continue;
    return v;
  }
  return null;
}

/**
 * Giá trị sau `MÃ ĐL:` — lấy token đầu (bỏ phần trong ngoặc ghi chú).
 * Ví dụ `AT (ghi chú…)` → `AT`.
 */
export function maDlLineValueToToken(value: string): string {
  const t = String(value ?? "").trim();
  if (!t) return "";
  const beforeParen = t.split(/\s*\(/)[0]?.trim() ?? t;
  const token = beforeParen.split(/[\s,;]+/)[0]?.trim() ?? "";
  return token.replace(/\.$/, "");
}

/**
 * Mã cột A tab CONG_NO — **chỉ** từ mã đại lý nhóm, **không** dùng MCC.
 * Ưu tiên: dòng `MÃ ĐL:` / `MÃ DL:` / `MA DL:` → (tuỳ chọn) `MÃ ĐẠI LÝ:` → dòng ngay trên `TỔNG TIỀN CẦN THANH TOÁN` (một từ, không phải nhãn khác).
 */
export function extractMaDaiLyForCongNo(text: string): string {
  const body = String(text ?? "").trim();
  if (!body) return "";

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const m =
      line.match(/^\s*MÃ\s*ĐL\s*:\s*(.+)$/iu) ??
      line.match(/^\s*MÃ\s*DL\s*:\s*(.+)$/iu) ??
      line.match(/^\s*MA\s*DL\s*:\s*(.+)$/iu) ??
      line.match(/^\s*MÃ\s*ĐẠI\s*L[ÝY]\s*:\s*(.+)$/iu) ??
      line.match(/^\s*MA\s*DAI\s*LY\s*:\s*(.+)$/iu);
    if (m?.[1]) {
      const tok = maDlLineValueToToken(m[1]);
      if (tok) return tok;
    }
  }

  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const tongIdx = lines.findIndex(
    (line) =>
      /TỔNG\s*TIỀN\s*CẦN\s*THANH\s*TOÁN\s*:/iu.test(line) ||
      /TONG\s*TIEN\s*CAN\s*THANH\s*TOAN\s*:/iu.test(line),
  );
  if (tongIdx > 0) {
    const prev = lines[tongIdx - 1] ?? "";
    if (
      /^[A-Za-z0-9_.-]{1,32}$/.test(prev) &&
      !/^(MCC|MÃ|MA|TÀI|TAI|TÊN|NGÀY|RATE|LINK)/iu.test(prev)
    ) {
      return prev;
    }
  }
  return "";
}

/**
 * Số nợ ghi cột B: (1) `TỔNG TIỀN CẦN THANH TOÁN: … = …` (2) một dòng `CÔNG NỢ: số`
 * (không dùng cho khối nhiều dòng `TÊN - số` sau `CÔNG NỢ:`) (3) `TỔNG TIỀU:` (typo hay gặp).
 */
export function parseCongNoDebtValueFromBaoCao(text: string): number | null {
  const fromTong = parseTongTienCanThanhToanTotal(text);
  if (fromTong != null) return fromTong;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cn = line.match(/^\s*CÔNG\s*NỢ\s*:\s*([\d\s.,]+)\s*$/iu);
    if (cn?.[1]) {
      const v = num(cn[1]);
      if (Number.isFinite(v)) return v;
    }
    const tongTieu = line.match(/^\s*TỔNG\s*TIỀU\s*:\s*([\d\s.,]+)\s*$/iu);
    if (tongTieu?.[1]) {
      const v = num(tongTieu[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

export type CongNoResolveContext = {
  chatId?: string;
  chatTitle?: string;
  /** `TELEGRAM_AGENT_CHAT_MAP` — chat_id → mã đại lý (cột A). */
  agentByChatId?: Record<string, string>;
};

/** Tên nhóm kiểu `BLA - NVT` / `BLA – NVT` → mã `NVT` (phần sau dấu gạch cuối). */
export function extractMaDaiLyFromChatTitle(title: string): string {
  const t = String(title ?? "").trim();
  if (!t) return "";
  const parts = t.split(/\s*[\-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    if (/^[A-Za-z][A-Za-z0-9_.-]{0,31}$/u.test(last)) return last;
  }
  return "";
}

export function parseAgentChatMapJson(raw: string | undefined): Record<string, string> {
  const s = (raw ?? "").trim();
  if (!s) return {};
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      const key = String(k).trim();
      const val = String(v ?? "").trim();
      if (key && val) out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

/** Gộp nhiều khối text (tin hiện tại, reply, ghim…) rồi lấy MÃ ĐL + số nợ. */
export function parseCongNoUpsertWithContext(
  texts: string[],
  ctx: CongNoResolveContext = {},
): { agent: string; debt: number } | null {
  const merged = texts.map((t) => String(t ?? "").trim()).filter(Boolean).join("\n");
  if (!merged) return null;

  const debt = parseCongNoDebtValueFromBaoCao(merged);
  if (debt == null) return null;

  let agent = extractMaDaiLyForCongNo(merged).trim();
  const cid = ctx.chatId?.trim();
  if (!agent && cid && ctx.agentByChatId?.[cid]) {
    agent = ctx.agentByChatId[cid]!.trim();
  }
  if (!agent && ctx.chatTitle) {
    agent = extractMaDaiLyFromChatTitle(ctx.chatTitle).trim();
  }
  if (!agent) return null;
  return { agent, debt };
}

export function parseCongNoUpsertFromBaoCaoMessage(text: string): { agent: string; debt: number } | null {
  return parseCongNoUpsertWithContext([text]);
}

function agentCandidatesFromThuNote(note: string): string[] {
  const t = String(note ?? "").trim();
  if (!t) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const x = s.trim();
    if (x && !out.includes(x)) out.push(x);
  };
  push(t);
  const dash = t.split(/\s*-\s*/);
  if (dash[0]) push(dash[0]!);
  const firstWord = t.split(/\s+/)[0];
  if (firstWord) push(firstWord);
  return out;
}

/** Đọc CONG_NO A:B, cập nhật B nếu đã có A; không ghi đè dòng khác — append khi chưa có. */
export async function upsertCongNoDebt(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  agent: string,
  debt: number,
): Promise<void> {
  const batch = await sheetsBatchGetMergeSafe(accessToken, spreadsheetId, [
    `'${sheetName}'!A1:B5000`,
  ]);
  const rows = batch[sheetName] ?? [];
  const want = normalizeCongNoAgentKey(agent);
  for (let i = 1; i < rows.length; i++) {
    const a = stringifySheetRow(rows[i] as unknown[])[0] ?? "";
    if (!normalizeCongNoAgentKey(a)) continue;
    if (normalizeCongNoAgentKey(a) !== want) continue;
    const sheetRow = i + 1;
    await sheetsBatchUpdate(accessToken, spreadsheetId, [
      { range: `'${sheetName}'!B${sheetRow}`, values: [[debt]] },
    ]);
    return;
  }
  await sheetsValuesAppend(
    accessToken,
    spreadsheetId,
    `'${sheetName}'!A:B`,
    [[agent.trim(), debt]],
    "USER_ENTERED",
  );
}

/** Nhiều cặp (khối CÔNG NỢ) — mỗi cặp upsert một dòng. */
export async function upsertCongNoDebtPairs(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  pairs: { name: string; amountStr: string }[],
): Promise<void> {
  for (const p of pairs) {
    const debt = num(p.amountStr);
    if (!Number.isFinite(debt)) continue;
    await upsertCongNoDebt(accessToken, spreadsheetId, sheetName, p.name.trim(), debt);
  }
}

/**
 * Sau THU: nếu có dòng A trùng mã (ghi chú) và |Thu − B| ≤ 2 và B đang có số → xóa B.
 */
export async function clearCongNoDebtIfThuMatchesWithinTwo(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  thuAmount: number,
  note: string,
): Promise<boolean> {
  const batch = await sheetsBatchGetMergeSafe(accessToken, spreadsheetId, [
    `'${sheetName}'!A1:B5000`,
  ]);
  const rows = batch[sheetName] ?? [];
  const candidates = agentCandidatesFromThuNote(note);
  if (candidates.length === 0) return false;

  for (const cand of candidates) {
    const want = normalizeCongNoAgentKey(cand);
    if (!want) continue;
    for (let i = 1; i < rows.length; i++) {
      const cells = stringifySheetRow(rows[i] as unknown[]);
      const a = cells[0] ?? "";
      const bRaw = cells[1] ?? "";
      if (normalizeCongNoAgentKey(a) !== want) continue;
      const bVal = num(bRaw);
      if (bRaw === "" || bRaw == null) continue;
      if (!Number.isFinite(bVal) || bVal === 0) continue;
      if (Math.abs(thuAmount - bVal) > 2) continue;
      const sheetRow = i + 1;
      await sheetsBatchUpdate(accessToken, spreadsheetId, [
        { range: `'${sheetName}'!B${sheetRow}`, values: [[""]] },
      ]);
      return true;
    }
  }
  return false;
}
