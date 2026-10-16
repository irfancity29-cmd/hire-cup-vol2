// Salinan ke Google Sheets (lewat Apps Script lama). Database utama tetap MongoDB:
// website TIDAK lagi membaca daftar tim dari Sheets, jadi baris palsu di Sheets tidak muncul di website.
const { config } = require('./config');

async function appendToSheet(reg) {
  if (!config.googleSheetUrl) return false;
  const p = reg.players.map((x) => `${x.nick} (${x.uid}/${x.sid})`);
  const payload = {
    teamName: reg.teamName,
    whatsapp: reg.captainWa,
    player1: p[0] || '',
    player2: p[1] || '',
    player3: p[2] || '',
    player4: p[3] || '',
    player5: p[4] || '',
    player6: p[5] || '-',
    player7: p[6] || '-',
    status: 'Lunas',
    orderId: reg.orderId,
  };
  const res = await fetch(config.googleSheetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Google Sheets HTTP ${res.status}`);
  return true;
}

/** Baca nama tim dari Sheets lama (untuk impor sekali jalan oleh admin). */
async function readSheetTeams() {
  if (!config.googleSheetUrl) throw new Error('GOOGLE_SHEET_URL belum diisi.');
  const res = await fetch(config.googleSheetUrl, { signal: AbortSignal.timeout(20000) });
  const raw = JSON.parse(await res.text());
  return raw
    .map((row) => {
      if (Array.isArray(row)) return String(row[1] || row[0] || '');
      if (row && typeof row === 'object') return String(row.teamName || row.name || '');
      return '';
    })
    .map((s) => s.trim())
    .filter((s) => s && !/timestamp/i.test(s) && !/^\d{4}-\d{2}-\d{2}T/.test(s));
}

module.exports = { appendToSheet, readSheetTeams };
