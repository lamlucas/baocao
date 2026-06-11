import type { Env } from "../env";
import {
  getSheetsAccessToken,
  sheetsBatchGetMergeSafe,
  sheetsValuesAppend,
} from "../lib/google";
import {
  HH_LOAI_TRU_TAB,
  hhLoaiTruRowValues,
  mergeHhLoaiTruRules,
  newHhLoaiTruRulesOnly,
  normalizeHhLoaiTruList,
  parseHhLoaiTruSheetRows,
  type HhLoaiTruRule,
} from "../lib/hhLoaiTru";
import { verifySession } from "../lib/session";

const HH_LOAI_TRU_MAX_ROW = 500;

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function readHhLoaiTruFromSheet(
  token: string,
  spreadsheetId: string,
): Promise<HhLoaiTruRule[]> {
  const batch = await sheetsBatchGetMergeSafe(
    token,
    spreadsheetId,
    [`${quoteSheetTitle(HH_LOAI_TRU_TAB)}!A1:C${HH_LOAI_TRU_MAX_ROW}`],
    "FORMATTED_VALUE",
  );
  return parseHhLoaiTruSheetRows(batch[HH_LOAI_TRU_TAB] ?? []);
}

/** Chỉ append dòng mới — không xóa / ghi đè dòng cũ (giữ lịch sử đối chiếu HH). */
async function appendNewHhLoaiTruRules(
  token: string,
  spreadsheetId: string,
  incoming: HhLoaiTruRule[],
): Promise<{ merged: HhLoaiTruRule[]; appended: number }> {
  const existing = await readHhLoaiTruFromSheet(token, spreadsheetId);
  const toAppend = newHhLoaiTruRulesOnly(existing, incoming);
  const merged = mergeHhLoaiTruRules(existing, incoming);

  if (toAppend.length > 0) {
    const q = quoteSheetTitle(HH_LOAI_TRU_TAB);
    await sheetsValuesAppend(
      token,
      spreadsheetId,
      `${q}!A:C`,
      toAppend.map((r) => hhLoaiTruRowValues(r)),
      "USER_ENTERED",
    );
  }

  return { merged, appended: toAppend.length };
}

async function requireUser(env: Env, request: Request): Promise<Response | null> {
  const user = await verifySession(env, request.headers.get("Cookie"));
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const deny = await requireUser(context.env, context.request);
  if (deny) return deny;

  if (!context.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    return Response.json({ error: "Thiếu GOOGLE_SERVICE_ACCOUNT_JSON." }, { status: 503 });
  }

  try {
    const token = await getSheetsAccessToken(context.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const rules = await readHhLoaiTruFromSheet(token, context.env.SPREADSHEET_ID_MAIN);
    return Response.json({ ok: true, exclusions: rules });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const deny = await requireUser(context.env, context.request);
  if (deny) return deny;

  if (!context.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    return Response.json({ error: "Thiếu GOOGLE_SERVICE_ACCOUNT_JSON." }, { status: 503 });
  }

  let body: { exclusions?: unknown };
  try {
    body = (await context.request.json()) as { exclusions?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = normalizeHhLoaiTruList(body.exclusions);
  try {
    const token = await getSheetsAccessToken(context.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const id = context.env.SPREADSHEET_ID_MAIN;
    const { merged, appended } = await appendNewHhLoaiTruRules(token, id, incoming);
    return Response.json({
      ok: true,
      exclusions: merged,
      appended,
      total: merged.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        error: `${msg} — kiểm tra tab «${HH_LOAI_TRU_TAB}» trên file MAIN và quyền service account.`,
      },
      { status: 500 },
    );
  }
};
