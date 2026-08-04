/**
 * BLACK CORP — Chấm công: tự thêm dòng ngày mới trong Bảng (Bảng_1)
 * Dán TOÀN BỘ file này vào main.gs (xóa code cũ) → Save
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1rZYkgdY6C4Tf1tOjqBw0hwkVE7pLGQlQSNS21ikjZ-w
 *
 * LƯU Ý: Sheet.getValues() KHÔNG tồn tại — phải dùng sheet.getRange(...).getValues()
 */
var TZ = "Asia/Ho_Chi_Minh";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Chấm công")
    .addItem("Thêm dòng ngày hôm nay (tất cả tab)", "rollChamCongDatesAllTabs")
    .addSeparator()
    .addItem("Bật tự thêm ngày mới mỗi ngày", "installDailyDateRollTrigger")
    .addItem("Tắt trigger tự thêm ngày", "removeDailyDateRollTrigger")
    .addToUi();
  try {
    rollChamCongDatesIfNeeded_();
  } catch (e) {
    console.error(e);
  }
}

function formatTodayVN_() {
  return Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy");
}

function parseDateVN_(s) {
  if (s instanceof Date && !isNaN(s.getTime())) return s;
  var m = String(s || "")
    .trim()
    .match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function dateKey_(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function addDay_(d) {
  var n = new Date(d.getTime());
  n.setDate(n.getDate() + 1);
  return n;
}

function formatDateVN_(d) {
  return Utilities.formatDate(d, TZ, "dd/MM/yyyy");
}

function isSkippedTab_(name) {
  var low = String(name || "").trim().toLowerCase();
  if (!low) return true;
  if (low === "cau_hinh" || low === "cấu hình") return true;
  if (low === "tổng hợp" || low === "tong hop") return true;
  if (low === "sheet1") return true;
  /** Tab hệ thống — không roll ngày chấm công (tránh hỏng LUONG_TT). */
  if (low === "luong_tt") return true;
  if (low === "hh_loai_tru") return true;
  return false;
}

function isChamCongHeaderRow_(row) {
  var a = String(row[0] || "").trim().toLowerCase();
  var b = String(row[1] || "").trim().toLowerCase();
  return /ngày|ngay|date/.test(a) && /chấm công|cham cong|đi làm|di lam/.test(b);
}

/** Đọc cột A–F từ sheet (luôn qua getRange). */
function readSheetData_(sheet, maxCols) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var cols = maxCols || 6;
  return sheet.getRange(1, 1, lastRow, cols).getValues();
}

/** Tìm Bảng chấm công — trả về object Table hoặc null. */
function findChamCongTable_(sheet) {
  if (typeof sheet.getTables !== "function") return null;
  var tables = sheet.getTables();
  for (var i = 0; i < tables.length; i++) {
    var tbl = tables[i];
    var tblRange = tbl.getRange();
    if (!tblRange || typeof tblRange.getValues !== "function") continue;
    var hdr = tblRange.getValues()[0];
    if (isChamCongHeaderRow_(hdr)) return tbl;
  }
  return null;
}

/** Ngày cuối trên toàn sheet (cột A) — không chỉ trong Table. */
function readLastDateOnSheet_(sheet) {
  var data = readSheetData_(sheet, 6);
  var last = null;
  var lastKey = 0;
  for (var r = 0; r < data.length; r++) {
    if (isChamCongHeaderRow_(data[r])) continue;
    var d = parseDateVN_(data[r][0]);
    if (!d) continue;
    var k = dateKey_(d);
    if (k >= lastKey) {
      lastKey = k;
      last = d;
    }
  }
  return last;
}

function dateExistsOnSheet_(sheet, targetKey) {
  var data = readSheetData_(sheet, 6);
  for (var r = 0; r < data.length; r++) {
    if (isChamCongHeaderRow_(data[r])) continue;
    var d = parseDateVN_(data[r][0]);
    if (d && dateKey_(d) === targetKey) return true;
  }
  return false;
}

/** Gom ngày, xóa trùng / dòng lẻ (checkbox không có ngày). */
function dedupeDateRowsOnSheet_(sheet) {
  var data = readSheetData_(sheet, 6);
  var headerRow = -1;
  var dataStart = 0;
  for (var r = 0; r < data.length; r++) {
    if (isChamCongHeaderRow_(data[r])) {
      headerRow = r;
      dataStart = r + 1;
    }
  }
  if (headerRow < 0) return 0;

  var byKey = {};
  var keyOrder = [];
  for (var i = dataStart; i < data.length; i++) {
    var row = data[i];
    var d = parseDateVN_(row[0]);
    if (!d) continue;
    var k = String(dateKey_(d));
    if (!byKey[k]) {
      byKey[k] = row.slice();
      keyOrder.push(Number(k));
    } else {
      var prev = byKey[k];
      prev[1] = prev[1] === true || row[1] === true;
      for (var c = 2; c < 6; c++) {
        if (row[c] !== "" && row[c] != null && row[c] !== false) prev[c] = row[c];
      }
    }
  }
  keyOrder.sort(function (a, b) {
    return a - b;
  });
  if (!keyOrder.length) return 0;

  var rawCount = 0;
  var hasStray = false;
  for (var j = dataStart; j < data.length; j++) {
    var dj = parseDateVN_(data[j][0]);
    if (dj) rawCount++;
    else {
      for (var c = 0; c < 6; c++) {
        if (data[j][c] !== "" && data[j][c] != null && data[j][c] !== false) {
          hasStray = true;
          break;
        }
      }
    }
  }
  if (rawCount === keyOrder.length && !hasStray) return 0;

  var outRows = [];
  for (var n = 0; n < keyOrder.length; n++) {
    outRows.push(byKey[String(keyOrder[n])]);
  }

  var lastRow = sheet.getLastRow();
  if (lastRow > dataStart) {
    sheet.getRange(dataStart + 1, 1, lastRow - dataStart, 6).clearContent();
  }
  sheet.getRange(dataStart + 1, 1, outRows.length, 6).setValues(outRows);
  for (var ri = 0; ri < outRows.length; ri++) {
    sheet.getRange(dataStart + 1 + ri, 2).setValue(outRows[ri][1] === true);
  }
  return rawCount - keyOrder.length;
}

function readLastDateInTable_(table) {
  var tblRange = table.getRange();
  var values = tblRange.getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    var d = parseDateVN_(values[i][0]);
    if (d) return d;
  }
  return null;
}

function todayExistsInTable_(table, todayKey) {
  var values = table.getRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var d = parseDateVN_(values[i][0]);
    if (d && dateKey_(d) === todayKey) return true;
  }
  return false;
}

function buildDatesToAdd_(lastDate, today) {
  var todayKey = dateKey_(today);
  var out = [];
  if (!lastDate) {
    out.push(formatDateVN_(today));
    return out;
  }
  var cursor = lastDate;
  while (dateKey_(cursor) < todayKey) {
    cursor = addDay_(cursor);
    out.push(formatDateVN_(cursor));
  }
  return out;
}

function blankRowForTable_(table) {
  var cols = table.getRange().getNumColumns();
  var row = [];
  for (var c = 0; c < cols; c++) row.push("");
  return row;
}

/** Thêm dòng qua Google Table.appendRow (giữ format bảng). */
function appendDatesToTable_(table, sheet, today) {
  var todayKey = dateKey_(today);
  if (dateExistsOnSheet_(sheet, todayKey)) return 0;
  var last = readLastDateOnSheet_(sheet);
  var dates = buildDatesToAdd_(last, today);
  var added = 0;
  for (var i = 0; i < dates.length; i++) {
    var d = parseDateVN_(dates[i]);
    if (d && dateExistsOnSheet_(sheet, dateKey_(d))) continue;
    var row = blankRowForTable_(table);
    row[0] = dates[i];
    if (row.length > 1) row[1] = false;
    table.appendRow(row);
    added++;
  }
  return added;
}

/** Thêm dòng ngày trên một tab nhân viên. */
function ensureTodayDateRowOnSheet_(sheet) {
  if (!sheet || typeof sheet.getRange !== "function") return 0;

  var today = parseDateVN_(formatTodayVN_());
  if (!today) return 0;
  var todayKey = dateKey_(today);

  try {
    dedupeDateRowsOnSheet_(sheet);
  } catch (e) {
    console.error("dedupe " + sheet.getName() + ": " + e);
  }

  try {
    var table = findChamCongTable_(sheet);
    if (table) return appendDatesToTable_(table, sheet, today);
  } catch (e) {
    console.error("Table " + sheet.getName() + ": " + e);
  }

  return ensureTodayDateRowFallback_(sheet, today, todayKey);
}

/** Không có Bảng — chèn hàng sau dòng ngày cuối, copy định dạng. */
function ensureTodayDateRowFallback_(sheet, today, todayKey) {
  var data = readSheetData_(sheet, 6);

  var headerRow = -1;
  var lastDate = null;
  var lastDateRow = -1;
  for (var r = 0; r < data.length; r++) {
    if (isChamCongHeaderRow_(data[r])) headerRow = r;
    var d = parseDateVN_(data[r][0]);
    if (d) {
      lastDate = d;
      lastDateRow = r;
    }
  }

  if (lastDate && dateKey_(lastDate) === todayKey) return 0;

  var dates = buildDatesToAdd_(readLastDateOnSheet_(sheet), today);
  dates = dates.filter(function (label) {
    var d = parseDateVN_(label);
    return d && !dateExistsOnSheet_(sheet, dateKey_(d));
  });
  if (!dates.length) return 0;

  var afterRow = lastDateRow >= 0 ? lastDateRow + 1 : headerRow >= 0 ? headerRow + 1 : 1;
  var templateRow = lastDateRow >= 0 ? lastDateRow + 1 : headerRow >= 0 ? headerRow + 1 : afterRow;

  sheet.insertRowsAfter(afterRow, dates.length);
  for (var n = 0; n < dates.length; n++) {
    var destRow = afterRow + 1 + n;
    sheet
      .getRange(templateRow, 1, 1, 6)
      .copyTo(sheet.getRange(destRow, 1, 1, 6), { formatOnly: true });
    sheet.getRange(destRow, 1).setValue(dates[n]);
    sheet.getRange(destRow, 2).setValue(false);
  }
  return dates.length;
}

function rollChamCongDatesAllTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var total = 0;
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (isSkippedTab_(sheet.getName())) continue;
    total += ensureTodayDateRowOnSheet_(sheet);
  }
  ss.toast("Đã thêm " + total + " dòng ngày trong bảng.", "Chấm công", 5);
}

function rollChamCongDatesIfNeeded_() {
  var props = PropertiesService.getDocumentProperties();
  var today = formatTodayVN_();
  if (props.getProperty("lastDateRoll") === today) return;
  rollChamCongDatesAllTabs();
  props.setProperty("lastDateRoll", today);
}

function installDailyDateRollTrigger() {
  removeDailyDateRollTrigger();
  ScriptApp.newTrigger("rollChamCongDatesAllTabs")
    .timeBased()
    .atHour(0)
    .nearMinute(10)
    .inTimezone(TZ)
    .everyDays(1)
    .create();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Đã bật tự thêm dòng ngày lúc 00:10 (GMT+7).",
    "Chấm công",
    5
  );
}

function removeDailyDateRollTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "rollChamCongDatesAllTabs") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
