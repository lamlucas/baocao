const $ = (sel, root = document) => root.querySelector(sel);

function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("vi-VN").format(n);
}

const state = {
  tongQuan: { a2: "", b2: "", c2: "", d2: "" },
  docTongQuan: null,
  thuChi: [],
  coc: [],
  congNo: [],
  computed: null,
  report: { byDay: [], byMonth: [] },
};

function rowThuChi(r) {
  return { ngay: r.ngay ?? "", thu: r.thu ?? "", chi: r.chi ?? "" };
}
function rowCoc(r) {
  return { ngay: r.ngay ?? "", thu: r.thu ?? "", chi: r.chi ?? "", ghiChu: r.ghiChu ?? "" };
}
function rowCongNo(r) {
  return { ten: r.ten ?? "", tienNo: r.tienNo ?? "" };
}

function setView(loggedIn) {
  $("#view-login").hidden = loggedIn;
  $("#view-app").hidden = !loggedIn;
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

function renderThuChi() {
  const tb = tbody("table-thu-chi");
  tb.innerHTML = "";
  state.thuChi.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="input" data-k="ngay" data-i="${i}" type="text" placeholder="VD: 2026-05-07" value="${escapeAttr(r.ngay)}" /></td>
      <td><input class="input" data-k="thu" data-i="${i}" type="text" inputmode="decimal" value="${escapeAttr(r.thu)}" /></td>
      <td><input class="input" data-k="chi" data-i="${i}" type="text" inputmode="decimal" value="${escapeAttr(r.chi)}" /></td>
      <td><button type="button" class="btn icon" data-del="thu_chi" data-i="${i}" title="Xóa dòng">✕</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("change", onThuChiChange);
    inp.addEventListener("input", onThuChiChange);
  });
  tb.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", onDelRow));
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
  tb.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", onDelRow));
}

function renderCongNo() {
  const tb = tbody("table-cong-no");
  tb.innerHTML = "";
  state.congNo.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="input" data-k="ten" data-i="${i}" type="text" value="${escapeAttr(r.ten)}" /></td>
      <td><input class="input" data-k="tienNo" data-i="${i}" type="text" inputmode="decimal" value="${escapeAttr(r.tienNo)}" /></td>
      <td><button type="button" class="btn icon" data-del="cong_no" data-i="${i}">✕</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("change", onCongNoChange);
    inp.addEventListener("input", onCongNoChange);
  });
  tb.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", onDelRow));
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function onThuChiChange(ev) {
  const inp = ev.target;
  const i = Number(inp.dataset.i);
  const k = inp.dataset.k;
  if (!state.thuChi[i]) return;
  state.thuChi[i][k] = inp.value;
  refreshComputedFromClient();
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
  let t = String(s).trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(t)) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    t = t.replace(/,/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
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
  valEl.textContent = `${fmtNum(n)} đồng`;
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

function refreshComputedFromClient() {
  const duDau = parseNumClient($("#tq-a2").value);
  const { thu: lastThu, chi: lastChi } = latestThuChiValues(state.thuChi);
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
  $("#tq-b2").value = fmtNum(sumCocB);
  $("#tq-c2").value = fmtNum(sumCocC);
  $("#tq-d2").value = fmtNum(sumNo);
  state.computed = {
    tongCoc: sumCocB,
    nhanCoc: sumCocC,
    tongCongNo: sumNo,
    soDuSauThuChi: duDau + lastThu - lastChi,
    duDauNhap: duDau,
  };
  buildReportFromState();
  renderReport();
  capNhatHienThiSoDuDauDoc();
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
  $("#rep-sodu").textContent = c ? fmtNum(c.soDuSauThuChi) : "—";
  $("#rep-a2").textContent = c ? fmtNum(c.duDauNhap) : "—";
  $("#rep-b2").textContent = c ? fmtNum(c.tongCoc) : "—";
  $("#rep-c2").textContent = c ? fmtNum(c.nhanCoc) : "—";
  $("#rep-d2").textContent = c ? fmtNum(c.tongCongNo) : "—";

  const tbD = $("#table-report-day tbody");
  tbD.innerHTML = "";
  for (const r of state.report.byDay) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(r.date)}</td><td>${fmtNum(r.tongThu)}</td><td>${fmtNum(r.tongChi)}</td>`;
    tbD.appendChild(tr);
  }
  const tbM = $("#table-report-month tbody");
  tbM.innerHTML = "";
  for (const r of state.report.byMonth) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(r.thang)}</td><td>${fmtNum(r.tongThu)}</td><td>${fmtNum(r.tongChi)}</td>`;
    tbM.appendChild(tr);
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
  if (kind === "thu_chi") state.thuChi.splice(i, 1);
  if (kind === "coc") state.coc.splice(i, 1);
  if (kind === "cong_no") state.congNo.splice(i, 1);
  if (kind === "thu_chi") renderThuChi();
  if (kind === "coc") renderCoc();
  if (kind === "cong_no") renderCongNo();
  refreshComputedFromClient();
}

function addRow(kind) {
  if (kind === "thu_chi") {
    state.thuChi.push({ ngay: "", thu: "", chi: "" });
    renderThuChi();
  }
  if (kind === "coc") {
    state.coc.push({ ngay: "", thu: "", chi: "", ghiChu: "" });
    renderCoc();
  }
  if (kind === "cong_no") {
    state.congNo.push({ ten: "", tienNo: "" });
    renderCongNo();
  }
  refreshComputedFromClient();
}

function applyPayload(data) {
  state.tongQuan = data.tongQuan ?? state.tongQuan;
  state.docTongQuan = data.docTongQuan ?? null;
  state.thuChi = (data.thuChi ?? []).map(rowThuChi);
  state.coc = (data.coc ?? []).map(rowCoc);
  state.congNo = (data.congNo ?? []).map(rowCongNo);
  state.computed = data.computed ?? null;
  state.report = data.report ?? { byDay: [], byMonth: [] };

  $("#tq-a2").value = state.tongQuan.a2 ?? "";
  $("#tq-b2").value = state.tongQuan.b2 ?? "";
  $("#tq-c2").value = state.tongQuan.c2 ?? "";
  $("#tq-d2").value = state.tongQuan.d2 ?? "";

  if (!state.thuChi.length) state.thuChi.push({ ngay: "", thu: "", chi: "" });
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
    thuChi: state.thuChi.filter((r) => (r.ngay || r.thu || r.chi).trim()),
    coc: state.coc.filter((r) => (r.ngay || r.thu || r.chi || r.ghiChu).trim()),
    congNo: state.congNo.filter((r) => (r.ten || r.tienNo).trim()),
  };
  try {
    const out = await api("/api/sheet", { method: "POST", body: JSON.stringify(body) });
    state.tongQuan = { ...state.tongQuan, ...out.tongQuan };
    const a2Saved = $("#tq-a2").value;
    state.docTongQuan = {
      sheet: "TONG_QUAN",
      a2_soDuDau: { raw: a2Saved, so: parseNumClient(a2Saved) },
    };
    $("#tq-b2").value = out.tongQuan.b2;
    $("#tq-c2").value = out.tongQuan.c2;
    $("#tq-d2").value = out.tongQuan.d2;
    refreshComputedFromClient();
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
