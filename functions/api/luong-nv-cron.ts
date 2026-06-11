import type { Env } from "../env";
import { runLuongNvMonthlyBot } from "../lib/luongNvMonthlyBot";

/**
 * Gửi bảng lương tháng trước — gọi bằng cron ngoài (vd. cron-job.org) lúc 15:00 GMT+7 ngày 1.
 * GET /api/luong-nv-cron?secret=... (hoặc header X-Cron-Secret)
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const secret = env.LUONG_NV_CRON_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { error: "Thiếu LUONG_NV_CRON_SECRET trên Cloudflare Pages." },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const provided =
    url.searchParams.get("secret")?.trim() ||
    request.headers.get("X-Cron-Secret")?.trim() ||
    "";
  if (provided !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runLuongNvMonthlyBot(env);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
};
