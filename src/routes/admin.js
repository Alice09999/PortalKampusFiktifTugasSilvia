'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { all, get, run } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin'));

function flash(req, type, text) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, text });
}

const ROLES = ['mahasiswa', 'dosen', 'admin'];

// ------------------------------------------------------------- dashboard
router.get('/', (req, res) => {
  const statistik = {
    mahasiswa: get(`SELECT COUNT(*) AS c FROM users WHERE role='mahasiswa'`).c,
    dosen: get(`SELECT COUNT(*) AS c FROM users WHERE role='dosen'`).c,
    admin: get(`SELECT COUNT(*) AS c FROM users WHERE role='admin'`).c,
    nonaktif: get(`SELECT COUNT(*) AS c FROM users WHERE active=0`).c,
    courses: get(`SELECT COUNT(*) AS c FROM courses`).c,
    enrollments: get(`SELECT COUNT(*) AS c FROM enrollments`).c,
    assignments: get(`SELECT COUNT(*) AS c FROM assignments`).c,
    submissions: get(`SELECT COUNT(*) AS c FROM submissions`).c,
    grades: get(`SELECT COUNT(*) AS c FROM grades WHERE score IS NOT NULL`).c,
    discussions: get(`SELECT COUNT(*) AS c FROM discussions`).c,
    replies: get(`SELECT COUNT(*) AS c FROM discussion_replies`).c
  };

  const terbaru = all(
    `SELECT id, username, full_name, role, active, created_at
       FROM users ORDER BY id DESC LIMIT 8`
  );

  res.render('admin/dashboard', { title: 'Dashboard Admin', statistik, terbaru });
});

// ------------------------------------------------------ pengelolaan akun
router.get('/akun', (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = String(req.query.filter || 'semua');

  let sql = `SELECT id, username, full_name, role, email, identity_no, active, created_at FROM users WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ` AND (username LIKE ? OR full_name LIKE ? OR identity_no LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (ROLES.includes(filter)) {
    sql += ` AND role = ?`;
    params.push(filter);
  }
  sql += ` ORDER BY role, username`;

  const rows = all(sql, params);
  res.render('admin/akun', {
    title: 'Pengelolaan Akun',
    rows,
    q,
    filter,
    total: get('SELECT COUNT(*) AS c FROM users').c
  });
});

router.post('/akun', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const fullName = String(req.body.full_name || '').trim().slice(0, 120);
  const role = String(req.body.role || '').trim();
  const email = String(req.body.email || '').trim().slice(0, 120);
  const identity = String(req.body.identity_no || '').trim().slice(0, 40);
  const password = String(req.body.password || '');

  const back = '/admin/akun';
  if (!/^[a-z0-9_.]{3,32}$/.test(username)) {
    flash(req, 'error', 'Nama pengguna harus 3–32 karakter (huruf kecil, angka, titik, garis bawah).');
    return res.redirect(back);
  }
  if (!fullName) {
    flash(req, 'error', 'Nama lengkap wajib diisi.');
    return res.redirect(back);
  }
  if (!ROLES.includes(role)) {
    flash(req, 'error', 'Peran tidak valid.');
    return res.redirect(back);
  }
  if (password.length < 8 || password.length > 128) {
    flash(req, 'error', 'Kata sandi minimal 8 karakter.');
    return res.redirect(back);
  }
  if (get('SELECT id FROM users WHERE username = ?', [username])) {
    flash(req, 'error', 'Nama pengguna sudah dipakai.');
    return res.redirect(back);
  }

  run(
    `INSERT INTO users (username, password_hash, full_name, role, email, identity_no, active)
     VALUES (?,?,?,?,?,?,1)`,
    [username, bcrypt.hashSync(password, 10), fullName, role, email || null, identity || null]
  );
  flash(req, 'success', `Akun "${username}" berhasil dibuat.`);
  res.redirect(back);
});

router.post('/akun/:id/role', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const role = String(req.body.role || '');
  const back = '/admin/akun';
  const target = get('SELECT * FROM users WHERE id = ?', [id]);

  if (!target) {
    flash(req, 'error', 'Akun tidak ditemukan.');
    return res.redirect(back);
  }
  if (!ROLES.includes(role)) {
    flash(req, 'error', 'Peran tidak valid.');
    return res.redirect(back);
  }
  if (target.id === req.session.user.id && role !== 'admin') {
    flash(req, 'error', 'Anda tidak dapat menurunkan peran akun Anda sendiri.');
    return res.redirect(back);
  }

  run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  flash(req, 'success', `Peran "${target.username}" diubah menjadi ${role}.`);
  res.redirect(back);
});

router.post('/akun/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const back = '/admin/akun';
  const target = get('SELECT * FROM users WHERE id = ?', [id]);

  if (!target) {
    flash(req, 'error', 'Akun tidak ditemukan.');
    return res.redirect(back);
  }
  if (target.id === req.session.user.id) {
    flash(req, 'error', 'Anda tidak dapat menonaktifkan akun Anda sendiri.');
    return res.redirect(back);
  }

  const baru = target.active === 1 ? 0 : 1;
  run('UPDATE users SET active = ? WHERE id = ?', [baru, id]);
  flash(
    req,
    'success',
    `Akun "${target.username}" ${baru === 1 ? 'diaktifkan' : 'dinonaktifkan'}.`
  );
  res.redirect(back);
});

router.post('/akun/:id/password', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const back = '/admin/akun';
  const password = String(req.body.password || '');
  const target = get('SELECT * FROM users WHERE id = ?', [id]);

  if (!target) {
    flash(req, 'error', 'Akun tidak ditemukan.');
    return res.redirect(back);
  }
  if (password.length < 8 || password.length > 128) {
    flash(req, 'error', 'Kata sandi minimal 8 karakter.');
    return res.redirect(back);
  }

  run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), id]);
  flash(req, 'success', `Kata sandi "${target.username}" berhasil direset.`);
  res.redirect(back);
});

module.exports = router;
