export interface Env {
  SPREADSHEET_ID_MAIN: string;
  /** File Google Sheet chứa tab BAO_CAO_TK (bot nhóm theo dõi tài khoản). */
  SPREADSHEET_ID_DEBT_SALES: string;
  /**
   * File chứa tab BAN_DAO (web + bot đơn dao). Tổng quan / Thu chi / Cọc / Công nợ đọc từ SPREADSHEET_ID_MAIN.
   * Nếu không set, BAN_DAO đọc/ghi trên SPREADSHEET_ID_DEBT_SALES (thường không dùng khi DEBT chỉ có BAO_CAO_TK).
   */
  SPREADSHEET_ID_BAN_DAO?: string;
  /** File chấm công nhân viên (mỗi tab = 1 NV, cột B = tick ngày công). */
  SPREADSHEET_ID_CHAM_CONG?: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  BALANCE_REVEAL_PASSWORD: string;
  /** Bot webhook Thu chi / Cọc / Công nợ / Bán dao / Báo cáo TK (Pages Secret). */
  TELEGRAM_BOT_TOKEN?: string;
  /** Bot @Blackcorp7777_bot — gửi bảng lương ngày 1 vào nhóm Nội Bộ (riêng, không dùng TELEGRAM_BOT_TOKEN). */
  TELEGRAM_LUONG_NV_BOT_TOKEN?: string;
  /** Mặc định -1003727898214 nếu không set. */
  TELEGRAM_THU_CHI_CHAT_ID?: string;
  /** Nhóm Báo Đơn Dao US — mặc định -5091396609. */
  TELEGRAM_BAN_DAO_CHAT_ID?: string;
  /** Black Corp theo dõi tài khoản — mặc định -1003992397667 (ghi tab BAO_CAO_TK). */
  TELEGRAM_BAO_CAO_CHAT_ID?: string;
  /** Nội Bộ - Black Corp — mặc định -1003978420142 (bot gửi bảng lương ngày 1). */
  TELEGRAM_NOI_BO_CHAT_ID?: string;
  /** Secret cho cron gửi bảng lương (tuỳ chọn, dùng khi gọi thủ công). */
  LUONG_NV_CRON_SECRET?: string;
  /** Khớp header X-Telegram-Bot-Api-Secret-Token khi đăng ký webhook (tuỳ chọn). */
  TELEGRAM_WEBHOOK_SECRET?: string;
}
