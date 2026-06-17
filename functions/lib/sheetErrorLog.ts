import type { Env } from "../env";

const KV_KEY = "__sheet_error_log__";
const MAX_ENTRIES = 40;

export type SheetErrorLogEntry = {
  at: string;
  source: string;
  spreadsheetId?: string;
  range?: string;
  message: string;
  status?: number;
};

function trimLog(entries: SheetErrorLogEntry[]): SheetErrorLogEntry[] {
  return entries.slice(-MAX_ENTRIES);
}

export async function readSheetErrorLog(env: Env): Promise<SheetErrorLogEntry[]> {
  const kv = env.BALANCE_KV;
  if (!kv) return [];
  try {
    const raw = await kv.get(KV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SheetErrorLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendSheetErrorLog(env: Env, entry: Omit<SheetErrorLogEntry, "at">): Promise<void> {
  const full: SheetErrorLogEntry = { ...entry, at: new Date().toISOString() };
  console.error("[sheet-error-log]", JSON.stringify(full));

  const kv = env.BALANCE_KV;
  if (!kv) return;
  try {
    const prev = await readSheetErrorLog(env);
    await kv.put(KV_KEY, JSON.stringify(trimLog([...prev, full])));
  } catch (e) {
    console.error("[sheet-error-log] KV write failed:", e);
  }
}

export function parseHttpStatusFromMessage(message: string): number | undefined {
  const m = message.match(/\b(429|403|404|500|502|503)\b/);
  return m ? Number(m[1]) : undefined;
}

export async function logSheetRangeError(
  env: Env,
  source: string,
  spreadsheetId: string,
  range: string,
  message: string,
): Promise<void> {
  await appendSheetErrorLog(env, {
    source,
    spreadsheetId,
    range,
    message,
    status: parseHttpStatusFromMessage(message),
  });
}
