const crypto = require('crypto');
const { config } = require('./config');

// Berjaga-jaga jika respons dibungkus { data: {...} }
const unwrap = (res) => (res && res.data && res.data.id ? res.data : res);

async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(config.waroengBaseUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.waroengApiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Waroeng Pay HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return unwrap(data);
}

/** Buat tagihan. Nominal SELALU dari server, tidak pernah dari browser. */
async function createPayment({ orderId, amount, description, redirectUrl, callbackUrl }) {
  const body = {
    amount,
    reference: orderId,
    description: String(description || '').slice(0, 200),
    expires_in: config.paymentExpiresMinutes,
    redirect_url: redirectUrl,
  };
  if (callbackUrl) body.callback_url = callbackUrl;
  const data = await call('POST', '/api/payments', body, { 'Idempotency-Key': orderId });
  const payUrl = data.pay_url || data.payUrl || data.payment_url || data.url;
  if (!data.id || !payUrl) throw new Error('Respons Waroeng Pay tidak berisi id / pay_url');
  return {
    gatewayId: data.id,
    payUrl,
    qrString: data.qris || null, // string QRIS mentah; gambar QR dibuat sendiri agar bisa tampil di website
    uniqueCode: data.unique_code ?? null,
    payAmount: data.amount,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
  };
}

/** Ambil status tagihan langsung dari Waroeng Pay (cadangan kalau webhook tidak masuk). */
function getPayment(id) {
  return call('GET', `/api/payments/${encodeURIComponent(id)}`);
}

/** Verifikasi webhook: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) hex + timestamp maks 5 menit. */
function verifyWebhook({ rawBody, timestamp, signature }) {
  const secret = config.waroengWebhookSecret;
  if (!secret) return { ok: false, reason: 'WAROENGPAY_WEBHOOK_SECRET belum diisi' };
  if (!rawBody || !timestamp || !signature) return { ok: false, reason: 'header/body tidak lengkap' };
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: 'timestamp kedaluwarsa' };
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature salah' };
  return { ok: true };
}

module.exports = { createPayment, getPayment, verifyWebhook };
