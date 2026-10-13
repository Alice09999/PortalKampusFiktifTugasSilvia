'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');

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

const config = {
  ROOT,
  NODE_ENV,
  PORT: int(process.env.PORT, 3000),
  HOST: process.env.HOST || '127.0.0.1',
  SESSION_SECRET:
    process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
      ? process.env.SESSION_SECRET
      : 'INSECURE-DEFAULT-SILAHKAN-GANTI-DI-.env',
  IS_PRODUCTION: NODE_ENV === 'production',
  LAB_ENABLED: labEnabled,
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
