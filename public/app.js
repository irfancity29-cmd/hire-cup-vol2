// Pengaturan (biaya, batas waktu, slot) diambil dari server lewat /api/config, bukan ditulis di sini.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let CONFIG = { fee: 150000, basePrize: 100000, prizePerTeam: 150000, maxTeams: 32, minPlayers: 5, maxPlayers: 7, closeAt: null, closedReason: null };

$('#yr').textContent = new Date().getFullYear();

/* Menu mobile */
const menuBtn = $('#menuBtn');
const mobileNav = $('#mobileNav');
menuBtn.addEventListener('click', () => {
  const open = mobileNav.classList.toggle('hidden') === false;
  menuBtn.setAttribute('aria-expanded', String(open));
});
$$('#mobileNav a').forEach((a) => a.addEventListener('click', () => { mobileNav.classList.add('hidden'); menuBtn.setAttribute('aria-expanded', 'false'); }));

/* Konfigurasi & prize pool */
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error();
    CONFIG = { ...CONFIG, ...(await res.json()) };
  } catch (_) {
    $('#slotStatus').textContent = 'Gagal memuat';
  }
  $('#prizeTotal').textContent = rupiah(CONFIG.prizeTotal ?? CONFIG.basePrize);
  $('#poolTeamCount').textContent = CONFIG.paidCount ?? 0;
  $('#poolBase').textContent = rupiah(CONFIG.basePrize);
  $('#poolPerTeam').textContent = rupiah(CONFIG.prizePerTeam);
  $('#feeAbout').textContent = rupiah(CONFIG.fee);
  $('#slotStatus').textContent = `${CONFIG.paidCount ?? 0} / ${CONFIG.maxTeams} Tim Terisi`;
  $('#payBtn').textContent = `Lanjut ke Pembayaran (${rupiah(CONFIG.fee)})`;
  setClosed(CONFIG.closedReason);
  startCountdown();
  refreshPlayers();
}

function setClosed(reason) {
  $('#regClosed').classList.toggle('hidden', !reason);
  $('#regClosedReason').textContent = reason || '';
  $('#regForm').classList.toggle('hidden', !!reason);
}

/* Daftar tim lunas */
async function loadVerifiedTeams() {
  const grid = $('#verifiedTeamsGrid');
  try {
    const res = await fetch('/api/teams');
    if (!res.ok) throw new Error();
    const teams = await res.json();
    if (!teams.length) {
      grid.innerHTML = '<div class="text-mist text-sm col-span-full py-4">Belum ada tim yang mendaftar. Jadilah yang pertama!</div>';
      return;
    }
    grid.innerHTML = teams.map((t) => `<div class="frame chamfer-sm pop"><div class="inner chamfer-sm p-4 flex items-center justify-between gap-2"><span class="font-semibold text-white truncate">${esc(t.teamName)}</span><span class="text-xs bg-gold/15 text-gold px-2 py-0.5 rounded shrink-0">Lunas</span></div></div>`).join('');
  } catch (_) {
    grid.innerHTML = '<div class="text-crimson text-sm col-span-full py-4">Gagal memuat daftar tim. Coba muat ulang halaman.</div>';
  }
}

/* Countdown */
let cdTimer;
function startCountdown() {
  clearInterval(cdTimer);
  if (!CONFIG.closeAt) return;
  const target = new Date(CONFIG.closeAt).getTime();
  $('#closeLabel').textContent = 'Batas pendaftaran: ' + new Date(target).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
  const set = (k, v) => { $(`[data-cd="${k}"]`).textContent = v; };
  const tick = () => {
    const left = Math.max(0, target - Date.now());
    const s = Math.floor(left / 1000);
    set('d', pad(Math.floor(s / 86400)));
    set('h', pad(Math.floor((s % 86400) / 3600)));
    set('m', pad(Math.floor((s % 3600) / 60)));
    set('s', pad(s % 60));
    if (left === 0) {
      clearInterval(cdTimer);
      setClosed('Pendaftaran sudah ditutup.');
    }
  };
  tick();
  cdTimer = setInterval(tick, 1000);
}

/* Bracket resmi (dari panitia) */
async function loadBracket() {
  const container = $('#liquipediaBracket');
  const note = $('#bracketNote');
  let data = { published: false, rounds: [] };
  try {
    const res = await fetch('/api/bracket');
    if (res.ok) data = await res.json();
  } catch (_) {}

  if (!data.published || !data.rounds.length) {
    note.textContent = 'Bracket resmi akan diumumkan setelah pendaftaran ditutup dan undian dilakukan panitia.';
    const names = ['32 Besar', '16 Besar', 'Perempat Final', 'Semi Final', 'Grand Final'];
    container.innerHTML = names.map((name, ri) => `<div class="lp-round"><div class="lp-round-header">${name}</div>${
      Array.from({ length: 16 >> ri }, () => '<div class="lp-matchup"><div class="lp-team"><span class="name">TBD</span><span class="score">-</span></div><div class="lp-team"><span class="name">TBD</span><span class="score">-</span></div></div>').join('')
    }</div>`).join('');
    return;
  }

  note.textContent = 'Bracket resmi. Pemenang setiap match ditandai warna emas.';
  const team = (t, score, m) => {
    const won = t && m.winner === t.id;
    const label = t ? esc(t.name) : (m.a || m.b) && m.winner ? 'BYE' : 'Menunggu…';
    return `<div class="lp-team${won ? ' winner' : ''}"><span class="name" title="${t ? esc(t.name) : ''}">${label}</span><span class="score">${score ?? '-'}</span></div>`;
  };
  container.innerHTML = data.rounds.map((r) => `<div class="lp-round"><div class="lp-round-header">${esc(r.name)}</div>${
    r.matches.map((m) => `<div class="lp-matchup">${team(m.a, m.scoreA, m)}${team(m.b, m.scoreB, m)}</div>`).join('')
  }</div>`).join('');
}

/* Player dinamis */
const list = $('#playerList');
const addBtn = $('#addPlayerBtn');
function playerRow() {
  const row = document.createElement('div');
  row.className = 'bg-well/60 border border-line p-3 pop';
  row.innerHTML = `
    <div class="flex justify-between mb-2"><span class="text-gold font-display text-xl row-title"></span><button type="button" class="remove-btn text-sm text-mist hover:text-crimson">Hapus</button></div>
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <div class="col-span-2"><input class="field" data-f="nick" maxlength="40" placeholder="Nickname"><p class="err" data-perr="nick"></p></div>
      <div class="col-span-2"><input class="field" data-f="uid" inputmode="numeric" maxlength="12" placeholder="User ID"><p class="err" data-perr="uid"></p></div>
      <div class="col-span-2 sm:col-span-1"><input class="field" data-f="sid" inputmode="numeric" maxlength="6" placeholder="Server ID"><p class="err" data-perr="sid"></p></div>
    </div>`;
  row.querySelector('.remove-btn').addEventListener('click', () => {
    if (list.children.length > CONFIG.minPlayers) { row.remove(); refreshPlayers(); }
  });
  return row;
}
function refreshPlayers() {
  const rows = [...list.children];
  rows.forEach((r, i) => {
    r.querySelector('.row-title').textContent = 'Player ' + (i + 1) + (i >= CONFIG.minPlayers ? ' (cadangan)' : '');
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
  if (new Set(uids).size !== uids.length) f.players = 'Ada User ID yang sama dipakai lebih dari satu player.';
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
    window.location.href = out.payUrl;
  } catch (err) {
    $('#formError').textContent = err.message;
    payBtn.disabled = false;
    payBtn.textContent = `Lanjut ke Pembayaran (${rupiah(CONFIG.fee)})`;
  }
});

/* Halaman status setelah kembali dari WaroengPay: /?order=KODE */
async function showStatus(orderId) {
  $('#site').classList.add('hidden');
  $('#view-success').classList.remove('hidden');
  window.scrollTo({ top: 0 });
  $('#pCode').textContent = orderId;

  let tries = 0;
  const poll = async () => {
    tries++;
    let r;
    try {
      const res = await fetch('/api/registrations/' + encodeURIComponent(orderId));
      r = await res.json();
      if (res.status === 404) {
        renderPending({ status: 'NotFound' });
        return;
      }
      if (!res.ok) throw new Error();
    } catch (_) {
      renderPending({ status: 'Pending', teamName: '-' });
      if (tries < 60) setTimeout(poll, 5000);
      return;
    }
    if (r.status === 'Paid') return renderPaid(r);
    renderPending(r);
    // Cek ulang tiap 3 detik selama ~5 menit, setelah itu tiap 15 detik
    if (r.status === 'Pending') setTimeout(poll, tries < 100 ? 3000 : 15000);
  };
  poll();
}

function renderPending(r) {
  $('#statusPaid').classList.add('hidden');
  $('#statusPending').classList.remove('hidden');
  $('#pTeam').textContent = r.teamName || '-';
  const pending = r.status === 'Pending';
  $('#pSpinner').classList.toggle('hidden', !pending);
  $('#pPayBtn').classList.toggle('hidden', !(pending && r.payUrl));
  if (r.payUrl) $('#pPayBtn').href = r.payUrl;
  $('#pRetryBtn').classList.toggle('hidden', pending);
  const text = {
    Pending: ['Menunggu pembayaran', 'Kami sedang mengecek pembayaranmu ke WaroengPay. Halaman ini otomatis diperbarui. Kalau belum bayar, klik "Lanjutkan Pembayaran".'],
    Expired: ['Tagihan kedaluwarsa', 'Waktu pembayaran sudah habis dan belum ada pembayaran masuk. Silakan daftar ulang.'],
    Failed: ['Pembayaran gagal', 'Tagihan dibatalkan atau gagal dibuat. Silakan daftar ulang.'],
    NotFound: ['Kode tidak ditemukan', 'Kode pendaftaran ini tidak ada. Periksa link-nya atau daftar ulang.'],
  }[r.status] || ['Status tidak diketahui', ''];
  $('#pTitle').textContent = text[0];
  $('#pDesc').textContent = text[1];
}

function renderPaid(r) {
  $('#statusPending').classList.add('hidden');
  $('#statusPaid').classList.remove('hidden');
  $('#sTeam').textContent = r.teamName;
  $('#sCode').textContent = r.orderId;
  $('#sWa').textContent = r.captainWa;
  $('#sPlayers').innerHTML = (r.players || []).map((p, i) =>
    `<li class="flex items-center justify-between py-2 text-sm"><span>${i + 1}. ${esc(p.nick)}${i >= 5 ? ' <span class="text-mist">(cadangan)</span>' : ''}</span><span class="text-mist">${esc(p.uid)} (${esc(p.sid)})</span></li>`
  ).join('');
  if (r.waGroupLink) {
    $('#waBtn').href = r.waGroupLink;
    $('#waBtn').classList.remove('hidden');
    $('#waPending').classList.add('hidden');
  } else {
    $('#waPending').innerHTML = 'Link grup akan dibagikan panitia lewat WhatsApp.';
  }
  try { localStorage.removeItem('lastOrder'); } catch (_) {}
}

$$('[data-home]').forEach((b) => b.addEventListener('click', () => { window.location.href = '/'; }));
$('#pRetryBtn').addEventListener('click', () => { window.location.href = '/#daftar'; });

/* Unduh E-Ticket */
$('#downloadTicketBtn').addEventListener('click', async () => {
  try {
    const canvas = await html2canvas($('#eTicketCard'), { scale: 2, backgroundColor: '#0b0f19', logging: false });
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
  loadVerifiedTeams();
  loadBracket();
  // Pengingat kalau sebelumnya keluar di tengah pembayaran
  let last = null;
  try { last = localStorage.getItem('lastOrder'); } catch (_) {}
  if (last) {
    const bar = document.createElement('div');
    bar.className = 'fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:max-w-sm z-50 frame chamfer-sm';
    bar.innerHTML = `<div class="inner chamfer-sm p-4 text-sm"><p class="text-slate-200">Kamu punya pendaftaran yang belum selesai.</p><div class="mt-3 flex gap-2"><a class="btn-gold chamfer-sm px-4 py-1.5 text-xl leading-none pt-2" href="/?order=${encodeURIComponent(last)}">Cek status</a><button type="button" class="btn-ghost chamfer-sm px-3 py-1.5">Tutup</button></div></div>`;
    bar.querySelector('button').addEventListener('click', () => { bar.remove(); try { localStorage.removeItem('lastOrder'); } catch (_) {} });
    document.body.appendChild(bar);
  }
}
