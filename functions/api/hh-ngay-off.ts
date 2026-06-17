import type { Env } from "../env";
import { getSheetsAccessToken } from "../lib/google";
import {
  HH_NGAY_OFF_TAB,
  loadHhNgayOffList,
  normalizeHhNgayOffList,
  saveHhNgayOffList,
} from "../lib/hhNgayOff";
import { verifySession } from "../lib/session";

const DEFAULT_SPREADSHEET_ID_CHAM_CONG = "1rZYkgdY6C4Tf1tOjqBw0hwkVE7pLGQlQSNS21ikjZ-w";

function spreadsheetIdChamCong(env: Env): string {
  const v = (env as { SPREADSHEET_ID_CHAM_CONG?: string }).SPREADSHEET_ID_CHAM_CONG?.trim();
  return v || DEFAULT_SPREADSHEET_ID_CHAM_CONG;
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
    const offDays = await loadHhNgayOffList(token, id);
    return Response.json({ ok: true, offDays, tab: HH_NGAY_OFF_TAB });
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
  let body: { offDays?: unknown };
  try {
    body = (await context.request.json()) as { offDays?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const offDays = normalizeHhNgayOffList(body.offDays);
  try {
    const token = await getSheetsAccessToken(context.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const id = spreadsheetIdChamCong(context.env);
    await saveHhNgayOffList(token, id, offDays);
    const merged = await loadHhNgayOffList(token, id);
    return Response.json({
      ok: true,
      offDays: merged,
      total: merged.length,
      message: `Đã lưu ${merged.length} ngày nghỉ/off.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        error: `${msg} — kiểm tra tab «${HH_NGAY_OFF_TAB}» trên file chấm công và quyền service account.`,
      },
      { status: 500 },
    );
  }
};
