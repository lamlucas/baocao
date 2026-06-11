import type { Env } from "../env";
import { getSheetsAccessToken, sheetsBatchGetMergeSafe, sheetsBatchUpdate } from "../lib/google";
import {
  buildHhLoaiTruWriteMatrix,
  HH_LOAI_TRU_TAB,
  normalizeHhLoaiTruList,
  parseHhLoaiTruSheetRows,
} from "../lib/hhLoaiTru";
import { verifySession } from "../lib/session";

const DEFAULT_SPREADSHEET_ID_CHAM_CONG = "1rZYkgdY6C4Tf1tOjqBw0hwkVE7pLGQlQSNS21ikjZ-w";

function spreadsheetIdChamCong(env: Env): string {
  const v = env.SPREADSHEET_ID_CHAM_CONG?.trim();
  return v || DEFAULT_SPREADSHEET_ID_CHAM_CONG;
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function hhLoaiTruRange(rows: number): string {
  return `${quoteSheetTitle(HH_LOAI_TRU_TAB)}!A1:C${Math.max(rows, 1)}`;
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
    const id = spreadsheetIdChamCong(context.env);
    const batch = await sheetsBatchGetMergeSafe(token, id, [`${quoteSheetTitle(HH_LOAI_TRU_TAB)}!A1:C500`]);
    const rules = parseHhLoaiTruSheetRows(batch[HH_LOAI_TRU_TAB] ?? []);
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

  const rules = normalizeHhLoaiTruList(body.exclusions);
  try {
    const token = await getSheetsAccessToken(context.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const id = spreadsheetIdChamCong(context.env);
    const matrix = buildHhLoaiTruWriteMatrix(rules);
    await sheetsBatchUpdate(
      token,
      id,
      [{ range: hhLoaiTruRange(matrix.length), values: matrix }],
      "USER_ENTERED",
    );
    return Response.json({ ok: true, exclusions: rules });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        error: `${msg} — tạo tab «${HH_LOAI_TRU_TAB}» trên file chấm công (A: Ngày, B: Ghi chú/Tên đại lý, C: Khoản thu).`,
      },
      { status: 500 },
    );
  }
};
