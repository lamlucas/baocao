# Sheet error log

Lỗi đọc Google Sheets được ghi ở 3 nơi:

## 1. Cloudflare Workers console
Mỗi lỗi in dạng JSON: `[sheet-error-log] {...}`

## 2. KV (server) — key `__sheet_error_log__`
- Binding: `BALANCE_KV` (cùng namespace Balance)
- Tối đa **40** dòng gần nhất
- API `/api/sheet` trả thêm `sheetDiagnostics.recentErrorLog`

## 3. Trình duyệt (localStorage)
- `sheetErrorLog` — lỗi từ lần tải Sheet gần đây (client)
- `sheetErrorLogServer` — bản copy từ KV qua API

### Xem log trên trình duyệt
Mở DevTools → Console:

```js
JSON.parse(localStorage.getItem("sheetErrorLog") || "[]")
JSON.parse(localStorage.getItem("sheetErrorLogServer") || "[]")
```

## Lỗi 429 (quota)
Google giới hạn **60 read requests/phút** cho service account. Tránh bấm Làm mới liên tục hoặc mở nhiều tab; tắt **Tự động** nếu không cần.
