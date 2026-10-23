/*
 * FunEarnEzz frontend.
 * API dilayani oleh Cloudflare Worker pada origin yang sama.
 * Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sebagai Worker secrets di Cloudflare,
 * bukan di file frontend ini. Jangan pernah mengirim service-role key ke browser.
 */

const $ = (selector) => document.querySelector(selector);
const state = { token: null, user: null, tasks: [], wallet: null, submissions: [], withdrawals: [], robux: [], maintenance: null, maintenanceDismissedKey: "", view: "overview", authMode: "login", busy: false };
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
function showSuccessModal(message) {
  let dialog = $("#successDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "successDialog";
    dialog.style.cssText = "border:1px solid #35405d;border-radius:18px;background:#11182b;color:#fff;padding:28px;max-width:90vw;text-align:center";
    dialog.innerHTML = '<h3>Berhasil</h3><p id="successDialogMessage"></p><button id="successDialogOk" class="button button-primary" type="button">OK</button>';
    document.body.appendChild(dialog);
    dialog.addEventListener("click", e => { if (e.target === dialog || e.target.id === "successDialogOk") dialog.close(); });
  }
  $("#successDialogMessage").textContent = message;
  if (!dialog.open) dialog.showModal();
  clearTimeout(dialog._autoCloseTimer);
  dialog._autoCloseTimer = setTimeout(() => { if (dialog.open) dialog.close(); }, 3000);
}
function localDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
function formatMaintenanceTime(value) {
  if (!value) return "Belum ditentukan";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("id-ID", {dateStyle:"medium",timeStyle:"short"})
    : String(value);
}
function showMaintenanceModal(status) {
  let dialog = $("#maintenanceDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "maintenanceDialog";
    dialog.style.cssText = "border:1px solid #35405d;border-radius:18px;background:#11182b;color:#fff;padding:26px;max-width:min(92vw,460px);text-align:center";
    dialog.innerHTML = '<div style="font-size:34px" aria-hidden="true">🛠️</div><h2 style="margin:10px 0">Website sedang maintenance</h2><p id="maintenanceReason" style="line-height:1.6"></p><p style="font-size:13px;color:#abb4cf">Perkiraan dibuka kembali: <span id="maintenanceReopenAt"></span></p><button id="maintenanceOk" class="button button-primary" type="button">Mengerti</button>';
    document.body.appendChild(dialog);
    const dismiss = () => {
      state.maintenanceDismissedKey = [state.maintenance?.reason || "", state.maintenance?.reopenAt || ""].join("|");
      if (dialog.open) dialog.close();
    };
    dialog.addEventListener("click", event => {
      if (event.target === dialog || event.target.id === "maintenanceOk") dismiss();
    });
    dialog.addEventListener("cancel", dismiss);
  }
  $("#maintenanceReason").textContent = status.reason || "Sistem sedang dalam pemeliharaan.";
  $("#maintenanceReopenAt").textContent = formatMaintenanceTime(status.reopenAt);
  if (!dialog.open) dialog.showModal();
}
async function checkMaintenance(force = false) {
  try {
    const status = await api("/api/maintenance");
    state.maintenance = status;
    const key = [status.reason || "", status.reopenAt || ""].join("|");
    const dialog = $("#maintenanceDialog");
    if (!status.enabled) {
      if (dialog?.open) dialog.close();
      state.maintenanceDismissedKey = "";
      return;
    }
    if (force || state.maintenanceDismissedKey !== key) showMaintenanceModal(status);
  } catch (error) {
    console.warn("Gagal memeriksa status maintenance:", getMessage(error));
  }
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
  let response;
  try {
    response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  } catch (cause) {
    const error = new Error(`Koneksi API gagal pada ${path}. Pastikan situs dibuka dari domain Cloudflare Worker yang benar dan deployment API aktif. Detail browser: ${cause?.message || "request diblokir"}`);
    error.name = "ApiNetworkError";
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request gagal (${response.status}) pada ${path}`);
  return data;
}

function getMessage(error) {
  return error?.message || "Terjadi kesalahan yang tidak diketahui.";
}
function statusLabel(status) {
  const value = String(status || "pending").toLowerCase();
  if (["approved","accepted","success","completed","paid"].includes(value)) return ["approved","Disetujui"];
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
      <label class="field">Metode penarikan<select name="method" required><option value="DANA">DANA</option></select><span class="field-hint">Penukaran Robux tersedia di menu Tukar Robux agar masuk ke antrean Robux admin.</span></label>
      <label class="field">Jumlah<input name="amount" type="number" min="1" step="1" inputmode="numeric" required placeholder="Masukkan jumlah"><span class="field-hint">Jumlah akan divalidasi kembali oleh server. Jangan mengandalkan angka di browser.</span></label>
      <label class="field">Nomor/tujuan DANA<input name="destination" required maxlength="160" placeholder="Nomor DANA"><span class="field-hint">Jangan isi password atau kode OTP akun.</span></label>
      <div id="withdrawError" class="form-error hidden" role="alert"></div>
      <button class="button button-primary" type="submit">Kirim pengajuan penarikan →</button>
    </form>`;
}

function renderRobux() {
  $("#viewContent").innerHTML = `<p style="color:#9ba4c0;font-size:11px;line-height:1.7;margin-top:18px">Pilih metode penukaran dan isi data yang diperlukan. Tarif dan potongan saldo dihitung dan divalidasi oleh server. Saldo yang ditahan akan dikembalikan jika permintaan ditolak.</p>
    <form id="robuxForm" class="form-grid">
      <label class="field">Metode penukaran<select name="method" id="robuxMethod" required><option value="gamepass">Game Pass</option><option value="username">Via Username</option></select></label>
      <label class="field">Jumlah Robux<input name="robux" type="number" min="10" step="1" inputmode="numeric" required placeholder="Minimal sesuai aturan server"></label>
      <label class="field">Username Roblox<input name="username" required maxlength="100" placeholder="Username Roblox"></label>
      <label class="field" id="robuxGamepassField">Link Game Pass<input name="gamepassUrl" type="url" maxlength="500" placeholder="https://www.roblox.com/..."><span class="field-hint">Wajib untuk metode Game Pass; jangan bagikan password atau OTP.</span></label>
      <div id="robuxError" class="form-error hidden" role="alert"></div>
      <button class="button button-primary" type="submit">Ajukan penukaran →</button>
    </form>`;
  const method = $("#robuxMethod"), urlField = $("#robuxGamepassField"), urlInput = $("#robuxForm").elements.gamepassUrl;
  const update = () => { const gamepass = method.value === "gamepass"; urlField.classList.toggle("hidden", !gamepass); urlInput.required = gamepass; };
  method.addEventListener("change", update); update();
}
function adminReviewCard(item, type, title, detail, primaryStatus, primaryLabel) {
  const status = String(item.status || "pending");
  const buttons = status === "pending" ? `<div class="inline-actions"><button class="button button-primary" data-admin-review="${type}" data-record-id="${escapeHTML(item.id)}" data-review-status="${primaryStatus}">${primaryLabel}</button><button class="button button-outline" data-admin-review="${type}" data-record-id="${escapeHTML(item.id)}" data-review-status="rejected">Tolak</button></div>` : "";
  const [statusClass, statusText] = statusLabel(status);
  return `<article class="data-card"><div class="data-card-head"><div><h4>${escapeHTML(title)}</h4><p>${escapeHTML(detail)}</p></div><span class="status ${statusClass}">${escapeHTML(statusText)}</span></div><div class="meta-row"><span class="tag">ID: ${escapeHTML(item.id)}</span><span class="tag">${escapeHTML(item.created_at || "Tanggal tidak tersedia")}</span></div>${item.review_note ? `<p>Catatan: ${escapeHTML(item.review_note)}</p>` : ""}${buttons}</article>`;
}
async function renderAdmin() {
  if (state.user?.role !== "admin") { $("#viewContent").innerHTML = emptyState("⚿", "Akses admin ditolak", "Halaman ini hanya tersedia untuk akun dengan role admin."); return; }
  $("#viewContent").innerHTML = emptyState("◷", "Memuat panel admin", "Mengambil ringkasan, pengguna, tugas, dan antrean pengajuan.");
  try {
    const [overview, jobs, users, submissions, withdrawals, robux, settings] = await Promise.all([
      api("/api/admin/overview"), api("/api/admin/jobs"), api("/api/admin/users"),
      api("/api/admin/submissions"), api("/api/admin/withdrawals"), api("/api/admin/robux"),
      api("/api/admin/settings")
    ]);
    const cfg = Object.fromEntries((Array.isArray(settings) ? settings : []).map(row => [row.key, row.value]));
    const reviewSubmissionCards = (Array.isArray(submissions) ? submissions : []).map(item =>
      adminReviewCard(item, "submissions", `Pengajuan tugas #${item.id}`, `User: ${item.user_id} · Tugas: ${item.job_id} · ${item.note || "Tanpa catatan"}`, "approved", "Setujui & beri reward")
      .replace("</article>", `${item.proof_url ? `<div class="inline-actions"><button class="button button-outline" data-proof-id="${escapeHTML(item.id)}">Lihat bukti</button></div>` : ""}</article>`));
    const withdrawalCards = (Array.isArray(withdrawals) ? withdrawals : []).map(item =>
      adminReviewCard(item, "withdrawals", `Penarikan ${money(item.amount)}`, `User: ${item.user_id} · Metode: ${item.method} · Tujuan: ${item.destination}`, "paid", "Tandai dibayar"));
    const robuxCards = (Array.isArray(robux) ? robux : []).map(item =>
      adminReviewCard(item, "robux", `Permintaan ${item.robux} Robux`, `User: ${item.user_id} · Username: ${item.username} · Metode: ${item.method} · Ditahan: ${money(item.cost)}`, "completed", "Tandai selesai"));
    const userCards = (Array.isArray(users) ? users : []).map(user => `<article class="data-card"><div class="data-card-head"><div><h4>${escapeHTML(user.username)}</h4><p>Role: ${escapeHTML(user.role)} · Saldo: ${escapeHTML(money(user.balance))} · Ditahan: ${escapeHTML(money(user.reserved_balance))}</p></div><span class="status ${user.disabled ? "rejected" : "approved"}">${user.disabled ? "Dinonaktifkan" : "Aktif"}</span></div><div class="inline-actions"><input aria-label="Nominal penyesuaian saldo" id="adjustAmount-${escapeHTML(user.id)}" type="number" step="1" placeholder="+/- saldo"><button class="button button-outline" data-user-adjust="${escapeHTML(user.id)}">Sesuaikan saldo</button><button class="button button-quiet" data-user-toggle="${escapeHTML(user.id)}" data-user-disabled="${!user.disabled}">${user.disabled ? "Aktifkan akun" : "Nonaktifkan akun"}</button></div></article>`).join("");
    const jobCards = (Array.isArray(jobs) ? jobs : []).map(job => `<article class="data-card"><div class="data-card-head"><div><h4>${escapeHTML(job.title)}</h4><p>${escapeHTML(job.description || "Tanpa deskripsi")}</p></div><span class="status ${job.status === "active" ? "approved" : "pending"}">${escapeHTML(job.status)}</span></div><div class="meta-row"><span class="tag">Reward: ${escapeHTML(money(job.reward))}</span><span class="tag">ID: ${escapeHTML(job.id)}</span></div></article>`).join("");
    $("#viewContent").innerHTML = `
      <div class="summary-grid">
        <div class="summary-box"><span>Pengguna</span><b>${Number(overview.users || 0)}</b><small>Total akun</small></div>
        <div class="summary-box"><span>Tugas</span><b>${Number(overview.jobs || 0)}</b><small>Total tugas</small></div>
        <div class="summary-box"><span>Antrean</span><b>${Number(overview.pending_submissions || 0) + Number(overview.pending_withdrawals || 0) + Number(overview.pending_robux || 0)}</b><small>Semua jenis pengajuan</small></div>
      </div>
      <h4>Tambah tugas</h4>
      <form id="adminJobForm" class="form-grid">
        <label class="field">Judul tugas<input name="title" maxlength="160" required></label>
        <label class="field">Deskripsi<textarea name="description" maxlength="4000" rows="3"></textarea></label>
        <label class="field">Reward (Rp)<input name="reward" type="number" min="0" step="1" required></label>
        <label class="field"><span><input name="photo_required" type="checkbox" style="width:auto;margin-right:8px">Wajib foto bukti</span></label>
        <div id="adminJobError" class="form-error hidden" role="alert"></div>
        <button class="button button-primary" type="submit">Buat tugas</button>
      </form>
      <h4>Tugas aktif & tersimpan</h4><div class="stack">${jobCards || emptyState("✧","Belum ada tugas","Buat tugas pertama melalui form di atas.")}</div>
      <h4>Pengajuan tugas</h4><div class="stack">${reviewSubmissionCards.join("") || emptyState("◷","Tidak ada pengajuan","Belum ada pengajuan tugas.")}</div>
      <h4>Penarikan saldo</h4><div class="stack">${withdrawalCards.join("") || emptyState("⇧","Tidak ada penarikan","Belum ada permintaan penarikan.")}</div>
      <h4>Penukaran Robux</h4><div class="stack">${robuxCards.join("") || emptyState("◇","Tidak ada permintaan Robux","Belum ada permintaan penukaran.")}</div>
      <h4>Pengguna & saldo</h4><div class="stack">${userCards || emptyState("♙","Belum ada pengguna","Akun baru akan tampil di sini.")}</div>
      <h4>Pengaturan Robux</h4>
      <form id="adminSettingsForm" class="form-grid">
        <label class="field">Minimal Robux<input name="robuxMin" type="number" min="1" step="1" value="${escapeHTML(cfg.robuxMin ?? 10)}" required></label>
        <label class="field">Tarif Game Pass per Robux (Rp)<input name="gamepassRate" type="number" min="1" step="1" value="${escapeHTML(cfg.gamepassRate ?? 170)}" required></label>
        <label class="field">Tarif Username per Robux (Rp)<input name="usernameRate" type="number" min="1" step="1" value="${escapeHTML(cfg.usernameRate ?? 230)}" required></label>
        <label class="field"><span><input name="maintenanceEnabled" type="checkbox" style="width:auto;margin-right:8px" ${String(cfg.maintenanceEnabled ?? false) === "true" ? "checked" : ""}>Aktifkan maintenance</span></label>
        <label class="field">Alasan maintenance<input name="maintenanceReason" maxlength="300" value="${escapeHTML(cfg.maintenanceReason ?? "Sistem sedang dalam pemeliharaan.")}"></label>
        <label class="field">Dibuka kembali (opsional)<input name="maintenanceReopenAt" type="datetime-local" value="${escapeHTML(localDateTimeInput(cfg.maintenanceReopenAt ?? ""))}"><span class="field-hint">Waktu memakai zona waktu perangkat.</span></label>
        <div id="adminSettingsError" class="form-error hidden" role="alert"></div>
        <button class="button button-primary" type="submit">Simpan pengaturan</button>
      </form>`;
  } catch (error) {
    setNotice("Panel admin gagal dimuat: " + getMessage(error), "error");
    $("#viewContent").innerHTML = emptyState("!", "Gagal memuat admin", "Segarkan halaman setelah memeriksa konfigurasi database dan role admin.");
  }
}
async function submitRobux(event) {
  event.preventDefault();
  if (!requireLogin()) return;
  const form=event.currentTarget, err=$("#robuxError"), button=form.querySelector('button[type="submit"]');
  const payload={method:form.elements.method.value,robux:Number(form.elements.robux.value),username:form.elements.username.value.trim(),gamepassUrl:form.elements.gamepassUrl.value.trim()};
  err.classList.add("hidden"); button.disabled=true; button.textContent="Mengirim…";
  try {
    const result=await api("/api/robux",{method:"POST",body:JSON.stringify(payload)});
    showSuccessModal("Penarikan diterima, admin akan segera memprosesnya.");
    await loadDashboard(); renderView("submissions");
  } catch(error) { err.textContent=getMessage(error); err.classList.remove("hidden"); }
  finally { button.disabled=false; button.textContent="Ajukan penukaran →"; }
}
async function submitAdminJob(event) {
  event.preventDefault(); if(state.user?.role!=="admin") return;
  const form=event.currentTarget, err=$("#adminJobError"), button=form.querySelector('button[type="submit"]');
  err.classList.add("hidden"); button.disabled=true;
  try {
    await api("/api/admin/jobs",{method:"POST",body:JSON.stringify({title:form.elements.title.value.trim(),description:form.elements.description.value.trim(),reward:Number(form.elements.reward.value),photo_required:form.elements.photo_required.checked})});
    notify("Tugas berhasil dibuat."); await renderAdmin();
  } catch(error) { err.textContent=getMessage(error); err.classList.remove("hidden"); }
  finally { button.disabled=false; }
}
async function saveAdminSettings(event) {
  event.preventDefault(); if(state.user?.role!=="admin") return;
  const form=event.currentTarget, err=$("#adminSettingsError"), button=form.querySelector('button[type="submit"]');
  const values={robuxMin:Number(form.elements.robuxMin.value),gamepassRate:Number(form.elements.gamepassRate.value),usernameRate:Number(form.elements.usernameRate.value),maintenanceEnabled:form.elements.maintenanceEnabled.checked,maintenanceReason:form.elements.maintenanceReason.value.trim(),maintenanceReopenAt:form.elements.maintenanceReopenAt.value ? new Date(form.elements.maintenanceReopenAt.value).toISOString() : ""};
  const numericValues=[values.robuxMin,values.gamepassRate,values.usernameRate];
  if(numericValues.some(value=>!Number.isSafeInteger(value)||value<1)){err.textContent="Minimal Robux dan semua tarif harus bilangan bulat positif.";err.classList.remove("hidden");return;}
  if(values.maintenanceReopenAt && !Number.isFinite(new Date(values.maintenanceReopenAt).getTime())){err.textContent="Waktu buka kembali tidak valid.";err.classList.remove("hidden");return;}
  err.classList.add("hidden");button.disabled=true;
  try { await api("/api/admin/settings",{method:"POST",body:JSON.stringify(values)}); await checkMaintenance(true); notify("Pengaturan berhasil disimpan."); await renderAdmin(); }
  catch(error){err.textContent=getMessage(error);err.classList.remove("hidden");}
  finally{button.disabled=false;}
}
async function adminReview(type, id, status) {
  const note = window.prompt("Catatan pemeriksa (opsional):", "") || "";
  try { await api(`/api/admin/${encodeURIComponent(type)}/${encodeURIComponent(id)}/review`,{method:"POST",body:JSON.stringify({status,note})}); notify("Status pengajuan diperbarui."); await renderAdmin(); }
  catch(error){notify("Gagal memproses pengajuan: "+getMessage(error));}
}
async function adminToggle(id, disabled) {
  try { await api(`/api/admin/users/${encodeURIComponent(id)}/toggle`,{method:"POST",body:JSON.stringify({disabled})}); notify(disabled?"Akun dinonaktifkan.":"Akun diaktifkan."); await renderAdmin(); }
  catch(error){notify("Gagal mengubah akun: "+getMessage(error));}
}
async function adminAdjust(id) {
  const input=document.getElementById("adjustAmount-"+id), amount=Number(input?.value);
  if(!Number.isFinite(amount)||amount===0){notify("Isi nominal penyesuaian saldo selain nol.");return;}
  const reason=window.prompt("Alasan penyesuaian saldo:","Penyesuaian admin")||"Penyesuaian admin";
  try { await api(`/api/admin/users/${encodeURIComponent(id)}/adjust`,{method:"POST",body:JSON.stringify({amount,reason})}); notify("Saldo berhasil disesuaikan."); await renderAdmin(); }
  catch(error){notify("Gagal menyesuaikan saldo: "+getMessage(error));}
}
async function openProof(id) {
  try { const result=await api(`/api/submissions/${encodeURIComponent(id)}/proof`); if(!result.url) throw new Error("Tautan bukti tidak tersedia."); window.open(result.url,"_blank","noopener,noreferrer"); }
  catch(error){notify("Gagal membuka bukti: "+getMessage(error));}
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
    if (!result.user) throw new Error("Respons autentikasi tidak menyertakan data akun.");
    state.user = result.user;
    document.body.classList.add("authenticated");
    closeAuth(); $("#authForm").reset(); notify(registering ? "Pendaftaran berhasil." : "Login berhasil.");
    await loadDashboard();
    $("#workspace").scrollIntoView({ behavior:"smooth", block:"start" });
  } catch (error) {
    errorBox.textContent = getMessage(error); errorBox.classList.remove("hidden");
  } finally {
    state.busy = false; submit.disabled = false; submit.innerHTML = state.authMode === "register" ? "Buat akun <span>→</span>" : "Masuk <span>→</span>";
  }
}
async function submitProof(taskId) {
  if (!requireLogin()) return;
  const task = state.tasks.find(item => String(item.id ?? item.taskId ?? item.task_id) === String(taskId));
  if (!task) { notify("Tugas tidak ditemukan. Segarkan daftar tugas."); return; }
  const existing = $("#proofDialog");
  if (existing) existing.remove();
  const dialog = document.createElement("dialog"); dialog.id = "proofDialog"; dialog.className = "modal";
  dialog.innerHTML = `<form id="proofForm" class="modal-card"><button type="button" class="modal-close" id="closeProof" aria-label="Tutup">×</button><div class="modal-logo">F<span>+</span></div><div class="eyebrow">TASK SUBMISSION</div><h2>Kirim bukti tugas</h2><p>${escapeHTML(task.title || task.name || "Tugas")}</p><label class="field">Gambar bukti<input name="proof" type="file" accept="image/jpeg,image/png,image/webp" ${task.photo_required ? "required" : ""}><span class="field-hint">${task.photo_required ? "Foto wajib untuk tugas ini." : "Foto opsional untuk tugas ini."} Maksimum 5 MB.</span></label><label class="field">Catatan (opsional)<textarea name="note" maxlength="1000" placeholder="Tambahkan penjelasan singkat"></textarea></label><div id="proofError" class="form-error hidden" role="alert"></div><button class="button button-primary button-large full-width" type="submit">Kirim untuk diperiksa →</button></form>`;
  document.body.appendChild(dialog); dialog.showModal();
  $("#closeProof").onclick = () => dialog.close();
  $("#proofForm").onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, file = form.elements.proof.files[0], err = $("#proofError"), button = form.querySelector('button[type="submit"]');
    err.classList.add("hidden");
    if (task.photo_required && !file) { err.textContent = "Tugas ini mewajibkan foto bukti."; err.classList.remove("hidden"); return; }
    if (file && !["image/jpeg","image/png","image/webp"].includes(String(file.type || "").toLowerCase())) {
      err.textContent = "Format foto harus JPG, PNG, atau WEBP.";
      err.classList.remove("hidden"); return;
    }
    if (file && file.size > 5 * 1024 * 1024) { err.textContent = "Ukuran foto maksimal 5 MB."; err.classList.remove("hidden"); return; }
    const body = new FormData(); body.append("taskId", String(taskId)); body.append("note", form.elements.note.value.trim());
    if (file) body.append("proof", file);
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
    showSuccessModal("Penarikan diterima, admin akan segera memprosesnya.");
    await loadDashboard(); renderView("submissions");
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
  if (target.id === "refreshButton") { checkHealth(); if (state.user) loadDashboard(); if (state.view === "admin" && state.user?.role === "admin") renderAdmin(); else if (!state.user) notify("Health check dimulai."); }
  if (target.id === "logoutButton") logout();
  if (target.dataset.proofId) openProof(target.dataset.proofId);
  if (target.dataset.adminReview) adminReview(target.dataset.adminReview, target.dataset.recordId, target.dataset.reviewStatus);
  if (target.dataset.userToggle) adminToggle(target.dataset.userToggle, target.dataset.userDisabled === "true");
  if (target.dataset.userAdjust) adminAdjust(target.dataset.userAdjust);
});
$("#authForm").addEventListener("submit", onAuthSubmit);
$("#authDialog").addEventListener("click", event => { if (event.target === $("#authDialog")) closeAuth(); });
document.addEventListener("submit", event => {
  if (event.target.id === "withdrawForm") submitWithdrawal(event);
  else if (event.target.id === "robuxForm") submitRobux(event);
  else if (event.target.id === "adminJobForm") submitAdminJob(event);
  else if (event.target.id === "adminSettingsForm") saveAdminSettings(event);
});
$("#year").textContent = new Date().getFullYear();
renderProfile(); renderView("overview"); checkHealth(); checkMaintenance(); restoreSession();
setInterval(() => checkMaintenance(), 60000);
