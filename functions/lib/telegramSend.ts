export async function telegramSendMessage(botToken: string, chatId: number | string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("telegram sendMessage", res.status, err);
    throw new Error(`Telegram sendMessage ${res.status}: ${err}`);
  }
}
