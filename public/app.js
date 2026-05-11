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
  report: { byDay: [], byMonth: [] },
  reportBanDao: { byDay: [], byMonth: [] },
};

function rowThuChi(r) {
  return {
    ngay: r.ngay ?? "",
    thu: r.thu ?? "",
    chi: r.chi ?? "",
    ghiChu: r.ghiChu ?? "",
    bienDong: r.bienDong ?? "",
  };
}
function rowCoc(r) {
  return { ngay: r.ngay ?? "", thu: r.thu ?? "", chi: r.chi ?? "", ghiChu: r.ghiChu ?? "" };
}
function rowCongNo(r) {
  return { ten: r.ten ?? "", tienNo: r.tienNo ?? "" };
}
function rowBanDao(r) {
  return {
    ngay: r.ngay ?? "",
    tenKh: r.tenKh ?? "",
    tienUs: r.tienUs ?? "",
    tienVnd: r.tienVnd ?? "",
    thu: r.thu ?? "",
    chi: r.chi ?? "",
  };
}

const REVEAL_KEY = "bc_reveal_balance";
function isRevealed() {
  return sessionStorage.getItem(REVEAL_KEY) === "1";
}
function setRevealed(v) {
  if (v) sessionStorage.setItem(REVEAL_KEY, "1");
  else sessionStorage.removeItem(REVEAL_KEY);
  const appRoot = $("#view-app");
  if (appRoot) appRoot.classList.toggle("bc-sensitive-revealed", v);
  const inp = $("#tq-a2");
  if (inp) inp.type = v ? "text" : "password";
  const e2inp = $("#tq-e2");
  if (e2inp) e2inp.type = v ? "text" : "password";
  const section = $("#section-sensitive-balance");
  if (section) section.hidden = !v;
  const a2Field = $("#field-a2");
  if (a2Field) a2Field.hidden = !v;
  const e2Field = $("#field-e2");
  if (e2Field) e2Field.hidden = !v;
  const repA2Card = $("#card-rep-a2");
  if (repA2Card) repA2Card.hidden = !v;
  const repE2Card = $("#card-rep-e2");
  if (repE2Card) repE2Card.hidden = !v;
  $("#btn-reveal-balance").hidden = v;
  $("#btn-hide-balance").hidden = !v;
  capNhatHienThiSoDuDauDoc();
  capNhatHienThiBienDong();
  renderThuChi();
}

function setView(loggedIn) {
  $("#view-login").hidden = loggedIn;
  $("#view-app").hidden = !loggedIn;
  const panels = $("#admin-tab-panels");
  if (panels) panels.hidden = !loggedIn;
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

function tbody(id) {
  return $(`#${id} tbody`);
}

function cellMoneyDisplay(raw) {
  if (raw == null || raw === "") return "—";
  if (typeof raw === "number" && Number.isFinite(raw)) return fmtMoney(raw);
  const s = String(raw).trim();
  if (!s) return "—";
  const n = parseNumClient(s);
  return fmtMoney(n);
}

/** Cột E: API có thể trả số thuần (UNFORMATTED) hoặc chuỗi — chỉ hiển thị, không tự tính lại. */
function cellBienDongDisplay(raw) {
  if (raw == null || raw === "") return "—";
  if (typeof raw === "number" && Number.isFinite(raw)) return fmtMoney(raw);
  const s = String(raw).trim();
  if (!s) return "—";
  const n = parseNumClient(s);
  if (!Number.isFinite(n)) return escapeHtml(s);
  return fmtMoney(n);
}

function renderThuChi() {
  const tb = tbody("table-thu-chi");
  tb.innerHTML = "";
  state.thuChi.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-readonly">${escapeHtml(r.ngay ?? "")}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.thu)}</td>
      <td class="cell-readonly cell-num">${cellMoneyDisplay(r.chi)}</td>
      <td class="cell-readonly">${escapeHtml(r.ghiChu ?? "")}</td>
      <td class="cell-readonly cell-num col-thu-chi-e">${cellBienDongDisplay(r.bienDong)}</td>`;
    tb.appendChild(tr);
  });
}

function renderCoc() {
  const tb = tbody("table-coc");
  tb.innerHTML = "";
  state.coc.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="input" data-k="ngay" data-i="${i}" type="text" value="${escapeAttr(r.ngay)}" /></td>
      <td><input class="input" data-k="thu" data-i="${i}" type="text" inputmode="decimal" value="${escapeAttr(r.thu)}" /></td>
      <td><input class="input" data-k="chi" data-i="${i}" type="text" inputmode="decimal" value="${escapeAttr(r.chi)}" /></td>
      <td><input class="input" data-k="ghiChu" data-i="${i}" type="text" value="${escapeAttr(r.ghiChu)}" /></td>
      <td><button type="button" class="btn icon" data-del="coc" data-i="${i}">✕</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("change", onCocChange);
    inp.addEventListener("input", onCocChange);
  });
  attachMoneyBlurHandlers(tb);
  tb.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", onDelRow));
}

function renderCongNo() {
  const tb = tbody("table-cong-no");
  tb.innerHTML = "";
  state.congNo.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="input" type="text" value="${escapeAttr(r.ten)}" readonly /></td>
      <td><input class="input" type="text" value="${escapeAttr(fmtMoney(parseNumClient(r.tienNo)))}" readonly /></td>
      <td></td>`;
    tb.appendChild(tr);
  });
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function onCocChange(ev) {
  const inp = ev.target;
  const i = Number(inp.dataset.i);
  const k = inp.dataset.k;
  if (!state.coc[i]) return;
  state.coc[i][k] = inp.value;
  refreshComputedFromClient();
}

function onCongNoChange(ev) {
  const inp = ev.target;
  const i = Number(inp.dataset.i);
  const k = inp.dataset.k;
  if (!state.congNo[i]) return;
  state.congNo[i][k] = inp.value;
  refreshComputedFromClient();
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

function attachMoneyBlurHandlers(root = document) {
  root.querySelectorAll("input[inputmode=\"decimal\"]").forEach((inp) => {
    if (inp.dataset.moneyBlurBound === "1") return;
    inp.dataset.moneyBlurBound = "1";
    inp.addEventListener("blur", () => {
      const v = inp.value ?? "";
      if (!String(v).trim()) return;
      const n = parseNumClient(v);
      inp.value = Number.isFinite(n) ? String(n) : v;
    });
  });
}

/** Dòng cuối có dữ liệu (Ngày/Thu/Chi): lấy Thu & Chi của dòng đó cho số dư. */
function latestThuChiValues(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const has = `${r.ngay ?? ""}${r.thu ?? ""}${r.chi ?? ""}`.trim();
    if (has) return { thu: parseNumClient(r.thu), chi: parseNumClient(r.chi) };
  }
  return { thu: 0, chi: 0 };
}

/** Hiển thị “số dư đầu là bao nhiêu” từ ô A2 (đồng bộ khi đọc Sheet hoặc khi sửa ô). */
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
  const { thu: lastThu, chi: lastChi } = latestThuChiValues(state.thuChi);
  /** Ô TONG_QUAN E2: giá trị/công thức từ Sheet — không ghi đè từ tính lũy kế trên client. */
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
    soDuSauThuChi: duDau + lastThu - lastChi,
    duDauNhap: duDau,
    bienDongE2: bienDongTuSheet,
  };
  buildReportFromState();
  renderReport();
  capNhatHienThiSoDuDauDoc();
  capNhatHienThiBienDong();
}

function buildReportFromState() {
  const byDay = new Map();
  for (const r of state.thuChi) {
    const day = (r.ngay ?? "").trim();
    if (!day) continue;
    const cur = byDay.get(day) ?? { thu: 0, chi: 0 };
    cur.thu += parseNumClient(r.thu);
    cur.chi += parseNumClient(r.chi);
    byDay.set(day, cur);
  }
  const byMonth = new Map();
  for (const [day, v] of byDay) {
    const m = day.length >= 7 ? day.slice(0, 7) : day;
    const cur = byMonth.get(m) ?? { thu: 0, chi: 0 };
    cur.thu += v.thu;
    cur.chi += v.chi;
    byMonth.set(m, cur);
  }
  state.report = {
    byDay: [...byDay.entries()]
      .map(([date, v]) => ({ date, tongThu: v.thu, tongChi: v.chi }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byMonth: [...byMonth.entries()]
      .map(([thang, v]) => ({ thang, tongThu: v.thu, tongChi: v.chi }))
      .sort((a, b) => a.thang.localeCompare(b.thang)),
  };
}

function renderReport() {
  const c = state.computed;
  $("#rep-sodu").textContent = c ? fmtMoney(c.soDuSauThuChi) : "—";
  $("#rep-a2").textContent = isRevealed() && c ? fmtMoney(c.duDauNhap) : "—";
  $("#rep-b2").textContent = c ? fmtMoney(c.tongCoc) : "—";
  $("#rep-c2").textContent = c ? fmtMoney(c.nhanCoc) : "—";
  $("#rep-d2").textContent = c ? fmtMoney(c.tongCongNo) : "—";
  $("#rep-e2").textContent = isRevealed() && c ? fmtMoney(c.bienDongE2) : "—";

  const tbD = $("#table-report-day tbody");
  tbD.innerHTML = "";
  for (const r of state.report.byDay) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(r.date)}</td><td>${fmtMoney(r.tongThu)}</td><td>${fmtMoney(r.tongChi)}</td>`;
    tbD.appendChild(tr);
  }
  const tbM = $("#table-report-month tbody");
  tbM.innerHTML = "";
  for (const r of state.report.byMonth) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(r.thang)}</td><td>${fmtMoney(r.tongThu)}</td><td>${fmtMoney(r.tongChi)}</td>`;
    tbM.appendChild(tr);
  }

  const bdD = $("#table-bandao-day tbody");
  if (bdD) {
    bdD.innerHTML = "";
    for (const r of state.reportBanDao.byDay ?? []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.date)}</td><td>${fmtMoney(r.tong)}</td>`;
      bdD.appendChild(tr);
    }
  }
  const bdM = $("#table-bandao-month tbody");
  if (bdM) {
    bdM.innerHTML = "";
    for (const r of state.reportBanDao.byMonth ?? []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.thang)}</td><td>${fmtMoney(r.tong)}</td>`;
      bdM.appendChild(tr);
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function onDelRow(ev) {
  const btn = ev.currentTarget;
  const kind = btn.dataset.del;
  const i = Number(btn.dataset.i);
  if (kind === "coc") state.coc.splice(i, 1);
  if (kind === "cong_no") state.congNo.splice(i, 1);
  if (kind === "coc") renderCoc();
  if (kind === "cong_no") renderCongNo();
  refreshComputedFromClient();
}

function addRow(kind) {
  if (kind === "coc") {
    state.coc.push({ ngay: "", thu: "", chi: "", ghiChu: "" });
    renderCoc();
  }
  refreshComputedFromClient();
}

function applyPayload(data) {
  state.tongQuan = data.tongQuan ?? state.tongQuan;
  state.docTongQuan = data.docTongQuan ?? null;
  state.thuChi = (data.thuChi ?? []).map(rowThuChi);
  state.coc = (data.coc ?? []).map(rowCoc);
  state.congNo = (data.congNo ?? []).map(rowCongNo);
  state.banDao = (data.banDao ?? []).map(rowBanDao);
  state.computed = data.computed ?? null;
  state.report = data.report ?? { byDay: [], byMonth: [] };
  state.reportBanDao = data.reportBanDao ?? { byDay: [], byMonth: [] };

  $("#tq-a2").value = state.tongQuan.a2 ?? "";
  $("#tq-b2").value = state.tongQuan.b2 ? String(state.tongQuan.b2) : "";
  $("#tq-c2").value = state.tongQuan.c2 ? String(state.tongQuan.c2) : "";
  $("#tq-d2").value = state.tongQuan.d2 ? String(state.tongQuan.d2) : "";
  $("#tq-e2").value = state.tongQuan.e2 ? String(state.tongQuan.e2) : "";

  if (!state.coc.length) state.coc.push({ ngay: "", thu: "", chi: "", ghiChu: "" });
  if (!state.congNo.length) state.congNo.push({ ten: "", tienNo: "" });

  renderThuChi();
  renderCoc();
  renderCongNo();
  refreshComputedFromClient();
  if (data.report) {
    renderReport();
  }
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
    const err = new Error(json?.error || res.statusText);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
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

function setStatus(msg, kind) {
  const el = $("#save-status");
  el.textContent = msg || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

async function saveSheet() {
  setStatus("Đang lưu…", null);
  const body = {
    tongQuan: { a2: $("#tq-a2").value },
    skipThuChi: true,
    coc: state.coc.filter((r) => (r.ngay || r.thu || r.chi || r.ghiChu).trim()),
  };
  try {
    await api("/api/sheet", { method: "POST", body: JSON.stringify(body) });
    const latest = await api("/api/sheet", { method: "GET" });
    applyPayload(latest);
    setStatus("Đã đồng bộ lên Google Sheet.", "ok");
  } catch (e) {
    setStatus(e.message || "Lưu thất bại.", "err");
  }
}

function bindOverviewInput() {
  $("#tq-a2").addEventListener("input", refreshComputedFromClient);
  $("#tq-a2").addEventListener("change", refreshComputedFromClient);
}

async function main() {
  bindTabs();
  activateTab("tong_quan");
  bindOverviewInput();
  setRevealed(isRevealed());

  $("#btn-reveal-balance").addEventListener("click", async () => {
    const p = prompt("Nhập mật khẩu để hiện Số dư đầu:");
    if (!p) return;
    try {
      await api("/api/reveal-balance", { method: "POST", body: JSON.stringify({ password: p }) });
      setRevealed(true);
    } catch (e) {
      alert(e.body?.error || e.message || "Sai mật khẩu.");
    }
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

  $("#btn-save").addEventListener("click", saveSheet);

  document.querySelectorAll("[data-add-row]").forEach((b) => {
    b.addEventListener("click", () => addRow(b.dataset.addRow));
  });

  try {
    const ok = await tryLoadSession();
    if (!ok) setView(false);
  } catch (e) {
    setView(false);
    $("#login-error").textContent =
      "Không tải được dữ liệu. Kiểm tra biến môi trường / quyền service account.";
    $("#login-error").hidden = false;
  }
}

main();
