// Pengaturan (biaya, batas waktu, slot) diambil dari server lewat /api/config, bukan ditulis di sini.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initial = (s) => (String(s || '?').trim().charAt(0) || '?').toUpperCase();

let CONFIG = { fee: 150000, basePrize: 100000, prizePerTeam: 150000, maxTeams: 32, minPlayers: 5, maxPlayers: 7, closeAt: '2026-12-24T23:59:00+07:00', tournamentAt: '2026-12-25T00:00:00+07:00', closedReason: null, paidCount: 0 };

$('#yr').textContent = new Date().getFullYear();

/* Menu mobile */
const links = $('#links');
$('#burger').addEventListener('click', () => {
  const open = links.classList.toggle('open');
  $('#burger').setAttribute('aria-expanded', String(open));
});
links.addEventListener('click', (e) => {
  if (e.target.tagName === 'A') { links.classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false'); }
});

/* Animasi muncul saat di-scroll */
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 })
  : null;
$$('.reveal').forEach((n) => (io ? io.observe(n) : n.classList.add('in')));

/* Konfigurasi, prize pool, slot */
let lastPrize = null;
function renderConfig() {
  const c = CONFIG;
  // Angka live belum tersedia (server belum tersambung ke database) → tampilkan "…" bukan angka yang salah
  const known = c.prizeTotal !== null && c.prizeTotal !== undefined;
  const prize = known ? c.prizeTotal : null;
  const left = Math.max(0, c.maxTeams - (c.paidCount || 0));
  const el = $('#prizeTotal');
  el.textContent = known ? rupiah(prize) : 'Rp…';
  if (known && lastPrize !== null && prize !== lastPrize) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  if (known) lastPrize = prize;

  $('#st-fee').textContent = rupiah(c.fee);
  $('#st-prize').textContent = known ? rupiah(prize) : '…';
  $('#st-slots').textContent = known ? `${c.paidCount}/${c.maxTeams}` : `…/${c.maxTeams}`;
  $('#feeAbout').textContent = rupiah(c.fee);
  $('#feeBox').textContent = rupiah(c.fee);
  $('#poolBase').textContent = rupiah(c.basePrize);
  $('#poolPerTeam').textContent = rupiah(c.prizePerTeam);
  $('#poolPer').textContent = rupiah(c.prizePerTeam);
  $('#poolTeamCount').textContent = known ? c.paidCount : '…';
  $('#poolSlotsLeft').textContent = known ? left : '…';
  $('#slotNow').textContent = known ? c.paidCount : '…';
  $('#slotMax').textContent = c.maxTeams;
  $('#slotFill').style.width = Math.min(100, ((c.paidCount || 0) / c.maxTeams) * 100) + '%';
  $('#payBtn').textContent = `Lanjut ke Pembayaran · ${rupiah(c.fee)}`;
  setClosed(c.closedReason);
  if (c.contactWa) {
    const wa = 'https://wa.me/' + c.contactWa + '?text=' + encodeURIComponent('Halo panitia HIRE CUP Vol 2, saya mau tanya soal pendaftaran.');
    ['#contactBtn', '#waFloat'].forEach((s) => { $(s).href = wa; $(s).classList.remove('hidden'); });
    const shown = c.contactWa.replace(/^62/, '0').replace(/^(\d{4})(\d{4})(\d+)$/, '$1-$2-$3');
    $('#trustContact').innerHTML = 'WhatsApp <a href="' + wa + '" target="_blank" rel="noopener">' + esc(shown) + '</a>';
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error();
    CONFIG = { ...CONFIG, ...(await res.json()) };
    const live = CONFIG.dbReady !== false;
    $('#poolLive').classList.toggle('off', !live);
    $('#poolLiveText').textContent = live ? 'LIVE' : 'MENYAMBUNGKAN…';
  } catch (_) {
    $('#poolLive').classList.add('off');
    $('#poolLiveText').textContent = 'GAGAL MEMUAT';
  }
  renderConfig();
  startCountdown();
  refreshPlayers();
}

function setClosed(reason) {
  $('#regClosed').classList.toggle('hidden', !reason);
  $('#regClosedReason').textContent = reason || '';
  $('#regForm').classList.toggle('hidden', !!reason);
}

/* Daftar tim lunas */
let teams = [];
function renderTeams() {
  const grid = $('#teamsGrid');
  const q = $('#teamSearch').value.trim().toLowerCase();
  const list = teams.filter((t) => !q || t.teamName.toLowerCase().includes(q));
  if (!teams.length) {
    grid.innerHTML = '<div class="empty">Belum ada tim yang terdaftar. Jadilah yang pertama!</div>';
    return;
  }
  if (!list.length) {
    grid.innerHTML = '<div class="empty">Tidak ada tim dengan nama itu.</div>';
    return;
  }
  grid.innerHTML = list.map((t) => `<div class="team"><div class="av">${esc(initial(t.teamName))}</div><div><div class="nm" title="${esc(t.teamName)}">${esc(t.teamName)}</div><div class="id">✓ LUNAS</div></div></div>`).join('');
}
async function loadTeams() {
  try {
    const res = await fetch('/api/teams');
    if (!res.ok) throw new Error();
    teams = await res.json();
    renderTeams();
  } catch (_) {
    $('#teamsGrid').innerHTML = '<div class="empty">Gagal memuat daftar tim. Coba muat ulang halaman.</div>';
  }
}
$('#teamSearch').addEventListener('input', renderTeams);

/* Countdown: sampai pendaftaran ditutup, lalu sampai turnamen dimulai */
let cdTimer;
const fmtDate = (t, withTime) => new Date(t).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Asia/Jakarta' });
function startCountdown() {
  clearInterval(cdTimer);
  const closeAt = new Date(CONFIG.closeAt).getTime();
  const startAt = new Date(CONFIG.tournamentAt).getTime();
  const set = (k, v) => { $(`[data-cd="${k}"]`).textContent = v; };
  const tick = () => {
    const now = Date.now();
    let target;
    if (now < closeAt) {
      target = closeAt;
      $('#cdTitle').textContent = 'PENDAFTARAN DITUTUP DALAM';
      $('#closeLabel').textContent = `Pendaftaran ditutup ${fmtDate(closeAt, true)} WIB · Turnamen ${fmtDate(startAt)}`;
    } else {
      target = startAt;
      $('#cdTitle').textContent = now < startAt ? 'TURNAMEN DIMULAI DALAM' : 'TURNAMEN SEDANG BERLANGSUNG';
      $('#closeLabel').textContent = `Pendaftaran sudah ditutup · Turnamen ${fmtDate(startAt)}`;
      if (!CONFIG.closedReason) setClosed('Pendaftaran sudah ditutup.');
    }
    const s = Math.floor(Math.max(0, target - now) / 1000);
    set('d', pad(Math.floor(s / 86400)));
    set('h', pad(Math.floor((s % 86400) / 3600)));
    set('m', pad(Math.floor((s % 3600) / 60)));
    set('s', pad(s % 60));
    if (now >= startAt) clearInterval(cdTimer);
  };
  tick();
  cdTimer = setInterval(tick, 1000);
}

/* Bracket resmi (dari panitia) */
async function loadBracket() {
  const box = $('#bracketBox');
  const note = $('#bracketNote');
  let data = { published: false, rounds: [] };
  try {
    const res = await fetch('/api/bracket');
    if (res.ok) data = await res.json();
  } catch (_) {}

  const slot = (name, score, cls) => `<div class="slot ${cls}"><span class="nm" title="${esc(name)}">${esc(name)}</span><span class="sc">${score ?? '-'}</span></div>`;

  if (!data.published || !data.rounds.length) {
    note.textContent = 'Bracket resmi diumumkan setelah pendaftaran ditutup dan undian dilakukan panitia.';
    const names = ['32 Besar', '16 Besar', 'Perempat Final', 'Semi Final', 'Grand Final'];
    box.innerHTML = names.map((n, ri) => `<div class="round${ri === 4 ? ' last' : ''}"><h4>${n}</h4><div class="rb">${
      Array.from({ length: 16 >> ri }, () => `<div class="match">${slot('TBD', null, 'tbd')}${slot('TBD', null, 'tbd')}</div>`).join('')
    }</div></div>`).join('');
    $('#champion').classList.add('hidden');
    return;
  }

  note.textContent = 'Bracket resmi — diperbarui panitia setiap pertandingan selesai.';
  const side = (t, score, m) => {
    if (!t) return slot(m.winner ? 'BYE' : 'Menunggu…', null, 'tbd');
    return slot(t.name, score, m.winner === t.id ? 'won' : '');
  };
  const last = data.rounds.length - 1;
  box.innerHTML = data.rounds.map((r, ri) => `<div class="round${ri === last ? ' last' : ''}"><h4>${esc(r.name)}</h4><div class="rb">${
    r.matches.map((m) => `<div class="match${m.winner ? ' done' : ''}">${side(m.a, m.scoreA, m)}${side(m.b, m.scoreB, m)}</div>`).join('')
  }</div></div>`).join('');

  const fin = data.rounds[last].matches[0];
  const champ = fin && fin.winner && [fin.a, fin.b].find((t) => t && t.id === fin.winner);
  $('#champion').classList.toggle('hidden', !champ);
  if (champ) $('#championName').textContent = 'JUARA: ' + champ.name;
}

/* Roster pemain dinamis */
const list = $('#playerList');
const addBtn = $('#addPlayerBtn');
function playerRow() {
  const row = document.createElement('div');
  row.className = 'prow';
  row.innerHTML = `
    <div class="prow-h"><b class="row-title"></b><button type="button" class="remove-btn">Hapus</button></div>
    <div class="pgrid">
      <div class="nick"><input class="field" data-f="nick" maxlength="40" placeholder="Nickname" aria-label="Nickname"><p class="err" data-perr="nick"></p></div>
      <div><input class="field" data-f="uid" inputmode="numeric" maxlength="12" placeholder="User ID" aria-label="User ID"><p class="err" data-perr="uid"></p></div>
      <div><input class="field" data-f="sid" inputmode="numeric" maxlength="6" placeholder="Server ID" aria-label="Server ID"><p class="err" data-perr="sid"></p></div>
    </div>`;
  row.querySelector('.remove-btn').addEventListener('click', () => {
    if (list.children.length > CONFIG.minPlayers) { row.remove(); refreshPlayers(); }
  });
  return row;
}
function refreshPlayers() {
  const rows = [...list.children];
  rows.forEach((r, i) => {
    r.querySelector('.row-title').innerHTML = 'Pemain ' + (i + 1) + (i >= CONFIG.minPlayers ? '<em>CADANGAN</em>' : '');
    r.querySelector('.remove-btn').classList.toggle('hidden', rows.length <= CONFIG.minPlayers);
  });
  $('#playerCount').textContent = `${rows.length}/${CONFIG.maxPlayers}`;
  addBtn.disabled = rows.length >= CONFIG.maxPlayers;
}
addBtn.addEventListener('click', () => {
  if (list.children.length < CONFIG.maxPlayers) { list.appendChild(playerRow()); refreshPlayers(); }
});
for (let i = 0; i < CONFIG.minPlayers; i++) list.appendChild(playerRow());
refreshPlayers();

/* Validasi di browser (server tetap memvalidasi ulang) */
function collectForm() {
  return {
    teamName: $('#teamName').value.trim(),
    captainWa: $('#captainWa').value.trim(),
    players: [...list.children].map((row) => ({
      nick: row.querySelector('[data-f="nick"]').value.trim(),
      uid: row.querySelector('[data-f="uid"]').value.trim(),
      sid: row.querySelector('[data-f="sid"]').value.trim(),
    })),
  };
}
function clearErrors() {
  $$('#regForm .err').forEach((e) => { e.textContent = ''; });
  $$('#regForm .field').forEach((f) => f.removeAttribute('aria-invalid'));
  $('#formError').textContent = '';
}
function showErrors(fields) {
  const mark = (input, errEl, msg) => { if (!msg) return; errEl.textContent = msg; input.setAttribute('aria-invalid', 'true'); };
  mark($('#teamName'), $('[data-err="teamName"]'), fields.teamName);
  mark($('#captainWa'), $('[data-err="captainWa"]'), fields.captainWa);
  (fields.playerRows || []).forEach((pe, i) => {
    const row = list.children[i];
    if (!row) return;
    ['nick', 'uid', 'sid'].forEach((k) => mark(row.querySelector(`[data-f="${k}"]`), row.querySelector(`[data-perr="${k}"]`), pe[k]));
  });
  if (fields.players) $('#formError').textContent = fields.players;
  const first = $('#regForm [aria-invalid="true"]');
  if (first) first.focus();
}
function validateLocal(d) {
  const f = {};
  if (d.teamName.length < 2 || d.teamName.length > 30) f.teamName = 'Nama tim 2–30 karakter.';
  let wa = d.captainWa.replace(/\D/g, '');
  if (wa.startsWith('0')) wa = '62' + wa.slice(1);
  else if (wa.startsWith('8')) wa = '62' + wa;
  if (!/^628\d{7,12}$/.test(wa)) f.captainWa = 'Nomor WhatsApp tidak valid (contoh: 08123456789).';
  const rows = d.players.map((p) => {
    const e = {};
    if (!p.nick) e.nick = 'Wajib diisi';
    if (!/^\d{5,12}$/.test(p.uid)) e.uid = 'User ID 5–12 angka';
    if (!/^\d{3,6}$/.test(p.sid)) e.sid = 'Server ID 3–6 angka';
    return e;
  });
  if (rows.some((e) => Object.keys(e).length)) f.playerRows = rows;
  const uids = d.players.map((p) => p.uid).filter(Boolean);
  if (new Set(uids).size !== uids.length) f.players = 'Ada User ID yang sama dipakai lebih dari satu pemain.';
  return f;
}

$('#regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  const data = collectForm();
  const local = validateLocal(data);
  if (Object.keys(local).length) {
    showErrors(local);
    if (!local.players) $('#formError').textContent = 'Periksa lagi kolom yang ditandai merah.';
    return;
  }
  const payBtn = $('#payBtn');
  payBtn.disabled = true;
  payBtn.textContent = 'Membuat tagihan pembayaran…';
  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (out.fields) showErrors(out.fields);
      throw new Error(out.error || 'Gagal mendaftar.');
    }
    // Simpan kode pesanan supaya bisa dibuka lagi walau pindah aplikasi saat membayar
    try { localStorage.setItem('lastOrder', out.orderId); } catch (_) {}
    // QRIS tampil langsung di website; halaman WaroengPay hanya cadangan kalau QRIS tidak tersedia
    window.location.href = out.hasQris ? '/?order=' + encodeURIComponent(out.orderId) : out.payUrl;
  } catch (err) {
    $('#formError').textContent = err.message;
    payBtn.disabled = false;
    payBtn.textContent = `Lanjut ke Pembayaran · ${rupiah(CONFIG.fee)}`;
  }
});

/* Halaman status setelah kembali dari WaroengPay: /?order=KODE */
function showStatus(orderId) {
  $('#site').classList.add('hidden');
  $('#view-status').classList.remove('hidden');
  window.scrollTo({ top: 0 });
  $('#pCode').textContent = orderId;
  let tries = 0;
  let haveQr = false;
  const poll = async () => {
    tries++;
    let r;
    try {
      // Gambar QR cukup diambil sekali; pengecekan berikutnya hanya status
      const res = await fetch('/api/registrations/' + encodeURIComponent(orderId) + (haveQr ? '?qr=0' : ''));
      r = await res.json();
      if (res.status === 404) return renderPending({ status: 'NotFound' });
      if (!res.ok) throw new Error();
    } catch (_) {
      renderPending({ status: 'Pending', teamName: '-' });
      if (tries < 60) setTimeout(poll, 5000);
      return;
    }
    if (r.status === 'Paid') return renderPaid(r);
    if (r.qrisImage) haveQr = true;
    renderPending(r);
    if (r.status === 'Pending') setTimeout(poll, tries < 100 ? 3000 : 15000);
  };
  poll();
}

function renderPending(r) {
  $('#statusPaid').classList.add('hidden');
  $('#statusPending').classList.remove('hidden');
  $('#pTeam').textContent = r.teamName || '-';
  const pending = r.status === 'Pending';
  if (r.qrisImage) $('#qrImg').src = r.qrisImage;
  const showQr = pending && !!$('#qrImg').getAttribute('src');
  $('#payBox').classList.toggle('hidden', !showQr);
  if (showQr) {
    $('#sumBase').textContent = rupiah(r.baseAmount);
    $('#sumCode').textContent = r.uniqueCode ? '+' + rupiah(r.uniqueCode) : '-';
    $('#sumTotal').textContent = rupiah(r.payAmount);
    startPayTimer(r.expiresAt);
  } else {
    stopPayTimer();
  }
  $('#pSpinner').classList.toggle('hidden', !pending);
  // Tanpa QRIS (cadangan): tombol besar ke halaman WaroengPay. Dengan QRIS: hanya link kecil
  $('#pPayBtn').classList.toggle('hidden', !(pending && r.payUrl && !showQr));
  $('#pPayAlt').classList.toggle('hidden', !(pending && r.payUrl && showQr));
  if (r.payUrl) { $('#pPayBtn').href = r.payUrl; $('#pPayAlt').href = r.payUrl; }
  $('#pRetryBtn').classList.toggle('hidden', pending);
  const text = {
    Pending: showQr
      ? ['📱', 'Scan & bayar QRIS', 'Selesaikan pembayaran sebelum waktunya habis. Tim otomatis tercatat lunas setelah pembayaran masuk.']
      : ['⏳', 'Menunggu pembayaran', 'Kami sedang mengecek pembayaranmu ke WaroengPay. Halaman ini otomatis diperbarui. Belum bayar? Klik "Lanjutkan Pembayaran".'],
    Expired: ['⌛', 'Tagihan kedaluwarsa', 'Waktu pembayaran habis dan belum ada pembayaran masuk. Silakan daftar ulang.'],
    Failed: ['✖', 'Pembayaran gagal', 'Tagihan dibatalkan atau gagal dibuat. Silakan daftar ulang.'],
    NotFound: ['❔', 'Kode tidak ditemukan', 'Kode pendaftaran ini tidak ada. Periksa link-nya atau daftar ulang.'],
  }[r.status] || ['❔', 'Status tidak diketahui', ''];
  $('#pIcon').textContent = text[0];
  $('#pTitle').textContent = text[1];
  $('#pDesc').textContent = text[2];
}

/* Timer sisa waktu bayar QRIS */
let payTimer = null;
let payTimerTarget = null;
function stopPayTimer() { clearInterval(payTimer); payTimer = null; }
function startPayTimer(expiresAt) {
  const target = expiresAt ? new Date(expiresAt).getTime() : null;
  if (!target || (payTimer && payTimerTarget === target)) return;
  stopPayTimer();
  payTimerTarget = target;
  const tick = () => {
    const s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    $('#payTimer').textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    $('.pay-timer').classList.toggle('low', s < 120);
    if (s === 0) stopPayTimer();
  };
  tick();
  payTimer = setInterval(tick, 1000);
}

$('#saveQrBtn').addEventListener('click', () => {
  const src = $('#qrImg').getAttribute('src');
  if (!src) return;
  const a = document.createElement('a');
  a.href = src;
  a.download = `QRIS-HireCup-${$('#pCode').textContent}.png`;
  a.click();
});

function renderPaid(r) {
  stopPayTimer();
  $('#statusPending').classList.add('hidden');
  $('#statusPaid').classList.remove('hidden');
  $('#sTeam').textContent = r.teamName;
  $('#sCode').textContent = r.orderId;
  $('#sWa').textContent = r.captainWa;
  $('#sPlayers').innerHTML = (r.players || []).map((p, i) =>
    `<li><span>${i + 1}. ${esc(p.nick)}${i >= 5 ? ' <small style="color:var(--violet)">CADANGAN</small>' : ''}</span><span>${esc(p.uid)} (${esc(p.sid)})</span></li>`
  ).join('');
  if (r.waGroupLink) {
    $('#waBtn').href = r.waGroupLink;
    $('#waBtn').classList.remove('hidden');
  } else {
    $('#waPending').classList.remove('hidden');
  }
  try { localStorage.removeItem('lastOrder'); } catch (_) {}
}

/* Unduh E-Ticket */
$('#downloadTicketBtn').addEventListener('click', async () => {
  try {
    if (!window.html2canvas) throw new Error();
    const canvas = await html2canvas($('#eTicketCard'), { scale: 2, backgroundColor: '#040a17', logging: false });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `ETicket-${($('#sTeam').textContent || 'Tim').replace(/[^\w-]+/g, '_')}-HireCupVol2.png`;
    a.click();
  } catch (_) {
    alert('Gagal mengunduh E-Ticket. Silakan screenshot manual.');
  }
});

/* Mulai */
const orderParam = new URLSearchParams(location.search).get('order');
if (orderParam) {
  showStatus(orderParam);
} else {
  loadConfig();
  loadTeams();
  loadBracket();
  // Perbarui prize pool & daftar tim tiap 30 detik
  setInterval(() => { loadConfig(); loadTeams(); }, 30000);

  // Pengingat kalau sebelumnya keluar di tengah pembayaran
  let last = null;
  try { last = localStorage.getItem('lastOrder'); } catch (_) {}
  if (last) {
    const bar = document.createElement('div');
    bar.className = 'resume';
    bar.innerHTML = `<p>Kamu punya pendaftaran yang belum selesai.</p><div><a class="btn btn-gold" href="/?order=${encodeURIComponent(last)}">Cek Status</a><button type="button" class="btn btn-ghost">Tutup</button></div>`;
    bar.querySelector('button').addEventListener('click', () => { bar.remove(); try { localStorage.removeItem('lastOrder'); } catch (_) {} });
    document.body.appendChild(bar);
  }
}
