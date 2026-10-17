// Semua pengaturan dibaca dari environment variable (Railway → Variables, atau file .env saat lokal).
// JANGAN menulis API key / password langsung di kode: repo ini publik.
require('dotenv').config();

const num = (v, def) => (v === undefined || v === '' || isNaN(Number(v)) ? def : Number(v));

const config = {
  port: num(process.env.PORT, 3000),
  mongoUri: process.env.MONGODB_URI || '',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  waroengApiKey: process.env.WAROENGPAY_API_KEY || '',
  waroengBaseUrl: (process.env.WAROENGPAY_BASE_URL || 'https://waroengpay.com').replace(/\/+$/, ''),
  waroengWebhookSecret: process.env.WAROENGPAY_WEBHOOK_SECRET || '',
  waroengAcceptTest: process.env.WAROENGPAY_ACCEPT_TEST === 'true',

  googleSheetUrl: process.env.GOOGLE_SHEET_URL || '',
  waGroupLink: process.env.WA_GROUP_LINK || '',
  // Nomor WA panitia untuk tombol "Tanya Panitia" (bisa diganti lewat CONTACT_WA)
  contactWa: String(process.env.CONTACT_WA || '0895329378730').replace(/\D/g, '').replace(/^0/, '62'),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // Rahasia untuk menandatangani token login admin; kalau kosong diturunkan dari ADMIN_PASSWORD
  sessionSecret: process.env.SESSION_SECRET || '',

  fee: num(process.env.REGISTRATION_FEE, 150000),
  basePrize: num(process.env.PRIZE_BASE, 100000),
  prizePerTeam: num(process.env.PRIZE_PER_TEAM, 150000),
  maxTeams: num(process.env.MAX_TEAMS, 32),
  minPlayers: 5,
  maxPlayers: 7,
  // Pendaftaran ditutup H-1, turnamen dimulai 25 Desember 2026 (WIB)
  closeAt: process.env.REGISTRATION_CLOSE_AT || '2026-12-24T23:59:00+07:00',
  tournamentAt: process.env.TOURNAMENT_START_AT || '2026-12-25T00:00:00+07:00',
  paymentExpiresMinutes: num(process.env.PAYMENT_EXPIRES_MINUTES, 30),
};

function checkConfig() {
  const missing = [];
  if (!config.mongoUri) missing.push('MONGODB_URI');
  if (!config.waroengApiKey) missing.push('WAROENGPAY_API_KEY');
  if (!config.adminPassword) missing.push('ADMIN_PASSWORD');
  if (missing.length) {
    // Server tetap jalan (halaman publik tetap tampil), tapi fitur yang butuh variabel ini dimatikan
    console.error('Environment variable wajib belum diisi:', missing.join(', '));
    console.error('Lihat .env.example untuk daftar lengkapnya.');
  }
  if (!config.waroengWebhookSecret) console.warn('PERINGATAN: WAROENGPAY_WEBHOOK_SECRET kosong, webhook akan ditolak. Status bayar tetap dicek lewat API.');
  if (!config.waGroupLink) console.warn('PERINGATAN: WA_GROUP_LINK kosong, peserta tidak mendapat link grup.');
  if (!config.googleSheetUrl) console.warn('Info: GOOGLE_SHEET_URL kosong, data tidak disalin ke Google Sheets.');
  return missing;
}

module.exports = { config, checkConfig };
