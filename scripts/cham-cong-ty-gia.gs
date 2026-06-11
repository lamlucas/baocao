/**
 * Google Apps Script — gắn vào file chấm công NV.
 * Cập nhật tỉ giá VND/USD vào ô F2 (tab SU_BEO + mọi tab nhân viên).
 *
 * Tab mẫu SU_BEO: A Ngày, B Chấm công, C Tiền ứng, D Phạt, E Thưởng, F2 Tỉ giá.
 */
var TEMPLATE_TAB = "SU_BEO";

function isSkippedTab_(name) {
  var low = String(name || "").trim().toLowerCase();
  if (!low) return true;
  if (low === "cau_hinh" || low === "cấu hình") return true;
  if (low === "tổng hợp" || low === "tong hop") return true;
  if (low === "sheet1") return true;
  return false;
}

/** Ghi công thức GOOGLEFINANCE vào F2 (tab mẫu + tab NV). */
function setTyGiaFormulaF2AllTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var formula = '=GOOGLEFINANCE("CURRENCY:USDVND")';
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (isSkippedTab_(name)) return;
    sh.getRange("F2").setFormula(formula);
  });
}

function installTyGiaHourlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      return t.getHandlerFunction() === "setTyGiaFormulaF2AllTabs";
    })
    .forEach(function (t) {
      ScriptApp.deleteTrigger(t);
    });
  ScriptApp.newTrigger("setTyGiaFormulaF2AllTabs").timeBased().everyHours(1).create();
}
