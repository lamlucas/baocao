const $ = (sel, root = document) => root.querySelector(sel);

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const state = {
  tongQuan: { a2: "", b2: "", c2: "", d2: "", e2: "" },
  docTongQuan: null,
  thuChi: [],
  coc: [],
  congNo: [],
  banDao: [],
  computed: null,
  report: { byDay: [], byMonth: [], todayVietnam: null },
  reportBanDao: { byDay: [], byMonth: [], todayVietnam: null },
  reportThuChiNav: { month: "", day: "" },
  reportBanDaoNav: { month: "", day: "" },
  banDaoPanelNav: { month: "", day: "" },
};

function rowThuChi(r) {
  return {
    ngay: r.ngay ?? "",
    thu: r.thu ?? "",
    chi: r.chi ?? "",
    ghiChu: r.ghiChu ?? "",
  };
}
function rowCoc(r) {
  return {
    ngay: r.ngay ?? "",
    thu: r.thu ?? "",
    chi: r.chi ?? "",
    ten: r.ten ?? "",
    ghiChu: r.ghiChu ?? "",
  };
}
function rowCongNo(r) {
  return { ten: r.ten ?? "", tienNo: r.tienNo ?? "" };
}
function rowBanDao(r) {
  return {
    ngay: r.ngay ?? "",
    ten: r.ten ?? r.tenKh ?? "",
    diaChi: r.diaChi ?? "",
    sdt: r.sdt ?? "",
    soLuong: r.soLuong ?? "",
    gia: r.gia ?? "",
    thanhTien: r.thanhTien ?? r.tienUs ?? "",
  };
}

const REVEAL_KEY = "bc_reveal_balance";
const AUTO_SYNC_KEY = "bc_auto_sync";
const LAST_SIG_KEY = "bc_payload_sig";

let pollTimer = null;
let toolbarBound = false;

function isRevealed() {
  return sessionStorage.getItem(REVEAL_KEY) === "1";
}
function isAutoSyncOn() {
  return sessionStorage.getItem(AUTO_SYNC_KEY) === "1";
}
function syncSensitiveRevealClass() {
  document.body.classList.toggle("bc-sensitive-revealed", isRevealed());
}

function setRevealed(v) {
  if (v) sessionStorage.setItem(REVEAL_KEY, "1");
  else sessionStorage.removeItem(REVEAL_KEY);
  syncSensitiveRevealClass();
  const inp = $("#tq-a2");
  if (inp) inp.type = v ? "text" : "password";
  const e2inp = $("#tq-e2");
  if (e2inp) e2inp.type = v ? "text" : "password";
  const section = $("#section-sensitive-balance");
  if (section) section.hidden = !v;
  const gridBal = $("#grid-balance-edit");
  if (gridBal) gridBal.hidden = !v;
  $("#row-metric-balance")?.toggleAttribute("hidden", !v);
  $("#row-metric-fluctuation")?.toggleAttribute("hidden", !v);
  $("#btn-reveal-balance").hidden = v;
  $("#btn-hide-balance").hidden = !v;
  capNhatHienThiSoDuDauDoc();
  capNhatHienThiBienDong();
  renderThuChi();
  renderReport();
}

function setAutoSyncUi() {
  const btn = $("#btn-auto-sync");
  if (!btn) return;
  const on = isAutoSyncOn();
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.textContent = on ? "Tự động: Bật" : "Tự động: Tắt";
}

function setView(loggedIn) {
  $("#view-login").hidden = loggedIn;
  $("#view-app").hidden = !loggedIn;
  const panels = $("#admin-tab-panels");
  if (panels) panels.hidden = !loggedIn;
  if (!loggedIn && pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function activateTab(id) {
  document.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.tab === id;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    const on = p.dataset.panel === id;
    p.hidden = !on;
    p.classList.toggle("active", on);
  });
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
}

/** yyyy-mm-dd theo múi Việt Nam (Asia/Ho_Chi_Minh). */
function todayIsoVietnam() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** yyyy-mm hiện tại (GMT+7). */
function currentMonthIsoVietnam() {
  return todayIsoVietnam().slice(0, 7);
}

function tbody(id) {
  return $(`#${id} tbody`);
}

/** yyyy-mm-dd → dd/mm/yyyy (hiển thị báo cáo). */
function formatDayForDisplay(s) {
  const t = String(s ?? "").trim().split(/\s+/)[0] ?? "";
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(s ?? "");
}

/** yyyy-mm → Tháng mm/yyyy */
function formatMonthForDisplay(s) {
  const t = String(s ?? "").trim();
  const m = t.match(/^(\d{4})-(\d{2})$/);
  if (m) return `Tháng ${m[2]}/${m[1]}`;
  return t;
}

/** Chuẩn ngày → yyyy-mm-dd (khớp dữ liệu Sheet / báo cáo). */
function flexibleDateToIsoClient(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const core = raw.split(/\s+/)[0] ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(core)) return core;
  const iso = core.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = core.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return core;
}

function thuChiRowDayIso(r) {
  return flexibleDateToIsoClient(r.ngay);
}

function thuChiRowHasData(r) {
  return Boolean(
    parseNumClient(r.thu) || parseNumClient(r.chi) || String(r.ghiChu ?? "").trim(),
  );
}

function thuChiRowsForDay(isoDay) {
  return state.thuChi.filter((r) => thuChiRowDayIso(r) === isoDay && thuChiRowHasData(r));
}

function sumThuChiRows(rows) {
  let thu = 0;
  let chi = 0;
  for (const r of rows) {
    thu += parseNumClient(r.thu);
    chi += parseNumClient(r.chi);
  }
  return { thu, chi };
}

function renderThuChiDetailTable(tbodyEl, rows) {
  if (!tbodyEl) return;
  tbodyEl.innerHTML = "";
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">Không có dòng thu/chi.</td>`;
    tbodyEl.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.thu)}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.chi)}</td>
      <td class="cell-readonly">${escapeHtml(r.ghiChu ?? "")}</td>`;
    tbodyEl.appendChild(tr);
  }
}

function setReportThuChiNav(month, day) {
  state.reportThuChiNav = { month: month || "", day: day || "" };
  renderReportThuChiDrill();
}

function renderReportThuChiDrill() {
  const { month, day } = state.reportThuChiNav;
  const wrapMonths = $("#wrap-report-tc-months");
  const wrapDays = $("#wrap-report-tc-days");
  const wrapDetail = $("#wrap-report-tc-detail");
  if (!wrapMonths || !wrapDays || !wrapDetail) return;

  wrapMonths.hidden = Boolean(month);
  wrapDays.hidden = !month || Boolean(day);
  wrapDetail.hidden = !day;

  const tbMonth = $("#table-report-tc-month tbody");
  if (!month && tbMonth) {
    tbMonth.innerHTML = "";
    const months = [...(state.report?.byMonth ?? [])].sort((a, b) =>
      String(b.thang).localeCompare(String(a.thang)),
    );
    for (const r of months) {
      const tr = document.createElement("tr");
      tr.className = "report-tc-click-row";
      tr.dataset.month = String(r.thang);
      tr.innerHTML = `
        <td>${escapeHtml(formatMonthForDisplay(r.thang))}</td>
        <td class="cell-num">${fmtMoney(r.tongThu ?? 0)}</td>
        <td class="cell-num">${fmtMoney(r.tongChi ?? 0)}</td>`;
      tbMonth.appendChild(tr);
    }
  }

  const monthLabel = $("#report-tc-month-label");
  if (monthLabel) monthLabel.textContent = month ? formatMonthForDisplay(month) : "—";

  const tbDays = $("#table-report-tc-days tbody");
  if (month && !day && tbDays) {
    tbDays.innerHTML = "";
    const days = (state.report?.byDay ?? [])
      .filter((r) => String(r.date).startsWith(`${month}-`))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const r of days) {
      const tr = document.createElement("tr");
      tr.className = "report-tc-click-row";
      tr.dataset.day = String(r.date);
      tr.innerHTML = `
        <td>${escapeHtml(formatDayForDisplay(r.date))}</td>
        <td class="cell-num">${fmtMoney(r.tongThu ?? 0)}</td>
        <td class="cell-num">${fmtMoney(r.tongChi ?? 0)}</td>`;
      tbDays.appendChild(tr);
    }
  }

  const dayLabel = $("#report-tc-day-label");
  if (dayLabel) dayLabel.textContent = day ? formatDayForDisplay(day) : "—";

  if (day) {
    const rows = thuChiRowsForDay(day);
    const totals = sumThuChiRows(rows);
    const repFromApi = (state.report?.byDay ?? []).find((r) => r.date === day);
    const tThu = repFromApi?.tongThu ?? totals.thu;
    const tChi = repFromApi?.tongChi ?? totals.chi;
    const elThu = $("#report-tc-day-thu");
    const elChi = $("#report-tc-day-chi");
    if (elThu) elThu.textContent = `Tổng thu: ${fmtMoney(tThu)}`;
    if (elChi) elChi.textContent = `Tổng chi: ${fmtMoney(tChi)}`;
    renderThuChiDetailTable($("#table-report-tc-detail tbody"), rows);
  }
}

function renderReportThuChiToday() {
  const today = todayIsoVietnam();
  const rtc = state.report?.todayVietnam;
  const iso = rtc?.date ?? today;
  const rtl = $("#report-thu-chi-today-label");
  const rtthu = $("#report-thu-chi-today-thu");
  const rtchi = $("#report-thu-chi-today-chi");
  const rows = thuChiRowsForDay(iso);
  const totals = sumThuChiRows(rows);
  const tThu = typeof rtc?.tongThu === "number" && Number.isFinite(rtc.tongThu) ? rtc.tongThu : totals.thu;
  const tChi = typeof rtc?.tongChi === "number" && Number.isFinite(rtc.tongChi) ? rtc.tongChi : totals.chi;
  if (rtl) rtl.textContent = formatDayForDisplay(iso);
  if (rtthu) rtthu.textContent = `Tổng thu: ${fmtMoney(tThu)}`;
  if (rtchi) rtchi.textContent = `Tổng chi: ${fmtMoney(tChi)}`;
  renderThuChiDetailTable($("#table-report-tc-today tbody"), rows);
}

function banDaoRowDayIso(r) {
  return flexibleDateToIsoClient(r.ngay);
}

function banDaoRowHasData(r) {
  return Boolean(
    String(r.ten ?? "").trim() ||
      String(r.diaChi ?? "").trim() ||
      String(r.sdt ?? "").trim() ||
      parseNumClient(r.soLuong) ||
      parseNumClient(r.gia) ||
      parseNumClient(r.thanhTien),
  );
}

function banDaoRowsForDay(isoDay) {
  return state.banDao.filter((r) => banDaoRowDayIso(r) === isoDay && banDaoRowHasData(r));
}

function sumBanDaoRows(rows) {
  let tong = 0;
  for (const r of rows) tong += parseNumClient(r.thanhTien);
  return tong;
}

function renderBanDaoDetailTable(tbodyEl, rows) {
  if (!tbodyEl) return;
  tbodyEl.innerHTML = "";
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="muted">Không có đơn trong ngày này.</td>`;
    tbodyEl.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(r.ten ?? "")}</td>
      <td class="cell-readonly">${escapeHtml(r.diaChi ?? "")}</td>
      <td class="cell-readonly">${escapeHtml(r.sdt ?? "")}</td>
      <td class="cell-readonly cell-num">${escapeHtml(String(r.soLuong ?? ""))}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.gia)}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.thanhTien)}</td>`;
    tbodyEl.appendChild(tr);
  }
}

/** @param {"reportBanDaoNav"|"banDaoPanelNav"} navStateKey */
function renderBanDaoDrill(navStateKey, ui) {
  const nav = state[navStateKey];
  if (!nav) return;
  const { month, day } = nav;

  const wrapMonths = $(ui.wrapMonths);
  const wrapDays = $(ui.wrapDays);
  const wrapDetail = $(ui.wrapDetail);
  if (!wrapMonths || !wrapDays || !wrapDetail) return;

  wrapMonths.hidden = Boolean(month);
  wrapDays.hidden = !month || Boolean(day);
  wrapDetail.hidden = !day;

  const tbMonth = $(ui.tableMonth + " tbody");
  if (!month && tbMonth) {
    tbMonth.innerHTML = "";
    const months = [...(state.reportBanDao?.byMonth ?? [])].sort((a, b) =>
      String(b.thang).localeCompare(String(a.thang)),
    );
    for (const r of months) {
      const tr = document.createElement("tr");
      tr.className = ui.rowClass;
      tr.dataset.month = String(r.thang);
      tr.innerHTML = `
        <td>${escapeHtml(formatMonthForDisplay(r.thang))}</td>
        <td class="cell-num">${fmtMoney(r.tong ?? 0)}</td>`;
      tbMonth.appendChild(tr);
    }
  }

  const monthLabel = $(ui.monthLabel);
  if (monthLabel) monthLabel.textContent = month ? formatMonthForDisplay(month) : "—";

  const tbDays = $(ui.tableDays + " tbody");
  if (month && !day && tbDays) {
    tbDays.innerHTML = "";
    const days = (state.reportBanDao?.byDay ?? [])
      .filter((r) => String(r.date).startsWith(`${month}-`))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const r of days) {
      const tr = document.createElement("tr");
      tr.className = ui.rowClass;
      tr.dataset.day = String(r.date);
      tr.innerHTML = `
        <td>${escapeHtml(formatDayForDisplay(r.date))}</td>
        <td class="cell-num">${fmtMoney(r.tong ?? 0)}</td>`;
      tbDays.appendChild(tr);
    }
  }

  const dayLabel = $(ui.dayLabel);
  if (dayLabel) dayLabel.textContent = day ? formatDayForDisplay(day) : "—";

  if (day) {
    const rows = banDaoRowsForDay(day);
    const totals = sumBanDaoRows(rows);
    const repFromApi = (state.reportBanDao?.byDay ?? []).find((r) => r.date === day);
    const tong = typeof repFromApi?.tong === "number" && Number.isFinite(repFromApi.tong)
      ? repFromApi.tong
      : totals;
    const elTotal = $(ui.dayTotal);
    if (elTotal) elTotal.textContent = `Tổng thành tiền: ${fmtMoney(tong)}`;
    renderBanDaoDetailTable($(ui.tableDetail + " tbody"), rows);
  }
}

function setReportBanDaoNav(month, day) {
  state.reportBanDaoNav = { month: month || "", day: day || "" };
  renderBanDaoDrill("reportBanDaoNav", REPORT_BD_UI);
}

function setBanDaoPanelNav(month, day) {
  state.banDaoPanelNav = { month: month || "", day: day || "" };
  renderBanDaoDrill("banDaoPanelNav", BAN_DAO_PANEL_UI);
}

const REPORT_BD_UI = {
  wrapMonths: "#wrap-report-bd-months",
  wrapDays: "#wrap-report-bd-days",
  wrapDetail: "#wrap-report-bd-detail",
  tableMonth: "#table-report-bd-month",
  tableDays: "#table-report-bd-days",
  tableDetail: "#table-report-bd-detail",
  monthLabel: "#report-bd-month-label",
  dayLabel: "#report-bd-day-label",
  dayTotal: "#report-bd-day-total",
  rowClass: "report-bd-click-row",
};

const BAN_DAO_PANEL_UI = {
  wrapMonths: "#wrap-bandao-panel-months",
  wrapDays: "#wrap-bandao-panel-days",
  wrapDetail: "#wrap-bandao-panel-detail",
  tableMonth: "#table-bandao-panel-month",
  tableDays: "#table-bandao-panel-days",
  tableDetail: "#table-bandao-panel-detail",
  monthLabel: "#bandao-panel-month-label",
  dayLabel: "#bandao-panel-day-label",
  dayTotal: "#bandao-panel-day-total",
  rowClass: "report-bd-click-row",
};

function renderReportBanDaoDrill() {
  renderBanDaoDrill("reportBanDaoNav", REPORT_BD_UI);
}

function renderBanDaoPanelDrill() {
  renderBanDaoDrill("banDaoPanelNav", BAN_DAO_PANEL_UI);
}

function renderReportBanDaoToday() {
  const tv = state.reportBanDao?.todayVietnam;
  const iso = tv?.date ?? todayIsoVietnam();
  const rows = banDaoRowsForDay(iso);
  const totals = sumBanDaoRows(rows);
  const tong = typeof tv?.tong === "number" && Number.isFinite(tv.tong) ? tv.tong : totals;
  const lbl = $("#report-bd-today-label");
  const el = $("#report-bd-today-total");
  if (lbl) lbl.textContent = formatDayForDisplay(iso);
  if (el) el.textContent = `Tổng thành tiền: ${fmtMoney(tong)}`;
  renderBanDaoDetailTable($("#table-report-bd-today tbody"), rows);
}

function cellMoneyDisplay(raw) {
  if (raw == null || raw === "") return "—";
  if (typeof raw === "number" && Number.isFinite(raw)) return fmtMoney(raw);
  const str = String(raw).trim();
  if (!str) return "—";
  const n = parseNumClient(str);
  return fmtMoney(n);
}

function renderThuChi() {
  const tb = tbody("table-thu-chi");
  tb.innerHTML = "";
  state.thuChi.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(formatDayForDisplay(r.ngay ?? ""))}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.thu)}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.chi)}</td>
      <td class="cell-readonly">${escapeHtml(r.ghiChu ?? "")}</td>`;
    tb.appendChild(tr);
  });
}

function renderCoc() {
  const tb = tbody("table-coc");
  tb.innerHTML = "";
  state.coc.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(formatDayForDisplay(r.ngay ?? ""))}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.thu)}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.chi)}</td>
      <td class="cell-readonly">${escapeHtml(r.ten ?? "")}</td>
      <td class="cell-readonly">${escapeHtml(r.ghiChu ?? "")}</td>`;
    tb.appendChild(tr);
  });
}

function renderBanDaoDetail() {
  const tb = tbody("table-ban-dao");
  if (!tb) return;
  tb.innerHTML = "";
  for (const r of state.banDao) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(formatDayForDisplay(r.ngay ?? ""))}</td>
      <td class="cell-readonly">${escapeHtml(r.ten ?? "")}</td>
      <td class="cell-readonly">${escapeHtml(r.diaChi ?? "")}</td>
      <td class="cell-readonly">${escapeHtml(r.sdt ?? "")}</td>
      <td class="cell-readonly cell-num">${escapeHtml(String(r.soLuong ?? ""))}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.gia)}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.thanhTien)}</td>`;
    tb.appendChild(tr);
  }
}

function renderCongNo() {
  const tb = tbody("table-cong-no");
  tb.innerHTML = "";
  state.congNo.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(r.ten ?? "")}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.tienNo)}</td>`;
    tb.appendChild(tr);
  });
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function parseNumClient(s) {
  if (s == null || s === "") return 0;
  const raw = String(s).trim().replace(/\s/g, "");
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  let t = raw;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    t = raw.replace(new RegExp(`\\${thousandSep}`, "g"), "").replace(decimalSep, ".");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = raw.split(sep);
    if (parts.length > 2 && parts.slice(1).every((p) => p.length === 3)) {
      t = parts.join("");
    } else if (
      parts.length === 2 &&
      parts[1].length === 3 &&
      parts[0].length >= 1 &&
      /^\d+$/.test(parts[0]) &&
      /^\d+$/.test(parts[1])
    ) {
      t = parts.join("");
    } else {
      t = raw.replace(sep, ".");
    }
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function capNhatHienThiSoDuDauDoc() {
  const valEl = $("#so-du-dau-doc-hien-thi");
  const rawEl = $("#so-du-dau-doc-raw");
  if (!valEl) return;
  if (!isRevealed()) {
    valEl.textContent = "Đang ẩn — bấm Presently và nhập mật khẩu để xem.";
    if (rawEl) {
      rawEl.hidden = true;
      rawEl.textContent = "";
    }
    return;
  }
  const raw = ($("#tq-a2")?.value ?? "").trim();
  if (!raw) {
    valEl.textContent = "Chưa có dữ liệu — ô A2 trên TONG_QUAN đang trống.";
    if (rawEl) {
      rawEl.hidden = true;
      rawEl.textContent = "";
    }
    return;
  }
  const n = parseNumClient($("#tq-a2").value);
  valEl.textContent = fmtMoney(n);
  if (rawEl) {
    const fromApi = state.docTongQuan?.a2_soDuDau?.raw;
    if (fromApi != null && String(fromApi).trim() !== raw) {
      rawEl.hidden = false;
      rawEl.textContent = `Giá trị gốc trên Sheet (lần tải gần nhất): ${fromApi}`;
    } else {
      rawEl.hidden = true;
      rawEl.textContent = "";
    }
  }
}

function capNhatHienThiBienDong() {
  const el = $("#bien-dong-doc-hien-thi");
  if (!el) return;
  if (!isRevealed()) {
    el.textContent = "Đang ẩn — bấm Presently (cùng mật khẩu với Balance) để xem.";
    return;
  }
  const v = ($("#tq-e2")?.value ?? "").trim();
  if (!v) {
    el.textContent = "—";
    return;
  }
  el.textContent = fmtMoney(parseNumClient(v));
}

function refreshComputedFromClient() {
  const duDau = parseNumClient($("#tq-a2").value);
  const bienDongTuSheet = parseNumClient(String($("#tq-e2")?.value ?? "").trim() || "0");
  let sumCocB = 0;
  let sumCocC = 0;
  for (const r of state.coc) {
    sumCocB += parseNumClient(r.thu);
    sumCocC += parseNumClient(r.chi);
  }
  let sumNo = 0;
  for (const r of state.congNo) {
    sumNo += parseNumClient(r.tienNo);
  }
  $("#tq-b2").value = fmtMoney(sumCocC);
  $("#tq-c2").value = fmtMoney(sumCocB);
  $("#tq-d2").value = fmtMoney(sumNo);
  state.computed = {
    tongCoc: sumCocC,
    nhanCoc: sumCocB,
    tongCongNo: sumNo,
    duDauNhap: duDau,
    bienDongE2: bienDongTuSheet,
  };
  renderReport();
  capNhatHienThiSoDuDauDoc();
  capNhatHienThiBienDong();
}

function renderReport() {
  const c = state.computed;
  $("#rep-a2").textContent = isRevealed() && c ? fmtMoney(c.duDauNhap) : "—";
  $("#rep-b2").textContent = c ? fmtMoney(c.tongCoc) : "—";
  $("#rep-c2").textContent = c ? fmtMoney(c.nhanCoc) : "—";
  $("#rep-d2").textContent = c ? fmtMoney(c.tongCongNo) : "—";
  const repE2 = $("#rep-e2");
  if (repE2) repE2.textContent = isRevealed() && c ? fmtMoney(c.bienDongE2) : "—";

  renderReportThuChiDrill();
  renderReportThuChiToday();
  renderReportBanDaoDrill();
  renderReportBanDaoToday();
  renderBanDaoPanelDrill();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function applyPayload(data) {
  syncSensitiveRevealClass();
  state.tongQuan = data.tongQuan ?? state.tongQuan;
  state.docTongQuan = data.docTongQuan ?? null;
  state.thuChi = (data.thuChi ?? []).map(rowThuChi);
  state.coc = (data.coc ?? []).map(rowCoc);
  state.congNo = (data.congNo ?? []).map(rowCongNo);
  state.banDao = (data.banDao ?? []).map(rowBanDao);
  state.computed = data.computed ?? null;
  state.report = {
    byDay: data.report?.byDay ?? [],
    byMonth: data.report?.byMonth ?? [],
    todayVietnam: data.report?.todayVietnam ?? null,
  };
  state.reportBanDao = data.reportBanDao ?? { byDay: [], byMonth: [], todayVietnam: null };

  $("#tq-a2").value = state.tongQuan.a2 ?? "";
  $("#tq-b2").value = state.tongQuan.b2 ? String(state.tongQuan.b2) : "";
  $("#tq-c2").value = state.tongQuan.c2 ? String(state.tongQuan.c2) : "";
  $("#tq-e2").value =
    state.tongQuan.e2 !== undefined && state.tongQuan.e2 !== null && String(state.tongQuan.e2) !== ""
      ? String(state.tongQuan.e2)
      : "";

  sessionStorage.setItem(LAST_SIG_KEY, JSON.stringify(data));

  renderThuChi();
  renderCoc();
  renderCongNo();
  renderBanDaoDetail();
  refreshComputedFromClient();
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text || "Lỗi không xác định" };
  }
  if (!res.ok) {
    let msg = json?.error || res.statusText;
    if (typeof msg === "string" && /^\s*</.test(msg)) {
      msg =
        "Server trả HTML thay vì JSON (Worker lỗi nặng hoặc chưa deploy bản sửa). Mở Workers Logs trên Cloudflare.";
    }
    const err = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function setSyncStatus(msg, kind) {
  const el = $("#sync-status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

/** @returns {Promise<boolean>} true nếu dữ liệu đổi hoặc luôn khi force */
async function fetchSheetAndApply(options = {}) {
  const { force = false, silent = false } = options;
  const data = await api("/api/sheet", { method: "GET" });
  const sig = JSON.stringify(data);
  const prev = sessionStorage.getItem(LAST_SIG_KEY) || "";
  if (!force && sig === prev) {
    if (!silent) setSyncStatus("Đã là mới nhất (không đổi).", "ok");
    return false;
  }
  applyPayload(data);
  if (!silent) setSyncStatus("Đã tải dữ liệu từ Google Sheet.", "ok");
  return true;
}

async function tryLoadSession() {
  try {
    const data = await api("/api/sheet", { method: "GET" });
    setView(true);
    applyPayload(data);
    return true;
  } catch (e) {
    if (e.status === 401) {
      setView(false);
      return false;
    }
    throw e;
  }
}

function startAutoPoll() {
  if (pollTimer != null) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!isAutoSyncOn() || document.hidden) return;
    try {
      await fetchSheetAndApply({ force: false, silent: true });
    } catch {
      /* bỏ qua lỗi mạng từng lần */
    }
  }, 45000);
}

function bindToolbarAfterLogin() {
  if (toolbarBound) return;
  toolbarBound = true;
  $("#btn-refresh")?.addEventListener("click", async () => {
    try {
      await fetchSheetAndApply({ force: true, silent: false });
    } catch (e) {
      setSyncStatus(e.message || "Làm mới thất bại.", "err");
    }
  });

  $("#btn-auto-sync")?.addEventListener("click", () => {
    if (isAutoSyncOn()) sessionStorage.removeItem(AUTO_SYNC_KEY);
    else sessionStorage.setItem(AUTO_SYNC_KEY, "1");
    setAutoSyncUi();
    if (isAutoSyncOn()) startAutoPoll();
    else if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

  $("#btn-clear-cache")?.addEventListener("click", () => {
    sessionStorage.removeItem(REVEAL_KEY);
    sessionStorage.removeItem(AUTO_SYNC_KEY);
    sessionStorage.removeItem(LAST_SIG_KEY);
    setSyncStatus("Đã xóa cache trình duyệt. Đang tải lại…", "ok");
    location.reload();
  });

  $("#table-report-tc-month")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-tc-click-row");
    if (!tr?.dataset.month) return;
    setReportThuChiNav(tr.dataset.month, "");
  });
  $("#table-report-tc-days")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-tc-click-row");
    if (!tr?.dataset.day) return;
    setReportThuChiNav(state.reportThuChiNav.month, tr.dataset.day);
  });
  $("#btn-report-tc-back-month")?.addEventListener("click", () => setReportThuChiNav("", ""));
  $("#btn-report-tc-back-days")?.addEventListener("click", () =>
    setReportThuChiNav(state.reportThuChiNav.month, ""),
  );

  $("#table-report-bd-month")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-bd-click-row");
    if (!tr?.dataset.month) return;
    setReportBanDaoNav(tr.dataset.month, "");
  });
  $("#table-report-bd-days")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-bd-click-row");
    if (!tr?.dataset.day) return;
    setReportBanDaoNav(state.reportBanDaoNav.month, tr.dataset.day);
  });
  $("#btn-report-bd-back-month")?.addEventListener("click", () => setReportBanDaoNav("", ""));
  $("#btn-report-bd-back-days")?.addEventListener("click", () =>
    setReportBanDaoNav(state.reportBanDaoNav.month, ""),
  );

  $("#table-bandao-panel-month")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-bd-click-row");
    if (!tr?.dataset.month) return;
    setBanDaoPanelNav(tr.dataset.month, "");
  });
  $("#table-bandao-panel-days")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-bd-click-row");
    if (!tr?.dataset.day) return;
    setBanDaoPanelNav(state.banDaoPanelNav.month, tr.dataset.day);
  });
  $("#btn-bandao-panel-back-month")?.addEventListener("click", () => setBanDaoPanelNav("", ""));
  $("#btn-bandao-panel-back-days")?.addEventListener("click", () =>
    setBanDaoPanelNav(state.banDaoPanelNav.month, ""),
  );
}

function bindOverviewInput() {
  $("#tq-a2")?.addEventListener("input", refreshComputedFromClient);
  $("#tq-a2")?.addEventListener("change", refreshComputedFromClient);
}

async function main() {
  bindTabs();
  activateTab("thu_chi");
  bindOverviewInput();
  setRevealed(isRevealed());
  setAutoSyncUi();

  async function onRevealBalanceClick() {
    const p = prompt("Nhập mật khẩu để hiện Số dư đầu:");
    if (!p) return;
    try {
      await api("/api/reveal-balance", { method: "POST", body: JSON.stringify({ password: p }) });
      setRevealed(true);
    } catch (e) {
      alert(e.body?.error || e.message || "Sai mật khẩu.");
    }
  }
  $("#btn-reveal-balance").addEventListener("click", onRevealBalanceClick);
  $("#btn-hide-balance").addEventListener("click", () => setRevealed(false));

  $("#form-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const username = String(fd.get("username") || "");
    const password = String(fd.get("password") || "");
    const errEl = $("#login-error");
    errEl.hidden = true;
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
      await tryLoadSession();
      bindToolbarAfterLogin();
      if (isAutoSyncOn()) startAutoPoll();
    } catch (e) {
      errEl.textContent = e.body?.error || e.message || "Đăng nhập thất bại.";
      errEl.hidden = false;
    }
  });

  $("#btn-logout").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    setView(false);
  });

  try {
    const ok = await tryLoadSession();
    if (!ok) setView(false);
    else {
      bindToolbarAfterLogin();
      if (isAutoSyncOn()) startAutoPoll();
    }
  } catch (e) {
    setView(false);
    $("#login-error").textContent =
      e.body?.error ||
      e.message ||
      "Không tải được dữ liệu. Kiểm tra biến môi trường / quyền service account.";
    $("#login-error").hidden = false;
  }
}

main();
