# Gắn webhook bot Black Corp - Thu Chi → Cloudflare Pages

Telegram chỉ gửi tin nhóm tới **một URL** bạn đăng ký. URL đó phải trỏ tới project Pages và dùng **token của bot Thu Chi** (không phải bot Báo cáo).

## 1. Lấy token bot Thu Chi

1. Mở Telegram → [@BotFather](https://t.me/BotFather)
2. `/mybots` → chọn **Black Corp - Thu Chi**
3. **API Token** → copy (dạng `123456789:ABCdef...`)

## 2. Thêm Secret trên Cloudflare

1. Vào [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. Chọn project **black-corp-sheets** (hoặc tên project bạn deploy)
3. **Settings** → **Environment variables**
4. Tab **Production** (và **Preview** nếu test)
5. **Add** → chọn **Encrypt** (Secret):

| Tên biến | Bắt buộc | Ghi chú |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Có | Token bot **Thu Chi** từ BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Khuyến nghị | Chuỗi ngẫu nhiên dài (vd `bc-webhook-2026-xYz...`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Có | JSON service account (một dòng) |
| `ADMIN_PASSWORD` | Có | Mật khẩu đăng nhập web |
| `SESSION_SECRET` | Có | Chuỗi ngẫu nhiên |
| `BALANCE_REVEAL_PASSWORD` | Có | Mật khẩu xem số dư |

Tuỳ chọn (có thể để **Variables** không mã hóa):

- `TELEGRAM_THU_CHI_CHAT_ID` — mặc định `-1003727898214`
- `TELEGRAM_BAO_CAO_CHAT_ID` — mặc định `-1003992397667`
- `TELEGRAM_AGENT_CHAT_MAP` — ví dụ `{"-1001234567890":"NVT"}`

6. **Save** → **Redeploy** project (Deployments → ⋮ → Retry deployment) để secret có hiệu lực.

### Cách 2: Wrangler CLI

```powershell
cd "đường-dẫn\bao cao moi"
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name=black-corp-sheets
# Nhập token khi được hỏi

npx wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name=black-corp-sheets
npx wrangler pages secret put GOOGLE_SERVICE_ACCOUNT_JSON --project-name=black-corp-sheets
```

## 3. Deploy code (nếu chưa)

```powershell
npm run deploy
```

Ghi lại URL site, ví dụ: `https://black-corp-sheets.pages.dev`

## 4. Đăng ký webhook với Telegram

Thay `<TOKEN>` và `<PAGES_URL>`:

```powershell
$env:TELEGRAM_BOT_TOKEN = "<TOKEN-bot-Thu-Chi>"
$env:PAGES_URL = "https://black-corp-sheets.pages.dev"
$env:TELEGRAM_WEBHOOK_SECRET = "chuỗi-trùng-Cloudflare"   # bỏ qua nếu không dùng secret

.\scripts\set-telegram-webhook.ps1
```

Hoặc gọi API trực tiếp (PowerShell):

```powershell
$token = "<TOKEN>"
$url = "https://black-corp-sheets.pages.dev/api/telegram-webhook"
$secret = "chuỗi-bí-mật"

$body = @{ url = $url; secret_token = $secret } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook" -Method Post -ContentType "application/json" -Body $body
```

Kiểm tra:

```powershell
Invoke-RestMethod "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`url` phải đúng `/api/telegram-webhook`, `last_error_message` nên trống.

Mở trình duyệt: `https://black-corp-sheets.pages.dev/api/telegram-webhook` → thấy chữ **Telegram webhook (POST)**.

## 5. Bot trong nhóm

- Thêm **Black Corp - Thu Chi** vào mọi nhóm đại lý (BLA - NVT, …).
- Cấp quyền **đọc tin nhắn** (hoặc tắt privacy mode: BotFather → bot → **Bot Settings** → **Group Privacy** → Turn off).

### Thu / Chi (tab THU_CHI — file MAIN `1IikVlW74…`)

| Việc | Cách làm |
|------|----------|
| Ghi Sheet | `Thu: 6.28 - AT` hoặc `Chi: 100 - VL` (số trước dấu `-`, ghi chú / mã ĐL sau) |
| Ngày | Tự động theo giờ Việt Nam (cột A) |
| Cột B / C | Thu → B; Chi → C |
| Nhóm đại lý | **Trả lời ảnh** bằng lệnh Thu/Chi → chuyển ảnh + lệnh sang nhóm **Thu chi - Black Corp** (`TELEGRAM_THU_CHI_CHAT_ID`) |
| Nhóm Thu chi | Gõ lệnh trực tiếp trong nhóm hub — chỉ ghi Sheet (không chuyển tiếp) |

## 6. Một token = một webhook

Nếu trước đó token Thu Chi gắn webhook khác, `setWebhook` sẽ **ghi đè**. Bot **Báo cáo** (token khác) **không** cần webhook cho tính năng CONG_NO — Telegram gửi mọi tin nhóm tới bot Thu Chi khi bot Thu Chi có trong nhóm.

## 7. Xử lý lỗi thường gặp

| Triệu chứng | Cách xử lý |
|-------------|------------|
| Không phản hồi | Kiểm tra `getWebhookInfo`, redeploy sau khi thêm secret |
| 403 Forbidden | `TELEGRAM_WEBHOOK_SECRET` trên Cloudflare ≠ `secret_token` lúc setWebhook |
| CONG_NO không đổi | Bot Thu Chi có trong nhóm? Đã deploy code mới? |
| Chỉ bot Báo cáo gửi tin | Bình thường — webhook vẫn nhận tin **của mọi thành viên/bot** trong nhóm nếu bot Thu Chi là member |
