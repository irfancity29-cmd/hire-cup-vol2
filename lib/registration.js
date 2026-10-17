const crypto = require('crypto');
const { config } = require('./config');
const { Registration } = require('./models');
const { getPayment } = require('./waroengpay');
const { appendToSheet } = require('./sheet');

const activePendingFilter = () => ({ status: 'Pending', expiresAt: { $gt: new Date() } });

async function stats() {
  const [paidCount, pendingCount] = await Promise.all([
    Registration.countDocuments({ status: 'Paid' }),
    Registration.countDocuments(activePendingFilter()),
  ]);
  return { paidCount, pendingCount, prizeTotal: config.basePrize + paidCount * config.prizePerTeam };
}

/** Pendaftaran masih dibuka? Return null kalau buka, atau alasan tutup. */
function closedReason({ paidCount }) {
  if (Date.now() >= new Date(config.closeAt).getTime()) return 'Pendaftaran sudah ditutup.';
  if (paidCount >= config.maxTeams) return `Slot ${config.maxTeams} tim sudah penuh.`;
  return null;
}

async function syncSheet(reg) {
  try {
    if (await appendToSheet(reg)) await Registration.updateOne({ _id: reg._id }, { sheetSynced: true });
  } catch (e) {
    console.error('Gagal menyalin ke Google Sheets untuk', reg.orderId, '-', e.message);
  }
}

/**
 * Tandai LUNAS secara atomik (aman walau webhook & pengecekan manual datang bersamaan).
 * Status Expired/Failed juga diterima: uang sudah masuk (mis. bayar tepat di batas waktu).
 */
async function markPaid(reg, { paidAt, late, issuer } = {}) {
  const updated = await Registration.findOneAndUpdate(
    { _id: reg._id, status: { $ne: 'Paid' } },
    {
      status: 'Paid',
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      paidLate: !!late,
      ...(issuer ? { paymentIssuer: String(issuer).slice(0, 40) } : {}),
      // Pendaftaran lama / manual yang belum punya kode tiket dibuatkan sekarang
      ...(reg.ticketCode && reg.ticketToken ? {} : newTicket()),
    },
    { new: true }
  );
  if (updated) {
    console.log('LUNAS:', updated.orderId, updated.teamName);
    syncSheet(updated); // jalan di latar belakang
  }
  return updated;
}

/** Terapkan status dari Waroeng Pay (hasil webhook atau GET) ke pendaftaran. */
async function applyGatewayStatus(reg, p) {
  if (p.livemode === false && !config.waroengAcceptTest) return reg;
  if (p.status === 'paid') {
    if (Number(p.base_amount ?? p.amount) !== reg.amount) {
      console.error('Nominal tidak cocok untuk', reg.orderId, 'base_amount =', p.base_amount, 'seharusnya', reg.amount);
      return reg;
    }
    await markPaid(reg, { paidAt: p.paid_at, late: p.late, issuer: p.payment && p.payment.issuer });
  } else if (p.status === 'expired') {
    await Registration.updateOne({ _id: reg._id, status: 'Pending' }, { status: 'Expired' });
  } else if (p.status === 'cancelled') {
    await Registration.updateOne({ _id: reg._id, status: 'Pending' }, { status: 'Failed' });
  } else {
    return reg;
  }
  return (await Registration.findById(reg._id)) || reg;
}

/** Cek status ke Waroeng Pay (dibatasi tiap 4 detik per pendaftaran agar tidak membanjiri API). */
async function reconcile(reg, { force = false } = {}) {
  if (reg.status === 'Paid' || !reg.gatewayId) return reg;
  if (!force && reg.lastCheckedAt && Date.now() - reg.lastCheckedAt.getTime() < 4000) return reg;
  await Registration.updateOne({ _id: reg._id }, { lastCheckedAt: new Date() });
  try {
    return await applyGatewayStatus(reg, await getPayment(reg.gatewayId));
  } catch (e) {
    console.error('Cek status Waroeng Pay gagal untuk', reg.orderId, '-', e.message);
    return reg;
  }
}

/** Tandai Expired untuk tagihan yang sudah lewat batas waktu (tanpa memanggil API). */
async function expireStale() {
  await Registration.updateMany(
    { status: 'Pending', expiresAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) } },
    { status: 'Expired' }
  );
}

/* ---------- E-ticket ---------- */

// Tanpa 0/O/1/I agar tidak tertukar saat dibaca panitia
const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newTicket() {
  const bytes = crypto.randomBytes(6);
  const ticketCode = Array.from(bytes, (b) => TICKET_ALPHABET[b % TICKET_ALPHABET.length]).join('');
  return { ticketCode, ticketToken: crypto.randomBytes(16).toString('hex') };
}

/** Pastikan pendaftaran punya kode & token tiket (untuk data lama). Return dokumen terbaru. */
async function ensureTicket(reg) {
  if (reg.ticketCode && reg.ticketToken) return reg;
  const t = newTicket();
  await Registration.updateOne({ _id: reg._id, ticketToken: { $in: [null, ''] } }, t);
  return Registration.findById(reg._id);
}

const ticketUrl = (reg) => `/ticket.html?o=${encodeURIComponent(reg.orderId)}&t=${reg.ticketToken}`;

module.exports = { stats, closedReason, markPaid, applyGatewayStatus, reconcile, expireStale, activePendingFilter, syncSheet, newTicket, ensureTicket, ticketUrl };
