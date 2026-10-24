'use strict';
(function () {
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };
  var state = { user: null, view: 'dashboard', config: {}, data: {}, maintenance: null, dialogTimer: null, pendingCount: null, notificationReady: false, pollTimer: null, chatTimer: null, maintenanceTimer: null, pendingEmail: '' };
  var viewMeta = {
    dashboard: ['RUANG KAMU', 'Dashboard', 'Pantau saldo dan tugas yang tersedia.'],
    history: ['AKTIVITAS', 'Riwayat', 'Catatan saldo masuk, saldo keluar, dan status pengajuan.'],
    withdraw: ['PENARIKAN', 'Withdraw', 'Pilih DANA, Robux, atau diamond Free Fire.'],
    referral: ['REWARD', 'Referral', 'Undang teman dan dapatkan bonus setelah teman memverifikasi email dan menyelesaikan job pertamanya.'],
    chat: ['KOMUNITAS', 'Global Chat', 'Berbagi info dengan sopan. Promosi dan spam tidak diperbolehkan.'],
    maintenance: ['PENGATURAN ADMIN', 'Maintenance Menu', 'Kelola maintenance dan pengumuman untuk semua pengguna.'],
    requests: ['ANTREAN ADMIN', 'Request Withdraw', 'Request DANA dan Robux tampil bersama dalam satu antrean.'],
    codes: ['REWARD ADMIN', 'Create Unickcode', 'Buat kode saldo dengan batas jumlah penerima.'],
    'create-job': ['TUGAS ADMIN', 'Create Job', 'Buat tugas dengan reward, link, kuota, dan pengaturan bukti foto.'],
    'review-jobs': ['ANTREAN JOB', 'Review Job', 'Periksa bukti kerja dan setujui reward atau tolak dengan alasan.'],
    'payout-settings': ['PENGATURAN ADMIN', 'Setting UATS', 'Atur tarif penarikan dan reward referral.']
  };
  var cash = function (value) {
    var n = Number(value || 0);
    if (!Number.isFinite(n)) return 'Rp0';
    return 'Rp' + Math.round(n).toLocaleString('id-ID');
  };
  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var date = function (value) {
    if (!value) return '—';
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  };
  var api = async function (path, options) {
    options = options || {};
    var headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    var response;
    try {
      response = await fetch(path, Object.assign({}, options, { headers: headers, credentials: 'same-origin', cache: 'no-store' }));
    } catch (e) {
      throw new Error('Koneksi terganggu. Cek internet lalu coba lagi.');
    }
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || data.message || ('Request gagal (' + response.status + ').'));
    return data;
  };
  var say = function (message) {
    var node = $('#liveStatus');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node._timer);
    node._timer = setTimeout(function () { node.classList.remove('show'); }, 2800);
  };
  var closeDialog = function () {
    var layer = $('#dialogLayer');
    if (!layer || layer.classList.contains('hidden')) return;
    clearTimeout(state.dialogTimer);
    var callback = layer._onClose;
    layer._onClose = null;
    layer.classList.add('hidden');
    layer.innerHTML = '';
    if (typeof callback === 'function') callback();
  };
  var showDialog = function (title, message, options) {
    options = options || {};
    closeDialog();
    var layer = $('#dialogLayer');
    var locked = !!options.locked;
    layer._onClose = options.onClose || null;
    layer.innerHTML = '<section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">' +
      '<div class="dialog-icon ' + esc(options.kind || '') + '">' + esc(options.icon || (options.kind === 'error' ? '×' : options.kind === 'warning' ? '!' : '✓')) + '</div>' +
      '<h2 id="dialogTitle">' + esc(title) + '</h2><p>' + esc(message) + '</p>' +
      (locked ? '' : '<div class="dialog-actions"><button id="dialogOk" class="button button-primary" type="button">OK</button></div>') +
      '</section>';
    layer.classList.remove('hidden');
    if (!locked) $('#dialogOk').addEventListener('click', closeDialog);
    if (!locked && Number(options.autoMs) > 0) state.dialogTimer = setTimeout(closeDialog, Number(options.autoMs));
  };
  var showPrompt = function (title, message, placeholder, callback) {
    closeDialog();
    var layer = $('#dialogLayer');
    layer.innerHTML = '<section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialogTitle"><div class="dialog-icon error">×</div><h2 id="dialogTitle">' + esc(title) + '</h2><p>' + esc(message) + '</p><div class="dialog-fields"><label class="field"><span>Alasan penolakan</span><textarea id="rejectReason" maxlength="1000" required placeholder="' + esc(placeholder || 'Tuliskan alasan yang jelas') + '"></textarea></label></div><div class="dialog-actions"><button id="promptCancel" class="button button-outline" type="button">Batal</button><button id="promptSubmit" class="button button-danger" type="button">Kirim penolakan</button></div></section>';
    layer.classList.remove('hidden');
    $('#promptCancel').addEventListener('click', closeDialog);
    $('#promptSubmit').addEventListener('click', async function () {
      var reason = $('#rejectReason').value.trim();
      if (!reason) { $('#rejectReason').focus(); say('Alasan penolakan wajib diisi.'); return; }
      var button = $('#promptSubmit');
      button.disabled = true;
      button.textContent = 'Mengirim…';
      try {
        var outcome = await callback(reason);
        closeDialog();
        if (outcome && outcome.title) showDialog(outcome.title, outcome.message || 'Selesai.', outcome.options || { autoMs: 3000 });
      } catch (error) {
        button.disabled = false; button.textContent = 'Kirim penolakan';
        showDialog('Belum berhasil', error.message, { kind: 'error' });
      }
    });
  };
  var setAuthMode = function (mode) {
    var register = mode === 'register', verify = mode === 'verify';
    $('#registerForm').classList.toggle('hidden', !register);
    $('#loginForm').classList.toggle('hidden', register || verify);
    $('#verifyForm').classList.toggle('hidden', !verify);
    $('#authHeading').textContent = register ? 'Daftar Akun' : verify ? 'Verifikasi Email' : 'Masuk';
    $('#authSubheading').textContent = register ? 'Buat akun dan verifikasi email untuk mulai mendapatkan reward' : verify ? 'Masukkan kode yang dikirim ke email kamu' : 'Masuk untuk melanjutkan';
    $('#authSwitchText').textContent = register ? 'Sudah punya akun?' : 'Belum punya akun?';
    $('#switchAuth').textContent = register ? 'Login' : 'Daftar sekarang';
    $('#switchAuth').parentElement.classList.toggle('hidden', verify);
    $('#authNotice').classList.add('hidden');
    $('#authNotice').textContent = '';
  };
  var authMessage = function (text) {
    $('#authNotice').textContent = text;
    $('#authNotice').classList.remove('hidden');
  };
  var setLoggedOut = function () {
    state.user = null;
    $('#appScreen').classList.add('hidden');
    $('#authScreen').classList.remove('hidden');
    closeMenu();
    setAuthMode('register');
    clearInterval(state.pollTimer);
    clearInterval(state.chatTimer);
    clearInterval(state.maintenanceTimer);
    state.chatTimer = null;
    state.maintenanceTimer = null;
  };
  var setLoggedIn = function (user) {
    state.user = user;
    $('#authScreen').classList.add('hidden');
    $('#appScreen').classList.remove('hidden');
    $('#headerUsername').textContent = user.username || 'Pengguna';
    $('#headerAvatar').textContent = String(user.username || 'U').slice(0, 1).toUpperCase();
    $('#drawerRole').textContent = user.role === 'admin' ? 'Administrator' : user.role === 'staff' ? 'Staff' : 'Pengguna';
    $('#adminNav').classList.toggle('hidden', user.role !== 'admin');
    startRequestPolling();
    clearInterval(state.maintenanceTimer);
    applyMaintenance();
    state.maintenanceTimer = setInterval(applyMaintenance, 30000);
    showAnnouncement();
    return navigate('dashboard');
  };
  var getConfig = async function () {
    try {
      var result = await api('/api/config');
      state.config = result.settings || {};
      state.config.robuxMin = numberSetting(state.config.robuxMin, 10);
      state.config.gamepassRate = numberSetting(state.config.gamepassRate, 170);
      state.config.usernameRate = numberSetting(state.config.usernameRate, 230);
      state.config.danaFee = numberSetting(state.config.danaFee, 2000);
      state.config.diamondRate = numberSetting(state.config.diamondRate, 0);
      state.config.diamondMin = numberSetting(state.config.diamondMin, 1);
      state.config.referralInviterReward = numberSetting(state.config.referralInviterReward, 0);
      state.config.referralInviteeReward = numberSetting(state.config.referralInviteeReward, 0);
    } catch (e) { state.config = { robuxMin: 10, gamepassRate: 170, usernameRate: 230, danaFee: 2000, diamondRate: 0, diamondMin: 1, referralInviterReward: 0, referralInviteeReward: 0 }; }
    return state.config;
  };
  var numberSetting = function (value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  var applyMaintenance = async function () {
    if (!state.user) return;
    try {
      var data = await api('/api/maintenance');
      state.maintenance = data;
      if (data.enabled) {
        var suffix = data.reopenAt ? '\nPerkiraan dibuka kembali: ' + date(data.reopenAt) : '';
        var heading = $('#dialogLayer .dialog-card h2');
        var locked = state.user.role !== 'admin';
        if ($('#dialogLayer').classList.contains('hidden') || !heading || heading.textContent !== 'Website sedang maintenance' || $('#dialogLayer').dataset.maintenanceLocked !== String(locked)) {
          showDialog('Website sedang maintenance', (data.reason || 'Sistem sedang dalam pemeliharaan.') + suffix, { locked: locked, kind: 'warning', icon: '⚙' });
          $('#dialogLayer').dataset.maintenanceLocked = String(locked);
        }
      } else if ($('#dialogLayer .dialog-card h2') && $('#dialogLayer .dialog-card h2').textContent === 'Website sedang maintenance') closeDialog();
    } catch (e) { state.maintenance = { enabled: false }; }
  };
  var showAnnouncement = async function () {
    if (!state.user) return;
    try {
      var cfg = await getConfig();
      if (!(String(cfg.announcementEnabled) === 'true' || cfg.announcementEnabled === true)) return;
      var key = String(cfg.announcementUpdatedAt || cfg.announcementMessage || '');
      if (!key) return;
      var storageKey = 'fe_announcement_seen:' + String(state.user.id || state.user.username) + ':' + key;
      try { if (localStorage.getItem(storageKey) === '1') return; } catch (e) {}
      if (state.maintenance && state.maintenance.enabled) return;
      try { localStorage.setItem(storageKey, '1'); } catch (e) {}
      showDialog(String(cfg.announcementTitle || 'Pengumuman'), String(cfg.announcementMessage || 'Ada informasi baru.'), { autoMs: 6000 });
    } catch (e) { /* pengumuman gagal dimuat tidak memblokir login */ }
  };
  var closeMenu = function () {
    $('#navDrawer').classList.remove('open');
    $('#drawerShade').classList.add('hidden');
    $('#menuButton').setAttribute('aria-expanded', 'false');
  };
  var toggleMenu = function (open) {
    var shouldOpen = typeof open === 'boolean' ? open : !$('#navDrawer').classList.contains('open');
    $('#navDrawer').classList.toggle('open', shouldOpen);
    $('#drawerShade').classList.toggle('hidden', !shouldOpen);
    $('#menuButton').setAttribute('aria-expanded', String(shouldOpen));
  };
  var navigate = async function (view) {
    if (!viewMeta[view]) view = 'dashboard';
    if (!state.user) return;
    if (view !== 'dashboard' && view !== 'history' && view !== 'withdraw' && view !== 'chat' && view !== 'referral' && state.user.role !== 'admin') {
      showDialog('Akses dibatasi', 'Menu ini khusus admin.', { kind: 'error' });
      return;
    }
    state.view = view;
    clearInterval(state.chatTimer);
    state.chatTimer = null;
    closeMenu();
    $$('.nav-link[data-view]').forEach(function (node) { node.classList.toggle('active', node.dataset.view === view); });
    $('#pageEyebrow').textContent = viewMeta[view][0];
    $('#pageTitle').textContent = viewMeta[view][1];
    $('#pageDescription').textContent = viewMeta[view][2];
    $('#viewRoot').innerHTML = '<div class="panel"><div class="empty-state">Memuat data…</div></div>';
    try {
      if (view === 'dashboard') await renderDashboard();
      else if (view === 'history') await renderHistory();
      else if (view === 'withdraw') await renderWithdraw();
      else if (view === 'referral') await renderReferral();
      else if (view === 'chat') await renderChat();
      else if (view === 'maintenance') await renderMaintenance();
      else if (view === 'requests') await renderRequests();
      else if (view === 'codes') await renderCodes();
      else if (view === 'create-job') renderCreateJob();
      else if (view === 'review-jobs') await renderJobReviews();
      else if (view === 'payout-settings') renderPayoutSettings();
    } catch (error) {
      $('#viewRoot').innerHTML = '<div class="panel"><div class="empty-state"><b>Data belum dapat dimuat</b>' + esc(error.message) + '</div><button id="retryLoad" class="button button-outline" type="button">Coba lagi</button></div>';
      $('#retryLoad').addEventListener('click', function () { navigate(view); });
    }
  };
  var refreshUser = async function () {
    try {
      var result = await api('/api/me');
      state.user = result.user;
      $('#headerUsername').textContent = state.user.username || 'Pengguna';
      $('#headerAvatar').textContent = String(state.user.username || 'U').slice(0, 1).toUpperCase();
      $('#headerBalance').textContent = cash(state.user.balance);
    } catch (e) { setLoggedOut(); throw e; }
  };
  var loadRequestsMine = async function () {
    var results = await Promise.all([api('/api/withdrawals').catch(function () { return []; }), api('/api/robux').catch(function () { return []; }), api('/api/diamond').catch(function () { return []; })]);
    return { withdrawals: Array.isArray(results[0]) ? results[0] : [], robux: Array.isArray(results[1]) ? results[1] : [], diamonds: Array.isArray(results[2]) ? results[2] : [] };
  };
  var statusFor = function (status) {
    status = String(status || 'pending').toLowerCase();
    if (['paid', 'completed', 'approved', 'success'].indexOf(status) >= 0) return ['SUKSES', 'success', '✓'];
    if (status === 'rejected' || status === 'declined' || status === 'failed') return ['DITOLAK', 'rejected', '×'];
    return ['DIPROSES', 'pending', '◷'];
  };
  var statusTag = function (status) {
    var info = statusFor(status);
    return '<span class="status ' + info[1] + '">' + info[2] + ' ' + info[0] + '</span>';
  };
  var renderDashboard = async function () {
    var loaded = await Promise.all([api('/api/dashboard'), api('/api/jobs'), api('/api/wallet')]);
    var result = loaded[0], jobs = loaded[1], wallet = loaded[2];
    state.user = result.user || state.user;
    $('#headerBalance').textContent = cash(wallet.balance == null ? state.user.balance : wallet.balance);
    var jobHtml = (Array.isArray(jobs) ? jobs : []).map(function (job) {
      return '<article class="job-card"><div class="card-top"><div><h3>' + esc(job.title) + '</h3><p>' + esc(job.description || 'Ikuti instruksi job yang tersedia.') + '</p></div><span class="tag reward">+' + cash(job.reward) + '</span></div><div class="tag-list"><span class="tag">Kuota ' + esc(job.quota_used || 0) + '/' + esc(job.quota == null ? '∞' : job.quota) + '</span><span class="tag">' + (job.photo_required ? 'Foto bukti wajib' : 'Foto bukti opsional') + '</span></div>' +
        (job.link ? '<p><a href="' + esc(job.link) + '" rel="noopener noreferrer" target="_blank" class="text-button">Buka link tugas ↗</a></p>' : '') +
        '<div class="button-row"><button class="button button-primary" type="button" data-job-submit="' + esc(job.id) + '" data-job-title="' + esc(job.title) + '" data-photo="' + String(!!job.photo_required) + '">Kerjakan job</button></div></article>';
    }).join('');
    $('#viewRoot').innerHTML =
      '<section class="balance-card"><small>Saldo tersedia</small><strong>' + cash(wallet.balance == null ? state.user.balance : wallet.balance) + '</strong><p>Saldo tertahan untuk request: ' + cash(wallet.reserved_balance || 0) + '</p></section>' +
      '<div class="mini-stats"><div class="mini-stat"><small>Tugas tersedia</small><strong>' + (Array.isArray(jobs) ? jobs.length : 0) + '</strong></div><div class="mini-stat"><small>Pengajuan tugas</small><strong>' + esc(result.stats && result.stats.submissions || 0) + '</strong></div><div class="mini-stat"><small>Request withdraw</small><strong>' + esc(result.stats && result.stats.withdrawals || 0) + '</strong></div></div>' +
      '<section class="panel"><div class="panel-heading"><div><h2>Job tersedia</h2><p class="subtle">Pilih tugas dan ikuti instruksinya.</p></div></div><div class="stack">' + (jobHtml || '<div class="empty-state"><b>Belum ada job tersedia</b>Cek lagi nanti saat admin menerbitkan tugas baru.</div>') + '</div></section>' +
      '<section class="panel"><div class="panel-heading"><div><h2>Unick Code</h2><p class="subtle">Masukkan kode reward yang diberikan admin. Setiap akun hanya bisa menukarkan kode yang sama satu kali.</p></div></div><form id="redeemForm" class="form-grid"><label class="field wide"><span>UNICK CODE</span><input name="code" maxlength="80" placeholder="Masukkan kode unik" autocomplete="off" required></label><div class="wide"><button class="button button-primary" type="submit">Terima reward</button></div></form></section>';
    $$('[data-job-submit]').forEach(function (button) { button.addEventListener('click', function () { openJobSubmit(button.dataset.jobSubmit, button.dataset.jobTitle, button.dataset.photo === 'true'); }); });
    $('#redeemForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = $('button[type="submit"]', form); button.disabled = true;
      try {
        var data = await api('/api/codes/redeem', { method: 'POST', body: JSON.stringify({ code: form.code.value.trim() }) });
        await refreshUser();
        showDialog('Reward berhasil diterima', 'Kode valid. Saldo bertambah ' + cash(data.reward) + '.', { autoMs: 3000, icon: '✓' });
        navigate('dashboard');
      } catch (error) { showDialog('Kode belum dapat digunakan', error.message, { kind: 'error' }); }
      finally { button.disabled = false; }
    });
  };
  var openJobSubmit = function (id, title, requiredPhoto) {
    closeDialog();
    var layer = $('#dialogLayer');
    layer.innerHTML = '<section class="dialog-card" role="dialog" aria-modal="true"><div class="dialog-icon">✓</div><h2>Kirim hasil job</h2><p>' + esc(title) + '</p><div class="dialog-fields"><form id="jobSubmitForm" class="form-stack"><label class="field"><span>Catatan / hasil</span><textarea name="note" maxlength="2000" placeholder="Ceritakan hasil pekerjaan kamu"></textarea></label><label class="field"><span>Foto bukti ' + (requiredPhoto ? '(wajib)' : '(opsional)') + '</span><input name="proof" type="file" accept="image/jpeg,image/png,image/webp" ' + (requiredPhoto ? 'required' : '') + '><small>JPG, PNG, WEBP. Maksimal 5 MB.</small></label><button class="button button-primary" type="submit">Kirim pengajuan</button><button id="jobCancel" class="button button-outline" type="button">Batal</button></form></div></section>';
    layer.classList.remove('hidden');
    $('#jobCancel').addEventListener('click', closeDialog);
    $('#jobSubmitForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = $('button[type="submit"]', form);
      var file = form.proof.files[0];
      if (requiredPhoto && !file) { showDialog('Foto wajib diisi', 'Job ini mengharuskan foto bukti.', { kind: 'warning' }); return; }
      if (file && file.size > 5 * 1024 * 1024) { showDialog('Foto terlalu besar', 'Ukuran foto maksimal 5 MB.', { kind: 'error' }); return; }
      var payload = new FormData(); payload.append('note', form.note.value);
      if (file) payload.append('proof', file);
      button.disabled = true; button.textContent = 'Mengirim…';
      try {
        await api('/api/jobs/' + encodeURIComponent(id) + '/submit', { method: 'POST', body: payload });
        closeDialog();
        showDialog('Pengajuan dikirim', 'Hasil job masuk antrean pemeriksaan admin.', { autoMs: 3000 });
        await navigate('dashboard');
      } catch (error) { button.disabled = false; button.textContent = 'Kirim pengajuan'; showDialog('Pengajuan gagal', error.message, { kind: 'error' }); }
    });
  };
  var renderHistory = async function () {
    var results = await Promise.all([api('/api/wallet'), api('/api/history')]);
    var wallet = results[0], history = results[1];
    var ledger = (wallet.transactions || []).map(function (item) {
      var value = Number(item.amount || 0);
      var sign = value > 0 ? '+' : '';
      return '<article class="history-row"><div class="card-top"><div><strong>' + esc(item.reason || item.type || 'Transaksi saldo') + '</strong><p class="subtle">' + esc(date(item.created_at)) + '</p></div><b style="color:' + (value >= 0 ? '#087f4c' : '#bd3646') + '">' + sign + cash(value) + '</b></div></article>';
    }).join('');
    var requests = [];
    (history.withdrawals || []).forEach(function (item) { requests.push({ type: 'DANA', created_at: item.created_at, amount: item.amount, payout: item.payout_amount, fee: item.fee_amount, method: item.method, status: item.status, note: item.review_note, id: item.id }); });
    (history.robux || []).forEach(function (item) { requests.push({ type: 'ROBUX', created_at: item.created_at, amount: item.cost, details: item.robux + ' Robux · ' + item.method + ' · ' + item.username, status: item.status, note: item.review_note, id: item.id }); });
    requests.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    var requestHtml = requests.map(function (item) {
      var status = statusFor(item.status);
      return '<article class="history-row"><div class="card-top"><div><strong>' + esc(item.type) + ' · ' + cash(item.amount) + '</strong><p class="subtle">' + esc(date(item.created_at)) + '</p></div>' + statusTag(item.status) + '</div>' +
        (item.details ? '<p class="subtle">' + esc(item.details) + '</p>' : '') +
        (item.type === 'DANA' ? '<p class="subtle">Diterima: ' + cash(item.payout == null ? item.amount : item.payout) + ' · Biaya admin: ' + cash(item.fee || 0) + '</p>' : '') +
        (item.note ? '<div class="inline-alert danger-alert">Alasan admin: ' + esc(item.note) + '</div>' : '') + '</article>';
    }).join('');
    var submissions = (history.submissions || []).map(function (item) {
      return '<article class="history-row"><div class="card-top"><div><strong>Job #' + esc(item.job_id) + '</strong><p class="subtle">' + esc(date(item.created_at)) + '</p></div>' + statusTag(item.status) + '</div>' + (item.review_note ? '<p class="subtle">Catatan admin: ' + esc(item.review_note) + '</p>' : '') + '</article>';
    }).join('');
    $('#viewRoot').innerHTML =
      '<section class="panel"><div class="panel-heading"><div><h2>Mutasi saldo</h2><p>Uang masuk dan keluar dari akun kamu.</p></div></div><div class="stack">' + (ledger || '<div class="empty-state">Belum ada transaksi saldo.</div>') + '</div></section>' +
      '<section class="panel"><div class="panel-heading"><div><h2>Riwayat withdraw</h2><p>DANA dan Robux dalam satu daftar.</p></div></div><div class="stack">' + (requestHtml || '<div class="empty-state">Belum ada request withdraw.</div>') + '</div></section>' +
      '<section class="panel"><div class="panel-heading"><div><h2>Riwayat job</h2><p>Status dari pengajuan job yang pernah dikirim.</p></div></div><div class="stack">' + (submissions || '<div class="empty-state">Belum ada pengajuan job.</div>') + '</div></section>';
  };
  var renderWithdraw = async function () {
    var results = await Promise.all([api('/api/wallet'), api('/api/config'), loadRequestsMine()]);
    var wallet = results[0], config = results[1].settings || {}, requests = results[2];
    state.config = Object.assign({}, state.config, config);
    var rows = [];
    requests.withdrawals.forEach(function (item) { rows.push({ kind: 'DANA', amount: item.amount, payout: item.payout_amount, fee: item.fee_amount, status: item.status, at: item.created_at, note: item.review_note, details: item.destination }); });
    requests.robux.forEach(function (item) { rows.push({ kind: 'ROBUX', amount: item.cost, status: item.status, at: item.created_at, note: item.review_note, details: item.robux + ' Robux · ' + item.method + ' · ' + item.username }); });
    (requests.diamonds || []).forEach(function (item) { rows.push({ kind: 'DIAMOND FF', amount: item.cost, status: item.status, at: item.created_at, note: item.review_note, details: item.diamonds + ' diamond · UID ' + item.ff_uid + (item.ff_server_id ? ' · Server ' + item.ff_server_id : '') }); });
    rows.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    var requestHtml = rows.map(function (item) {
      return '<article class="history-row"><div class="card-top"><div><strong>' + esc(item.kind) + ' · potong ' + cash(item.amount) + '</strong><p class="subtle">' + esc(date(item.at)) + '</p></div>' + statusTag(item.status) + '</div><p class="subtle">' + esc(item.details || '') + '</p>' +
      (item.kind === 'DANA' ? '<p class="subtle">Nominal yang diterima: ' + cash(item.payout == null ? item.amount : item.payout) + ' · Biaya admin: ' + cash(item.fee || 0) + '</p>' : '') +
      (item.note ? '<div class="inline-alert danger-alert">Alasan ditolak: ' + esc(item.note) + '</div>' : '') + '</article>';
    }).join('');
    var fee = numberSetting(config.danaFee, 2000);
    $('#viewRoot').innerHTML =
      '<section class="panel"><div class="panel-heading"><div><h2>Buat request</h2><p>Pilih jenis penarikan terlebih dahulu. Request akan masuk antrean admin.</p></div></div>' +
      '<div class="withdraw-tabs" id="withdrawTabs" role="tablist" aria-label="Jenis penarikan"><span class="withdraw-tab-slider" aria-hidden="true"></span><button class="withdraw-tab active" id="tabRobux" type="button" role="tab" aria-selected="true" data-withdraw-tab="robux">ROBUX</button><button class="withdraw-tab" id="tabDana" type="button" role="tab" aria-selected="false" data-withdraw-tab="dana">DANA</button><button class="withdraw-tab" id="tabDiamond" type="button" role="tab" aria-selected="false" data-withdraw-tab="diamond">DIAMOND FF</button></div>' +
      '<form id="withdrawForm" class="form-grid">' +
      '<input id="withdrawType" name="type" type="hidden" value="robux">' +
      '<label class="field" id="danaAmountWrap" hidden><span>Nominal saldo yang dipotong (Rp)</span><input id="withdrawAmount" type="number" name="amount" min="1" step="1" placeholder="Contoh: 10000"></label>' +
      '<label class="field wide" id="danaDestinationWrap" hidden><span>Nomor DANA</span><input name="destination" inputmode="tel" maxlength="200" placeholder="Nomor akun DANA penerima"></label>' +
      '<div class="field" id="robuxAmountInfo"><span>Jumlah Robux</span><p class="subtle">Pilih jumlah Robux di bawah. Saldo yang dipotong dihitung otomatis.</p></div>' +
      '<label class="field" id="robuxMethodWrap" hidden><span>Metode Robux</span><select id="robuxMethod" name="method"><option value="gamepass">Game Pass</option><option value="username">Via Username</option></select></label>' +
      '<label class="field" id="robuxCountWrap" hidden><span>Jumlah Robux</span><input id="robuxCount" type="number" name="robux" min="' + esc(numberSetting(config.robuxMin, 10)) + '" step="1" placeholder="Jumlah Robux"></label>' +
      '<label class="field" id="robloxUsernameWrap" hidden><span>Username Roblox</span><input name="robloxUsername" maxlength="100" placeholder="Username Roblox"></label>' +
      '<label class="field wide" id="gamepassWrap" hidden><span>Link Game Pass</span><input name="gamepassUrl" type="url" maxlength="500" placeholder="https://www.roblox.com/..."></label>' +
      '<label class="field" id="diamondCountWrap" hidden><span>Jumlah diamond FF</span><input id="diamondCount" name="diamonds" type="number" min="' + esc(numberSetting(config.diamondMin, 1)) + '" step="1" placeholder="Jumlah diamond"></label>' +
      '<label class="field" id="diamondUidWrap" hidden><span>UID Free Fire</span><input name="ffUid" inputmode="numeric" pattern="[0-9]{5,20}" maxlength="20" placeholder="UID Free Fire"></label>' +
      '<label class="field" id="diamondServerWrap" hidden><span>Server/region (opsional)</span><input name="serverId" maxlength="32" placeholder="ID server jika diperlukan"></label>' +
      '<div class="currency-note wide" id="withdrawCalc">Biaya admin DANA saat ini: ' + cash(fee) + '. Nominal ini ditampilkan sebelum request dikirim.</div>' +
      '<div class="wide"><button class="button button-primary full" type="submit">Kirim request withdraw</button></div></form></section>' +
      '<section class="panel"><div class="panel-heading"><div><h2>Riwayat withdraw</h2><p>Status diperbarui setelah admin memproses request.</p></div></div><div class="stack">' + (requestHtml || '<div class="empty-state">Belum ada request withdraw.</div>') + '</div></section>';
    var form = $('#withdrawForm');
    var updateCalc = function () {
      var type = $('#withdrawType').value, amount = Number($('#withdrawAmount').value || 0);
      var method = $('#robuxMethod').value, count = Number($('#robuxCount').value || 0);
      $('#tabRobux').classList.toggle('active', type === 'robux');
      $('#tabDana').classList.toggle('active', type === 'dana');
      $('#tabDiamond').classList.toggle('active', type === 'diamond');
      $('#withdrawTabs').classList.toggle('is-dana', type === 'dana');
      $('#withdrawTabs').classList.toggle('is-diamond', type === 'diamond');
      $('#tabRobux').setAttribute('aria-selected', String(type === 'robux'));
      $('#tabDana').setAttribute('aria-selected', String(type === 'dana'));
      $('#tabDiamond').setAttribute('aria-selected', String(type === 'diamond'));
      $('#danaAmountWrap').hidden = type !== 'dana';
      $('#danaDestinationWrap').hidden = type !== 'dana';
      $('#robuxAmountInfo').hidden = type !== 'robux';
      $('#robuxMethodWrap').hidden = type !== 'robux';
      $('#robuxCountWrap').hidden = type !== 'robux';
      $('#robloxUsernameWrap').hidden = type !== 'robux';
      $('#gamepassWrap').hidden = type !== 'robux' || method !== 'gamepass';
      $('#diamondCountWrap').hidden = type !== 'diamond';
      $('#diamondUidWrap').hidden = type !== 'diamond';
      $('#diamondServerWrap').hidden = type !== 'diamond';
      if (type === 'dana') {
        var payout = amount - fee;
        $('#withdrawCalc').textContent = 'Biaya admin DANA saat ini ' + cash(fee) + '. Saldo dipotong ' + cash(amount) + '; estimasi diterima ' + cash(Math.max(0, payout)) + '.';
      } else if (type === 'diamond') {
        var diamondRate = numberSetting(config.diamondRate, 0), diamonds = Number($('#diamondCount').value || 0);
        $('#withdrawCalc').textContent = diamondRate > 0 ? 'Harga ' + cash(diamondRate) + ' per diamond. ' + diamonds + ' diamond akan memotong saldo ' + cash(diamondRate * diamonds) + '. Pengiriman diproses manual oleh admin.' : 'Penarikan diamond FF belum diaktifkan. Admin perlu mengatur harga per diamond terlebih dahulu.';
      } else {
        var rate = numberSetting(method === 'gamepass' ? config.gamepassRate : config.usernameRate, method === 'gamepass' ? 170 : 230);
        var cost = count * rate;
        $('#withdrawCalc').textContent = 'Tarif ' + cash(rate) + ' per Robux. ' + count + ' Robux akan memotong saldo ' + cash(cost) + '. Minimal ' + numberSetting(config.robuxMin, 10) + ' Robux.';
      }
    };
    $('[data-withdraw-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $('#withdrawType').value = tab.dataset.withdrawTab;
        updateCalc();
      });
    });
    ['change', 'input'].forEach(function (evt) { $('#robuxMethod').addEventListener(evt, updateCalc); $('#withdrawAmount').addEventListener(evt, updateCalc); $('#robuxCount').addEventListener(evt, updateCalc); $('#diamondCount').addEventListener(evt, updateCalc); });
    updateCalc();
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var submit = $('button[type="submit"]', form); submit.disabled = true; submit.textContent = 'Mengirim request…';
      try {
        if ($('#withdrawType').value === 'dana') {
          var amount = Number(form.amount.value);
          if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Nominal saldo harus berupa angka positif.');
          if (amount <= fee) throw new Error('Nominal penarikan harus lebih besar dari biaya admin DANA ' + cash(fee) + '.');
          if (!form.destination.value.trim()) throw new Error('Nomor DANA wajib diisi.');
          await api('/api/withdrawals', { method: 'POST', body: JSON.stringify({ method: 'DANA', amount: amount, destination: form.destination.value.trim() }) });
        } else if ($('#withdrawType').value === 'diamond') {
          var diamonds = Number(form.diamonds.value);
          if (!Number.isSafeInteger(diamonds) || diamonds < numberSetting(config.diamondMin, 1)) throw new Error('Jumlah diamond di bawah batas minimum.');
          if (numberSetting(config.diamondRate, 0) < 1) throw new Error('Harga diamond FF belum diatur admin.');
          if (!/^\\d{5,20}$/.test(form.ffUid.value.trim())) throw new Error('UID Free Fire harus berupa 5–20 angka.');
          await api('/api/diamond', { method: 'POST', body: JSON.stringify({ diamonds: diamonds, ffUid: form.ffUid.value.trim(), serverId: form.serverId.value.trim() }) });
        } else {
          var robux = Number(form.robux.value);
          var methodName = form.elements.namedItem('method').value;
          var uname = form.robloxUsername.value.trim();
          var url = form.gamepassUrl.value.trim();
          if (!Number.isSafeInteger(robux) || robux < numberSetting(config.robuxMin, 10)) throw new Error('Jumlah Robux di bawah batas minimum.');
          if (!uname) throw new Error('Username Roblox wajib diisi.');
          if (methodName === 'gamepass' && !/^https:\/\/www\.roblox\.com\//i.test(url)) throw new Error('Link Game Pass Roblox wajib diisi.');
          await api('/api/robux', { method: 'POST', body: JSON.stringify({ method: methodName, robux: robux, username: uname, gamepassUrl: methodName === 'gamepass' ? url : '' }) });
        }
        await refreshUser();
        showDialog('Request terkirim', 'Request kamu sedang diproses berdasarkan antrean. Mohon menunggu.', { autoMs: 3000 });
        await navigate('withdraw');
      } catch (error) { showDialog('Request belum terkirim', error.message, { kind: 'error' }); }
      finally { submit.disabled = false; submit.textContent = 'Kirim request withdraw'; }
    });
  };
  var renderChat = async function () {
    clearInterval(state.chatTimer);
    state.chatTimer = null;
    var rows = await api('/api/chat');
    $('#viewRoot').innerHTML = '<section class="panel chat-panel"><div class="panel-heading"><div><h2>Global Chat</h2><p>Jangan spam, promosi, atau membagikan informasi pribadi.</p></div><button id="chatRefresh" class="button button-soft" type="button">Perbarui</button></div><div id="chatMessages" class="chat-messages">' + chatHtml(rows) + '</div><form id="chatForm" class="chat-send"><input name="message" maxlength="1000" autocomplete="off" placeholder="Tulis pesan..." required><button class="button button-primary" type="submit">Kirim</button></form><p class="hint">Perintah mute hanya untuk admin/staff: /mute @username 7 atau /unmute @username</p></section>';
    $('#chatRefresh').addEventListener('click', async function () { try { await renderChat(); say('Chat diperbarui.'); } catch (e) { showDialog('Chat gagal dimuat', e.message, { kind: 'error' }); } });
    $('#chatForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget, input = form.message, button = $('button[type="submit"]', form), message = input.value.trim();
      if (!message) return;
      button.disabled = true;
      try {
        var result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: message }) });
        if (result.command) showDialog('Perintah berhasil', result.message || 'Perintah moderator berhasil dijalankan.', { autoMs: 3000 });
        else say('Pesan terkirim.');
        await renderChat();
      } catch (error) { showDialog('Pesan belum terkirim', error.message, { kind: 'error' }); }
      finally { button.disabled = false; input.value = ''; }
    });
    var area = $('#chatMessages'); area.scrollTop = area.scrollHeight;
    state.chatTimer = setInterval(async function () {
      if (state.view !== 'chat') return;
      var liveArea = $('#chatMessages');
      if (!liveArea) return;
      var wasNearBottom = liveArea.scrollHeight - liveArea.scrollTop - liveArea.clientHeight < 50;
      try {
        var fresh = await api('/api/chat');
        if (state.view !== 'chat' || !$('#chatMessages')) return;
        liveArea = $('#chatMessages');
        liveArea.innerHTML = chatHtml(fresh);
        if (wasNearBottom) liveArea.scrollTop = liveArea.scrollHeight;
      } catch (error) {
        // Keep the existing messages on a transient poll failure.
      }
    }, 5000);
  };
  var chatHtml = function (rows) {
    if (!Array.isArray(rows) || !rows.length) return '<div class="empty-state">Belum ada pesan. Mulai percakapan dengan sopan.</div>';
    return rows.map(function (row) {
      var mine = state.user && row.user_id === state.user.id;
      return '<article class="chat-row ' + (mine ? 'mine' : '') + '"><time>' + esc(date(row.created_at)) + '</time><b>' + esc(row.username || 'Member') + '</b><p>' + esc(row.message) + '</p></article>';
    }).join('');
  };
  var renderMaintenance = async function () {
    var result = await api('/api/admin/settings');
    var cfg = {};
    (result || []).forEach(function (item) { cfg[item.key] = item.value; });
    var checked = function (value) { return String(value).toLowerCase() === 'true' || value === true ? 'checked' : ''; };
    $('#viewRoot').innerHTML = '<section class="panel"><div class="panel-heading"><div><h2>Maintenance</h2><p>Jika aktif, pengguna diblokir sampai admin menonaktifkannya atau waktu buka kembali tercapai.</p></div></div><form id="maintenanceForm" class="form-grid">' +
      '<label class="check-row wide"><span>Aktifkan maintenance (popup tidak bisa ditutup)</span><span class="switch"><input name="maintenanceEnabled" type="checkbox" ' + checked(cfg.maintenanceEnabled) + '><span></span></span></label>' +
      '<label class="field wide"><span>Alasan maintenance</span><textarea name="maintenanceReason" maxlength="1000" placeholder="Sedang dilakukan perbaikan sistem">' + esc(cfg.maintenanceReason || '') + '</textarea></label>' +
      '<label class="field wide"><span>Perkiraan dibuka kembali (opsional)</span><input name="maintenanceReopenAt" type="datetime-local" value="' + esc(localInput(cfg.maintenanceReopenAt)) + '"></label>' +
      '<div class="wide"><button class="button button-primary" type="submit">Simpan maintenance</button></div></form></section>' +
      '<section class="panel"><div class="panel-heading"><div><h2>Pengumuman</h2><p>Popup informasi yang bisa ditutup user melalui OK atau otomatis.</p></div></div><form id="announcementForm" class="form-grid">' +
      '<label class="check-row wide"><span>Tampilkan pengumuman ke pengguna</span><span class="switch"><input name="announcementEnabled" type="checkbox" ' + checked(cfg.announcementEnabled) + '><span></span></span></label>' +
      '<label class="field wide"><span>Judul pengumuman</span><input name="announcementTitle" maxlength="120" value="' + esc(cfg.announcementTitle || '') + '" placeholder="Informasi penting"></label>' +
      '<label class="field wide"><span>Isi pengumuman</span><textarea name="announcementMessage" maxlength="2000" placeholder="Tulis pemberitahuan untuk semua pengguna">' + esc(cfg.announcementMessage || '') + '</textarea></label>' +
      '<div class="wide"><button class="button button-primary" type="submit">Simpan pengumuman</button></div></form></section>';
    $('#maintenanceForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = $('button[type="submit"]', form); button.disabled = true;
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({
          maintenanceEnabled: form.maintenanceEnabled.checked,
          maintenanceReason: form.maintenanceReason.value.trim() || 'Sistem sedang dalam pemeliharaan.',
          maintenanceReopenAt: form.maintenanceReopenAt.value ? new Date(form.maintenanceReopenAt.value).toISOString() : ''
        }) });
        showDialog('Maintenance tersimpan', 'Pengaturan maintenance sudah diperbarui.', { autoMs: 3000 });
        await applyMaintenance();
      } catch (error) { showDialog('Gagal menyimpan', error.message, { kind: 'error' }); }
      finally { button.disabled = false; }
    });
    $('#announcementForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = $('button[type="submit"]', form); button.disabled = true;
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({
          announcementEnabled: form.announcementEnabled.checked,
          announcementTitle: form.announcementTitle.value.trim() || 'Pengumuman',
          announcementMessage: form.announcementMessage.value.trim(),
          announcementUpdatedAt: new Date().toISOString()
        }) });
        showDialog('Pengumuman tersimpan', 'Pengumuman akan tampil kepada pengguna yang membuka website.', { autoMs: 3000 });
      } catch (error) { showDialog('Gagal menyimpan', error.message, { kind: 'error' }); }
      finally { button.disabled = false; }
    });
  };
  var localInput = function (value) {
    if (!value) return '';
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  var renderRequests = async function () {
    var result = await Promise.all([api('/api/admin/withdrawals'), api('/api/admin/robux'), api('/api/admin/diamond'), api('/api/admin/users')]);
    var requests = [];
    (result[0] || []).forEach(function (item) { requests.push(Object.assign({ kind: 'dana' }, item)); });
    (result[1] || []).forEach(function (item) { requests.push(Object.assign({ kind: 'robux' }, item)); });
    (result[2] || []).forEach(function (item) { requests.push(Object.assign({ kind: 'diamond' }, item)); });
    requests.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    var users = {};
    (result[3] || []).forEach(function (u) { users[u.id] = u.username || u.id; });
    var pending = requests.filter(function (r) { return r.status === 'pending'; }).length;
    state.pendingCount = pending;
    $('#pendingBadge').textContent = String(pending);
    $('#pendingBadge').classList.toggle('hidden', pending === 0);
    $('#viewRoot').innerHTML = '<section class="panel"><div class="panel-heading"><div><h2>Semua request withdraw</h2><p>Request Dana dan Robux tergabung di bawah. Terima hanya setelah pembayaran benar-benar selesai.</p></div><button id="enableNotify" class="button button-soft" type="button">Aktifkan notifikasi</button></div><div class="stack">' + (requests.map(function (item) {
      var id = item.kind === 'dana' ? item.id : item.id;
      var pendingItem = item.status === 'pending';
      var methodText = item.kind === 'dana' ? 'DANA' : item.kind === 'diamond' ? 'DIAMOND FREE FIRE' : 'ROBUX · ' + (item.method === 'gamepass' ? 'Game Pass' : 'Username');
      var debit = item.kind === 'dana' ? item.amount : item.cost;
      var payout = item.kind === 'dana' ? item.payout_amount : null;
      var detail = item.kind === 'dana' ? 'Tujuan: ' + item.destination : item.kind === 'diamond' ? 'UID Free Fire: ' + item.ff_uid + (item.ff_server_id ? ' · Server: ' + item.ff_server_id : '') : 'Username Roblox: ' + item.username + (item.method === 'gamepass' ? ' · Game Pass: ' + item.gamepass_url : '');
      return '<article class="request-card"><div class="card-top"><div><h3>' + esc(methodText) + '</h3><p>@' + esc(users[item.user_id] || 'user') + ' · ' + esc(date(item.created_at)) + '</p></div>' + statusTag(item.status) + '</div>' +
      '<div class="request-meta"><div><small>Saldo dipotong</small><strong>' + cash(debit) + '</strong></div><div><small>' + (item.kind === 'dana' ? 'Dana dikirim' : item.kind === 'diamond' ? 'Jumlah diamond' : 'Jumlah Robux') + '</small><strong>' + (item.kind === 'dana' ? cash(payout == null ? debit : payout) : item.kind === 'diamond' ? esc(item.diamonds + ' diamond') : esc(item.robux + ' Robux')) + '</strong></div></div>' +
      (item.kind === 'dana' ? '<p>' + esc(detail) + ' · Biaya admin ' + cash(item.fee_amount || Math.max(0, Number(debit) - Number(payout == null ? debit : payout))) + '</p>' : '<p>' + esc(detail) + '<br>Tarif: ' + cash(item.rate) + (item.kind === 'diamond' ? ' per diamond' : ' per Robux') + '</p>') +
      (item.review_note ? '<div class="inline-alert danger-alert">Alasan penolakan: ' + esc(item.review_note) + '</div>' : '') +
      (pendingItem ? '<div class="button-row"><button class="button button-danger" type="button" data-review="reject" data-kind="' + item.kind + '" data-id="' + esc(id) + '">Tolak</button><button class="button button-success" type="button" data-review="accept" data-kind="' + item.kind + '" data-id="' + esc(id) + '">Terima</button></div>' : '') +
      '</article>';
    }).join('') || '<div class="empty-state"><b>Belum ada request</b>Request baru akan tampil di antrean ini.</div>') + '</div></section>';
    $('#enableNotify').addEventListener('click', async function () {
      if (!('Notification' in window)) { showDialog('Notifikasi tidak didukung', 'Browser ini tidak menyediakan notifikasi web. Antrean tetap bisa diperiksa lewat menu ini.', { kind: 'warning' }); return; }
      try {
        var permission = await Notification.requestPermission();
        state.notificationReady = permission === 'granted';
        if (state.notificationReady) showDialog('Notifikasi aktif', 'Browser akan memberi notifikasi saat ada request baru selama website terbuka.', { autoMs: 3000 });
        else showDialog('Izin belum diberikan', 'Aktifkan izin notifikasi situs melalui pengaturan browser bila diperlukan.', { kind: 'warning' });
      } catch (e) { showDialog('Notifikasi gagal diaktifkan', 'Browser tidak mengizinkan notifikasi saat ini.', { kind: 'error' }); }
    });
    $$('[data-review]').forEach(function (button) {
      button.addEventListener('click', function () {
        var kind = button.dataset.kind, id = button.dataset.id;
        if (button.dataset.review === 'reject') {
          showPrompt('Tolak request', 'Wajib isi alasan. Saldo yang ditahan akan dikembalikan setelah penolakan berhasil.', 'Contoh: Data tujuan tidak valid', async function (reason) {
            await reviewRequest(kind, id, false, reason);
            await navigate('requests');
            return { title: 'Request ditolak', message: 'Alasan tersimpan dan saldo yang ditahan sudah dikembalikan.', options: { autoMs: 3000, kind: 'warning', icon: '×' } };
          });
        } else {
          showDialog('Konfirmasi penyelesaian', 'Pastikan Dana/Robux sudah benar-benar dikirim sebelum mengonfirmasi request ini.', { kind: 'warning', icon: '!' });
          var layer = $('#dialogLayer');
          var oldOk = $('#dialogOk');
          oldOk.textContent = 'Sudah selesai, terima';
          oldOk.className = 'button button-success';
          oldOk.addEventListener('click', async function acceptClick() {
            try {
              await reviewRequest(kind, id, true, '');
              closeDialog();
              showDialog('WITHDRAW DITERIMA', 'Request berhasil ditandai selesai.', { autoMs: 2000, icon: '✓' });
              await navigate('requests');
            } catch (error) { closeDialog(); showDialog('Belum berhasil', error.message, { kind: 'error' }); }
          }, { once: true });
        }
      });
    });
  };
  var reviewRequest = async function (kind, id, accept, note) {
    var route = kind === 'dana' ? 'withdrawals' : kind === 'diamond' ? 'diamond' : 'robux';
    var status = accept ? (kind === 'dana' ? 'paid' : 'completed') : 'rejected';
    await api('/api/admin/' + route + '/' + encodeURIComponent(id) + '/review', { method: 'POST', body: JSON.stringify({ status: status, note: note }) });
  };
  var renderJobReviews = async function () {
    var results = await Promise.all([api('/api/admin/submissions'), api('/api/admin/users'), api('/api/admin/jobs')]);
    var users = {}, jobs = {};
    (results[1] || []).forEach(function (item) { users[item.id] = item.username || item.id; });
    (results[2] || []).forEach(function (item) { jobs[item.id] = item; });
    var submissions = (results[0] || []).slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    var html = submissions.map(function (item) {
      var job = jobs[item.job_id] || {};
      return '<article class="request-card"><div class="card-top"><div><h3>' + esc(job.title || ('Job #' + item.job_id)) + '</h3><p>@' + esc(users[item.user_id] || 'user') + ' · ' + esc(date(item.created_at)) + '</p></div>' + statusTag(item.status) + '</div>' +
        '<div class="request-meta"><div><small>Reward job</small><strong>' + cash(job.reward || 0) + '</strong></div><div><small>Kuota terpakai</small><strong>' + esc(job.quota_used || 0) + '/' + esc(job.quota == null ? '∞' : job.quota) + '</strong></div></div>' +
        (item.note ? '<p>' + esc(item.note) + '</p>' : '<p class="subtle">Tidak ada catatan dari pengguna.</p>') +
        (item.proof_url ? '<div class="button-row"><button class="button button-outline" type="button" data-proof-id="' + esc(item.id) + '">Lihat foto bukti</button></div>' : '<p class="subtle">Foto bukti tidak dilampirkan.</p>') +
        (item.review_note ? '<div class="inline-alert ' + (item.status === 'rejected' ? 'danger-alert' : '') + '">Catatan admin: ' + esc(item.review_note) + '</div>' : '') +
        (item.status === 'pending' ? '<div class="button-row"><button class="button button-danger" type="button" data-job-review="reject" data-id="' + esc(item.id) + '">Tolak</button><button class="button button-success" type="button" data-job-review="accept" data-id="' + esc(item.id) + '">Setujui reward</button></div>' : '') +
        '</article>';
    }).join('');
    $('#viewRoot').innerHTML = '<section class="panel"><div class="panel-heading"><div><h2>Pengajuan job</h2><p>Reward masuk setelah pengajuan disetujui. Penolakan butuh alasan dan membebaskan satu kuota job.</p></div></div><div class="stack">' + (html || '<div class="empty-state">Belum ada pengajuan job.</div>') + '</div></section>';
    $$('[data-proof-id]').forEach(function (button) {
      button.addEventListener('click', async function () {
        button.disabled = true;
        try {
          var proof = await api('/api/submissions/' + encodeURIComponent(button.dataset.proofId) + '/proof');
          var layer = $('#dialogLayer');
          closeDialog();
          layer.innerHTML = '<section class="dialog-card" role="dialog" aria-modal="true"><h2 style="margin-bottom:12px">Foto bukti job</h2><img src="' + esc(proof.url) + '" alt="Foto bukti pengajuan" style="display:block;max-width:100%;max-height:65dvh;object-fit:contain;margin:0 auto;border-radius:12px"><div class="dialog-actions"><button id="proofOk" class="button button-primary" type="button">OK</button></div></section>';
          layer.classList.remove('hidden');
          $('#proofOk').addEventListener('click', closeDialog);
        } catch (error) { showDialog('Bukti tidak dapat dibuka', error.message, { kind: 'error' }); }
        finally { button.disabled = false; }
      });
    });
    $$('[data-job-review]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.dataset.id;
        if (button.dataset.jobReview === 'reject') {
          showPrompt('Tolak pengajuan job', 'Isi alasan penolakan agar pengguna tahu apa yang perlu diperbaiki.', 'Jelaskan alasan penolakan', async function (reason) {
            await api('/api/admin/submissions/' + encodeURIComponent(id) + '/review', { method: 'POST', body: JSON.stringify({ status: 'rejected', note: reason }) });
            await navigate('review-jobs');
            return { title: 'Pengajuan ditolak', message: 'Alasan tersimpan dan satu kuota job dibebaskan.', options: { autoMs: 3000, kind: 'warning', icon: '×' } };
          });
        } else {
          var selected = (results[0] || []).find(function (x) { return String(x.id) === String(id); });
          var selectedJob = selected ? jobs[selected.job_id] : null;
          showDialog('Setujui pengajuan?', 'Saldo reward ' + cash(selectedJob ? selectedJob.reward : 0) + ' akan ditambahkan ke akun pengguna jika disetujui.', { kind: 'warning', icon: '!' });
          $('#dialogOk').textContent = 'Setujui reward';
          $('#dialogOk').className = 'button button-success';
          $('#dialogOk').addEventListener('click', async function acceptJob() {
            try {
              var res = await api('/api/admin/submissions/' + encodeURIComponent(id) + '/review', { method: 'POST', body: JSON.stringify({ status: 'approved', note: '' }) });
              closeDialog();
              await navigate('review-jobs');
              showDialog('Job disetujui', 'Reward sudah ditambahkan ke saldo pengguna.', { autoMs: 3000 });
            } catch (error) { closeDialog(); showDialog('Belum berhasil', error.message, { kind: 'error' }); }
          }, { once: true });
        }
      });
    });
  };
  var renderCodes = async function () {
    var codes = await api('/api/admin/codes');
    $('#viewRoot').innerHTML = '<section class="panel"><div class="panel-heading"><div><h2>Buat Unickcode</h2><p>Kode dapat dipakai setiap akun satu kali. Setelah batas penerima tercapai, kode otomatis habis.</p></div></div><form id="codeForm" class="form-grid"><label class="field"><span>UNICKCODE</span><input name="code" minlength="2" maxlength="80" required placeholder="Contoh: TESTING"></label><label class="field"><span>JUMLAH REWARD (Rp)</span><input name="reward" type="number" min="1" step="1" required placeholder="1000"></label><label class="field"><span>JUMLAH PENERIMA</span><input name="max_uses" type="number" min="1" step="1" required placeholder="10"></label><div class="wide"><button class="button button-primary" type="submit">Buat kode</button></div></form></section><section class="panel"><div class="panel-heading"><div><h2>Kode yang dibuat</h2></div></div><div class="stack">' + ((codes || []).map(function (code) {
      return '<article class="code-row"><div><strong>' + esc(code.code) + '</strong><small>Reward ' + cash(code.reward) + ' · Dipakai ' + esc(code.used_count) + '/' + esc(code.max_uses) + '</small></div><span class="status ' + (code.active && Number(code.used_count) < Number(code.max_uses) ? 'success' : 'rejected') + '">' + (code.active && Number(code.used_count) < Number(code.max_uses) ? 'AKTIF' : 'HABIS') + '</span></article>';
    }).join('') || '<div class="empty-state">Belum ada kode yang dibuat.</div>') + '</div></section>';
    $('#codeForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = $('button[type="submit"]', form); button.disabled = true;
      try {
        await api('/api/admin/codes', { method: 'POST', body: JSON.stringify({ code: form.code.value.trim(), reward: Number(form.reward.value), max_uses: Number(form.max_uses.value) }) });
        showDialog('Unickcode dibuat', 'Kode dapat digunakan sampai jumlah penerima yang kamu tentukan tercapai.', { autoMs: 3000 });
        await navigate('codes');
      } catch (error) { showDialog('Gagal membuat kode', error.message, { kind: 'error' }); }
      finally { button.disabled = false; }
    });
  };
  var renderCreateJob = function () {
    $('#viewRoot').innerHTML = '<section class="panel"><div class="panel-heading"><div><h2>Job baru</h2><p>Kuota menghitung pengajuan yang masih aktif dan yang disetujui. Pengajuan yang ditolak membebaskan satu kuota.</p></div></div><form id="jobCreateForm" class="form-grid">' +
      '<label class="field wide"><span>NAMA JOB</span><input name="title" maxlength="160" required placeholder="Nama pekerjaan"></label>' +
      '<label class="field wide"><span>DESKRIPSI</span><textarea name="description" maxlength="4000" required placeholder="Jelaskan langkah-langkah pengerjaan"></textarea></label>' +
      '<label class="field wide"><span>LINK JOB (opsional)</span><input name="link" type="url" maxlength="1000" placeholder="https://..."></label>' +
      '<label class="field"><span>REWARD (Rp)</span><input name="reward" type="number" min="0" step="1" required placeholder="1000"></label>' +
      '<label class="field"><span>KUOTA</span><input name="quota" type="number" min="1" step="1" required placeholder="10"></label>' +
      '<label class="check-row wide"><span>Wajib kirim gambar bukti</span><span class="switch"><input name="photo_required" type="checkbox"><span></span></span></label>' +
      '<div class="wide"><button class="button button-primary" type="submit">Buat job</button></div></form></section>';
    $('#jobCreateForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = $('button[type="submit"]', form); button.disabled = true;
      try {
        await api('/api/admin/jobs', { method: 'POST', body: JSON.stringify({ title: form.title.value.trim(), description: form.description.value.trim(), link: form.link.value.trim(), reward: Number(form.reward.value), quota: Number(form.quota.value), photo_required: form.photo_required.checked }) });
        showDialog('Job berhasil dibuat', 'Job kini muncul di dashboard pengguna dan kuotanya akan diperbarui otomatis.', { autoMs: 3000 });
        await navigate('create-job');
      } catch (error) { showDialog('Job gagal dibuat', error.message, { kind: 'error' }); }
      finally { button.disabled = false; }
    });
  };
  var renderPayoutSettings = async function () {
    var result = await api('/api/admin/settings'), cfg = {};
    (result || []).forEach(function (item) { cfg[item.key] = item.value; });
    var rates = {
      gamepass: cfg.gamepassRate == null ? 170 : cfg.gamepassRate,
      username: cfg.usernameRate == null ? 230 : cfg.usernameRate,
      diamond: cfg.diamondRate == null ? 0 : cfg.diamondRate,
      dana: cfg.danaFee == null ? 2000 : cfg.danaFee
    };
    $('#viewRoot').innerHTML = '<div class="withdraw-tabs settings-tabs" id="settingsTabs" role="tablist" aria-label="Kategori setting"><span class="withdraw-tab-slider" aria-hidden="true"></span><button class="withdraw-tab active" type="button" id="settingsPayoutTab" role="tab" aria-selected="true">Penarikan</button><button class="withdraw-tab" type="button" id="settingsReferralTab" role="tab" aria-selected="false">Referral</button></div><div id="settingsPanel"></div>';
    var panel = $('#settingsPanel');
    var showSection = function (which) {
      $('#settingsTabs').classList.toggle('is-dana', which === 'referral');
      $('#settingsPayoutTab').classList.toggle('active', which === 'payout');
      $('#settingsReferralTab').classList.toggle('active', which === 'referral');
      $('#settingsPayoutTab').setAttribute('aria-selected', String(which === 'payout'));
      $('#settingsReferralTab').setAttribute('aria-selected', String(which === 'referral'));
      if (which === 'payout') {
        panel.innerHTML = '<section class="panel"><div class="panel-heading"><div><h2>Harga dan biaya penarikan</h2><p>Pengaturan berlaku untuk permintaan baru.</p></div></div><form id="payoutForm" class="form-grid">' +
          '<label class="field wide"><span>Jenis pengaturan</span><select name="method" id="payoutMethod"><option value="gamepass">Robux — Game Pass</option><option value="username">Robux — Via Username</option><option value="diamond">Diamond Free Fire</option><option value="dana">DANA</option></select></label>' +
          '<label class="field wide"><span id="payoutLabel">Harga per 1 Robux (Rp)</span><input id="payoutValue" name="value" type="number" min="0" max="1000000000" step="1" required></label>' +
          '<label class="field wide"><span>Minimum Robux</span><input id="robuxMinSetting" type="number" min="1" max="1000000" step="1" value="' + esc(cfg.robuxMin == null ? 10 : cfg.robuxMin) + '" required></label>' +
          '<label class="field wide"><span>Minimum diamond FF</span><input id="diamondMinSetting" type="number" min="1" max="1000000" step="1" value="' + esc(cfg.diamondMin == null ? 1 : cfg.diamondMin) + '" required></label>' +
          '<div class="currency-note wide" id="payoutHelp">Tarif yang disimpan digunakan untuk permintaan baru.</div><div class="wide"><button class="button button-primary" type="submit">Simpan setting penarikan</button></div></form></section>';
        var method = $('#payoutMethod'), value = $('#payoutValue'), label = $('#payoutLabel'), help = $('#payoutHelp');
        var update = function () {
          value.value = rates[method.value];
          label.textContent = method.value === 'dana' ? 'Biaya admin DANA (Rp)' : method.value === 'diamond' ? 'Harga per 1 diamond FF (Rp)' : 'Harga per 1 Robux (Rp)';
          help.textContent = method.value === 'dana' ? 'Biaya dipotong dari nominal saldo yang diminta; sisa nominal dikirim ke DANA.' : method.value === 'diamond' ? 'Harga dikalikan jumlah diamond. Admin mengirim diamond secara manual setelah permintaan disetujui.' : 'Tarif per Robux dikalikan jumlah Robux.';
        };
        method.addEventListener('change', update); update();
        $('#payoutForm').addEventListener('submit', async function (event) {
          event.preventDefault();
          var button = $('button[type="submit"]', event.currentTarget), amount = Number(value.value), minRobux = Number($('#robuxMinSetting').value), minDiamond = Number($('#diamondMinSetting').value);
          if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000 || (method.value !== 'dana' && method.value !== 'diamond' && amount < 1)) { showDialog('Nominal tidak valid', 'Masukkan angka harga/biaya yang valid.', { kind: 'error' }); return; }
          if (!Number.isSafeInteger(minRobux) || minRobux < 1 || !Number.isSafeInteger(minDiamond) || minDiamond < 1) { showDialog('Batas minimum tidak valid', 'Minimum Robux dan diamond harus minimal 1.', { kind: 'error' }); return; }
          button.disabled = true;
          try {
            var payload = { robuxMin: minRobux, diamondMin: minDiamond };
            if (method.value === 'dana') payload.danaFee = amount;
            if (method.value === 'diamond') payload.diamondRate = amount;
            if (method.value === 'gamepass') payload.gamepassRate = amount;
            if (method.value === 'username') payload.usernameRate = amount;
            await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
            showDialog('Setting tersimpan', 'Harga dan biaya penarikan berhasil diperbarui.', { autoMs: 2500 });
            await renderPayoutSettings();
          } catch (error) { showDialog('Setting gagal disimpan', error.message, { kind: 'error' }); }
          finally { button.disabled = false; }
        });
      } else {
        panel.innerHTML = '<section class="panel"><div class="panel-heading"><div><h2>Reward referral</h2><p>Bonus diberikan kepada kedua pihak setelah email terverifikasi dan job pertama disetujui. Jumlah undangan tidak dibatasi.</p></div></div><form id="referralSettingsForm" class="form-grid">' +
          '<label class="field wide"><span>Reward untuk pengundang (Rp)</span><input name="referralInviterReward" type="number" min="0" max="1000000000" step="1" value="' + esc(cfg.referralInviterReward == null ? 0 : cfg.referralInviterReward) + '" required></label>' +
          '<label class="field wide"><span>Reward untuk pengguna baru (Rp)</span><input name="referralInviteeReward" type="number" min="0" max="1000000000" step="1" value="' + esc(cfg.referralInviteeReward == null ? 0 : cfg.referralInviteeReward) + '" required></label>' +
          '<div class="currency-note wide">Reward masuk langsung ke saldo setelah kriteria terpenuhi. Isi 0 untuk menonaktifkan reward bagi pihak terkait.</div><div class="wide"><button class="button button-primary" type="submit">Simpan reward referral</button></div></form></section>';
        $('#referralSettingsForm').addEventListener('submit', async function (event) {
          event.preventDefault();
          var form = event.currentTarget, button = $('button[type="submit"]', form), inviter = Number(form.referralInviterReward.value), invitee = Number(form.referralInviteeReward.value);
          if (![inviter, invitee].every(function (n) { return Number.isSafeInteger(n) && n >= 0 && n <= 1000000000; })) { showDialog('Reward tidak valid', 'Reward harus berupa angka bulat nol atau lebih.', { kind: 'error' }); return; }
          button.disabled = true;
          try {
            await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ referralInviterReward: inviter, referralInviteeReward: invitee }) });
            showDialog('Reward referral tersimpan', 'Reward untuk kedua pihak berhasil diperbarui.', { autoMs: 2500 });
            await renderPayoutSettings();
            showSection('referral');
          } catch (error) { showDialog('Gagal menyimpan reward', error.message, { kind: 'error' }); }
          finally { button.disabled = false; }
        });
      }
    };
    $('#settingsPayoutTab').addEventListener('click', function () { showSection('payout'); });
    $('#settingsReferralTab').addEventListener('click', function () { showSection('referral'); });
    showSection('payout');
  };
  var startRequestPolling = function () {
    clearInterval(state.pollTimer);
    if (!state.user || state.user.role !== 'admin') return;
    var check = async function () {
      try {
        var r = await Promise.all([api('/api/admin/withdrawals'), api('/api/admin/robux'), api('/api/admin/diamond')]);
        var count = (r[0] || []).filter(function (x) { return x.status === 'pending'; }).length + (r[1] || []).filter(function (x) { return x.status === 'pending'; }).length + (r[2] || []).filter(function (x) { return x.status === 'pending'; }).length;
        if (state.pendingCount !== null && count > state.pendingCount && state.notificationReady && 'Notification' in window) new Notification('Request withdraw baru', { body: 'Ada ' + (count - state.pendingCount) + ' request baru di antrean.' });
        state.pendingCount = count;
        $('#pendingBadge').textContent = String(count);
        $('#pendingBadge').classList.toggle('hidden', count === 0);
      } catch (e) { /* antrean dicoba lagi pada interval berikutnya */ }
    };
    check();
    state.pollTimer = setInterval(check, 30000);
  };
  var bindTopLevel = function () {
    try { var refParam = new URLSearchParams(window.location.search).get('ref'); if (refParam && !$('#registerReferral').value) $('#registerReferral').value = refParam.toUpperCase().slice(0, 24); } catch (e) {}
    $('#switchAuth').addEventListener('click', function () { setAuthMode($('#registerForm').classList.contains('hidden') ? 'register' : 'login'); });
    $('#registerForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = $('button[type="submit"]', form), username = form.username.value.trim(), email = form.email.value.trim().toLowerCase(), password = form.password.value;
      if (password !== form.confirm.value) { authMessage('Konfirmasi password tidak sama.'); return; }
      button.disabled = true; button.textContent = 'Mengirim kode…';
      try {
        var result = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: username, email: email, password: password, referralCode: form.referralCode.value.trim() }) });
        state.pendingEmail = email;
        $('#verifyEmail').value = email;
        setAuthMode('verify');
        authMessage(result.message || 'Kode verifikasi diminta dikirim ke email kamu.');
      } catch (error) { authMessage(error.message); }
      finally { button.disabled = false; button.textContent = 'Daftar'; }
    });
    $('#verifyForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = $('button[type="submit"]', form), email = form.email.value.trim().toLowerCase(), code = form.code.value.trim();
      button.disabled = true; button.textContent = 'Memverifikasi…';
      try {
        var result = await api('/api/email/verify', { method: 'POST', body: JSON.stringify({ email: email, code: code }) });
        state.pendingEmail = '';
        await setLoggedIn(result.user);
        say('Email berhasil diverifikasi.');
      } catch (error) { authMessage(error.message); }
      finally { button.disabled = false; button.textContent = 'Verifikasi email'; }
    });
    $('#resendCode').addEventListener('click', async function () {
      var email = $('#verifyEmail').value.trim().toLowerCase(), button = $('#resendCode');
      button.disabled = true; button.textContent = 'Meminta kode…';
      try {
        var result = await api('/api/email/resend', { method: 'POST', body: JSON.stringify({ email: email }) });
        authMessage(result.message || 'Kode baru diminta dikirim. Periksa inbox dan folder spam.');
      } catch (error) { authMessage(error.message); }
      finally { button.disabled = false; button.textContent = 'Kirim ulang kode'; }
    });
    $('#loginForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = $('button[type="submit"]', form);
      button.disabled = true; button.textContent = 'Memeriksa…';
      try {
        var result = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value }) });
        showDialog('Login berhasil', 'Kamu akan dialihkan ke dashboard dalam 3 detik.', { autoMs: 3000, onClose: function () { setLoggedIn(result.user); } });
      } catch (error) { authMessage(error.message); }
      finally { button.disabled = false; button.textContent = 'Login'; }
    });
    $('#menuButton').addEventListener('click', function () { toggleMenu(); });
    $('#closeMenu').addEventListener('click', function () { toggleMenu(false); });
    $('#drawerShade').addEventListener('click', function () { toggleMenu(false); });
    $$('.nav-link[data-view]').forEach(function (button) { button.addEventListener('click', function () { navigate(button.dataset.view); }); });
    var logout = async function () {
      try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) { /* UI still returns to login */ }
      closeDialog(); setLoggedOut(); showDialog('Sudah keluar', 'Kamu telah keluar dari akun.', { autoMs: 2500 });
    };
    $('#logoutButton').addEventListener('click', function () { showDialog('Keluar akun?', 'Sesi kamu akan ditutup.', { kind: 'warning' }); $('#dialogOk').textContent = 'Ya, keluar'; $('#dialogOk').addEventListener('click', logout, { once: true }); });
    $('#drawerLogout').addEventListener('click', logout);
    $('#refreshButton').addEventListener('click', function () { navigate(state.view).then(function () { say('Data diperbarui.'); }).catch(function () { /* navigasi menampilkan pesan error */ }); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.maintenance && state.maintenance.enabled) { event.preventDefault(); return; }
      if (event.key === 'Escape') closeMenu();
    });
  };
  var boot = async function () {
    try {
      var result = await api('/api/me');
      await setLoggedIn(result.user);
    } catch (e) {
      setLoggedOut();
    }
  };
  bindTopLevel();
  setAuthMode('register');
  boot();
})();