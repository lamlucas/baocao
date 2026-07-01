import type { Env } from "../env";
import { resolveLuongNvBotToken, sanitizeTelegramBotToken, telegramGetMe } from "../lib/telegramSend";

const LUONG_NV_BOT_USERNAME = "Blackcorp7777_bot";

/** Kiểm tra Functions đã deploy — GET /api/health → JSON (không phải HTML). */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const checks: Record<string, boolean> = {
    ADMIN_USERNAME: Boolean(env.ADMIN_USERNAME?.trim()),
    ADMIN_PASSWORD: Boolean(env.ADMIN_PASSWORD?.trim()),
    SESSION_SECRET: Boolean(env.SESSION_SECRET?.trim()),
    GOOGLE_SERVICE_ACCOUNT_JSON: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()),
    SPREADSHEET_ID_MAIN: Boolean(env.SPREADSHEET_ID_MAIN?.trim()),
    SPREADSHEET_ID_DEBT_SALES: Boolean(env.SPREADSHEET_ID_DEBT_SALES?.trim()),
    SPREADSHEET_ID_CHAM_CONG: Boolean(
      (env.SPREADSHEET_ID_CHAM_CONG ?? "1rZYkgdY6C4Tf1tOjqBw0hwkVE7pLGQlQSNS21ikjZ-w").trim(),
    ),
    TELEGRAM_BOT_TOKEN: Boolean(sanitizeTelegramBotToken(env.TELEGRAM_BOT_TOKEN)),
    TELEGRAM_LUONG_NV_BOT_TOKEN: Boolean(resolveLuongNvBotToken(env)),
    LUONG_NV_CRON_SECRET: Boolean(env.LUONG_NV_CRON_SECRET?.trim()),
  };
  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);

  const telegramLuongNv = await telegramGetMe(resolveLuongNvBotToken(env));
  const telegramMain = checks.TELEGRAM_BOT_TOKEN
    ? await telegramGetMe(env.TELEGRAM_BOT_TOKEN ?? "")
    : { ok: false as const, status: 0, description: "not configured" };

  return Response.json({
    ok: true,
    service: "black-corp-sheets",
    functionsDeployed: true,
    checks,
    missingSecrets: missing,
    telegram: {
      luongNv: telegramLuongNv.ok
        ? {
            valid: true,
            username: telegramLuongNv.username,
            expectedUsername: LUONG_NV_BOT_USERNAME,
            usernameMatch: telegramLuongNv.username.toLowerCase() === LUONG_NV_BOT_USERNAME.toLowerCase(),
            firstName: telegramLuongNv.firstName,
          }
        : {
            valid: false,
            error: telegramLuongNv.description,
            status: telegramLuongNv.status,
            hint:
              "Cập nhật secret TELEGRAM_LUONG_NV_BOT_TOKEN = token @Blackcorp7777_bot từ @BotFather (không dùng TELEGRAM_BOT_TOKEN).",
          },
      main: telegramMain.ok
        ? { valid: true, username: telegramMain.username, firstName: telegramMain.firstName }
        : { valid: false, error: telegramMain.description },
    },
    hint:
      missing.length > 0
        ? "Thiếu Secret trên Cloudflare Pages — bổ sung rồi redeploy."
        : !telegramLuongNv.ok
          ? "Token bot lương không hợp lệ — chạy scripts/setup-luong-nv-telegram.ps1 hoặc cập nhật secret trên Cloudflare."
          : "Cấu hình đủ. Nếu Sheet vẫn trống: chia sẻ file Google Sheet cho email service account.",
  });
};
