export function sanitizeTelegramBotToken(raw: string | undefined | null): string {
  if (!raw) return "";
  let t = String(raw).trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (/^bot\s+/i.test(t)) t = t.replace(/^bot\s+/i, "");
  return t.trim();
}

export function resolveLuongNvBotToken(env: { TELEGRAM_LUONG_NV_BOT_TOKEN?: string }): string {
  return sanitizeTelegramBotToken(env.TELEGRAM_LUONG_NV_BOT_TOKEN);
}

export type TelegramGetMeResult =
  | { ok: true; username: string; firstName: string; id: number }
  | { ok: false; status: number; description: string };

export async function telegramGetMe(botToken: string): Promise<TelegramGetMeResult> {
  const token = sanitizeTelegramBotToken(botToken);
  if (!token) return { ok: false, status: 0, description: "empty token" };
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  let data: { ok?: boolean; description?: string; result?: { username?: string; first_name?: string; id?: number } };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, status: res.status, description: await res.text() };
  }
  if (!res.ok || !data.ok) {
    return {
      ok: false,
      status: res.status,
      description: String(data.description ?? "getMe failed"),
    };
  }
  return {
    ok: true,
    username: data.result?.username ?? "",
    firstName: data.result?.first_name ?? "",
    id: data.result?.id ?? 0,
  };
}

export async function telegramSendMessage(
  botToken: string,
  chatId: number | string,
  text: string,
): Promise<void> {
  const token = sanitizeTelegramBotToken(botToken);
  if (!token) throw new Error("Thiếu Telegram bot token.");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("telegram sendMessage", res.status, err);
    if (res.status === 401) {
      throw new Error(
        "Telegram 401 Unauthorized — token TELEGRAM_LUONG_NV_BOT_TOKEN sai hoặc đã thu hồi. Lấy token mới từ @BotFather cho @Blackcorp7777_bot và cập nhật secret Cloudflare.",
      );
    }
    throw new Error(`Telegram sendMessage ${res.status}: ${err}`);
  }
}
