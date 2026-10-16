// Login admin sederhana: password dari ADMIN_PASSWORD → token bertanda tangan HMAC (berlaku 12 jam).
const crypto = require('crypto');
const { config } = require('./config');

const TTL_MS = 12 * 60 * 60 * 1000;
const secret = () => config.sessionSecret || crypto.createHash('sha256').update('hirecup:' + config.adminPassword).digest('hex');
const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function checkPassword(pw) {
  // Bandingkan hash agar panjang sama & constant-time
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  return !!config.adminPassword && safeEqual(h(pw), h(config.adminPassword));
}

function issueToken() {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(exp)}`;
}

function requireAdmin(req, res, next) {
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = token.split('.');
  if (exp && sig && safeEqual(sig, sign(exp)) && Number(exp) > Date.now()) return next();
  res.status(401).json({ error: 'Silakan login admin lagi.' });
}

module.exports = { checkPassword, issueToken, requireAdmin };
