export interface Env {
  SPREADSHEET_ID_MAIN: string;
  SPREADSHEET_ID_DEBT_SALES: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  BALANCE_REVEAL_PASSWORD: string;
  /** Bot ghi THU_CHI từ nhóm Telegram (Pages Secret). */
  TELEGRAM_BOT_TOKEN?: string;
  /** Mặc định -1003727898214 nếu không set. */
  TELEGRAM_THU_CHI_CHAT_ID?: string;
  /** Khớp header X-Telegram-Bot-Api-Secret-Token khi đăng ký webhook (tuỳ chọn). */
  TELEGRAM_WEBHOOK_SECRET?: string;
}
