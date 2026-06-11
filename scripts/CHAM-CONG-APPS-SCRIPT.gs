/**
 * BLACK CORP — Chấm công & tỉ giá lương NV
 * Dán toàn bộ file này vào: Extensions → Apps Script (file chấm công)
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1rZYkgdY6C4Tf1tOjqBw0hwkVE7pLGQlQSNS21ikjZ-w
 *
 * Tab mẫu: SU_BEO
 *   A: Ngày | B: Chấm công | C: Tiền ứng | D: Phạt | E: Thưởng
 *   F2: Tỉ giá VND / 1 USD (web đọc ô này để tính lương CB)
 *
 * Cách cài:
 * 1. Mở Sheet → Extensions → Apps Script → dán code → Save
 * 2. Reload Sheet → menu « Chấm công » → « Cài F2 tỉ giá (tất cả tab) »
 *    (Lần đầu: Authorize quyền truy cập)
 * 3. Tuỳ chọn: « Bật tự cập nhật mỗi giờ »
 */
var TEMPLATE_TAB = "SU_BEO";
var TY_GIA_FORMULA = '=GOOGLEFINANCE("CURRENCY:USDVND")';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Chấm công")
    .addItem("Cài F2 tỉ giá (tất cả tab)", "setTyGiaFormulaF2AllTabs")
    .addItem("Copy F2 từ SU_BEO sang tab NV", "copyTyGiaFromTemplate")
    .addSeparator()
    .addItem("Bật tự cập nhật mỗi giờ", "installTyGiaHourlyTrigger")
    .addItem("Tắt trigger tự cập nhật", "removeTyGiaHourlyTrigger")
    .addToUi();
}

/** Tab hệ thống — bỏ qua khi cập nhật F2. */
function isSkippedTab_(name) {
  var low = String(name || "").trim().toLowerCase();
  if (!low) return true;
  if (low === "cau_hinh" || low === "cấu hình") return true;
  if (low === "tổng hợp" || low === "tong hop") return true;
  if (low === "sheet1") return true;
  return false;
}

/** Ghi công thức GOOGLEFINANCE vào F2 — tab SU_BEO + mọi tab nhân viên. */
function setTyGiaFormulaF2AllTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var count = 0;
  ss.getSheets().forEach(function (sh) {
    if (isSkippedTab_(sh.getName())) return;
    sh.getRange("F2").setFormula(TY_GIA_FORMULA);
    count++;
  });
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Đã cài F2 cho " + count + " tab.",
    "Chấm công",
    5
  );
}

/**
 * Copy giá trị F2 từ tab SU_BEO sang các tab NV (không ghi đè tab mẫu).
 * Dùng khi nhập tỉ giá tay vào SU_BEO!F2 thay vì GOOGLEFINANCE.
 */
function copyTyGiaFromTemplate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var template = ss.getSheetByName(TEMPLATE_TAB);
  if (!template) {
    SpreadsheetApp.getUi().alert("Không tìm thấy tab mẫu « " + TEMPLATE_TAB + " ».");
    return;
  }
  var rate = template.getRange("F2").getValue();
  if (rate === "" || rate === null) {
    SpreadsheetApp.getUi().alert("Ô F2 tab " + TEMPLATE_TAB + " đang trống.");
    return;
  }
  var count = 0;
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === TEMPLATE_TAB || isSkippedTab_(name)) return;
    sh.getRange("F2").setValue(rate);
    count++;
  });
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Đã copy F2 → " + count + " tab NV.",
    "Chấm công",
    5
  );
}

/** Tự chạy mỗi giờ — refresh công thức F2. */
function installTyGiaHourlyTrigger() {
  removeTyGiaHourlyTrigger();
  ScriptApp.newTrigger("setTyGiaFormulaF2AllTabs")
    .timeBased()
    .everyHours(1)
    .create();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Đã bật cập nhật F2 mỗi giờ.",
    "Chấm công",
    5
  );
}

function removeTyGiaHourlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      return t.getHandlerFunction() === "setTyGiaFormulaF2AllTabs";
    })
    .forEach(function (t) {
      ScriptApp.deleteTrigger(t);
    });
}

/** Khi sửa F2 trên SU_BEO → tự copy sang tab NV. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== TEMPLATE_TAB) return;
  if (e.range.getA1Notation() !== "F2") return;
  copyTyGiaFromTemplate();
}
