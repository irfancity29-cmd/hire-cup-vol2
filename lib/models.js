const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema(
  { nick: String, uid: String, sid: String },
  { _id: false }
);

const registrationSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    teamName: { type: String, required: true },
    teamKey: { type: String, required: true, index: true }, // nama tim huruf kecil, untuk cek nama dobel
    captainWa: { type: String, default: '' },
    players: [playerSchema],
    amount: { type: Number, default: 0 }, // nominal pokok (tanpa kode unik)
    payAmount: Number, // nominal yang harus dibayar (bisa + kode unik dari Waroeng Pay)
    gatewayId: { type: String, index: true },
    payUrl: String,
    qrString: String, // isi QRIS dinamis dari Waroeng Pay
    uniqueCode: Number,
    status: { type: String, enum: ['Pending', 'Paid', 'Expired', 'Failed'], default: 'Pending', index: true },
    expiresAt: Date,
    paidAt: Date,
    paidLate: Boolean,
    paymentIssuer: String, // mis. "BRI", "DANA" (dari Waroeng Pay, untuk invoice)
    // E-ticket: kode pendek untuk verifikasi + token rahasia agar link tiket tidak bisa ditebak
    ticketCode: { type: String, index: true },
    ticketToken: String,
    // web = daftar lewat website, manual = ditambah admin, sheet = impor dari Google Sheets lama
    source: { type: String, enum: ['web', 'manual', 'sheet'], default: 'web' },
    hidden: { type: Boolean, default: false }, // disembunyikan dari daftar publik (moderasi nama)
    sheetSynced: { type: Boolean, default: false },
    lastCheckedAt: Date,
  },
  { timestamps: true }
);

const matchSchema = new mongoose.Schema(
  {
    a: { type: String, default: null }, // orderId tim A (null = belum ada / bye)
    b: { type: String, default: null },
    scoreA: { type: Number, default: null },
    scoreB: { type: Number, default: null },
    winner: { type: String, default: null }, // orderId pemenang
  },
  { _id: false }
);

// Hanya ada satu dokumen bracket (key: 'main')
const bracketSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true },
    published: { type: Boolean, default: false },
    rounds: [[matchSchema]],
  },
  { timestamps: true }
);

const Registration = mongoose.model('Registration', registrationSchema);
const Bracket = mongoose.model('Bracket', bracketSchema);

module.exports = { Registration, Bracket };
