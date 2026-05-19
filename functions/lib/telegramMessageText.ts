/** Lấy nội dung lệnh từ tin Telegram (text hoặc caption ảnh/tài liệu). */

export type TgMsgLike = {
  text?: string;
  caption?: string;
};

export function messageBodyText(msg: TgMsgLike | undefined): string {
  if (!msg) return "";
  return String(msg.text ?? msg.caption ?? "").trim();
}
