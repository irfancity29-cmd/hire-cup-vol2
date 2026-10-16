const { config } = require('./config');

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const teamKeyOf = (name) => clean(name, 60).toLowerCase();

/** 08xx / +628xx / 628xx → 628xx. Return '' kalau tidak valid. */
function normalizeWa(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^628\d{7,12}$/.test(d) ? d : '';
}

/** Validasi data pendaftaran. Return { errors, value }. */
function validateRegistration(body) {
  const errors = {};
  const teamName = clean(body.teamName, 60);
  if (teamName.length < 2 || teamName.length > 30) errors.teamName = 'Nama tim 2–30 karakter.';

  const captainWa = normalizeWa(body.captainWa);
  if (!captainWa) errors.captainWa = 'Nomor WhatsApp tidak valid (contoh: 08123456789).';

  const raw = Array.isArray(body.players) ? body.players : [];
  const players = raw.map((p) => ({
    nick: clean(p && p.nick, 40),
    uid: String((p && p.uid) ?? '').replace(/\D/g, ''),
    sid: String((p && p.sid) ?? '').replace(/\D/g, ''),
  }));
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    errors.players = `Jumlah player harus ${config.minPlayers}–${config.maxPlayers}.`;
  }
  const playerErrors = players.map((p) => {
    const e = {};
    if (!p.nick) e.nick = 'Wajib diisi';
    if (!/^\d{5,12}$/.test(p.uid)) e.uid = 'User ID 5–12 angka';
    if (!/^\d{3,6}$/.test(p.sid)) e.sid = 'Server ID 3–6 angka';
    return e;
  });
  if (playerErrors.some((e) => Object.keys(e).length)) errors.playerRows = playerErrors;

  const uids = players.map((p) => p.uid).filter(Boolean);
  if (new Set(uids).size !== uids.length) errors.players = 'Ada User ID yang sama dipakai lebih dari satu player.';

  return { errors, value: { teamName, teamKey: teamKeyOf(teamName), captainWa, players } };
}

module.exports = { validateRegistration, normalizeWa, teamKeyOf, clean };
