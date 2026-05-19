# Đăng ký webhook Telegram → Cloudflare Pages (bot Black Corp - Thu Chi)
# Chạy: .\scripts\set-telegram-webhook.ps1
# Hoặc: $env:TELEGRAM_BOT_TOKEN="..."; $env:PAGES_URL="https://xxx.pages.dev"; .\scripts\set-telegram-webhook.ps1

param(
  [string]$BotToken = $env:TELEGRAM_BOT_TOKEN,
  [string]$PagesUrl = $env:PAGES_URL,
  [string]$WebhookSecret = $env:TELEGRAM_WEBHOOK_SECRET
)

if (-not $BotToken) {
  Write-Host "Thiếu token. Đặt biến TELEGRAM_BOT_TOKEN hoặc truyền -BotToken"
  Write-Host "Lấy token: Telegram -> @BotFather -> /mybots -> Black Corp - Thu Chi -> API Token"
  exit 1
}

if (-not $PagesUrl) {
  $PagesUrl = Read-Host "URL site Pages (vd https://black-corp-sheets.pages.dev)"
}
$PagesUrl = $PagesUrl.Trim().TrimEnd("/")
$WebhookUrl = "$PagesUrl/api/telegram-webhook"

Write-Host "Webhook URL: $WebhookUrl"

$body = @{ url = $WebhookUrl }
if ($WebhookSecret) {
  $body.secret_token = $WebhookSecret
  Write-Host "Dùng secret_token (phải trùng TELEGRAM_WEBHOOK_SECRET trên Cloudflare)"
}

$json = $body | ConvertTo-Json -Compress
$uri = "https://api.telegram.org/bot$BotToken/setWebhook"
$res = Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json; charset=utf-8" -Body $json

if ($res.ok) {
  Write-Host "OK: $($res.description)"
  $info = Invoke-RestMethod "https://api.telegram.org/bot$BotToken/getWebhookInfo"
  Write-Host "getWebhookInfo:"
  $info.result | ConvertTo-Json
} else {
  Write-Host "Lỗi: $($res | ConvertTo-Json)"
  exit 1
}

# Kiểm tra endpoint (GET)
try {
  $ping = Invoke-WebRequest -Uri $WebhookUrl -Method Get -UseBasicParsing
  Write-Host "GET $WebhookUrl -> $($ping.StatusCode) $($ping.Content)"
} catch {
  Write-Host "Cảnh báo: GET webhook thất bại — deploy Pages chưa xong hoặc URL sai: $_"
}
