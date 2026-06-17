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
  balance: { value: 0, kvBound: false },
  thuChi: [],
  coc: [],
  congNo: [],
  baoCaoTk: [],
  computed: null,
  report: { byDay: [], byMonth: [], todayVietnam: null },
  reportChiTieu: { byDay: [], byMonth: [], todayVietnam: null, nguonList: [] },
  reportLuongNv: { todayVietnam: "", currentMonth: "", previousMonth: "", periods: [] },
  hhLoaiTru: [],
  hhLoaiTruDirty: false,
  chamCongNvTabs: [],
  chamCongNvTemplate: "SUBEO",
  chamCongNvCommissionStart: {},
  selectedChamCongNvTab: "",
  reportThuChiNav: { month: "", day: "" },
  reportThuChiMode: "monthly",
  reportThuChiNguonFilter: "",
  chiTieuNav: { month: "", day: "" },
  chiTieuNguonFilter: "",
  chiTieuDaiLyFilter: "",
  baoCaoThuChiCompareNav: { month: "", day: "" },
  baoCaoThuChiCompareFilter: { month: "", daiLy: "" },
  /** "" | "desc" | "asc" — sắp xếp cột Chênh trong bảng so khớp đại lý. */
  compareBcTcChenhSort: "",
};

function rowThuChi(r) {
  return {
    ngay: r.ngay ?? "",
    thu: r.thu ?? "",
    chi: r.chi ?? "",
    ten: r.ten ?? "",
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
let balanceSaveTimer = null;
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
  const gridBal = $("#grid-balance-edit");
  if (gridBal) {
    gridBal.hidden = !v;
    gridBal.classList.remove("grid-balance-reveal--animate");
    if (v) {
      void gridBal.offsetWidth;
      gridBal.classList.add("grid-balance-reveal--animate");
    }
  }
  $("#btn-reveal-balance").hidden = v;
  $("#btn-hide-balance").hidden = !v;
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

/** Hiển thị: chữ cái đầu mỗi từ viết hoa (dữ liệu sheet không đổi). */
function formatDisplayLabel(s) {
  const t = String(s ?? "").trim();
  if (!t || t === "—") return t || "—";
  return t
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLocaleLowerCase("vi");
      if (!lower) return word;
      return lower.charAt(0).toLocaleUpperCase("vi") + lower.slice(1);
    })
    .join(" ");
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

/** Khóa tên khách (cột D) — không phân biệt hoa/thường. */
function thuChiNguonNormKey(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return "—";
  return t.toLocaleLowerCase("vi");
}

function thuChiRowNguonNormKey(r) {
  return thuChiNguonNormKey(r.ten);
}

function thuChiNguonDisplayLabel(normKey) {
  if (!normKey) return "";
  for (const r of state.thuChi) {
    if (!thuChiRowHasData(r)) continue;
    if (thuChiRowNguonNormKey(r) !== normKey) continue;
    const raw = String(r.ten ?? "").trim();
    return formatDisplayLabel(raw || "—");
  }
  return normKey;
}

function thuChiNguonList() {
  const byNorm = new Map();
  for (const r of state.thuChi) {
    if (!thuChiRowHasData(r)) continue;
    const raw = String(r.ten ?? "").trim();
    if (!raw) continue;
    const norm = thuChiNguonNormKey(raw);
    const prev = byNorm.get(norm);
    byNorm.set(norm, !prev || raw.length >= prev.length ? raw : prev);
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
  sel.innerHTML = `<option value="">— Chọn tên khách —</option>`;
  for (const { norm, label } of list) {
    const opt = document.createElement("option");
    opt.value = norm;
    opt.textContent = formatDisplayLabel(label);
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

function thuChiReportTen(r) {
  return formatDisplayLabel(String(r.ten ?? "").trim());
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
      <td class="cell-readonly">${escapeHtml(thuChiReportTen(r))}</td>`;
    tbodyEl.appendChild(tr);
  }
}

function setReportThuChiNav(month, day) {
  state.reportThuChiNav = { month: month || "", day: day || "" };
  renderReportThuChiDrill();
}

function compareBcTcNormTen(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function uniqueCompareDaiLyNames(names) {
  const map = new Map();
  for (const raw of names) {
    const display = String(raw ?? "").trim();
    if (!display || display === "—") continue;
    const norm = compareBcTcNormTen(display);
    if (!norm) continue;
    const prev = map.get(norm);
    map.set(norm, !prev || display.length >= prev.length ? display : prev);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, "vi"));
}

function filterCompareReport(raw, daiLyFilter) {
  const src = raw ?? { byMonth: [], byDay: [], daiLyList: [], monthList: [] };
  let byMonth = src.byMonth ?? [];
  let byDay = src.byDay ?? [];
  if (!daiLyFilter) {
    return {
      byMonth,
      byDay,
      daiLyList: src.daiLyList ?? [],
      monthList: src.monthList ?? [],
    };
  }
  const norm = compareBcTcNormTen(daiLyFilter);
  byMonth = byMonth
    .map((m) => ({
      ...m,
      rows: (m.rows ?? []).filter((r) => compareBcTcNormTen(r.ten) === norm),
    }))
    .filter((m) => m.rows.length > 0);
  byDay = byDay
    .map((d) => ({
      ...d,
      rows: (d.rows ?? []).filter((r) => compareBcTcNormTen(r.ten) === norm),
    }))
    .filter((d) => d.rows.length > 0);
  return {
    byMonth,
    byDay,
    daiLyList: src.daiLyList ?? [],
    monthList: byMonth.map((m) => m.thang),
  };
}

function populateCompareBcTcFilters() {
  const raw = state.reportBaoCaoThuChiCompare ?? {
    daiLyList: [],
    monthList: [],
    byMonth: [],
    byDay: [],
  };
  const filtered = filterCompareReport(raw, state.baoCaoThuChiCompareFilter.daiLy || "");
  const monthSel = $("#compare-bc-tc-filter-month");
  const daiLySel = $("#compare-bc-tc-filter-dai-ly");
  const prevMonth = state.baoCaoThuChiCompareFilter.month || "";
  const prevDaiLy = state.baoCaoThuChiCompareFilter.daiLy || "";

  if (monthSel) {
    const months = filtered.monthList?.length
      ? filtered.monthList
      : [...new Set((filtered.byMonth ?? []).map((m) => m.thang))].sort((a, b) => b.localeCompare(a));
    monthSel.innerHTML = `<option value="">Tất cả tháng</option>`;
    for (const thang of months) {
      const opt = document.createElement("option");
      opt.value = thang;
      opt.textContent = formatMonthForDisplay(thang);
      monthSel.appendChild(opt);
    }
    monthSel.value = prevMonth;
  }

  if (daiLySel) {
    const list = uniqueCompareDaiLyNames(
      raw.daiLyList?.length
        ? raw.daiLyList
        : (raw.byMonth ?? []).flatMap((m) => (m.rows ?? []).map((r) => r.ten)),
    );
    daiLySel.innerHTML = `<option value="">Tất cả đại lý</option>`;
    for (const d of list) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = formatDisplayLabel(d);
      daiLySel.appendChild(opt);
    }
    daiLySel.value = prevDaiLy;
  }
}

function compareBcTcFilterScopeLabel(month, daiLy, day) {
  const parts = [];
  if (daiLy) parts.push(`Đại lý: ${formatDisplayLabel(daiLy)}`);
  if (day) parts.push(`Ngày ${formatDayForDisplay(day)}`);
  else if (month) parts.push(formatMonthForDisplay(month));
  return parts.length ? parts.join(" · ") : "";
}

function setCompareBcTcFilterMonth(value) {
  state.baoCaoThuChiCompareFilter.month = value || "";
  if (value) {
    state.baoCaoThuChiCompareNav.month = value;
    state.baoCaoThuChiCompareNav.day = "";
  } else {
    state.baoCaoThuChiCompareNav.month = "";
    state.baoCaoThuChiCompareNav.day = "";
  }
  renderBaoCaoThuChiCompareDrill();
}

function setCompareBcTcFilterDaiLy(value) {
  state.baoCaoThuChiCompareFilter.daiLy = value || "";
  state.baoCaoThuChiCompareNav.day = "";
  if (value && state.baoCaoThuChiCompareFilter.month) {
    const scoped = filterCompareReport(state.reportBaoCaoThuChiCompare, value);
    const ok = (scoped.monthList ?? []).includes(state.baoCaoThuChiCompareFilter.month);
    if (!ok) {
      state.baoCaoThuChiCompareFilter.month = "";
      state.baoCaoThuChiCompareNav.month = "";
    }
  }
  populateCompareBcTcFilters();
  renderBaoCaoThuChiCompareDrill();
}

function compareBcTcAmount(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return parseNumClient(v);
}

function summarizeCompareRows(rows) {
  let khop = 0;
  let lech = 0;
  let tongBctk = 0;
  let tongThuChi = 0;
  for (const r of rows) {
    if (r.khop) khop += 1;
    else lech += 1;
    tongBctk += compareBcTcAmount(r.baoCaoThu);
    tongThuChi += compareBcTcAmount(r.thuChiThu);
  }
  return { khop, lech, tongBctk, tongThuChi };
}

function sortCompareBcTcRowsByChenh(rows, mode) {
  if (!mode || !rows?.length) return rows ?? [];
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const ca = compareBcTcAmount(a.chenh);
    const cb = compareBcTcAmount(b.chenh);
    return mode === "asc" ? ca - cb : cb - ca;
  });
  return sorted;
}

function updateCompareBcTcChenhSortIndicators() {
  const mode = state.compareBcTcChenhSort;
  for (const id of ["btn-compare-bc-tc-sort-chenh-month", "btn-compare-bc-tc-sort-chenh-day"]) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const ind = btn.querySelector(".sort-indicator");
    if (ind) ind.textContent = mode === "asc" ? "↑" : mode === "desc" ? "↓" : "↕";
    btn.classList.toggle("is-active", Boolean(mode));
    btn.setAttribute("aria-pressed", String(Boolean(mode)));
    btn.title =
      mode === "desc"
        ? "Chênh: lớn → nhỏ (bấm để nhỏ → lớn)"
        : mode === "asc"
          ? "Chênh: nhỏ → lớn (bấm để mặc định)"
          : "Sắp xếp theo chênh lệch";
  }
}

function cycleCompareBcTcChenhSort() {
  const cur = state.compareBcTcChenhSort;
  state.compareBcTcChenhSort = cur === "" ? "desc" : cur === "desc" ? "asc" : "";
  renderBaoCaoThuChiCompareDrill();
}

function renderCompareBcTcTenTable(tbodyEl, rows) {
  if (!tbodyEl) return;
  tbodyEl.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="muted">Không có dữ liệu so khớp.</td>`;
    tbodyEl.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (!r.khop) tr.className = "compare-row-mismatch";
    const status = r.khop
      ? `<span class="compare-status-ok">Khớp</span>`
      : `<span class="compare-status-bad">Lệch</span>`;
    tr.innerHTML = `
      <td>${displayLabel(r.ten)}</td>
      <td class="cell-num">${fmtChiTieuUsd(compareBcTcAmount(r.baoCaoThu))}</td>
      <td class="cell-num">${fmtMoney(compareBcTcAmount(r.thuChiThu))}</td>
      <td class="cell-num">${fmtChiTieuUsd(compareBcTcAmount(r.chenh))}</td>
      <td>${status}</td>`;
    tbodyEl.appendChild(tr);
  }
}

function setBaoCaoThuChiCompareNav(month, day) {
  state.baoCaoThuChiCompareNav = { month: month || "", day: day || "" };
  renderBaoCaoThuChiCompareDrill();
}

function renderBaoCaoThuChiCompareDrill() {
  const filterMonth = state.baoCaoThuChiCompareFilter.month || "";
  const filterDaiLy = state.baoCaoThuChiCompareFilter.daiLy || "";
  const { month: navMonth, day } = state.baoCaoThuChiCompareNav;
  const month = filterMonth || navMonth;
  const report = filterCompareReport(state.reportBaoCaoThuChiCompare, filterDaiLy);
  const wrapMonths = $("#wrap-compare-bc-tc-months");
  const wrapMonthDetail = $("#wrap-compare-bc-tc-month-detail");
  const wrapDayDetail = $("#wrap-compare-bc-tc-day-detail");
  const scopeEl = $("#compare-bc-tc-filter-scope");
  if (!wrapMonths || !wrapMonthDetail || !wrapDayDetail) return;

  const scopeText = compareBcTcFilterScopeLabel(month, filterDaiLy, day);
  if (scopeEl) {
    scopeEl.textContent = scopeText;
    scopeEl.hidden = !scopeText;
  }

  wrapMonths.hidden = Boolean(month);
  wrapMonthDetail.hidden = !month || Boolean(day);
  wrapDayDetail.hidden = !day;

  const tbMonth = $("#table-compare-bc-tc-month tbody");
  if (!month && tbMonth) {
    tbMonth.innerHTML = "";
    const months = [...(report.byMonth ?? [])].sort((a, b) =>
      String(b.thang).localeCompare(String(a.thang)),
    );
    if (!months.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="5" class="muted">Chưa có dữ liệu để so sánh.</td>`;
      tbMonth.appendChild(tr);
    } else {
      for (const m of months) {
        const sum = summarizeCompareRows(m.rows ?? []);
        const tr = document.createElement("tr");
        tr.className = "report-tc-click-row";
        tr.dataset.month = String(m.thang);
        tr.innerHTML = `
          <td>${escapeHtml(formatMonthForDisplay(m.thang))}</td>
          <td class="cell-num">${sum.khop}</td>
          <td class="cell-num">${sum.lech}</td>
          <td class="cell-num">${fmtChiTieuUsd(sum.tongBctk)}</td>
          <td class="cell-num">${fmtMoney(sum.tongThuChi)}</td>`;
        tbMonth.appendChild(tr);
      }
    }
  }

  const monthLabel = $("#compare-bc-tc-month-label");
  if (monthLabel) monthLabel.textContent = month ? formatMonthForDisplay(month) : "—";

  if (month && !day) {
    const monthBlock = (report.byMonth ?? []).find((m) => m.thang === month);
    renderCompareBcTcTenTable(
      $("#table-compare-bc-tc-month-ten tbody"),
      sortCompareBcTcRowsByChenh(monthBlock?.rows ?? [], state.compareBcTcChenhSort),
    );

    const tbDays = $("#table-compare-bc-tc-days tbody");
    if (tbDays) {
      tbDays.innerHTML = "";
      const days = (report.byDay ?? [])
        .filter((d) => String(d.date).startsWith(`${month}-`))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (!days.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="5" class="muted">Không có ngày trong tháng này.</td>`;
        tbDays.appendChild(tr);
      } else {
        for (const d of days) {
          const sum = summarizeCompareRows(d.rows ?? []);
          const tr = document.createElement("tr");
          tr.className = "report-tc-click-row";
          tr.dataset.day = String(d.date);
          tr.innerHTML = `
            <td>${escapeHtml(formatDayForDisplay(d.date))}</td>
            <td class="cell-num">${sum.khop}</td>
            <td class="cell-num">${sum.lech}</td>
            <td class="cell-num">${fmtChiTieuUsd(sum.tongBctk)}</td>
            <td class="cell-num">${fmtMoney(sum.tongThuChi)}</td>`;
          tbDays.appendChild(tr);
        }
      }
    }
  }

  const dayLabel = $("#compare-bc-tc-day-label");
  if (dayLabel) dayLabel.textContent = day ? formatDayForDisplay(day) : "—";

  if (day) {
    const dayBlock = (report.byDay ?? []).find((d) => d.date === day);
    renderCompareBcTcTenTable(
      $("#table-compare-bc-tc-day-ten tbody"),
      sortCompareBcTcRowsByChenh(dayBlock?.rows ?? [], state.compareBcTcChenhSort),
    );
  }

  updateCompareBcTcChenhSortIndicators();
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
      tr.innerHTML = `<td colspan="3" class="muted">Chọn tên khách (cột D) để xem báo cáo.</td>`;
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
  let rows = state.baoCaoTk;
  const nguon = state.chiTieuNguonFilter || "";
  const daiLy = state.chiTieuDaiLyFilter || "";
  if (nguon) rows = rows.filter((r) => (r.nguon || "—") === nguon);
  if (daiLy) rows = rows.filter((r) => compareBcTcNormTen(r.tenKhach || "—") === compareBcTcNormTen(daiLy));
  return rows;
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

  if (labelEl) labelEl.textContent = formatDisplayLabel(filter);
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
      <td class="cell-readonly">${displayLabel(r.mcc ?? "—")}</td>
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

function chiTieuByDaiLyForMonth(entries, month) {
  const map = new Map();
  for (const e of entries) {
    if (!chiTieuSameCalendarMonth(e.ngay, month)) continue;
    const key = e.tenKhach || "—";
    if (key === "—") continue;
    const cur = map.get(key) ?? { daiLy: key, tongTieu: 0, tongThu: 0 };
    cur.tongTieu += chiTieuAmount(e.tongTieu);
    cur.tongThu += chiTieuAmount(e.tongThu);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => a.daiLy.localeCompare(b.daiLy, "vi"));
}

function renderChiTieuDaiLyMonthTable(tbodyEl, labelEl, monthIso, entries) {
  if (state.chiTieuDaiLyFilter) {
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
    tr.innerHTML = `<td colspan="3" class="muted">Chọn tháng để xem theo đại lý.</td>`;
    tbodyEl.appendChild(tr);
    return;
  }
  const daiLyRows = chiTieuByDaiLyForMonth(entries, monthIso);
  if (!daiLyRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">Chưa có dữ liệu trong ${escapeHtml(formatMonthForDisplay(monthIso))}.</td>`;
    tbodyEl.appendChild(tr);
    return;
  }
  for (const d of daiLyRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${displayLabel(d.daiLy)}</td>
      <td class="cell-num">${fmtChiTieuUsd(d.tongTieu)}</td>
      <td class="cell-num">${fmtChiTieuUsd(d.tongThu)}</td>`;
    tbodyEl.appendChild(tr);
  }
}

function renderChiTieuByDaiLyFilter() {
  const filter = state.chiTieuDaiLyFilter || "";
  const wrap = $("#wrap-chi-tieu-by-dai-ly");
  if (!wrap) return;

  if (!filter) {
    wrap.hidden = true;
    for (const id of ["chi-tieu-month-dai-ly-heading", "chi-tieu-days-dai-ly-heading"]) {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    }
    for (const sel of ["#table-chi-tieu-month-dai-ly", "#table-chi-tieu-days-dai-ly"]) {
      const table = $(sel);
      const block = table?.closest(".table-wrap");
      if (block) block.hidden = false;
    }
    return;
  }

  wrap.hidden = false;
  const labelEl = $("#chi-tieu-by-dai-ly-label");
  const scopeEl = $("#chi-tieu-by-dai-ly-scope");
  const tbody = $("#table-chi-tieu-by-dai-ly tbody");
  const { month, day } = state.chiTieuNav;

  for (const id of ["chi-tieu-month-dai-ly-heading", "chi-tieu-days-dai-ly-heading"]) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  for (const sel of ["#table-chi-tieu-month-dai-ly", "#table-chi-tieu-days-dai-ly"]) {
    const table = $(sel);
    const block = table?.closest(".table-wrap");
    if (block) block.hidden = true;
  }

  if (labelEl) labelEl.textContent = formatDisplayLabel(filter);
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
    tr.innerHTML = `<td colspan="4" class="muted">Không có dữ liệu cho đại lý này.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(formatDayForDisplay(r.ngay))}</td>
      <td class="cell-readonly">${displayLabel(r.mcc ?? "—")}</td>
      <td class="cell-readonly cell-num">${fmtChiTieuUsd(chiTieuAmount(r.tongTieu))}</td>
      <td class="cell-readonly cell-num">${fmtChiTieuUsd(chiTieuAmount(r.tongThu))}</td>`;
    tbody.appendChild(tr);
  }
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
      <td>${displayLabel(n.nguon)}</td>
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
      <td class="cell-readonly">${displayLabel(g.mcc)}</td>
      <td class="cell-readonly cell-num">${fmtChiTieuUsd(g.tongTieu)}</td>
      <td class="cell-readonly cell-num">${fmtChiTieuUsd(g.tongThu)}</td>
      <td class="cell-readonly">${displayLabel(g.nguon || "—")}</td>`;
    tbodyEl.appendChild(tr);
  }
}

function populateChiTieuDaiLyFilter() {
  const sel = $("#chi-tieu-dai-ly-filter");
  if (!sel) return;
  const prev = state.chiTieuDaiLyFilter || "";
  const fromApi = state.reportChiTieu?.daiLyList ?? [];
  const list = uniqueCompareDaiLyNames(
    fromApi.length ? fromApi : state.baoCaoTk.map((r) => r.tenKhach),
  );
  sel.innerHTML = `<option value="">Tất cả đại lý</option>`;
  for (const d of list) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = formatDisplayLabel(d);
    sel.appendChild(opt);
  }
  sel.value = prev;
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
    opt.textContent = formatDisplayLabel(n);
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
  renderChiTieuByDaiLyFilter();
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
    renderChiTieuDaiLyMonthTable(
      $("#table-chi-tieu-month-dai-ly tbody"),
      $("#chi-tieu-month-dai-ly-label"),
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
    renderChiTieuDaiLyMonthTable(
      $("#table-chi-tieu-days-dai-ly tbody"),
      $("#chi-tieu-days-dai-ly-label"),
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
  renderChiTieuByDaiLyFilter();
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
  if (!tb) return;
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
      <td class="cell-readonly">${displayLabel(r.ten ?? "")}</td>
      <td class="cell-readonly">${displayLabel(r.ghiChu ?? "")}</td>`;
    tb.appendChild(tr);
  });
}

function renderCongNo() {
  const tb = tbody("table-cong-no");
  tb.innerHTML = "";
  let sumNo = 0;
  state.congNo.forEach((r) => {
    sumNo += parseNumClient(r.tienNo);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${displayLabel(r.ten ?? "")}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.tienNo)}</td>`;
    tb.appendChild(tr);
  });
  const totalEl = $("#cong-no-total");
  if (totalEl) totalEl.textContent = `Tổng công nợ: ${fmtMoney(sumNo)}`;
}

function hhLoaiTruAmountCell(row, kind) {
  const display = kind === "thu" ? row.khoanThuDisplay : row.khoanChiDisplay;
  const amount = kind === "thu" ? row.khoanThu : row.khoanChi;
  if (display != null && String(display).trim() !== "") return escapeHtml(String(display).trim());
  if ((amount ?? 0) > 0) return cellMoneyDisplay(amount);
  return "—";
}

function renderHhLoaiTruTable() {
  const tb = tbody("table-hh-loai-tru");
  if (!tb) return;
  tb.innerHTML = "";
  const list = state.hhLoaiTru ?? [];
  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="muted">Chưa có khoản loại trừ — thêm dòng và bấm Lưu.</td>`;
    tb.appendChild(tr);
    return;
  }
  list.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const ngayShow = row.ngayDisplay?.trim() ? row.ngayDisplay.trim() : formatDayForDisplay(row.ngay ?? "");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(ngayShow)}</td>
      <td class="cell-readonly cell-num">${hhLoaiTruAmountCell(row, "thu")}</td>
      <td class="cell-readonly cell-num">${hhLoaiTruAmountCell(row, "chi")}</td>
      <td class="cell-readonly">${displayLabel(row.tenDaiLy ?? "")}</td>
      <td class="cell-readonly">${escapeHtml(row.note ?? "")}</td>
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
  const note = $("#hh-loai-tru-note");
  if (note) note.value = "";
  const thu = $("#hh-loai-tru-thu");
  if (thu) thu.value = "";
  const chi = $("#hh-loai-tru-chi");
  if (chi) chi.value = "";
}

/** Lấy dòng đang nhập trên form (chưa thêm vào bảng). */
function readHhLoaiTruFormRow() {
  const ngay = ($("#hh-loai-tru-ngay")?.value ?? "").trim();
  const tenDaiLy = ($("#hh-loai-tru-ten")?.value ?? "").trim();
  const note = ($("#hh-loai-tru-note")?.value ?? "").trim();
  const thuRaw = ($("#hh-loai-tru-thu")?.value ?? "").trim();
  const chiRaw = ($("#hh-loai-tru-chi")?.value ?? "").trim();
  const khoanThu = parseNumClient(thuRaw);
  const khoanChi = parseNumClient(chiRaw);
  if (!ngay || (!tenDaiLy && !note) || (khoanThu <= 0 && khoanChi <= 0)) return null;
  return {
    ngay,
    tenDaiLy,
    note: note || undefined,
    khoanThu,
    khoanChi,
    khoanThuDisplay: khoanThu > 0 ? thuRaw : "",
    khoanChiDisplay: khoanChi > 0 ? chiRaw : "",
  };
}

/** Thêm dòng form vào danh sách (nếu form đủ dữ liệu). */
function tryAppendHhLoaiTruFormRow() {
  const row = readHhLoaiTruFormRow();
  if (!row) return false;
  state.hhLoaiTru = [...(state.hhLoaiTru ?? []), row];
  state.hhLoaiTruDirty = true;
  renderHhLoaiTruTable();
  resetHhLoaiTruFormDefaults();
  return true;
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
    if (!tryAppendHhLoaiTruFormRow()) {
      setHhLoaiTruStatus("Nhập đủ Ngày, Ghi chú và ít nhất một trong Khoản thu / Khoản chi > 0.", "err");
      return;
    }
    setHhLoaiTruStatus("Đã thêm dòng — bấm «Lưu danh sách» để ghi Sheet.", "ok");
  });

  $("#btn-hh-loai-tru-reload")?.addEventListener("click", async () => {
    setHhLoaiTruStatus("Đang tải…");
    try {
      await loadHhLoaiTruFromApi();
      setHhLoaiTruStatus(`Đã tải ${(state.hhLoaiTru ?? []).length} dòng từ Sheet.`, "ok");
    } catch (e) {
      setHhLoaiTruStatus(e.message || "Lỗi tải.", "err");
    }
  });

  $("#btn-hh-loai-tru-save")?.addEventListener("click", async () => {
    tryAppendHhLoaiTruFormRow();
    const list = state.hhLoaiTru ?? [];
    if (!list.length) {
      setHhLoaiTruStatus("Chưa có dòng để lưu — nhập Ngày, Ghi chú và Khoản thu hoặc Khoản chi.", "err");
      return;
    }
    setHhLoaiTruStatus("Đang lưu…");
    try {
      const res = await api("/api/luong-nv-exclusions", {
        method: "PUT",
        body: JSON.stringify({ exclusions: list }),
      });
      state.hhLoaiTru = res.exclusions ?? list;
      state.hhLoaiTruDirty = false;
      renderHhLoaiTruTable();
      const appended = res.appended ?? 0;
      const total = res.total ?? state.hhLoaiTru.length;
      setHhLoaiTruStatus(
        appended > 0
          ? `Đã thêm ${appended} dòng mới (tổng ${total} trên Sheet) — làm mới bảng lương…`
          : `Không có dòng mới (tổng ${total} trên Sheet) — làm mới bảng lương…`,
        "ok",
      );
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
    state.chamCongNvCommissionStart = res.commissionStartByTab ?? {};
    renderChamCongNvTable();
  } catch (e) {
    setChamCongNvStatus(e.message || "Không tải được danh sách tab.", "err");
  }
}

async function saveChamCongNvCommissionStart(tabName, dateIso) {
  setChamCongNvStatus("Đang lưu ngày HH…");
  try {
    const res = await api("/api/cham-cong-employees", {
      method: "PUT",
      body: JSON.stringify({ tabName, commissionStartDate: dateIso || "" }),
    });
    if (dateIso) state.chamCongNvCommissionStart[tabName] = dateIso;
    else delete state.chamCongNvCommissionStart[tabName];
    setChamCongNvStatus(res.message || "Đã lưu.", "ok");
    await fetchSheetAndApply({ force: true, silent: true });
  } catch (e) {
    setChamCongNvStatus(e.message || "Lỗi lưu ngày HH.", "err");
    await loadChamCongNvTabs();
  }
}

function renderChamCongNvPicker() {
  const listEl = $("#cham-cong-nv-dropdown-list");
  const labelEl = $("#cham-cong-nv-picker-label");
  if (!listEl) return;
  const list = state.chamCongNvTabs ?? [];
  const selected = state.selectedChamCongNvTab || "";
  if (labelEl) labelEl.textContent = selected || "Tất cả";
  listEl.innerHTML = "";
  const addItem = (name, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `luong-nv-dropdown-item${name === selected ? " active" : ""}`;
    btn.textContent = label;
    btn.dataset.tab = name;
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", name === selected ? "true" : "false");
    btn.addEventListener("click", () => {
      state.selectedChamCongNvTab = name;
      closeChamCongNvPicker();
      renderChamCongNvPicker();
      renderLuongNv();
    });
    listEl.appendChild(btn);
  };
  addItem("", "Tất cả nhân viên");
  list.forEach((tabName) => addItem(tabName, tabName));
}

function closeChamCongNvPicker() {
  const dropdown = $("#cham-cong-nv-dropdown");
  const btn = $("#btn-cham-cong-nv-picker");
  if (dropdown) dropdown.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function renderChamCongNvTable() {
  renderChamCongNvPicker();
  const tb = tbody("table-cham-cong-nv");
  if (!tb) return;
  tb.innerHTML = "";
  const list = state.chamCongNvTabs ?? [];
  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">Chưa có tab nhân viên trên file chấm công.</td>`;
    tb.appendChild(tr);
    return;
  }
  const tpl = (state.chamCongNvTemplate || "SUBEO").toLowerCase();
  const starts = state.chamCongNvCommissionStart ?? {};
  list.forEach((tabName) => {
    const isTemplate = tabName.toLowerCase() === tpl;
    const startDate = starts[tabName] || "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(tabName)}${isTemplate ? ' <span class="muted small">(NV + mẫu)</span>' : ""}</td>
      <td>
        <input type="date" class="input input-sm cham-cong-nv-hh-start" data-cc-tab="${escapeAttr(tabName)}" value="${escapeAttr(startDate)}" title="Chỉ tính HH từ ngày này (THU_CHI)" />
      </td>
      <td class="cell-readonly">${
        isTemplate
          ? '<span class="muted small">Không xóa</span>'
          : `<button type="button" class="btn ghost btn-sm" data-cc-del="${escapeAttr(tabName)}">Xóa</button>`
      }</td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll(".cham-cong-nv-hh-start").forEach((input) => {
    input.addEventListener("change", () => {
      const tab = input.getAttribute("data-cc-tab");
      if (!tab) return;
      void saveChamCongNvCommissionStart(tab, input.value || "");
    });
  });
  tb.querySelectorAll("[data-cc-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = btn.getAttribute("data-cc-del");
      if (!tab || !confirm(`Xóa tab « ${tab} » trên Sheet chấm công?`)) return;
      setChamCongNvStatus("Đang xóa…");
      try {
        await api(`/api/cham-cong-employees?tab=${encodeURIComponent(tab)}`, { method: "DELETE" });
        setChamCongNvStatus(`Đã xóa tab ${tab}.`, "ok");
        if (state.selectedChamCongNvTab === tab) state.selectedChamCongNvTab = "";
        await loadChamCongNvTabs();
        await fetchSheetAndApply({ force: true });
      } catch (e) {
        setChamCongNvStatus(e.message || "Lỗi xóa tab.", "err");
      }
    });
  });
}

function bindLuongNvToolbar() {
  if ($("#cham-cong-nv-picker-wrap")?.dataset.bound === "1") return;
  const wrap = $("#cham-cong-nv-picker-wrap");
  if (!wrap) return;
  wrap.dataset.bound = "1";

  $("#btn-cham-cong-nv-picker")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const dropdown = $("#cham-cong-nv-dropdown");
    const btn = $("#btn-cham-cong-nv-picker");
    if (!dropdown || !btn) return;
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderChamCongNvPicker();
  });

  document.addEventListener("click", (ev) => {
    if (!wrap.contains(ev.target)) closeChamCongNvPicker();
  });

  $("#btn-hh-loai-tru-toggle")?.addEventListener("click", () => {
    const section = $("#section-hh-loai-tru");
    const btn = $("#btn-hh-loai-tru-toggle");
    if (!section || !btn) return;
    const open = section.hidden;
    section.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.classList.toggle("active", open);
    if (open && !state.hhLoaiTruDirty) void loadHhLoaiTruFromApi().catch(() => {});
  });

  $("#btn-cham-cong-nv-manage")?.addEventListener("click", () => {
    const section = $("#section-cham-cong-nv");
    const btn = $("#btn-cham-cong-nv-manage");
    if (!section || !btn) return;
    const open = section.hidden;
    section.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.classList.toggle("active", open);
    if (open && !(state.chamCongNvTabs ?? []).length) void loadChamCongNvTabs();
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
      const exclThu = cb.thuExcludedHhLoaiTru ?? 0;
      const exclChi = cb.chiExcludedHhLoaiTru ?? 0;
      const exclTotal = cb.thuExcluded ?? exclThu;
      const exclParts = [];
      if (exclThu > 0) exclParts.push(`loại thu: ${cellMoneyDisplay(exclThu)}`);
      if (exclChi > 0) exclParts.push(`loại chi: ${cellMoneyDisplay(exclChi)}`);
      const filterTab = (state.selectedChamCongNvTab || "").trim();
      const employees = (period.employees ?? []).filter(
        (emp) => !filterTab || (emp.name ?? "") === filterTab,
      );
      const rows = employees
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
            const carryOut = emp.tienUngCarryOutUsd ?? 0;
            const ungTitle =
              carryOut > 0
                ? ` title="Còn ${fmtChiTieuUsd(carryOut)} — bot tự ghi cột C ngày 1 tháng sau"`
                : "";
            const tongLuong =
              emp.tongLuongUsd ??
              base + (emp.commissionUsd ?? 0) - phat + thuong;
            const thucNhan =
              emp.thucNhanUsd ??
              emp.totalSalaryUsd ??
              tongLuong - ung;
            const hhStart = emp.commissionStartDate || "";
            const hhTitle = hhStart
              ? ` title="HH tính từ ${formatDayForDisplay(hhStart)}"`
              : "";
            return `
        <tr>
          <td class="cell-readonly">${escapeHtml(emp.name ?? "")}</td>
          <td class="cell-readonly cell-num">${escapeHtml(String(emp.workingDays ?? 0))} / ${escapeHtml(String(period.daysInMonth ?? "—"))}</td>
          <td class="cell-readonly cell-num">${fmtChiTieuUsd(base)}</td>
          <td class="cell-readonly cell-num"${hhTitle}>${fmtChiTieuUsd(emp.commissionUsd)}</td>
          <td class="cell-readonly cell-num">${phat > 0 ? fmtChiTieuUsd(phat) : "—"}</td>
          <td class="cell-readonly cell-num">${thuong > 0 ? fmtChiTieuUsd(thuong) : "—"}</td>
          <td class="cell-readonly cell-num luong-nv-total"><strong>${fmtChiTieuUsd(tongLuong)}</strong></td>
          <td class="cell-readonly cell-num"${ungTitle}>${ung > 0 ? fmtChiTieuUsd(ung) : "—"}</td>
          <td class="cell-readonly cell-num luong-nv-total"><strong>${fmtChiTieuUsd(thucNhan)}</strong></td>
        </tr>`;
          },
        )
        .join("");

      const emptyRow =
        rows ||
        `<tr><td colspan="9" class="muted">Chưa có tab nhân viên trong file chấm công.</td></tr>`;

      return `
      <section class="luong-nv-period" data-period="${idx}">
        <h3 class="subsection-title">${escapeHtml(period.label ?? "")}</h3>
        <p class="muted small panel-guide">${escapeHtml(period.payNote ?? "")}</p>
        <div class="luong-nv-commission-summary muted small">
          <strong>Cơ sở hoa hồng 1%:</strong>
          Thu ${cellMoneyDisplay(cb.tongThu)} − Chi ${cellMoneyDisplay(cb.tongChi)}
          ${exclTotal > 0 || exclChi > 0 ? ` (loại: ${exclParts.join("; ")})` : ""}
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
                <th class="th-num">Tổng lương (USD)</th>
                <th class="th-num">Tiền ứng (C) (USD)</th>
                <th class="th-num">Thực nhận (USD)</th>
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

function refreshComputedFromClient() {
  const duDau = parseNumClient($("#tq-a2").value);
  let sumThu = 0;
  let sumChi = 0;
  let sumCocB = 0;
  let sumCocC = 0;
  for (const r of state.thuChi) {
    sumThu += parseNumClient(r.thu);
    sumChi += parseNumClient(r.chi);
  }
  for (const r of state.coc) {
    sumCocB += parseNumClient(r.thu);
    sumCocC += parseNumClient(r.chi);
  }
  let sumNo = 0;
  for (const r of state.congNo) {
    sumNo += parseNumClient(r.tienNo);
  }
  const balanceFluctuations = duDau + sumThu - sumChi;
  $("#tq-e2").value = fmtMoney(balanceFluctuations);
  $("#tq-b2").value = fmtMoney(sumCocC);
  $("#tq-c2").value = fmtMoney(sumCocB);
  $("#tq-d2").value = fmtMoney(sumNo);
  state.computed = {
    tongCoc: sumCocC,
    nhanCoc: sumCocB,
    tongCongNo: sumNo,
    duDauNhap: duDau,
    balanceFluctuations,
    sumThuChiThu: sumThu,
    sumThuChiChi: sumChi,
  };
  renderReport();
}

async function saveBalanceToKv() {
  if (!isRevealed()) return;
  const raw = ($("#tq-a2")?.value ?? "").trim();
  if (!raw) return;
  try {
    await api("/api/balance", {
      method: "PUT",
      body: JSON.stringify({ balance: parseNumClient(raw) }),
    });
  } catch {
    /* giữ im lặng — user có thể thử lại khi sửa */
  }
}

function scheduleBalanceSave() {
  clearTimeout(balanceSaveTimer);
  balanceSaveTimer = setTimeout(() => void saveBalanceToKv(), 800);
}

function renderReport() {
  populateReportThuChiNguonFilter();
  renderReportThuChiDrill();
  renderReportThuChiToday();
  populateCompareBcTcFilters();
  renderBaoCaoThuChiCompareDrill();
  populateChiTieuNguonFilter();
  populateChiTieuDaiLyFilter();
  renderChiTieuToday();
  renderChiTieuDrill();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function displayLabel(s) {
  return escapeHtml(formatDisplayLabel(s));
}

function applyPayload(data, options = {}) {
  const { preserveHhLoaiTru = false } = options;
  syncSensitiveRevealClass();
  state.balance = data.balance ?? { value: 0, kvBound: false };
  state.thuChi = (data.thuChi ?? []).map(rowThuChi);
  state.coc = (data.coc ?? []).map(rowCoc);
  state.congNo = (data.congNo ?? []).map(rowCongNo);
  state.baoCaoTk = (data.baoCaoTk ?? []).map(rowBaoCaoTk);
  state.computed = data.computed ?? null;
  state.report = {
    byDay: data.report?.byDay ?? [],
    byMonth: data.report?.byMonth ?? [],
    todayVietnam: data.report?.todayVietnam ?? null,
  };
  state.reportChiTieu = data.reportChiTieu ?? {
    byDay: [],
    byMonth: [],
    todayVietnam: null,
    nguonList: [],
    daiLyList: [],
  };
  state.reportBaoCaoThuChiCompare = data.reportBaoCaoThuChiCompare ?? {
    byMonth: [],
    byDay: [],
    daiLyList: [],
    monthList: [],
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

  const bal = state.balance?.value;
  $("#tq-a2").value = bal != null && Number.isFinite(bal) ? String(bal) : "";

  sessionStorage.setItem(LAST_SIG_KEY, JSON.stringify(data));
  showSheetDiagnostics(data.sheetDiagnostics);

  renderThuChi();
  renderCoc();
  renderCongNo();
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
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html") || /^\s*<(!DOCTYPE|html)/i.test(text)) {
    const err = new Error(
      "API trả HTML thay vì JSON — Cloudflare Functions chưa deploy. Chạy deploy từ thư mục gốc (có functions/) hoặc kiểm tra /api/health.",
    );
    err.status = res.status;
    throw err;
  }
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
    if (res.status === 404) {
      msg =
        msg && msg !== "Not Found"
          ? msg
          : "Không tìm thấy API (/api/…). Deploy lại Cloudflare Pages kèm thư mục functions/.";
    }
    if (res.status === 503 && !json?.error) {
      msg = "Cấu hình server thiếu Secret (ADMIN_PASSWORD, SESSION_SECRET, GOOGLE_SERVICE_ACCOUNT_JSON).";
    }
    const err = new Error(msg || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function truncateSheetError(msg) {
  const s = String(msg ?? "");
  if (s.length <= 180) return s;
  return `${s.slice(0, 177)}…`;
}

function setSyncStatus(msg, kind) {
  const el = $("#sync-status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function appendClientSheetErrorLog(entry) {
  const key = "sheetErrorLog";
  try {
    const prev = JSON.parse(localStorage.getItem(key) || "[]");
    const list = Array.isArray(prev) ? prev : [];
    list.push({ ...entry, at: entry.at || new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(list.slice(-30)));
  } catch {
    /* ignore */
  }
}

function showSheetDiagnostics(diag) {
  if (!diag) return;
  const errors = diag.errors ?? [];
  const counts = diag.counts ?? {};
  const allEmpty =
    (counts.thuChi ?? 0) === 0 &&
    (counts.coc ?? 0) === 0 &&
    (counts.congNo ?? 0) === 0;
  if (!errors.length && !allEmpty) return;
  if (errors.length) {
    const first = errors[0];
    const is429 = /429|RESOURCE_EXHAUSTED|RATE_LIMIT/i.test(String(first?.message ?? ""));
    const hint = first?.message?.includes("403")
      ? " — chia sẻ Google Sheet cho email service account (quyền Editor)."
      : is429
        ? " — vượt giới hạn đọc Google Sheet (60/phút). Đợi ~1 phút, tắt Tự động, rồi Làm mới."
        : "";
    for (const err of errors) {
      appendClientSheetErrorLog({
        range: err.range,
        message: err.message,
        spreadsheetId: err.spreadsheetId,
      });
    }
    const recent = diag.recentErrorLog ?? [];
    if (recent.length) {
      try {
        localStorage.setItem("sheetErrorLogServer", JSON.stringify(recent.slice(-30)));
      } catch {
        /* ignore */
      }
    }
    setSyncStatus(
      `Lỗi đọc Sheet (${errors.length}): ${first?.range ?? "?"} — ${truncateSheetError(first?.message ?? "?")}${hint}`,
      "err",
    );
    return;
  }
  if (allEmpty) {
    setSyncStatus(
      "Sheet trống hoặc không đọc được dữ liệu — kiểm tra quyền service account và tên tab (THU_CHI, COC…).",
      "err",
    );
  }
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
  const hasSheetErrors = (data.sheetDiagnostics?.errors ?? []).length > 0;
  const counts = data.sheetDiagnostics?.counts ?? {};
  const allEmpty =
    (counts.thuChi ?? state.thuChi?.length ?? 0) === 0 &&
    (counts.coc ?? state.coc?.length ?? 0) === 0;
  if (!silent && !hasSheetErrors && !allEmpty) {
    setSyncStatus("Đã tải dữ liệu từ Google Sheet.", "ok");
  }
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
  }, 90000);
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

  $("#chi-tieu-nguon-filter")?.addEventListener("change", (ev) => {
    state.chiTieuNguonFilter = ev.target.value || "";
    setChiTieuNav(state.chiTieuNav.month, state.chiTieuNav.day);
    renderChiTieuToday();
  });

  $("#chi-tieu-dai-ly-filter")?.addEventListener("change", (ev) => {
    state.chiTieuDaiLyFilter = ev.target.value || "";
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

  $("#table-compare-bc-tc-month")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-tc-click-row");
    if (!tr?.dataset.month) return;
    state.baoCaoThuChiCompareFilter.month = "";
    const monthSel = $("#compare-bc-tc-filter-month");
    if (monthSel) monthSel.value = "";
    setBaoCaoThuChiCompareNav(tr.dataset.month, "");
  });
  $("#table-compare-bc-tc-days")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.report-tc-click-row");
    if (!tr?.dataset.day) return;
    setBaoCaoThuChiCompareNav(state.baoCaoThuChiCompareNav.month, tr.dataset.day);
  });
  $("#btn-compare-bc-tc-back-month")?.addEventListener("click", () => {
    state.baoCaoThuChiCompareFilter.month = "";
    const monthSel = $("#compare-bc-tc-filter-month");
    if (monthSel) monthSel.value = "";
    setBaoCaoThuChiCompareNav("", "");
  });
  $("#btn-compare-bc-tc-back-days")?.addEventListener("click", () =>
    setBaoCaoThuChiCompareNav(state.baoCaoThuChiCompareNav.month, ""),
  );
  $("#compare-bc-tc-filter-month")?.addEventListener("change", (ev) => {
    setCompareBcTcFilterMonth(ev.target.value || "");
  });
  $("#compare-bc-tc-filter-dai-ly")?.addEventListener("change", (ev) => {
    setCompareBcTcFilterDaiLy(ev.target.value || "");
  });
  for (const id of ["btn-compare-bc-tc-sort-chenh-month", "btn-compare-bc-tc-sort-chenh-day"]) {
    document.getElementById(id)?.addEventListener("click", cycleCompareBcTcChenhSort);
  }
}

function bindOverviewInput() {
  const onBalanceInput = () => {
    refreshComputedFromClient();
    scheduleBalanceSave();
  };
  $("#tq-a2")?.addEventListener("input", onBalanceInput);
  $("#tq-a2")?.addEventListener("change", onBalanceInput);
}

async function main() {
  bindTabs();
  bindAppMenu();
  bindHhLoaiTruForm();
  bindLuongNvToolbar();
  bindChamCongNvPanel();
  resetHhLoaiTruFormDefaults();
  activateTab("coc");
  bindOverviewInput();
  setRevealed(isRevealed());
  setAutoSyncUi();

  function openRevealPasswordModal() {
    const backdrop = $("#reveal-password-backdrop");
    const modal = $("#reveal-password-modal");
    const input = $("#input-reveal-password");
    const err = $("#reveal-password-error");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (input) input.value = "";
    if (backdrop) backdrop.hidden = false;
    if (modal) modal.hidden = false;
    requestAnimationFrame(() => input?.focus());
  }

  function closeRevealPasswordModal() {
    const backdrop = $("#reveal-password-backdrop");
    const modal = $("#reveal-password-modal");
    if (backdrop) backdrop.hidden = true;
    if (modal) modal.hidden = true;
  }

  $("#btn-reveal-balance").addEventListener("click", openRevealPasswordModal);
  $("#btn-reveal-password-cancel")?.addEventListener("click", closeRevealPasswordModal);
  $("#reveal-password-backdrop")?.addEventListener("click", closeRevealPasswordModal);
  $("#form-reveal-password")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const p = String($("#input-reveal-password")?.value ?? "");
    if (!p) return;
    const err = $("#reveal-password-error");
    try {
      await api("/api/reveal-balance", { method: "POST", body: JSON.stringify({ password: p }) });
      closeRevealPasswordModal();
      setRevealed(true);
    } catch (e) {
      if (err) {
        err.textContent = e.body?.error || e.message || "Sai mật khẩu.";
        err.hidden = false;
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#reveal-password-modal")?.hidden) closeRevealPasswordModal();
  });
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
    const detail = e.body?.error || e.message;
    $("#login-error").textContent =
      detail ||
      (e.status === 401
        ? ""
        : "Không tải được dữ liệu. Kiểm tra deploy API, biến môi trường và quyền service account.");
    $("#login-error").hidden = !detail;
  }
}

main();
