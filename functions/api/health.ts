import type { Env } from "../env";

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
    TELEGRAM_BOT_TOKEN: Boolean(env.TELEGRAM_BOT_TOKEN?.trim()),
    TELEGRAM_LUONG_NV_BOT_TOKEN: Boolean(env.TELEGRAM_LUONG_NV_BOT_TOKEN?.trim()),
  };
  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return Response.json({
    ok: true,
    service: "black-corp-sheets",
    functionsDeployed: true,
    checks,
    missingSecrets: missing,
    hint:
      missing.length > 0
        ? "Thiếu Secret trên Cloudflare Pages — bổ sung rồi redeploy."
        : "Cấu hình đủ. Nếu Sheet vẫn trống: chia sẻ file Google Sheet cho email service account.",
  });
};
