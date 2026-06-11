const $ = (sel, root = document) => root.querySelector(sel);

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/** USD theo locale Việt Nam (1.234,56 US$) — tab Chi tiêu / BAO_CAO_TK. */
function fmtChiTieuUsd(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtVnd(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

const state = {
  tongQuan: { a2: "", b2: "", c2: "", d2: "", e2: "" },
  docTongQuan: null,
  thuChi: [],
  coc: [],
  congNo: [],
  banDao: [],
  baoCaoTk: [],
  computed: null,
  report: { byDay: [], byMonth: [], todayVietnam: null },
  reportBanDao: { byDay: [], byMonth: [], todayVietnam: null },
  reportChiTieu: { byDay: [], byMonth: [], todayVietnam: null, nguonList: [] },
  reportLuongNv: { todayVietnam: "", currentMonth: "", previousMonth: "", periods: [] },
  hhLoaiTru: [],
  hhLoaiTruDirty: false,
  chamCongNvTabs: [],
  chamCongNvTemplate: "SUBEO",
  reportThuChiNav: { month: "", day: "" },
  reportThuChiMode: "monthly",
  reportThuChiNguonFilter: "",
  reportBanDaoNav: { month: "", day: "" },
  banDaoPanelNav: { month: "", day: "" },
  chiTieuNav: { month: "", day: "" },
  chiTieuNguonFilter: "",
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
function rowBaoCaoTk(r) {
  return {
    ngay: r.ngay ?? "",
    mcc: r.mcc ?? "",
    taiKhoan: r.taiKhoan ?? "",
    tenKhach: r.tenKhach ?? "",
    tongTieu: r.tongTieu ?? 0,
    tongThu: r.tongThu ?? 0,
    nguon: r.nguon ?? "—",
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
  const topbarNav = $("#topbar-nav");
  if (topbarNav) topbarNav.hidden = !loggedIn;
  const topbarInner = $("#topbar-inner");
  if (topbarInner) topbarInner.classList.toggle("topbar-inner--app", loggedIn);
  if (!loggedIn) closeAppMenu();
  if (!loggedIn && pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

const TAB_LABELS = {
  thu_chi: "Thu chi",
  coc: "Tiền cọc",
  cong_no: "Công nợ",
  chi_tieu: "Chi tiêu",
  ban_dao: "Bán dao",
  luong_nv: "Lương NV",
  bao_cao: "Báo cáo",
};

function closeAppMenu() {
  const panel = $("#app-menu-panel");
  const btn = $("#btn-app-menu");
  const backdrop = $("#app-menu-backdrop");
  if (panel) panel.hidden = true;
  if (backdrop) backdrop.hidden = true;
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Mở menu");
  }
}

function openAppMenu() {
  const panel = $("#app-menu-panel");
  const btn = $("#btn-app-menu");
  const backdrop = $("#app-menu-backdrop");
  if (panel) panel.hidden = false;
  if (backdrop) backdrop.hidden = false;
  if (btn) {
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Đóng menu");
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
  const heading = document.getElementById("page-heading");
  if (heading) heading.textContent = TAB_LABELS[id] || id;
  document.title = `BLACK CORP® — ${TAB_LABELS[id] || id}`;
  closeAppMenu();
  if (id === "luong_nv" && !state.hhLoaiTruDirty) {
    void loadHhLoaiTruFromApi().catch(() => {});
  }
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
}

function bindAppMenu() {
  const toggle = $("#btn-app-menu");
  const backdrop = $("#app-menu-backdrop");
  if (!toggle) return;

  toggle.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const panel = $("#app-menu-panel");
    if (panel?.hidden) openAppMenu();
    else closeAppMenu();
  });

  backdrop?.addEventListener("click", closeAppMenu);

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeAppMenu();
  });

  document.querySelectorAll(".app-menu-actions .btn").forEach((btn) => {
    btn.addEventListener("click", () => closeAppMenu());
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

/** Khóa ghi chú (cột D) — không phân biệt hoa/thường. */
function thuChiNguonNormKey(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return "—";
  return t.toLocaleLowerCase("vi");
}

function thuChiRowNguonNormKey(r) {
  return thuChiNguonNormKey(r.ghiChu);
}

function thuChiNguonDisplayLabel(normKey) {
  if (!normKey) return "";
  for (const r of state.thuChi) {
    if (!thuChiRowHasData(r)) continue;
    if (thuChiRowNguonNormKey(r) !== normKey) continue;
    const raw = String(r.ghiChu ?? "").trim();
    return raw || "—";
  }
  return normKey;
}

function thuChiNguonList() {
  const byNorm = new Map();
  for (const r of state.thuChi) {
    if (!thuChiRowHasData(r)) continue;
    const raw = String(r.ghiChu ?? "").trim();
    const label = raw || "—";
    const norm = thuChiNguonNormKey(raw);
    if (!byNorm.has(norm)) byNorm.set(norm, label);
  }
  return [...byNorm.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "vi"))
    .map(([norm, label]) => ({ norm, label }));
}

function thuChiRowsForReport() {
  const rows = state.thuChi.filter(thuChiRowHasData);
  if (state.reportThuChiMode !== "nguon") return rows;
  const nguon = state.reportThuChiNguonFilter || "";
  if (!nguon) return [];
  return rows.filter((r) => thuChiRowNguonNormKey(r) === nguon);
}

function buildThuChiAggregates(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const day = thuChiRowDayIso(r);
    if (!day) continue;
    const cur = byDay.get(day) ?? { thu: 0, chi: 0 };
    cur.thu += parseNumClient(r.thu);
    cur.chi += parseNumClient(r.chi);
    byDay.set(day, cur);
  }
  const byMonth = new Map();
  for (const [day, v] of byDay) {
    const m = day.slice(0, 7);
    const cur = byMonth.get(m) ?? { thu: 0, chi: 0 };
    cur.thu += v.thu;
    cur.chi += v.chi;
    byMonth.set(m, cur);
  }
  return {
    byDay: [...byDay.entries()]
      .map(([date, v]) => ({ date, tongThu: v.thu, tongChi: v.chi }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byMonth: [...byMonth.entries()]
      .map(([thang, v]) => ({ thang, tongThu: v.thu, tongChi: v.chi }))
      .sort((a, b) => a.thang.localeCompare(b.thang)),
  };
}

function thuChiRowsForDayFiltered(isoDay) {
  return thuChiRowsForReport().filter((r) => thuChiRowDayIso(r) === isoDay);
}

function populateReportThuChiNguonFilter() {
  const sel = $("#report-thu-chi-nguon-filter");
  if (!sel) return;
  const prev = state.reportThuChiNguonFilter || "";
  const list = thuChiNguonList();
  sel.innerHTML = `<option value="">— Chọn nguồn —</option>`;
  for (const { norm, label } of list) {
    const opt = document.createElement("option");
    opt.value = norm;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  const prevNorm = prev ? thuChiNguonNormKey(prev) : "";
  if (prevNorm && list.some((x) => x.norm === prevNorm)) {
    sel.value = prevNorm;
    state.reportThuChiNguonFilter = prevNorm;
  } else {
    sel.value = "";
    state.reportThuChiNguonFilter = "";
  }
}

function setReportThuChiMode(mode) {
  state.reportThuChiMode = mode === "nguon" ? "nguon" : "monthly";
  state.reportThuChiNav = { month: "", day: "" };
  document.querySelectorAll(".report-thu-chi-mode-btn").forEach((btn) => {
    const on = btn.dataset.mode === state.reportThuChiMode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const wrapFilter = $("#wrap-report-thu-chi-nguon-filter");
  if (wrapFilter) wrapFilter.hidden = state.reportThuChiMode !== "nguon";
  renderReportThuChiDrill();
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

  const rows = thuChiRowsForReport();
  const { byMonth, byDay } = buildThuChiAggregates(rows);
  const needNguon = state.reportThuChiMode === "nguon" && !state.reportThuChiNguonFilter;

  const nguonLabel = $("#report-tc-nguon-label");
  if (nguonLabel) {
    if (state.reportThuChiMode === "nguon" && state.reportThuChiNguonFilter) {
      nguonLabel.hidden = false;
      nguonLabel.textContent = ` — ${thuChiNguonDisplayLabel(state.reportThuChiNguonFilter)}`;
    } else {
      nguonLabel.hidden = true;
      nguonLabel.textContent = "";
    }
  }

  const tbMonth = $("#table-report-tc-month tbody");
  if (!month && tbMonth) {
    tbMonth.innerHTML = "";
    if (needNguon) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="3" class="muted">Chọn nguồn (ghi chú) để xem báo cáo.</td>`;
      tbMonth.appendChild(tr);
    } else if (!byMonth.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="3" class="muted">Không có dữ liệu.</td>`;
      tbMonth.appendChild(tr);
    } else {
      for (const r of [...byMonth].sort((a, b) => String(b.thang).localeCompare(String(a.thang)))) {
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
  }

  const monthLabel = $("#report-tc-month-label");
  if (monthLabel) monthLabel.textContent = month ? formatMonthForDisplay(month) : "—";

  const tbDays = $("#table-report-tc-days tbody");
  if (month && !day && tbDays) {
    tbDays.innerHTML = "";
    const days = byDay
      .filter((r) => String(r.date).startsWith(`${month}-`))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!days.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="3" class="muted">Không có dữ liệu trong tháng này.</td>`;
      tbDays.appendChild(tr);
    } else {
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
  }

  const dayLabel = $("#report-tc-day-label");
  if (dayLabel) dayLabel.textContent = day ? formatDayForDisplay(day) : "—";

  if (day) {
    const dayRows = thuChiRowsForDayFiltered(day);
    const totals = sumThuChiRows(dayRows);
    const rep = byDay.find((r) => r.date === day);
    const tThu = rep?.tongThu ?? totals.thu;
    const tChi = rep?.tongChi ?? totals.chi;
    const elThu = $("#report-tc-day-thu");
    const elChi = $("#report-tc-day-chi");
    if (elThu) elThu.textContent = `Tổng thu: ${fmtMoney(tThu)}`;
    if (elChi) elChi.textContent = `Tổng chi: ${fmtMoney(tChi)}`;
    renderThuChiDetailTable($("#table-report-tc-detail tbody"), dayRows);
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

function chiTieuSameCalendarMonth(ngay, monthIso) {
  if (!ngay || !monthIso || String(ngay).length < 7 || String(monthIso).length < 7) return false;
  return String(ngay).slice(5, 7) === String(monthIso).slice(5, 7);
}

function chiTieuScopeLabel(month, day) {
  if (day) return `Ngày ${formatDayForDisplay(day)}`;
  if (month) return formatMonthForDisplay(month);
  return "Tất cả ngày có dữ liệu";
}

function chiTieuEntriesForNguonView(entries, month, day) {
  if (day) return entries.filter((r) => r.ngay === day);
  if (month) return entries.filter((r) => chiTieuSameCalendarMonth(r.ngay, month));
  return entries;
}

/** Số từ API (UNFORMATTED) — không parse lại nếu đã là number. */
function chiTieuAmount(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return parseNumClient(v);
}

function chiTieuFilteredEntries() {
  const filter = state.chiTieuNguonFilter || "";
  if (!filter) return state.baoCaoTk;
  return state.baoCaoTk.filter((r) => (r.nguon || "—") === filter);
}

function renderChiTieuByNguonFilter() {
  const filter = state.chiTieuNguonFilter || "";
  const wrap = $("#wrap-chi-tieu-by-nguon");
  if (!wrap) return;

  if (!filter) {
    wrap.hidden = true;
    for (const id of [
      "chi-tieu-month-nguon-heading",
      "chi-tieu-days-nguon-heading",
    ]) {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    }
    for (const sel of ["#table-chi-tieu-month-nguon", "#table-chi-tieu-days-nguon"]) {
      const table = $(sel);
      const block = table?.closest(".table-wrap");
      if (block) block.hidden = false;
    }
    return;
  }

  wrap.hidden = false;
  const labelEl = $("#chi-tieu-by-nguon-label");
  const scopeEl = $("#chi-tieu-by-nguon-scope");
  const tbody = $("#table-chi-tieu-by-nguon tbody");
  const { month, day } = state.chiTieuNav;
  const hideNguonSummary = true;

  for (const id of [
    "chi-tieu-month-nguon-heading",
    "chi-tieu-days-nguon-heading",
  ]) {
    const el = document.getElementById(id);
    if (el) el.hidden = hideNguonSummary;
  }
  for (const sel of ["#table-chi-tieu-month-nguon", "#table-chi-tieu-days-nguon"]) {
    const table = $(sel);
    const block = table?.closest(".table-wrap");
    if (block) block.hidden = hideNguonSummary;
  }

  if (labelEl) labelEl.textContent = filter;
  if (scopeEl) scopeEl.textContent = chiTieuScopeLabel(month, day);

  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = chiTieuEntriesForNguonView(chiTieuFilteredEntries(), month, day).sort((a, b) => {
    const dc = String(a.ngay || "").localeCompare(String(b.ngay || ""));
    if (dc !== 0) return dc;
    return String(a.mcc || "").localeCompare(String(b.mcc || ""), "vi");
  });

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="muted">Không có dữ liệu cho nguồn này.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(formatDayForDisplay(r.ngay))}</td>
      <td class="cell-readonly">${escapeHtml(r.mcc ?? "—")}</td>
      <td class="cell-readonly cell-num">${fmtChiTieuUsd(chiTieuAmount(r.tongTieu))}</td>
      <td class="cell-readonly cell-num">${fmtChiTieuUsd(chiTieuAmount(r.tongThu))}</td>`;
    tbody.appendChild(tr);
  }
}

function sumChiTieuEntries(rows) {
  let tongTieu = 0;
  let tongThu = 0;
  for (const r of rows) {
    tongTieu += chiTieuAmount(r.tongTieu);
    tongThu += chiTieuAmount(r.tongThu);
  }
  return { tongTieu, tongThu };
}

function groupChiTieuByMcc(rows) {
  return rows
    .map((r) => ({
      mcc: String(r.mcc || "—").trim() || "—",
      nguon: r.nguon || "—",
      tongTieu: chiTieuAmount(r.tongTieu),
      tongThu: chiTieuAmount(r.tongThu),
    }))
    .sort((a, b) => {
      const mc = a.mcc.localeCompare(b.mcc, "vi");
      return mc !== 0 ? mc : a.nguon.localeCompare(b.nguon, "vi");
    });
}

function chiTieuMonthsForDisplay(entries) {
  const fromApi = state.reportChiTieu?.byMonth ?? [];
  if (fromApi.length) {
    return fromApi.map((m) => ({
      thang: m.thang,
      tongTieu: chiTieuAmount(m.tongTieu),
      tongThu: chiTieuAmount(m.tongThu),
    }));
  }
  return chiTieuByMonthFromEntries(entries);
}

function chiTieuDaysForDisplay(entries, month) {
  const fromApi = (state.reportChiTieu?.byDay ?? []).filter((d) =>
    chiTieuSameCalendarMonth(d.date, month),
  );
  if (fromApi.length) {
    return fromApi.map((d) => ({
      date: d.date,
      tongTieu: chiTieuAmount(d.tongTieu),
      tongThu: chiTieuAmount(d.tongThu),
    }));
  }
  return chiTieuByDayFromEntries(entries, month);
}
function chiTieuByMonthFromEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    const thang = String(e.ngay || "").slice(0, 7);
    if (!thang || thang.length < 7) continue;
    const cur = map.get(thang) ?? { thang, tongTieu: 0, tongThu: 0 };
    cur.tongTieu += chiTieuAmount(e.tongTieu);
    cur.tongThu += chiTieuAmount(e.tongThu);
    map.set(thang, cur);
  }
  return [...map.values()].sort((a, b) => a.thang.localeCompare(b.thang));
}

function chiTieuByDayFromEntries(entries, month) {
  const map = new Map();
  for (const e of entries) {
    const day = e.ngay;
    if (!day || !chiTieuSameCalendarMonth(day, month)) continue;
    const cur = map.get(day) ?? { date: day, tongTieu: 0, tongThu: 0 };
    cur.tongTieu += chiTieuAmount(e.tongTieu);
    cur.tongThu += chiTieuAmount(e.tongThu);
    map.set(day, cur);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function chiTieuByNguonForMonth(entries, month) {
  const map = new Map();
  for (const e of entries) {
    if (!chiTieuSameCalendarMonth(e.ngay, month)) continue;
    const key = e.nguon || "—";
    const cur = map.get(key) ?? { nguon: key, tongTieu: 0, tongThu: 0 };
    cur.tongTieu += chiTieuAmount(e.tongTieu);
    cur.tongThu += chiTieuAmount(e.tongThu);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => a.nguon.localeCompare(b.nguon, "vi"));
}

function renderChiTieuNguonMonthTable(tbodyEl, labelEl, monthIso, entries) {
  if (state.chiTieuNguonFilter) {
    if (tbodyEl) tbodyEl.innerHTML = "";
    return;
  }
  if (labelEl) {
    labelEl.textContent = monthIso ? `${formatMonthForDisplay(monthIso)} (GMT+7)` : "—";
  }
  if (!tbodyEl) return;
  tbodyEl.innerHTML = "";
  if (!monthIso) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">Chọn tháng để xem theo nguồn.</td>`;
    tbodyEl.appendChild(tr);
    return;
  }
  const fromApi = (state.reportChiTieu?.byMonth ?? []).find((m) => m.thang === monthIso);
  const nguonRows = fromApi?.byNguon?.length
    ? fromApi.byNguon
    : chiTieuByNguonForMonth(entries, monthIso);
  if (!nguonRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">Chưa có dữ liệu trong ${escapeHtml(formatMonthForDisplay(monthIso))}.</td>`;
    tbodyEl.appendChild(tr);
    return;
  }
  for (const n of nguonRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(n.nguon)}</td>
      <td class="cell-num">${fmtChiTieuUsd(chiTieuAmount(n.tongTieu))}</td>
      <td class="cell-num">${fmtChiTieuUsd(chiTieuAmount(n.tongThu))}</td>`;
    tbodyEl.appendChild(tr);
  }
}

function renderChiTieuMccTable(tbodyEl, groups) {
  if (!tbodyEl) return;
  tbodyEl.innerHTML = "";
  if (!groups.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="muted">Không có dữ liệu.</td>`;
    tbodyEl.appendChild(tr);
    return;
  }
  for (const g of groups) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(g.mcc)}</td>
      <td class="cell-readonly cell-num">${fmtChiTieuUsd(g.tongTieu)}</td>
      <td class="cell-readonly cell-num">${fmtChiTieuUsd(g.tongThu)}</td>
      <td class="cell-readonly">${escapeHtml(g.nguon || "—")}</td>`;
    tbodyEl.appendChild(tr);
  }
}

function populateChiTieuNguonFilter() {
  const sel = $("#chi-tieu-nguon-filter");
  if (!sel) return;
  const prev = state.chiTieuNguonFilter || "";
  const list = state.reportChiTieu?.nguonList ?? [];
  sel.innerHTML = `<option value="">Tất cả nguồn</option>`;
  for (const n of list) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  }
  sel.value = prev;
}

function setChiTieuNav(month, day) {
  state.chiTieuNav = { month: month || "", day: day || "" };
  renderChiTieuDrill();
}

function renderChiTieuToday() {
  const today = todayIsoVietnam();
  const rtc = state.reportChiTieu?.todayVietnam;
  const iso = rtc?.date ?? today;
  const entries = chiTieuFilteredEntries().filter((r) => r.ngay === iso);
  const totals = sumChiTieuEntries(entries);
  const groups = groupChiTieuByMcc(entries);

  const lbl = $("#chi-tieu-today-label");
  const elTieu = $("#chi-tieu-today-tieu");
  const elThu = $("#chi-tieu-today-thu");
  if (lbl) lbl.textContent = formatDayForDisplay(iso);
  if (elTieu) elTieu.textContent = `Tổng tiêu: ${fmtChiTieuUsd(totals.tongTieu)}`;
  if (elThu) elThu.textContent = `Tổng thu: ${fmtChiTieuUsd(totals.tongThu)}`;
  renderChiTieuMccTable($("#table-chi-tieu-today-mcc tbody"), groups);
  renderChiTieuByNguonFilter();
}

function renderChiTieuDrill() {
  const { month, day } = state.chiTieuNav;
  const entries = chiTieuFilteredEntries();
  const wrapMonths = $("#wrap-chi-tieu-months");
  const wrapDays = $("#wrap-chi-tieu-days");
  const wrapDetail = $("#wrap-chi-tieu-detail");
  if (!wrapMonths || !wrapDays || !wrapDetail) return;

  wrapMonths.hidden = Boolean(month);
  wrapDays.hidden = !month || Boolean(day);
  wrapDetail.hidden = !day;

  const tbMonth = $("#table-chi-tieu-month tbody");
  if (!month && tbMonth) {
    tbMonth.innerHTML = "";
    const months = chiTieuMonthsForDisplay(entries).sort((a, b) =>
      String(b.thang).localeCompare(String(a.thang)),
    );
    for (const r of months) {
      const tr = document.createElement("tr");
      tr.className = "report-tc-click-row";
      tr.dataset.month = String(r.thang);
      tr.innerHTML = `
        <td>${escapeHtml(formatMonthForDisplay(r.thang))}</td>
        <td class="cell-num">${fmtChiTieuUsd(r.tongTieu)}</td>
        <td class="cell-num">${fmtChiTieuUsd(r.tongThu)}</td>`;
      tbMonth.appendChild(tr);
    }

    const tbNguon = $("#table-chi-tieu-month-nguon tbody");
    const nguonMonthLabel = $("#chi-tieu-month-nguon-label");
    renderChiTieuNguonMonthTable(
      tbNguon,
      nguonMonthLabel,
      currentMonthIsoVietnam(),
      entries,
    );
  }

  const monthLabel = $("#chi-tieu-month-label");
  if (monthLabel) monthLabel.textContent = month ? formatMonthForDisplay(month) : "—";

  const tbDays = $("#table-chi-tieu-days tbody");
  if (month && !day && tbDays) {
    tbDays.innerHTML = "";
    for (const r of chiTieuDaysForDisplay(entries, month)) {
      const tr = document.createElement("tr");
      tr.className = "report-tc-click-row";
      tr.dataset.day = String(r.date);
      tr.innerHTML = `
        <td>${escapeHtml(formatDayForDisplay(r.date))}</td>
        <td class="cell-num">${fmtChiTieuUsd(r.tongTieu)}</td>
        <td class="cell-num">${fmtChiTieuUsd(r.tongThu)}</td>`;
      tbDays.appendChild(tr);
    }
    renderChiTieuNguonMonthTable(
      $("#table-chi-tieu-days-nguon tbody"),
      $("#chi-tieu-days-nguon-label"),
      month,
      entries,
    );
  }

  const dayLabel = $("#chi-tieu-day-label");
  if (dayLabel) dayLabel.textContent = day ? formatDayForDisplay(day) : "—";

  if (day) {
    const dayRows = entries.filter((r) => r.ngay === day);
    const totals = sumChiTieuEntries(dayRows);
    const elTieu = $("#chi-tieu-day-tieu");
    const elThu = $("#chi-tieu-day-thu");
    if (elTieu) elTieu.textContent = `Tổng tiêu: ${fmtChiTieuUsd(totals.tongTieu)}`;
    if (elThu) elThu.textContent = `Tổng thu: ${fmtChiTieuUsd(totals.tongThu)}`;
    renderChiTieuMccTable($("#table-chi-tieu-detail-mcc tbody"), groupChiTieuByMcc(dayRows));
  }

  renderChiTieuByNguonFilter();
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

function renderHhLoaiTruTable() {
  const tb = tbody("table-hh-loai-tru");
  if (!tb) return;
  tb.innerHTML = "";
  const list = state.hhLoaiTru ?? [];
  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="muted">Chưa có khoản loại trừ — thêm dòng và bấm Lưu.</td>`;
    tb.appendChild(tr);
    return;
  }
  list.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(formatDayForDisplay(row.ngay ?? ""))}</td>
      <td class="cell-readonly">${escapeHtml(row.tenDaiLy ?? "")}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(row.khoanThu)}</td>
      <td class="cell-readonly"><button type="button" class="btn ghost btn-sm" data-hh-del="${idx}">Xóa</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-hh-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-hh-del"));
      if (!Number.isFinite(i)) return;
      state.hhLoaiTru = (state.hhLoaiTru ?? []).filter((_, j) => j !== i);
      state.hhLoaiTruDirty = true;
      renderHhLoaiTruTable();
    });
  });
}

function setHhLoaiTruStatus(msg, kind) {
  const el = $("#hh-loai-tru-status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function resetHhLoaiTruFormDefaults() {
  const ngay = $("#hh-loai-tru-ngay");
  if (ngay) ngay.value = todayIsoVietnam();
  const ten = $("#hh-loai-tru-ten");
  if (ten) ten.value = "";
  const thu = $("#hh-loai-tru-thu");
  if (thu) thu.value = "";
}

async function loadHhLoaiTruFromApi() {
  const res = await api("/api/luong-nv-exclusions");
  state.hhLoaiTru = res.exclusions ?? [];
  state.hhLoaiTruDirty = false;
  renderHhLoaiTruTable();
}

function bindHhLoaiTruForm() {
  const form = $("#form-hh-loai-tru");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const ngay = ($("#hh-loai-tru-ngay")?.value ?? "").trim();
    const tenDaiLy = ($("#hh-loai-tru-ten")?.value ?? "").trim();
    const khoanThu = parseNumClient($("#hh-loai-tru-thu")?.value ?? "");
    if (!ngay || !tenDaiLy || khoanThu <= 0) {
      setHhLoaiTruStatus("Nhập đủ Ngày, Tên đại lý và Khoản thu > 0.", "err");
      return;
    }
    state.hhLoaiTru = [...(state.hhLoaiTru ?? []), { ngay, tenDaiLy, khoanThu }];
    state.hhLoaiTruDirty = true;
    renderHhLoaiTruTable();
    resetHhLoaiTruFormDefaults();
    setHhLoaiTruStatus("Đã thêm dòng — bấm «Lưu danh sách» để ghi Sheet.", "ok");
  });

  $("#btn-hh-loai-tru-save")?.addEventListener("click", async () => {
    setHhLoaiTruStatus("Đang lưu…");
    try {
      await api("/api/luong-nv-exclusions", {
        method: "PUT",
        body: JSON.stringify({ exclusions: state.hhLoaiTru ?? [] }),
      });
      await loadHhLoaiTruFromApi();
      setHhLoaiTruStatus("Đã lưu — đang làm mới bảng lương…", "ok");
      await fetchSheetAndApply({ force: true, preserveHhLoaiTru: true });
      setHhLoaiTruStatus("Đã lưu và cập nhật bảng lương.", "ok");
    } catch (e) {
      setHhLoaiTruStatus(e.message || "Lỗi lưu.", "err");
    }
  });
}

function renderLuongNvTyGiaInfo() {
  const el = $("#luong-nv-ty-gia-info");
  if (!el) return;
  const cfg = state.reportLuongNv?.config;
  if (!cfg?.tyGiaVndPerUsd) {
    el.textContent = "";
    return;
  }
  const vnd = new Intl.NumberFormat("vi-VN").format(Math.round(cfg.luongCoBanVndThang ?? 0));
  const ty = new Intl.NumberFormat("vi-VN").format(Math.round(cfg.tyGiaVndPerUsd));
  const usd = fmtChiTieuUsd(cfg.luongCoBanUsdThang ?? 0);
  const src = cfg.tyGiaSourceTab ? ` (F2 tab ${cfg.tyGiaSourceTab})` : "";
  el.textContent = `Tỉ giá F2${src}: ${ty} ₫/USD → Lương CB tháng ≈ ${vnd} ₫ = ${usd}`;
}

function setChamCongNvStatus(msg, kind) {
  const el = $("#cham-cong-nv-status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

async function loadChamCongNvTabs() {
  try {
    const res = await api("/api/cham-cong-employees");
    state.chamCongNvTabs = res.employees ?? [];
    state.chamCongNvTemplate = res.templateTab ?? "SUBEO";
    renderChamCongNvTable();
  } catch (e) {
    setChamCongNvStatus(e.message || "Không tải được danh sách tab.", "err");
  }
}

function renderChamCongNvTable() {
  const tb = tbody("table-cham-cong-nv");
  if (!tb) return;
  tb.innerHTML = "";
  const list = state.chamCongNvTabs ?? [];
  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="2" class="muted">Chưa có tab nhân viên trên file chấm công.</td>`;
    tb.appendChild(tr);
    return;
  }
  const tpl = (state.chamCongNvTemplate || "SUBEO").toLowerCase();
  list.forEach((tabName) => {
    const isTemplate = tabName.toLowerCase() === tpl;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(tabName)}${isTemplate ? ' <span class="muted small">(NV + mẫu)</span>' : ""}</td>
      <td class="cell-readonly">${
        isTemplate
          ? '<span class="muted small">Không xóa</span>'
          : `<button type="button" class="btn ghost btn-sm" data-cc-del="${escapeAttr(tabName)}">Xóa</button>`
      }</td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-cc-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = btn.getAttribute("data-cc-del");
      if (!tab || !confirm(`Xóa tab « ${tab} » trên Sheet chấm công?`)) return;
      setChamCongNvStatus("Đang xóa…");
      try {
        await api(`/api/cham-cong-employees?tab=${encodeURIComponent(tab)}`, { method: "DELETE" });
        setChamCongNvStatus(`Đã xóa tab ${tab}.`, "ok");
        await loadChamCongNvTabs();
        await fetchSheetAndApply({ force: true });
      } catch (e) {
        setChamCongNvStatus(e.message || "Lỗi xóa tab.", "err");
      }
    });
  });
}

function bindChamCongNvPanel() {
  if ($("#section-cham-cong-nv")?.dataset.bound === "1") return;
  const section = $("#section-cham-cong-nv");
  if (!section) return;
  section.dataset.bound = "1";

  $("#btn-cham-cong-nv-refresh")?.addEventListener("click", () => loadChamCongNvTabs());
  $("#btn-cham-cong-nv-create")?.addEventListener("click", async () => {
    const tabName = ($("#cham-cong-nv-tab-name")?.value ?? "").trim();
    if (!tabName) {
      setChamCongNvStatus("Nhập tên tab.", "err");
      return;
    }
    setChamCongNvStatus("Đang tạo tab (copy SUBEO)…");
    try {
      const res = await api("/api/cham-cong-employees", {
        method: "POST",
        body: JSON.stringify({ tabName }),
      });
      setChamCongNvStatus(res.message || "Đã tạo tab.", "ok");
      $("#cham-cong-nv-tab-name").value = "";
      await loadChamCongNvTabs();
      await fetchSheetAndApply({ force: true });
    } catch (e) {
      setChamCongNvStatus(e.message || "Lỗi tạo tab.", "err");
    }
  });
}

function renderLuongNv() {
  const wrap = $("#wrap-luong-nv-periods");
  if (!wrap) return;
  renderHhLoaiTruTable();
  renderChamCongNvTable();
  renderLuongNvTyGiaInfo();
  const report = state.reportLuongNv ?? { periods: [] };
  const periods = report.periods ?? [];
  if (!periods.length) {
    wrap.innerHTML = `<p class="muted">Chưa có dữ liệu lương — kiểm tra file chấm công và quyền service account.</p>`;
    return;
  }

  const cfg = report.config ?? {};
  wrap.innerHTML = periods
    .map((period, idx) => {
      const cb = period.commissionBase ?? {};
      const exclCongNo = cb.thuExcludedCongNo ?? 0;
      const exclCustom = cb.thuExcludedHhLoaiTru ?? 0;
      const exclTotal = cb.thuExcluded ?? exclCongNo + exclCustom;
      const exclParts = [];
      if (exclCongNo > 0) exclParts.push(`công nợ ROKER/GM: ${cellMoneyDisplay(exclCongNo)}`);
      if (exclCustom > 0) exclParts.push(`loại trừ web: ${cellMoneyDisplay(exclCustom)}`);
      const rows = (period.employees ?? [])
        .map(
          (emp) => {
            const base =
              emp.baseSalaryUsd ??
              (emp.baseSalaryVnd && cfg?.tyGiaVndPerUsd
                ? emp.baseSalaryVnd / cfg.tyGiaVndPerUsd
                : 0);
            const phat = emp.tienPhatUsd ?? 0;
            const thuong = emp.tienThuongUsd ?? 0;
            const ung = emp.tienUngUsd ?? 0;
            const total =
              emp.totalSalaryUsd ??
              base + (emp.commissionUsd ?? 0) - phat + thuong - ung;
            return `
        <tr>
          <td class="cell-readonly">${escapeHtml(emp.name ?? "")}</td>
          <td class="cell-readonly cell-num">${escapeHtml(String(emp.workingDays ?? 0))} / ${escapeHtml(String(period.daysInMonth ?? "—"))}</td>
          <td class="cell-readonly cell-num">${fmtChiTieuUsd(base)}</td>
          <td class="cell-readonly cell-num">${fmtChiTieuUsd(emp.commissionUsd)}</td>
          <td class="cell-readonly cell-num">${phat > 0 ? fmtChiTieuUsd(phat) : "—"}</td>
          <td class="cell-readonly cell-num">${thuong > 0 ? fmtChiTieuUsd(thuong) : "—"}</td>
          <td class="cell-readonly cell-num">${ung > 0 ? fmtChiTieuUsd(ung) : "—"}</td>
          <td class="cell-readonly cell-num luong-nv-total"><strong>${fmtChiTieuUsd(total)}</strong></td>
        </tr>`;
          },
        )
        .join("");

      const emptyRow =
        rows ||
        `<tr><td colspan="8" class="muted">Chưa có tab nhân viên trong file chấm công.</td></tr>`;

      return `
      <section class="luong-nv-period" data-period="${idx}">
        <h3 class="subsection-title">${escapeHtml(period.label ?? "")}</h3>
        <p class="muted small panel-guide">${escapeHtml(period.payNote ?? "")}</p>
        <div class="luong-nv-commission-summary muted small">
          <strong>Cơ sở hoa hồng 1%:</strong>
          Thu ${cellMoneyDisplay(cb.tongThu)} − Chi ${cellMoneyDisplay(cb.tongChi)}
          ${exclTotal > 0 ? ` (loại thu: ${exclParts.join("; ")})` : ""}
          = Lợi nhuận ${cellMoneyDisplay(cb.profit)} → HH ${fmtChiTieuUsd(cb.commissionUsd)} / NV
        </div>
        <div class="table-wrap">
          <table class="data-table data-table-aligned" id="table-luong-nv-${idx}">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th class="th-num">Ngày công</th>
                <th class="th-num">Lương CB (USD)</th>
                <th class="th-num">HH 1% (USD)</th>
                <th class="th-num">Tiền phạt (USD)</th>
                <th class="th-num">Thưởng (USD)</th>
                <th class="th-num">Tiền ứng C2 (USD)</th>
                <th class="th-num">Tổng</th>
              </tr>
            </thead>
            <tbody>${emptyRow}</tbody>
          </table>
        </div>
      </section>`;
    })
    .join("");
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
    if (sep === "." && parts.length > 2 && parts.slice(1).every((p) => p.length === 3)) {
      t = parts.join("");
    } else if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      t = `${parts[0]}.${parts[1]}`;
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
  populateReportThuChiNguonFilter();
  renderReportThuChiDrill();
  renderReportThuChiToday();
  renderReportBanDaoDrill();
  renderReportBanDaoToday();
  renderBanDaoPanelDrill();
  populateChiTieuNguonFilter();
  renderChiTieuToday();
  renderChiTieuDrill();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function applyPayload(data, options = {}) {
  const { preserveHhLoaiTru = false } = options;
  syncSensitiveRevealClass();
  state.tongQuan = data.tongQuan ?? state.tongQuan;
  state.docTongQuan = data.docTongQuan ?? null;
  state.thuChi = (data.thuChi ?? []).map(rowThuChi);
  state.coc = (data.coc ?? []).map(rowCoc);
  state.congNo = (data.congNo ?? []).map(rowCongNo);
  state.banDao = (data.banDao ?? []).map(rowBanDao);
  state.baoCaoTk = (data.baoCaoTk ?? []).map(rowBaoCaoTk);
  state.computed = data.computed ?? null;
  state.report = {
    byDay: data.report?.byDay ?? [],
    byMonth: data.report?.byMonth ?? [],
    todayVietnam: data.report?.todayVietnam ?? null,
  };
  state.reportBanDao = data.reportBanDao ?? { byDay: [], byMonth: [], todayVietnam: null };
  state.reportChiTieu = data.reportChiTieu ?? {
    byDay: [],
    byMonth: [],
    todayVietnam: null,
    nguonList: [],
  };
  state.reportLuongNv = data.reportLuongNv ?? {
    todayVietnam: "",
    currentMonth: "",
    previousMonth: "",
    periods: [],
  };
  if (!preserveHhLoaiTru && !state.hhLoaiTruDirty) {
    state.hhLoaiTru = data.hhLoaiTru ?? [];
  }

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
  renderLuongNv();
  refreshComputedFromClient();
  void loadChamCongNvTabs();
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
  const { force = false, silent = false, preserveHhLoaiTru = false } = options;
  const data = await api("/api/sheet", { method: "GET" });
  const sig = JSON.stringify(data);
  const prev = sessionStorage.getItem(LAST_SIG_KEY) || "";
  if (!force && sig === prev) {
    if (!silent) setSyncStatus("Đã là mới nhất (không đổi).", "ok");
    return false;
  }
  applyPayload(data, { preserveHhLoaiTru });
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

  $("#btn-report-thu-chi-mode-monthly")?.addEventListener("click", () => setReportThuChiMode("monthly"));
  $("#btn-report-thu-chi-mode-nguon")?.addEventListener("click", () => setReportThuChiMode("nguon"));
  $("#report-thu-chi-nguon-filter")?.addEventListener("change", (ev) => {
    state.reportThuChiNguonFilter = ev.target.value || "";
    setReportThuChiNav("", "");
  });

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

  $("#chi-tieu-nguon-filter")?.addEventListener("change", (ev) => {
    state.chiTieuNguonFilter = ev.target.value || "";
    setChiTieuNav(state.chiTieuNav.month, state.chiTieuNav.day);
    renderChiTieuToday();
  });

  $("#table-chi-tieu-month")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-tc-click-row");
    if (!tr?.dataset.month) return;
    setChiTieuNav(tr.dataset.month, "");
  });
  $("#table-chi-tieu-days")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-tc-click-row");
    if (!tr?.dataset.day) return;
    setChiTieuNav(state.chiTieuNav.month, tr.dataset.day);
  });
  $("#btn-chi-tieu-back-month")?.addEventListener("click", () => setChiTieuNav("", ""));
  $("#btn-chi-tieu-back-days")?.addEventListener("click", () =>
    setChiTieuNav(state.chiTieuNav.month, ""),
  );
}

function bindOverviewInput() {
  $("#tq-a2")?.addEventListener("input", refreshComputedFromClient);
  $("#tq-a2")?.addEventListener("change", refreshComputedFromClient);
}

async function main() {
  bindTabs();
  bindAppMenu();
  bindHhLoaiTruForm();
  bindChamCongNvPanel();
  resetHhLoaiTruFormDefaults();
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
