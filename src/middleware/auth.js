'use strict';

const crypto = require('crypto');

/** Ambil & bersihkan pesan kilat (flash) dari sesi, lalu isi variabel view. */
function flashMiddleware(req, res, next) {
  req.session.flash = req.session.flash || [];
  res.locals.flash = req.session.flash.splice(0); // ambil lalu kosongkan
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.originalUrl;
  res.locals.roleLabel = { mahasiswa: 'Mahasiswa', dosen: 'Dosen', admin: 'Admin' };
  res.locals.csrfToken = req.session.csrf || '';
  res.locals.csrfField = () =>
    `<input type="hidden" name="_csrf" value="${req.session.csrf || ''}">`;
  next();
}

/** Pastikan setiap sesi memiliki token CSRF. */
function ensureCsrf(req, res, next) {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(24).toString('hex');
  }
  next();
}

/**
 * Verifikasi token CSRF untuk semua permintaan POST.
 * Diterapkan pada rute portal utama maupun laboratorium.
 *
 * Catatan: untuk `multipart/form-data` body belum diparse pada tahap ini,
 * sehingga pemeriksaan ditunda dan dilakukan lewat verifyCsrf() setelah multer.
 */
function csrfProtection(req, res, next) {
  if (req.method !== 'POST') return next();
  const ct = String(req.headers['content-type'] || '');
  if (ct.toLowerCase().startsWith('multipart/form-data')) return next();
  if (!verifyCsrf(req, res)) return;
  next();
}

/** Mengembalikan false (dan sudah mengirim 403) bila token tidak valid. */
function verifyCsrf(req, res) {
  const token = req.body && req.body._csrf;
  if (!token || !req.session.csrf || token !== req.session.csrf) {
    res.status(403).render('error', {
      title: 'Permintaan Ditolak',
      status: 403,
      message: 'Token keamanan (CSRF) tidak valid. Muat ulang halaman lalu coba lagi.'
    });
    return false;
  }
  return true;
}

/** Wajib masuk terlebih dahulu. */
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type: 'error', text: 'Silakan login terlebih dahulu.' });
  return res.redirect('/login');
}

/** Wajib memiliki peran tertentu. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type: 'error', text: 'Silakan login terlebih dahulu.' });
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        status: 403,
        message:
          'Anda tidak memiliki hak akses untuk halaman ini. ' +
          `Peran Anda saat ini: ${req.session.user.role}.`
      });
    }
    next();
  };
}

module.exports = {
  flashMiddleware,
  ensureCsrf,
  csrfProtection,
  verifyCsrf,
  requireLogin,
  requireRole
};
