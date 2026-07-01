# Kiem tra token @Blackcorp7777_bot va (tu chon) cap nhat secret Cloudflare Pages.
#
# Cach 1 — chi kiem tra token:
#   $env:TELEGRAM_LUONG_NV_BOT_TOKEN = "<token tu @BotFather>"
#   .\scripts\setup-luong-nv-telegram.ps1
#
# Cach 2 — kiem tra + ghi secret len Cloudflare:
#   $env:TELEGRAM_LUONG_NV_BOT_TOKEN = "<token>"
#   .\scripts\setup-luong-nv-telegram.ps1 -PushSecret

param(
  [string]$Token = $env:TELEGRAM_LUONG_NV_BOT_TOKEN,
  [switch]$PushSecret,
  [string]$ProjectName = "black-agency"
)

$ExpectedUsername = "Blackcorp7777_bot"

function Normalize-Token([string]$raw) {
  if (-not $raw) { return "" }
  $t = $raw.Trim()
  if (($t.StartsWith('"') -and $t.EndsWith('"')) -or ($t.StartsWith("'") -and $t.EndsWith("'"))) {
    $t = $t.Substring(1, $t.Length - 2).Trim()
  }
  if ($t -match '^bot\s+') { $t = ($t -replace '^bot\s+', '').Trim() }
  return $t
}

$Token = Normalize-Token $Token
if (-not $Token) {
  Write-Host "Thieu token. Lay tu @BotFather cho @$ExpectedUsername"
  Write-Host "  /mybots -> Black Corp - Bao cao -> API Token"
  exit 1
}

Write-Host "=== Kiem tra getMe ==="
try {
  $me = Invoke-RestMethod -Uri "https://api.telegram.org/bot$Token/getMe" -TimeoutSec 20
} catch {
  Write-Host "Loi goi Telegram: $($_.Exception.Message)"
  exit 1
}

if (-not $me.ok) {
  Write-Host "Token khong hop le (401/403). Lay token MOI tu @BotFather."
  exit 1
}

$user = $me.result.username
Write-Host "  Bot: @$user — $($me.result.first_name) (id $($me.result.id))"
if ($user -ne $ExpectedUsername) {
  Write-Host "CANH BAO: Token khong phai @$ExpectedUsername (dang la @$user)"
  $ans = Read-Host "Van tiep tuc? (y/N)"
  if ($ans -notmatch '^[yY]') { exit 1 }
}

if (-not $PushSecret) {
  Write-Host ""
  Write-Host "Token hop le. Cap nhat Cloudflare:"
  Write-Host "  Dashboard -> Workers & Pages -> $ProjectName -> Settings -> Environment variables"
  Write-Host "  Ten: TELEGRAM_LUONG_NV_BOT_TOKEN (Encrypt, Production)"
  Write-Host "  Hoac chay lai: .\scripts\setup-luong-nv-telegram.ps1 -PushSecret"
  exit 0
}

$root = Split-Path $PSScriptRoot -Parent
$wrangler = Join-Path $root "node_modules\.bin\wrangler.cmd"
if (-not (Test-Path $wrangler)) {
  Write-Host "Chua co wrangler. Chay: npm install"
  exit 1
}

Write-Host ""
Write-Host "=== Ghi secret len Cloudflare Pages ($ProjectName) ==="
$env:TELEGRAM_LUONG_NV_BOT_TOKEN = $Token
& $wrangler pages secret put TELEGRAM_LUONG_NV_BOT_TOKEN --project-name $ProjectName
if ($LASTEXITCODE -ne 0) {
  Write-Host "wrangler that bai. Dang nhap: npx wrangler login"
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Xong. Doi ~1 phut roi kiem tra: https://black-agency.pages.dev/api/health"
Write-Host "Truong telegram.luongNv.valid phai la true."
