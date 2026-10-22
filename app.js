/*
 * FunEarnEzz frontend.
 * API dilayani oleh Cloudflare Worker pada origin yang sama.
 * Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sebagai Worker secrets di Cloudflare,
 * bukan di file frontend ini. Jangan pernah mengirim service-role key ke browser.
 */

const $ = (selector) => document.querySelector(selector);
const state = { token: null, user: null, tasks: [], wallet: null, submissions: [], withdrawals: [], robux: [], view: "overview", authMode: "login", busy: false };
const labels = { overview: ["YOUR ACCOUNT", "Ringkasan akun"], tasks: ["DISCOVER TASKS", "Daftar tugas"], submissions: ["YOUR ACTIVITY", "Riwayat pengajuan"], withdraw: ["PAYOUT REQUEST", "Penarikan saldo"], robux: ["ROBUX REDEMPTION", "Tukar Robux"], admin: ["ADMINISTRATION", "Admin panel"] };
let toastTimer;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
}
function money(value, currency = "IDR") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  try { return new Intl.NumberFormat("id-ID", { style:"currency", currency, maximumFractionDigits: currency === "IDR" ? 0 : 2 }).format(number); }
  catch { return `${currency} ${number.toLocaleString("id-ID")}`; }
}
function notify(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
function setNotice(message = "", type = "info") {
  const el = $("#notice");
  if (!message) { el.className = "notice hidden"; el.textContent = ""; return; }
  el.className = `notice ${type}`; el.textContent = message;
}
function setConnection(kind, text) {
  const el = $(".connection"); el.classList.remove("online", "offline");
  if (kind === "online") el.classList.add("online");
  if (kind === "offline") el.classList.add("offline");
  $("#connectionText").textContent = text;
  $("#apiSummary").textContent = kind === "online" ? "Backend siap" : kind === "offline" ? "Belum tersedia" : "Frontend siap";
  $("#apiSummaryHint").textContent = kind === "online" ? "Health check backend berhasil" : kind === "offline" ? "Backend belum dikonfigurasi" : "Supabase disambungkan setelah desain disetujui";
}
function getToken() { return state.token || sessionStorage.getItem("fe_token"); }
function saveToken(token) { state.token = token; if (token) sessionStorage.setItem("fe_token", token); else sessionStorage.removeItem("fe_token"); }
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}

function getMessage(error) {
  if (error instanceof TypeError) return "Gagal menghubungi API. Periksa HTTPS, URL backend, koneksi server, dan konfigurasi CORS.";
  return error?.message || "Terjadi kesalahan yang tidak diketahui.";
}
function statusLabel(status) {
  const value = String(status || "pending").toLowerCase();
  if (["approved","accepted","success","completed"].includes(value)) return ["approved","Disetujui"];
  if (["rejected","declined","failed"].includes(value)) return ["rejected","Ditolak"];
  return ["pending","Menunggu"];
}
function emptyState(icon, title, description, action = "") {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h4>${escapeHTML(title)}</h4><p>${escapeHTML(description)}</p>${action}</div>`;
}
function requireLogin() {
  if (state.user) return true;
  renderView("overview");
  setNotice("Masuk ke akun untuk memuat data dashboard.", "info");
  openAuth("login");
  return false;
}
function renderProfile() {
  const user = state.user;
  $("#profileName").textContent = user ? (user.username || user.name || user.email || "Member") : "Guest";
  $("#profileEmail").textContent = user ? (user.email || `@${user.username || "member"}`) : "Masuk untuk melanjutkan";
  $("#profileAvatar").textContent = user ? String(user.username || user.name || "FE").slice(0,2).toUpperCase() : "?";
  $("#sessionBadge").textContent = user ? "SUDAH MASUK" : "BELUM MASUK";
  $("#logoutButton").classList.toggle("hidden", !user);
  $("#adminNav").classList.toggle("hidden", user?.role !== "admin");
}
function renderOverview() {
  const wallet = state.wallet || {};
  const amount = wallet.availableBalance ?? wallet.available_balance ?? wallet.balance ?? wallet.available ?? null;
  const count = state.submissions.length;
  $("#viewContent").innerHTML = `
    <div class="welcome-panel"><div class="welcome-art">✦</div><div><h4>Halo, ${escapeHTML(state.user?.username || state.user?.name || "Member")}!</h4><p>Data akun di bawah dimuat dari backend. Nilai saldo tidak dihitung atau disimpan di browser.</p></div></div>
    <div class="summary-grid">
      <div class="summary-box"><span>Saldo tersedia</span><b>${amount === null ? "—" : escapeHTML(money(amount, wallet.currency || "IDR"))}</b><small>Data dari endpoint wallet</small></div>
      <div class="summary-box"><span>Pengajuan dimuat</span><b>${count}</b><small>Jumlah data pada riwayat yang dimuat</small></div>
      <div class="summary-box"><span>Tugas tersedia</span><b>${state.tasks.length}</b><small>Data dari endpoint tasks</small></div>
    </div>
    <div class="inline-actions"><button class="button button-primary" data-goto="tasks">Jelajahi tugas →</button><button class="button button-outline" data-goto="submissions">Lihat riwayat</button></div>`;
}
function renderTasks() {
  const tasks = state.tasks;
  if (!tasks.length) {
    $("#viewContent").innerHTML = emptyState("✧", "Belum ada tugas untuk ditampilkan", "Server belum mengirim daftar tugas, atau memang belum ada tugas aktif. Coba segarkan beberapa saat lagi.");
    return;
  }
  $("#viewContent").innerHTML = `<div class="stack">${tasks.map(task => {
    const id = task.id ?? task.taskId ?? task.task_id;
    const title = task.title || task.name || "Tugas";
    const desc = task.description || task.instructions || task.instruction || "Tidak ada deskripsi.";
    const reward = task.reward ?? task.amount ?? task.rewardAmount ?? task.reward_amount;
    return `<article class="data-card"><div class="data-card-head"><div><h4>${escapeHTML(title)}</h4><p>${escapeHTML(desc)}</p></div><span class="status approved">${reward == null ? "Reward —" : escapeHTML(money(reward, task.currency || "IDR"))}</span></div><div class="meta-row"><span class="tag">${escapeHTML(task.category || "Umum")}</span><span class="tag">ID: ${escapeHTML(id ?? "—")}</span></div><div class="inline-actions"><button class="button button-primary" data-submit-task="${escapeHTML(id ?? "")}" ${id == null ? "disabled" : ""}>Kirim bukti →</button></div></article>`;
  }).join("")}</div>`;
}
function renderSubmissions() {
  const rows = [
    ...state.submissions.map(row => ({ ...row, _kind: "Tugas" })),
    ...state.withdrawals.map(row => ({ ...row, _kind: "Penarikan" })),
    ...state.robux.map(row => ({ ...row, _kind: "Robux" })),
  ].sort((a,b) => String(b.created_at||"").localeCompare(String(a.created_at||"")));
  if (!rows.length) {
    $("#viewContent").innerHTML = emptyState("◷", "Belum ada aktivitas", "Pengajuan tugas, penarikan, dan penukaran Robux akan tampil di sini.");
    return;
  }
  $("#viewContent").innerHTML = `<div class="stack">${rows.map(row => {
    const [statusClass, statusText] = statusLabel(row.status);
    const title = row._kind === "Tugas"
      ? (row.taskTitle || row.task_title || row.title || `Pengajuan tugas #${row.id ?? "—"}`)
      : row._kind === "Penarikan"
        ? `Penarikan ${money(row.amount)} · ${row.method || "Metode"}`
        : `Penukaran ${escapeHTML(row.robux ?? "")} Robux`;
    const detail = row._kind === "Tugas" ? (row.note || "Tidak ada catatan.")
      : row._kind === "Penarikan" ? (row.destination ? `Tujuan: ${row.destination}` : "Permintaan penarikan saldo")
      : (row.username ? `Username Roblox: ${row.username}` : "Permintaan penukaran Robux");
    return `<article class="data-card"><div class="data-card-head"><div><span class="tag">${row._kind}</span><h4>${escapeHTML(title)}</h4><p>${escapeHTML(detail)}</p></div><span class="status ${statusClass}">${statusText}</span></div><div class="meta-row"><span class="tag">ID: ${escapeHTML(row.id ?? "—")}</span><span class="tag">${escapeHTML(row.created_at || row.date || "Tanggal tidak tersedia")}</span></div>${row.review_note ? `<p style="margin-top:10px">Catatan pemeriksa: ${escapeHTML(row.review_note)}</p>` : ""}${row._kind === "Tugas" && row.proof_url ? `<div class="inline-actions"><button class="button button-outline" data-proof-id="${escapeHTML(row.id)}">Lihat bukti</button></div>` : ""}</article>`;
  }).join("")}</div>`;
}
function renderWithdraw() {
  $("#viewContent").innerHTML = `<p style="color:#9ba4c0;font-size:11px;line-height:1.7;margin-top:18px">Ajukan penarikan menggunakan saldo yang diverifikasi server. Pastikan tujuan benar. Nilai minimum, biaya, dan aturan penarikan tetap ditentukan backend.</p>
    <form id="withdrawForm" class="form-grid">
      <label class="field">Metode penarikan<select name="method" required><option value="DANA">DANA</option><option value="Robux">Robux</option></select></label>
      <label class="field">Jumlah<input name="amount" type="number" min="1" step="1" inputmode="numeric" required placeholder="Masukkan jumlah"><span class="field-hint">Jumlah akan divalidasi kembali oleh server. Jangan mengandalkan angka di browser.</span></label>
      <label class="field">Tujuan penarikan<input name="destination" required maxlength="160" placeholder="Nomor DANA atau username Roblox"><span class="field-hint">Jangan isi password atau kode OTP akun.</span></label>
      <div id="withdrawError" class="form-error hidden" role="alert"></div>
      <button class="button button-primary" type="submit">Kirim pengajuan penarikan →</button>
    </form>`;
}
function renderView(view) {
  state.view = view in labels ? view : "overview";
  if (state.view === "admin" && state.user?.role !== "admin") {
    state.view = "overview";
    setNotice("Menu admin hanya tersedia untuk akun admin.", "error");
    view = "overview";
  }
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
  $("#viewKicker").textContent = labels[state.view][0];
  $("#viewTitle").textContent = labels[state.view][1];
  if (view !== "admin") setNotice("");
  if (state.view !== "overview" && !requireLogin()) return;
  if (state.view === "overview") state.user ? renderOverview() : $("#viewContent").innerHTML = `<div class="welcome-panel"><div class="welcome-art">✦</div><div><h4>Selamat datang di FunEarnEzz</h4><p>Masuk atau buat akun untuk memuat saldo, tugas, dan riwayatmu dari backend.</p><div class="inline-actions"><button class="button button-primary" id="contentLogin">Masuk</button><button class="button button-outline" id="contentRegister">Buat akun</button></div></div></div><div class="summary-grid"><div class="summary-box"><span>Saldo tersedia</span><b>—</b><small>Memerlukan login</small></div><div class="summary-box"><span>Pengajuan tugas</span><b>—</b><small>Memerlukan login</small></div><div class="summary-box"><span>Status API</span><b id="apiSummary">${"Memeriksa…"}</b><small id="apiSummaryHint">${"Memakai Cloudflare Worker pada origin yang sama"}</small></div></div>`;
  else if (state.view === "tasks") renderTasks();
  else if (state.view === "submissions") renderSubmissions();
  else if (state.view === "withdraw") renderWithdraw();
  else if (state.view === "robux") renderRobux();
  else if (state.view === "admin") renderAdmin();
}
function openAuth(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  const registering = state.authMode === "register";
  $("#authEyebrow").textContent = registering ? "JOIN FUNEARNEZZ" : "WELCOME BACK";
  $("#authTitle").textContent = registering ? "Buat akun baru" : "Masuk akun";
  $("#authSubtitle").textContent = registering ? "Daftar untuk mulai menggunakan dashboard reward." : "Lanjutkan aktivitas reward kamu.";
  $("#nameField").classList.add("hidden");
  $("#authName").required = false;
  $("#authIdentity").placeholder = "Masukkan username";
  $("#confirmPasswordField").classList.toggle("hidden", !registering);
  $("#authConfirmPassword").required = registering;
  $("#authIdentity").value = ""; $("#authPassword").value = ""; $("#authConfirmPassword").value = "";
  $("#authPassword").autocomplete = registering ? "new-password" : "current-password";
  $("#authSubmit").innerHTML = registering ? "Buat akun <span>→</span>" : "Masuk <span>→</span>";
  $("#authSwitchText").innerHTML = registering ? 'Sudah punya akun? <button type="button" id="switchAuth">Masuk</button>' : 'Belum punya akun? <button type="button" id="switchAuth">Daftar gratis</button>';
  $("#authError").classList.add("hidden");
  if (!$("#authDialog").open) $("#authDialog").showModal();
}
function closeAuth() { if ($("#authDialog").open) $("#authDialog").close(); }
async function checkHealth() {
  try {
    const health = await api("/api/health");
    if (health.databaseConfigured) setConnection("online", "Backend siap");
    else setConnection("ready", "Frontend siap · Supabase nanti");
  } catch (error) {
    // Desain frontend tetap bisa diuji meski backend belum disiapkan.
    setConnection("ready", "Frontend siap · backend nanti");
    console.info("Backend belum dikonfigurasi:", getMessage(error));
  }
}
async function parseList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
async function loadDashboard() {
  if (!state.user) { renderProfile(); renderView("overview"); return; }
  setNotice("Memuat data akun dari server…", "info");
  try {
    const [me, tasks, submissions, wallet] = await Promise.all([
      api("/api/me"),
      api("/api/jobs"),
      api("/api/history"),
      api("/api/wallet")
    ]);
    state.user = me.user || me;
    state.tasks = await parseList(tasks, ["tasks","data","items"]);
    state.submissions = await parseList(submissions, ["submissions","data","items"]);
    state.withdrawals = await parseList(submissions, ["withdrawals"]);
    state.robux = await parseList(submissions, ["robux"]);
    state.wallet = wallet.wallet || wallet.data || wallet;
    renderProfile(); renderView(state.view); setNotice("Data akun berhasil dimuat dari backend.", "success");
  } catch (error) {
    const message = getMessage(error);
    if (/401|403|unauthor|token|login|auth/i.test(message)) {
      saveToken(null); state.user = null; renderProfile(); renderView("overview");
      setNotice("Sesi tidak valid atau sudah berakhir. Silakan masuk kembali.", "error");
    } else setNotice(`Gagal memuat data: ${message}`, "error");
  }
}
async function onAuthSubmit(event) {
  event.preventDefault();
  if (state.busy) return;
  const registering = state.authMode === "register";
  const identity = $("#authIdentity").value.trim();
  const password = $("#authPassword").value;
  const username = identity;
  const errorBox = $("#authError");
  errorBox.classList.add("hidden");
  if (registering && password !== $("#authConfirmPassword").value) { errorBox.textContent = "Konfirmasi password tidak cocok."; errorBox.classList.remove("hidden"); return; }
  if (!/^[A-Za-z0-9_]{3,24}$/.test(identity)) { errorBox.textContent = "Username harus 3–24 karakter (huruf, angka, underscore)."; errorBox.classList.remove("hidden"); return; }
  
  state.busy = true; const submit = $("#authSubmit"); submit.disabled = true; submit.textContent = "Memproses…";
  try {
    const payload = { username, password };
    const result = await api(registering ? "/api/auth/register" : "/api/auth/login", { method:"POST", body:JSON.stringify(payload) });
    // Cookie sesi dikelola server sebagai HttpOnly dan tidak disimpan di JavaScript.
    saveToken(null);
    if (registering) {
      closeAuth(); $("#authForm").reset();
      notify("Akun berhasil dibuat. Silakan masuk.");
      openAuth("login");
      return;
    }
    if (!result.user) throw new Error("Respons login tidak menyertakan data akun.");
    state.user = result.user;
    document.body.classList.add("authenticated");
    closeAuth(); $("#authForm").reset(); notify(registering ? "Pendaftaran berhasil." : "Login berhasil.");
    await loadDashboard();
    $("#workspace").scrollIntoView({ behavior:"smooth", block:"start" });
  } catch (error) {
    errorBox.textContent = getMessage(error); errorBox.classList.remove("hidden");
  } finally {
    state.busy = false; submit.disabled = false; submit.innerHTML = registering ? "Buat akun <span>→</span>" : "Masuk <span>→</span>";
  }
}
async function submitProof(taskId) {
  if (!requireLogin()) return;
  const task = state.tasks.find(item => String(item.id ?? item.taskId ?? item.task_id) === String(taskId));
  if (!task) { notify("Tugas tidak ditemukan. Segarkan daftar tugas."); return; }
  const existing = $("#proofDialog");
  if (existing) existing.remove();
  const dialog = document.createElement("dialog"); dialog.id = "proofDialog"; dialog.className = "modal";
  dialog.innerHTML = `<form id="proofForm" class="modal-card"><button type="button" class="modal-close" id="closeProof" aria-label="Tutup">×</button><div class="modal-logo">F<span>+</span></div><div class="eyebrow">TASK SUBMISSION</div><h2>Kirim bukti tugas</h2><p>${escapeHTML(task.title || task.name || "Tugas")}</p><label class="field">Gambar bukti<input name="proof" type="file" accept="image/*" required><span class="field-hint">Maksimum dan jenis file harus mengikuti batas backend.</span></label><label class="field">Catatan (opsional)<textarea name="note" maxlength="1000" placeholder="Tambahkan penjelasan singkat"></textarea></label><div id="proofError" class="form-error hidden" role="alert"></div><button class="button button-primary button-large full-width" type="submit">Kirim untuk diperiksa →</button></form>`;
  document.body.appendChild(dialog); dialog.showModal();
  $("#closeProof").onclick = () => dialog.close();
  $("#proofForm").onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, file = form.elements.proof.files[0], err = $("#proofError"), button = form.querySelector('button[type="submit"]');
    err.classList.add("hidden");
    if (!file || !file.type.startsWith("image/")) { err.textContent = "Pilih file gambar yang valid."; err.classList.remove("hidden"); return; }
    const body = new FormData(); body.append("taskId", String(taskId)); body.append("note", form.elements.note.value.trim()); body.append("proof", file);
    button.disabled = true; button.textContent = "Mengirim…";
    try {
      await api(`/api/jobs/${encodeURIComponent(taskId)}/submit`, { method:"POST", body });
      dialog.close(); notify("Bukti berhasil dikirim untuk diperiksa."); await loadDashboard(); renderView("submissions");
    } catch (error) { err.textContent = getMessage(error); err.classList.remove("hidden"); }
    finally { button.disabled = false; button.textContent = "Kirim untuk diperiksa →"; }
  };
}
async function submitWithdrawal(event) {
  event.preventDefault();
  if (!requireLogin()) return;
  const form = event.currentTarget, err = $("#withdrawError"), button = form.querySelector('button[type="submit"]');
  err.classList.add("hidden");
  const amount = Number(form.elements.amount.value), destination = form.elements.destination.value.trim(), method = form.elements.method.value;
  if (!Number.isFinite(amount) || amount <= 0 || !destination) { err.textContent = "Masukkan jumlah dan tujuan yang valid."; err.classList.remove("hidden"); return; }
  button.disabled = true; button.textContent = "Mengirim…";
  try {
    await api("/api/withdrawals", { method:"POST", body:JSON.stringify({ method, amount, destination }) });
    notify("Pengajuan penarikan dikirim."); await loadDashboard(); renderView("submissions");
  } catch (error) { err.textContent = getMessage(error); err.classList.remove("hidden"); }
  finally { button.disabled = false; button.textContent = "Kirim pengajuan penarikan →"; }
}
async function logout() {
  try { if (state.user) await api("/api/auth/logout", { method:"POST" }); }
  catch (error) { console.warn("Logout server:", getMessage(error)); }
  saveToken(null); state.user = null; document.body.classList.remove("authenticated"); state.tasks = []; state.wallet = null; state.submissions = []; state.withdrawals = []; state.robux = [];
  renderProfile(); renderView("overview"); notify("Sesi lokal sudah diakhiri.");
}
async function restoreSession() {
  try {
    const result = await api("/api/me");
    state.user = result.user || null;
    if (state.user) { document.body.classList.add("authenticated"); await loadDashboard(); $("#workspace").scrollIntoView({ behavior:"auto", block:"start" }); }
    else { document.body.classList.remove("authenticated"); renderProfile(); renderView("overview"); }
  } catch {
    saveToken(null);
    state.user = null;
    document.body.classList.remove("authenticated");
    renderProfile();
    renderView("overview");
  }
}
document.addEventListener("click", event => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.id === "openLogin" || target.id === "heroLogin" || target.id === "contentLogin") openAuth("login");
  if (target.id === "openRegister" || target.id === "heroRegister" || target.id === "contentRegister") openAuth("register");
  if (target.id === "closeAuth") closeAuth();
  if (target.id === "switchAuth") openAuth(state.authMode === "login" ? "register" : "login");
  if (target.dataset.view) { renderView(target.dataset.view); $("#workspace").scrollIntoView({ behavior:"smooth", block:"start" }); }
  if (target.dataset.goto) { renderView(target.dataset.goto); $("#workspace").scrollIntoView({ behavior:"smooth", block:"start" }); }
  if (target.dataset.submitTask) submitProof(target.dataset.submitTask);
  if (target.id === "refreshButton") { checkHealth(); if (state.user) loadDashboard(); else notify("Health check dimulai."); }
  if (target.id === "logoutButton") logout();
});
$("#authForm").addEventListener("submit", onAuthSubmit);
$("#authDialog").addEventListener("click", event => { if (event.target === $("#authDialog")) closeAuth(); });
document.addEventListener("submit", event => { if (event.target.id === "withdrawForm") submitWithdrawal(event); });
$("#year").textContent = new Date().getFullYear();
renderProfile(); renderView("overview"); checkHealth(); restoreSession();
