'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ROOT dapat dioverride lewat APP_ROOT. Dibutuhkan oleh Netlify Functions:
// bundle di-ekstrak ke lokasi berbeda sehingga __dirname tidak lagi menunjuk ke
// root proyek, dan path views/public dihitung dari ROOT.
const ROOT = process.env.APP_ROOT || path.join(__dirname, '..');

function bool(v, dflt) {
  if (v === undefined || v === null || String(v).trim() === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

// Jalur laboratorium rentan: aktif di development, dan WAJIB mati di production
// kecuali diaktifkan secara eksplisit oleh operator (lihat README).
const labEnabled =
  process.env.LAB_ENABLED === undefined || process.env.LAB_ENABLED === ''
    ? NODE_ENV !== 'production'
    : bool(process.env.LAB_ENABLED, false);

// ------------------------------------------------------------- rahasia sesi
// Nilai fallback/contoh di bawah hanya untuk pengembangan lokal.
// Mode production DILARANG memakainya (nilai rahasia tidak pernah dicetak).
const RAHASIA_FALLBACK = 'INSECURE-DEFAULT-SILAHKAN-GANTI-DI-.env';
const RAHASIA_PLACEHOLDER = 'ganti-dengan-string-acak-panjang';
const rahasiaMentah =
  typeof process.env.SESSION_SECRET === 'string' ? process.env.SESSION_SECRET : '';
const rahasiaSah =
  rahasiaMentah.length >= 16 &&
  rahasiaMentah !== RAHASIA_FALLBACK &&
  rahasiaMentah !== RAHASIA_PLACEHOLDER;

// Kepatuhan ditegakkan oleh TITIK MASUK HTTP (server.js saat dijalankan langsung,
// dan netlify/functions/app.js). Config sendiri TIDAK melempar error, agar proses
// build/seeding (npm run init:db) tetap bisa berjalan walau NODE_ENV=production.
if (NODE_ENV === 'production' && !rahasiaSah) {
  console.error(
    '[config] PERINGATAN PENTING: SESSION_SECRET belum diisi atau masih memakai ' +
      'nilai contoh. Aplikasi akan MENOLAK melayani permintaan HTTP. Isi ' +
      'environment variable SESSION_SECRET dengan string acak (>=16 karakter). ' +
      'Contoh cara membuatnya: buat string acak heksadesimal 32 byte ' +
      '(64 karakter) dan simpan sebagai nilai SESSION_SECRET. Nilai rahasia ' +
      'tidak pernah dicetak oleh aplikasi ini.'
  );
}

const config = {
  ROOT,
  NODE_ENV,
  PORT: int(process.env.PORT, 3000),
  HOST: process.env.HOST || '127.0.0.1',
  SESSION_SECRET: rahasiaSah ? rahasiaMentah : RAHASIA_FALLBACK,
  // false = production + secret tidak sah -> titik masuk HTTP wajib menolak start.
  SESSION_SECRET_SAH: rahasiaSah,
  IS_PRODUCTION: NODE_ENV === 'production',
  LAB_ENABLED: labEnabled,
  // Backend penyimpanan: 'memory'/'disk' (default lokal, perilaku lama persis)
  // atau 'blobs' (Netlify Blobs — dipilih oleh netlify/functions/app.js).
  SESSION_BACKEND: String(process.env.SESSION_BACKEND || 'memory').trim().toLowerCase(),
  STORAGE_BACKEND: String(process.env.STORAGE_BACKEND || 'disk').trim().toLowerCase(),
  // Mirror file database ke penyimpanan persisten (hanya masuk akal di blobs).
  DB_MIRROR: bool(process.env.DB_MIRROR, false),
  MAX_UPLOAD_BYTES: int(process.env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
  LOGIN_MAX_FAILS: int(process.env.LOGIN_MAX_FAILS, 8),
  LOGIN_LOCK_SECONDS: int(process.env.LOGIN_LOCK_SECONDS, 300),
  DB_PATH: process.env.DB_PATH || path.join(ROOT, 'data', 'kampuskue.db'),
  LAB_DB_PATH: process.env.LAB_DB_PATH || path.join(ROOT, 'data', 'lab.db'),
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),
  ALLOWED_UPLOAD_EXT: ['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'zip', 'txt'],
  ALLOWED_UPLOAD_MIME: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/x-zip-compressed',
    'text/plain'
  ]
};

module.exports = config;
