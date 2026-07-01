import type { Env } from "../env";
import { runLuongNvMonthlyBot } from "../lib/luongNvMonthlyBot";
import { verifySession } from "../lib/session";

async function requireUser(env: Env, request: Request): Promise<Response | null> {
  const user = await verifySession(env, request.headers.get("Cookie"));
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/** Gửi bảng lương Telegram (đăng nhập web) — không cần LUONG_NV_CRON_SECRET. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const deny = await requireUser(context.env, context.request);
  if (deny) return deny;

  if (!context.env.TELEGRAM_LUONG_NV_BOT_TOKEN?.trim()) {
    return Response.json(
      { error: "Thiếu TELEGRAM_LUONG_NV_BOT_TOKEN (@Blackcorp7777_bot) trên Cloudflare." },
      { status: 503 },
    );
  }

  try {
    const result = await runLuongNvMonthlyBot(context.env);
    if (!result.sent) {
      return Response.json(
        { ok: false, error: "Không gửi được — kiểm tra token bot và dữ liệu chấm công." },
        { status: 500 },
      );
    }
    return Response.json({
      ok: true,
      sent: true,
      month: result.month,
      message: `Đã gửi bảng lương tháng ${result.month} vào nhóm Nội Bộ.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
};
