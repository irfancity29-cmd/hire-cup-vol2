const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const { config, checkConfig } = require('./lib/config');
const { Registration, Bracket } = require('./lib/models');
const { createPayment, verifyWebhook, getPayment } = require('./lib/waroengpay');
const { validateRegistration, normalizeWa, teamKeyOf, clean } = require('./lib/validate');
const reg = require('./lib/registration');
const bracket = require('./lib/bracket');
const { readSheetTeams } = require('./lib/sheet');
const QRCode = require('qrcode');
const { checkPassword, issueToken, requireAdmin } = require('./lib/auth');

const missingEnv = checkConfig();
let dbError = '';
const startedAt = new Date().toISOString();

const app = express();
app.set('trust proxy', 1); // Railway berada di belakang proxy
// rawBody disimpan untuk verifikasi signature webhook
app.use(express.json({ limit: '50kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const newOrderId = () => 'HC2-' + crypto.randomBytes(6).toString('hex').toUpperCase();
const maskWa = (wa) => (wa ? wa.slice(0, 4) + '••••' + wa.slice(-3) : '-');
const displayName = (r) => (r.hidden ? 'Tim (disembunyikan)' : r.teamName);

function baseUrlOf(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
}

/* ============================ KESEHATAN ============================ */

// Buka /api/health untuk melihat apa yang belum beres (hanya nama variabel, tidak ada nilai rahasia)
app.get('/api/health', (_req, res) => {
  const db = mongoose.connection.readyState === 1;
  res.status(db && !missingEnv.length ? 200 : 503).json({
    ok: db && !missingEnv.length,
    database: db ? 'terhubung' : 'TIDAK terhubung' + (dbError ? ': ' + dbError : ''),
    variabelBelumDiisi: missingEnv,
    webhookSecret: config.waroengWebhookSecret ? 'ada' : 'kosong',
    waGroupLink: config.waGroupLink ? 'ada' : 'kosong',
    googleSheetUrl: config.googleSheetUrl ? 'ada' : 'kosong',
    // Membantu memastikan Variables diisi di service & environment Railway yang benar
    railwayService: process.env.RAILWAY_SERVICE_NAME || null,
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME || null,
    serverStartedAt: startedAt,
  });
});

// Pengaturan publik. Tetap menjawab walau database belum tersambung (countdown & biaya tetap tampil)
app.get('/api/config', wrap(async (_req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  const s = dbReady ? await reg.stats() : null;
  res.json({
    fee: config.fee,
    basePrize: config.basePrize,
    prizePerTeam: config.prizePerTeam,
    maxTeams: config.maxTeams,
    minPlayers: config.minPlayers,
    maxPlayers: config.maxPlayers,
    closeAt: config.closeAt,
    tournamentAt: config.tournamentAt,
    contactWa: config.contactWa || null,
    dbReady,
    paidCount: s ? s.paidCount : null,
    prizeTotal: s ? s.prizeTotal : null,
    closedReason: reg.closedReason(s || { paidCount: 0 }),
  });
}));

// Selama database belum tersambung, API menjawab 503 dengan pesan jelas (halaman tetap tampil)
app.use('/api', (_req, res, next) => {
  if (mongoose.connection.readyState === 1) return next();
  res.status(503).json({ error: 'Server sedang tidak tersambung ke database. Coba lagi beberapa saat lagi.' });
});

/* ============================ PUBLIK ============================ */

app.get('/api/teams', wrap(async (_req, res) => {
  const teams = await Registration.find({ status: 'Paid', hidden: false }).sort({ paidAt: 1 }).select('teamName -_id').lean();
  res.json(teams.map((t) => ({ teamName: t.teamName })));
}));

const registerLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' } });

app.post('/api/register', registerLimiter, wrap(async (req, res) => {
  const { errors, value } = validateRegistration(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Data pendaftaran belum lengkap / tidak valid.', fields: errors });

  await reg.expireStale();
  const s = await reg.stats();
  const closed = reg.closedReason(s);
  if (closed) return res.status(409).json({ error: closed });
  if (s.paidCount + s.pendingCount >= config.maxTeams) {
    return res.status(409).json({ error: 'Slot tersisa sedang dalam proses pembayaran tim lain. Coba lagi 30 menit lagi.' });
  }

  const taken = await Registration.findOne({ teamKey: value.teamKey, $or: [{ status: 'Paid' }, reg.activePendingFilter()] });
  if (taken) {
    const msg = taken.status === 'Paid' ? 'Nama tim sudah terdaftar.' : 'Nama tim ini sedang dalam proses pembayaran. Selesaikan pembayaran sebelumnya atau tunggu 30 menit.';
    return res.status(409).json({ error: msg, fields: { teamName: msg } });
  }

  const orderId = newOrderId();
  const doc = await Registration.create({
    orderId,
    ...value,
    amount: config.fee,
    expiresAt: new Date(Date.now() + config.paymentExpiresMinutes * 60 * 1000),
  });

  try {
    const base = baseUrlOf(req);
    const pay = await createPayment({
      orderId,
      amount: config.fee,
      description: `Pendaftaran HIRE CUP Vol 2 - Tim ${value.teamName}`,
      redirectUrl: `${base}/?order=${orderId}`,
      callbackUrl: `${base}/api/webhook/waroengpay`,
    });
    await Registration.updateOne({ _id: doc._id }, {
      gatewayId: pay.gatewayId,
      payUrl: pay.payUrl,
      qrString: pay.qrString,
      uniqueCode: pay.uniqueCode,
      payAmount: pay.payAmount,
      ...(pay.expiresAt ? { expiresAt: pay.expiresAt } : {}),
    });
    // Website langsung menampilkan QRIS di halaman /?order=...; payUrl hanya cadangan
    res.json({ orderId, payUrl: pay.payUrl, hasQris: !!pay.qrString });
  } catch (e) {
    console.error('Gagal membuat tagihan Waroeng Pay:', e.message);
    await Registration.updateOne({ _id: doc._id }, { status: 'Failed' });
    res.status(502).json({ error: 'Gagal membuat tagihan pembayaran. Coba lagi sebentar lagi.' });
  }
}));

// Dipanggil halaman setelah kembali dari Waroeng Pay. Link grup WA hanya diberikan jika sudah LUNAS.
app.get('/api/registrations/:orderId', wrap(async (req, res) => {
  let r = await Registration.findOne({ orderId: String(req.params.orderId) });
  if (!r) return res.status(404).json({ error: 'Pendaftaran tidak ditemukan.' });
  if (r.status !== 'Paid') r = await reg.reconcile(r);
  const paid = r.status === 'Paid';
  const pending = r.status === 'Pending';
  let qrisImage = null;
  if (pending && r.qrString && req.query.qr !== '0') {
    try {
      qrisImage = await QRCode.toDataURL(r.qrString, { errorCorrectionLevel: 'M', margin: 2, width: 360 });
    } catch (e) {
      console.error('Gagal membuat gambar QR untuk', r.orderId, '-', e.message);
    }
  }
  res.json({
    orderId: r.orderId,
    status: r.status,
    teamName: r.teamName,
    captainWa: maskWa(r.captainWa),
    players: paid ? r.players.map((p) => ({ nick: p.nick, uid: p.uid, sid: p.sid })) : [],
    payUrl: pending ? r.payUrl : null,
    qrisImage,
    baseAmount: r.amount,
    uniqueCode: pending ? (r.uniqueCode ?? (r.payAmount && r.amount ? r.payAmount - r.amount : null)) : null,
    payAmount: pending ? r.payAmount || r.amount : null,
    expiresAt: pending ? r.expiresAt : null,
    waGroupLink: paid ? config.waGroupLink : null,
  });
}));

app.post('/api/webhook/waroengpay', wrap(async (req, res) => {
  const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
  const check = verifyWebhook({ rawBody: raw, timestamp: req.get('X-WaroengPay-Timestamp'), signature: req.get('X-Signature') });
  if (!check.ok) {
    console.warn('Webhook ditolak:', check.reason);
    return res.status(401).json({ success: false });
  }
  const event = req.body || {};
  if (event.event === 'ping') return res.json({ success: true, pong: true });
  const data = event.data || {};
  const r = await Registration.findOne({ gatewayId: data.id });
  if (!r) return res.json({ success: true, ignored: 'unknown_payment' });
  const statusByEvent = { 'payment.paid': 'paid', 'payment.expired': 'expired', 'payment.cancelled': 'cancelled' };
  if (statusByEvent[event.event]) {
    await reg.applyGatewayStatus(r, { ...data, status: statusByEvent[event.event], livemode: event.livemode ?? data.livemode });
  }
  res.json({ success: true });
}));

async function bracketView({ admin = false } = {}) {
  const b = await Bracket.findOne({ key: 'main' }).lean();
  if (!b || (!admin && !b.published)) return { exists: !!b, published: false, rounds: [] };
  const ids = [...new Set(b.rounds.flat().flatMap((m) => [m.a, m.b]).filter(Boolean))];
  const regs = await Registration.find({ orderId: { $in: ids } }).select('orderId teamName hidden').lean();
  const names = Object.fromEntries(regs.map((r) => [r.orderId, admin ? r.teamName : displayName(r)]));
  return {
    exists: true,
    published: b.published,
    rounds: b.rounds.map((matches) => ({
      name: bracket.roundName(matches.length),
      matches: matches.map((m) => ({
        a: m.a ? { id: m.a, name: names[m.a] || '?' } : null,
        b: m.b ? { id: m.b, name: names[m.b] || '?' } : null,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        winner: m.winner,
      })),
    })),
  };
}

app.get('/api/bracket', wrap(async (_req, res) => res.json(await bracketView())));

/* ============================ ADMIN ============================ */

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { error: 'Terlalu banyak percobaan login. Tunggu 15 menit.' } });

app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!checkPassword((req.body || {}).password)) return res.status(401).json({ error: 'Password salah.' });
  res.json({ token: issueToken() });
});

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/registrations', wrap(async (_req, res) => {
  await reg.expireStale();
  const list = await Registration.find().sort({ createdAt: -1 }).lean();
  res.json({ stats: await reg.stats(), registrations: list.map(({ _id, __v, teamKey, ...r }) => r) });
}));

const findReg = async (req, res) => {
  const r = await Registration.findOne({ orderId: String(req.params.orderId) });
  if (!r) res.status(404).json({ error: 'Pendaftaran tidak ditemukan.' });
  return r;
};

admin.patch('/registrations/:orderId', wrap(async (req, res) => {
  const r = await findReg(req, res);
  if (!r) return;
  const b = req.body || {};
  if (b.teamName !== undefined) {
    const name = clean(b.teamName, 60);
    if (name.length < 2 || name.length > 30) return res.status(400).json({ error: 'Nama tim 2–30 karakter.' });
    const dup = await Registration.findOne({ _id: { $ne: r._id }, teamKey: teamKeyOf(name), status: 'Paid' });
    if (dup) return res.status(409).json({ error: 'Nama tim sudah dipakai tim lain.' });
    r.teamName = name;
    r.teamKey = teamKeyOf(name);
  }
  if (b.captainWa !== undefined) {
    const wa = normalizeWa(b.captainWa);
    if (!wa) return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
    r.captainWa = wa;
  }
  if (b.hidden !== undefined) r.hidden = !!b.hidden;
  await r.save();
  res.json({ ok: true });
}));

// Konfirmasi manual (mis. tim bayar lewat transfer langsung ke panitia)
admin.post('/registrations/:orderId/mark-paid', wrap(async (req, res) => {
  const r = await findReg(req, res);
  if (!r) return;
  await reg.markPaid(r);
  res.json({ ok: true });
}));

admin.post('/registrations/:orderId/check', wrap(async (req, res) => {
  const r = await findReg(req, res);
  if (!r) return;
  if (!r.gatewayId) return res.status(400).json({ error: 'Pendaftaran ini tidak punya tagihan Waroeng Pay.' });
  const p = await getPayment(r.gatewayId).catch((e) => ({ error: e.message }));
  if (p.error) return res.status(502).json({ error: 'Gagal cek ke Waroeng Pay: ' + p.error });
  const after = await reg.applyGatewayStatus(r, p);
  const note = p.status === 'paid' && after.status !== 'Paid'
    ? `Nominal pokok di WaroengPay (${p.base_amount}) tidak sama dengan biaya (${r.amount}), jadi tidak otomatis lunas. Periksa manual.`
    : '';
  res.json({ ok: true, gatewayStatus: p.status, status: after.status, note });
}));

async function inBracket(orderId) {
  const b = await Bracket.findOne({ key: 'main' }).lean();
  return !!b && b.rounds.flat().some((m) => m.a === orderId || m.b === orderId);
}

admin.delete('/registrations/:orderId', wrap(async (req, res) => {
  const r = await findReg(req, res);
  if (!r) return;
  if (await inBracket(r.orderId)) return res.status(409).json({ error: 'Tim ini ada di bracket. Hapus/buat ulang bracket dulu.' });
  await r.deleteOne();
  res.json({ ok: true });
}));

// Tambah tim manual (langsung lunas)
admin.post('/registrations', wrap(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.teamName, 60);
  if (name.length < 2 || name.length > 30) return res.status(400).json({ error: 'Nama tim 2–30 karakter.' });
  if (await Registration.findOne({ teamKey: teamKeyOf(name), status: 'Paid' })) return res.status(409).json({ error: 'Nama tim sudah terdaftar.' });
  await Registration.create({
    orderId: newOrderId(), teamName: name, teamKey: teamKeyOf(name), captainWa: normalizeWa(b.captainWa),
    players: [], amount: 0, status: 'Paid', paidAt: new Date(), source: 'manual',
  });
  res.json({ ok: true });
}));

// Impor tim lama dari Google Sheets (tim yang sudah terdaftar sebelum sistem baru). Aman diulang.
admin.post('/import-sheet', wrap(async (_req, res) => {
  const names = await readSheetTeams();
  let added = 0;
  for (const name of names) {
    const teamName = clean(name, 30);
    if (teamName.length < 2) continue;
    if (await Registration.findOne({ teamKey: teamKeyOf(teamName), status: 'Paid' })) continue;
    await Registration.create({
      orderId: newOrderId(), teamName, teamKey: teamKeyOf(teamName), players: [], amount: 0,
      status: 'Paid', paidAt: new Date(), source: 'sheet', sheetSynced: true,
    });
    added++;
  }
  res.json({ ok: true, found: names.length, added });
}));

admin.post('/sync-sheet', wrap(async (_req, res) => {
  const pending = await Registration.find({ status: 'Paid', source: 'web', sheetSynced: false });
  for (const r of pending) await reg.syncSheet(r);
  const left = await Registration.countDocuments({ status: 'Paid', source: 'web', sheetSynced: false });
  res.json({ ok: true, tried: pending.length, left });
}));

admin.get('/export.csv', wrap(async (_req, res) => {
  const list = await Registration.find({ status: 'Paid' }).sort({ paidAt: 1 }).lean();
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // cegah formula injection di Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['No', 'Kode', 'Nama Tim', 'WhatsApp', 'Sumber', 'Lunas Pada', ...Array.from({ length: 7 }, (_, i) => `Player ${i + 1}`)];
  const rows = list.map((r, i) => [
    i + 1, r.orderId, r.teamName, r.captainWa, r.source, r.paidAt ? new Date(r.paidAt).toISOString() : '',
    ...Array.from({ length: 7 }, (_, k) => (r.players[k] ? `${r.players[k].nick} (${r.players[k].uid}/${r.players[k].sid})` : '')),
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tim-hire-cup-vol2.csv"');
  res.send('﻿' + [head, ...rows].map((row) => row.map(esc).join(',')).join('\r\n'));
}));

admin.get('/bracket', wrap(async (_req, res) => res.json(await bracketView({ admin: true }))));

admin.post('/bracket/generate', wrap(async (req, res) => {
  const teams = await Registration.find({ status: 'Paid' }).sort({ paidAt: 1 }).select('orderId').lean();
  let rounds;
  try {
    rounds = bracket.generate(teams.map((t) => t.orderId), { random: (req.body || {}).random !== false });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await Bracket.findOneAndUpdate({ key: 'main' }, { rounds, published: false }, { upsert: true });
  res.json({ ok: true, teams: teams.length });
}));

admin.post('/bracket/match', wrap(async (req, res) => {
  const { round, index, scoreA, scoreB, winner } = req.body || {};
  const b = await Bracket.findOne({ key: 'main' });
  if (!b) return res.status(404).json({ error: 'Bracket belum dibuat.' });
  const rounds = b.toObject().rounds;
  try {
    bracket.setResult(rounds, Number(round), Number(index), { scoreA, scoreB, winner: winner || null });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  b.rounds = rounds;
  b.markModified('rounds');
  await b.save();
  res.json({ ok: true });
}));

admin.post('/bracket/publish', wrap(async (req, res) => {
  const r = await Bracket.updateOne({ key: 'main' }, { published: !!(req.body || {}).published });
  if (!r.matchedCount) return res.status(404).json({ error: 'Bracket belum dibuat.' });
  res.json({ ok: true });
}));

admin.delete('/bracket', wrap(async (_req, res) => {
  await Bracket.deleteOne({ key: 'main' });
  res.json({ ok: true });
}));

app.use('/api/admin', admin);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body bukan JSON yang valid.' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server.' });
});

// Port dinamis wajib agar Railway tidak error 502. Server langsung jalan walau database belum siap.
app.listen(config.port, '0.0.0.0', () => console.log(`Server berjalan di port ${config.port}`));

mongoose.set('bufferCommands', false);
async function connectDb() {
  if (!config.mongoUri) {
    dbError = 'MONGODB_URI belum diisi';
    return;
  }
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
    dbError = '';
    console.log('Terhubung ke MongoDB:', mongoose.connection.name);
  } catch (e) {
    dbError = e.message.slice(0, 200);
    console.error('Gagal konek MongoDB (dicoba lagi 15 detik):', e.message);
    setTimeout(connectDb, 15000);
  }
}
connectDb();
