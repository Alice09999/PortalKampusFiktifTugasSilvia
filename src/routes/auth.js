'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { get } = require('../db');
const config = require('../config');
const guard = require('../loginGuard');

const router = express.Router();

const HOME = { mahasiswa: '/mahasiswa', dosen: '/dosen', admin: '/admin' };

function flash(req, type, text) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, text });
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(HOME[req.session.user.role] || '/');
  res.render('login', { title: 'Masuk — KampusKu' });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!username || !password) {
    flash(req, 'error', 'Nama pengguna dan kata sandi wajib diisi.');
    return res.redirect('/login');
  }
  if (username.length > 64 || password.length > 128) {
    flash(req, 'error', 'Input terlalu panjang.');
    return res.redirect('/login');
  }

  const ip = req.ip || 'local';
  const lock = guard.check(ip, username, config.LOGIN_MAX_FAILS, config.LOGIN_LOCK_SECONDS);
  if (lock.locked) {
    flash(
      req,
      'error',
      `Terlalu banyak percobaan gagal. Akun ditahan sementara ${lock.seconds} detik lagi.`
    );
    return res.redirect('/login');
  }

  // Query berparameter (aman dari SQL Injection).
  const user = get('SELECT * FROM users WHERE username = ?', [username]);

  const ok =
    user &&
    user.active === 1 &&
    bcrypt.compareSync(password, user.password_hash);

  if (!ok) {
    guard.registerFailure(ip, username, config.LOGIN_MAX_FAILS, config.LOGIN_LOCK_SECONDS);
    flash(req, 'error', 'Login gagal. Nama pengguna atau kata sandi salah.');
    return res.redirect('/login');
  }

  guard.reset(ip, username);

  // Putar ulang sesi (session fixation) lalu simpan identitas.
  req.session.regenerate((err) => {
    if (err) {
      console.error('[auth] gagal regenerate sesi:', err);
      flash(req, 'error', 'Terjadi kesalahan server saat memproses login.');
      return res.redirect('/login');
    }
    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role
    };
    req.session.csrf = require('crypto').randomBytes(24).toString('hex');
    req.session.save((e2) => {
      if (e2) {
        console.error('[auth] gagal menyimpan sesi:', e2);
        return res.redirect('/login');
      }
      return res.redirect(HOME[user.role] || '/');
    });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('kampuskue.sid');
    res.redirect('/login');
  });
});

module.exports = router;
