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
async function markPaid(reg, { paidAt, late } = {}) {
  const updated = await Registration.findOneAndUpdate(
    { _id: reg._id, status: { $ne: 'Paid' } },
    { status: 'Paid', paidAt: paidAt ? new Date(paidAt) : new Date(), paidLate: !!late },
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
    await markPaid(reg, { paidAt: p.paid_at, late: p.late });
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

module.exports = { stats, closedReason, markPaid, applyGatewayStatus, reconcile, expireStale, activePendingFilter, syncSheet };
