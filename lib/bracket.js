// Logika bagan single elimination. Tim disimpan sebagai orderId; null = slot kosong (bye).

const ROUND_NAMES = { 1: 'Grand Final', 2: 'Semi Final', 4: 'Perempat Final', 8: '16 Besar', 16: '32 Besar' };
const roundName = (matchCount) => ROUND_NAMES[matchCount] || `${matchCount * 2} Besar`;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Urutan seed standar agar bye tersebar, mis. untuk 8: [1,8,4,5,2,7,3,6]. */
function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

const emptyMatch = () => ({ a: null, b: null, scoreA: null, scoreB: null, winner: null });

/** Bagan baru dari daftar orderId (urutan = seed). Bye otomatis lolos. */
function generate(teamIds, { random = true } = {}) {
  if (teamIds.length < 2) throw new Error('Minimal 2 tim lunas untuk membuat bracket.');
  const ids = random ? shuffle(teamIds) : [...teamIds];
  let size = 2;
  while (size < ids.length) size *= 2;

  const slots = seedOrder(size).map((seed) => ids[seed - 1] || null);
  const rounds = [];
  const first = [];
  for (let i = 0; i < size; i += 2) first.push({ ...emptyMatch(), a: slots[i], b: slots[i + 1] });
  rounds.push(first);
  for (let n = size / 4; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, emptyMatch));

  propagate(rounds);
  return rounds;
}

/** Hitung ulang pemenang otomatis (bye) dan isi slot babak berikutnya dari pemenang. */
function propagate(rounds) {
  for (let r = 0; r < rounds.length; r++) {
    rounds[r].forEach((m, i) => {
      if (r > 0) {
        const prevA = rounds[r - 1][i * 2];
        const prevB = rounds[r - 1][i * 2 + 1];
        const newA = prevA ? prevA.winner : null;
        const newB = prevB ? prevB.winner : null;
        if (m.a !== newA || m.b !== newB) {
          // Peserta berubah → hasil lama tidak berlaku
          m.a = newA;
          m.b = newB;
          m.scoreA = m.scoreB = null;
          m.winner = null;
        }
      }
      // Bye: hanya satu tim dan pasangannya pasti kosong (di babak 1, atau babak lanjut yang lawannya juga bye)
      const isBye = (x, y, side) => x && !y && byeSide(rounds, r, i, side);
      if (isBye(m.a, m.b, 'b')) m.winner = m.a;
      else if (isBye(m.b, m.a, 'a')) m.winner = m.b;
      else if (m.winner && m.winner !== m.a && m.winner !== m.b) m.winner = null;
    });
  }
  return rounds;
}

/** Apakah sisi `side` pada match (r,i) dipastikan kosong selamanya (bukan sekadar belum selesai). */
function byeSide(rounds, r, i, side) {
  if (r === 0) return true;
  const prev = rounds[r - 1][i * 2 + (side === 'a' ? 0 : 1)];
  return !prev.a && !prev.b && byeSide(rounds, r - 1, i * 2 + (side === 'a' ? 0 : 1), 'a') && byeSide(rounds, r - 1, i * 2 + (side === 'a' ? 0 : 1), 'b');
}

/** Set skor & pemenang satu match, lalu propagate. */
function setResult(rounds, r, i, { scoreA, scoreB, winner }) {
  const m = rounds[r] && rounds[r][i];
  if (!m) throw new Error('Match tidak ditemukan.');
  if (!m.a || !m.b) throw new Error('Match ini belum punya dua tim.');
  if (winner !== null && winner !== m.a && winner !== m.b) throw new Error('Pemenang harus salah satu tim di match ini.');
  const toScore = (v) => (v === '' || v === null || v === undefined ? null : Math.max(0, Math.min(9, parseInt(v, 10) || 0)));
  m.scoreA = toScore(scoreA);
  m.scoreB = toScore(scoreB);
  m.winner = winner;
  return propagate(rounds);
}

module.exports = { generate, propagate, setResult, roundName };
