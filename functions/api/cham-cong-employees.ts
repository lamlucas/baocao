import type { Env } from "../env";
import {
  CHAM_CONG_TEMPLATE_TAB,
  createChamCongEmployeeTab,
  deleteChamCongEmployeeTab,
  listChamCongEmployeeTabs,
} from "../lib/chamCongSheet";
import {
  commissionStartMapForTabs,
  loadCommissionStartByEmployee,
  normalizeCommissionStartDate,
  upsertCommissionStartDate,
} from "../lib/luongNvEmployeeConfig";
import { getSheetsAccessToken, sheetsListTabTitles } from "../lib/google";
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
    const titles = await sheetsListTabTitles(token, id);
    const employees = listChamCongEmployeeTabs(titles);
    const commissionStartByEmployee = await loadCommissionStartByEmployee(token, id);
    return Response.json({
      ok: true,
      templateTab: CHAM_CONG_TEMPLATE_TAB,
      employees,
      commissionStartByTab: commissionStartMapForTabs(commissionStartByEmployee, employees),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const deny = await requireUser(context.env, context.request);
  if (deny) return deny;
  if (!context.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    return Response.json({ error: "Thiếu GOOGLE_SERVICE_ACCOUNT_JSON." }, { status: 503 });
  }
  let body: { tabName?: string };
  try {
    body = (await context.request.json()) as { tabName?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const tabName = String(body.tabName ?? "").trim();
  if (!tabName) return Response.json({ error: "Thiếu tên tab." }, { status: 400 });
  try {
    const token = await getSheetsAccessToken(context.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const id = spreadsheetIdChamCong(context.env);
    await createChamCongEmployeeTab(token, id, tabName);
    return Response.json({
      ok: true,
      message: `Đã tạo tab « ${tabName} » (copy từ ${CHAM_CONG_TEMPLATE_TAB}, F2 = công thức SUBEO!F2).`,
      tabName,
    });
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
  let body: { tabName?: string; commissionStartDate?: string };
  try {
    body = (await context.request.json()) as { tabName?: string; commissionStartDate?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const tabName = String(body.tabName ?? "").trim();
  if (!tabName) return Response.json({ error: "Thiếu tên tab." }, { status: 400 });
  const dateIso = normalizeCommissionStartDate(body.commissionStartDate ?? "");
  try {
    const token = await getSheetsAccessToken(context.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const id = spreadsheetIdChamCong(context.env);
    await upsertCommissionStartDate(token, id, tabName, dateIso);
    return Response.json({
      ok: true,
      tabName,
      commissionStartDate: dateIso || null,
      message: dateIso
        ? `Đã lưu ngày bắt đầu HH: ${dateIso}.`
        : "Đã xóa ngày bắt đầu HH — tính HH từ toàn bộ THU_CHI.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const deny = await requireUser(context.env, context.request);
  if (deny) return deny;
  if (!context.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    return Response.json({ error: "Thiếu GOOGLE_SERVICE_ACCOUNT_JSON." }, { status: 503 });
  }
  const tabName = new URL(context.request.url).searchParams.get("tab")?.trim() ?? "";
  if (!tabName) return Response.json({ error: "Thiếu ?tab=" }, { status: 400 });
  try {
    const token = await getSheetsAccessToken(context.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const id = spreadsheetIdChamCong(context.env);
    await deleteChamCongEmployeeTab(token, id, tabName);
    return Response.json({ ok: true, message: `Đã xóa tab « ${tabName} ».` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
};
