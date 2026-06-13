import type { Env } from "../env";
import { getOpeningBalance, setOpeningBalance } from "../lib/balanceKv";
import { verifySession } from "../lib/session";

function parseBalanceInput(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const user = await verifySession(context.env, context.request.headers.get("Cookie"));
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const value = await getOpeningBalance(context.env.BALANCE_KV);
  return Response.json({ balance: value, kvBound: Boolean(context.env.BALANCE_KV) });
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const user = await verifySession(context.env, context.request.headers.get("Cookie"));
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { balance?: unknown };
  try {
    body = (await context.request.json()) as { balance?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const value = parseBalanceInput(body.balance);
  if (value == null) return Response.json({ error: "Giá trị Balance không hợp lệ." }, { status: 400 });

  try {
    const stored = await setOpeningBalance(context.env.BALANCE_KV, value);
    return Response.json({ ok: true, balance: stored.value, updatedAt: stored.updatedAt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 503 });
  }
};
