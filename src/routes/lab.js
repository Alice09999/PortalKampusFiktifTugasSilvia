'use strict';

/**
 * LABORATORIUM KERENTANAN — hanya untuk pembelajaran di lingkungan lokal.
 *
 * 1. /lab/sqli  -> SQL Injection (query digabung dengan string)
 * 2. /lab/login -> percobaan login tanpa pembatasan (rate limiting)
 *
 * Keduanya memakai basis data TERPISAH (data/lab.db) yang tidak berhubungan
 * dengan data portal utama. Jika LAB_ENABLED=false, seluruh /lab/* membalas 404.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { labDb } = require('../db');

const router = express.Router();

// Gerbang laboratorium: tertutup bila LAB_ENABLED=false.
router.use((req, res, next) => {
  if (!config.LAB_ENABLED) {
    return res.status(404).render('error', {
      title: 'Tidak Ditemukan',
      status: 404,
      message: 'Laboratorium dinonaktifkan pada konfigurasi server ini.'
    });
  }
  next();
});

// ----------------------------------------------------------------- indeks
router.get('/', (req, res) => {
  res.render('lab/index', { title: 'Laboratorium Kerentanan' });
});

// =============================================== 1. SQL INJECTION (SADAR) =
router.get('/sqli', (req, res) => {
  res.render('lab/sqli', {
    title: 'Laboratorium SQL Injection',
    result: null,
    mode: 'cari',
    input: { q: '', username: '', password: '' }
  });
});

router.post('/sqli', (req, res) => {
  const mode = req.body.mode === 'login' ? 'login' : 'cari';
  const q = String(req.body.q || '');
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  const render = (payload) =>
    res.render('lab/sqli', {
      title: 'Laboratorium SQL Injection',
      mode,
      input: { q, username, password },
      ...payload
    });

  try {
    if (mode === 'cari') {
      // ===== VERSI SENGAGA RENTAN: nilai input disisipkan ke dalam string SQL.
      const sqlVulnerable =
        `SELECT id, username, full_name, role, email FROM lab_users ` +
        `WHERE username LIKE '%${q}%' OR full_name LIKE '%${q}%' ORDER BY id`;
      const rowsVulnerable = labDb.prepare(sqlVulnerable).all();

      // ===== VERSI PERBAIKAN: query berparameter (placeholder ?).
      const sqlFixed =
        'SELECT id, username, full_name, role, email FROM lab_users ' +
        'WHERE username LIKE ? OR full_name LIKE ? ORDER BY id';
      const rowsFixed = labDb.prepare(sqlFixed).all(`%${q}%`, `%${q}%`);

      return render({
        result: {
          kind: 'search',
          sqlVulnerable,
          rowsVulnerable,
          sqlFixed,
          rowsFixed,
          error: null
        }
      });
    }

    // ===== MODE LOGIN (SADAR RENTAN)
    const sqlVulnerable =
      `SELECT id, username, full_name, role FROM lab_users ` +
      `WHERE username = '${username}' AND password_hash = '${password}'`;
    let rowVulnerable = null;
    let errorVulnerable = null;
    try {
      rowVulnerable = labDb.prepare(sqlVulnerable).get() || null;
    } catch (e) {
      errorVulnerable = e.message;
    }

    const sqlFixed = 'SELECT id, username, full_name, role FROM lab_users WHERE username = ?';
    const user = labDb.prepare(sqlFixed).get(username) || null;
    const okFixed = !!user && bcrypt.compareSync(password, user.password_hash);

    return render({
      result: {
        kind: 'login',
        sqlVulnerable,
        rowVulnerable,
        errorVulnerable,
        sqlFixed,
        okFixed,
        fixedUser: okFixed ? user : null
      }
    });
  } catch (e) {
    return render({
      result: {
        kind: mode === 'cari' ? 'search' : 'login',
        error: e.message,
        sqlVulnerable: null,
        rowsVulnerable: [],
        sqlFixed: null,
        rowsFixed: [],
        rowVulnerable: null,
        errorVulnerable: null,
        okFixed: false
      }
    });
  }
});

// =============================== 2. PERCOBAAN SANI TANPA PEMBATASAN (LAB) =
const KAMUS = [
  '123456',
  'password',
  'admin123',
  'kampus',
  'kampus123',
  'mahasiswa',
  'qwerty',
  'latihan1',
  'kampus2026',
  'rahasia123'
];

router.get('/login', (req, res) => {
  const username = 'lab_mhs01';
  const total = labDb
    .prepare('SELECT COUNT(*) AS c FROM lab_login_attempts')
    .get().c;
  const perAkun = labDb
    .prepare(
      'SELECT username, COUNT(*) AS c, MAX(success) AS pernah_sukses ' +
        'FROM lab_login_attempts GROUP BY username ORDER BY c DESC'
    )
    .all();
  const riwayat = labDb
    .prepare(
      'SELECT id, username, success, created_at FROM lab_login_attempts ORDER BY id DESC LIMIT 25'
    )
    .all();

  res.render('lab/brute', {
    title: 'Laboratorium Percobaan Sandi Tanpa Pembatasan',
    target: username,
    kamus: KAMUS,
    total,
    perAkun,
    riwayat,
    hasil: null,
    inputUser: ''
  });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim().slice(0, 64);
  const password = String(req.body.password || '').slice(0, 128);
  const wantsJson =
    (req.get('accept') || '').includes('application/json') || req.body.format === 'json';

  // --- TIDAK ADA pembatasan percobaan di sini (sengaja, itulah objek latihan).
  const user = labDb
    .prepare('SELECT id, username, full_name, role, password_hash FROM lab_users WHERE username = ?')
    .get(username);
  const ok = !!user && bcrypt.compareSync(password, user.password_hash);

  labDb
    .prepare('INSERT INTO lab_login_attempts (username, success, ip) VALUES (?,?,?)')
    .run(username || '(kosong)', ok ? 1 : 0, req.ip || 'local');

  const total = labDb.prepare('SELECT COUNT(*) AS c FROM lab_login_attempts').get().c;
  const totalAkun = labDb
    .prepare('SELECT COUNT(*) AS c FROM lab_login_attempts WHERE username = ?')
    .get(username).c;
  const pernahSukses = labDb
    .prepare('SELECT MAX(success) AS s FROM lab_login_attempts WHERE username = ?')
    .get(username).s;

  const payload = {
    ok,
    message: ok
      ? `BERHASIL — masuk sebagai ${user.full_name} (${user.role}).`
      : 'Gagal — kata sandi salah. Silakan coba lagi (tidak ada pembatasan).',
    totalPercobaanSistem: total,
    totalPercobaanAkun: totalAkun,
    pernahSukses: !!pernahSukses
  };

  if (wantsJson) return res.json(payload);

  const riwayat = labDb
    .prepare(
      'SELECT id, username, success, created_at FROM lab_login_attempts ORDER BY id DESC LIMIT 25'
    )
    .all();
  const perAkun = labDb
    .prepare(
      'SELECT username, COUNT(*) AS c, MAX(success) AS pernah_sukses ' +
        'FROM lab_login_attempts GROUP BY username ORDER BY c DESC'
    )
    .all();

  res.render('lab/brute', {
    title: 'Laboratorium Percobaan Sandi Tanpa Pembatasan',
    target: 'lab_mhs01',
    kamus: KAMUS,
    total,
    perAkun,
    riwayat,
    hasil: payload,
    inputUser: username
  });
});

router.post('/login/reset', (req, res) => {
  labDb.exec('DELETE FROM lab_login_attempts;');
  res.redirect('/lab/login');
});

module.exports = router;
