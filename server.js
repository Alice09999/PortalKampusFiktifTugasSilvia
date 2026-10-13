'use strict';

/**
 * KampusKu — Portal Akademik Fiktif
 * Server Express: login, peran mahasiswa/dosen/admin, laboratorium kerentanan.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./src/config');
const { get, adaPerubahan, flushMirror } = require('./src/db');
const {
  flashMiddleware,
  ensureCsrf,
  csrfProtection
} = require('./src/middleware/auth');
const { createSessionStore } = require('./src/sessionStore');

const authRoutes = require('./src/routes/auth');
const mahasiswaRoutes = require('./src/routes/mahasiswa');
const dosenRoutes = require('./src/routes/dosen');
const adminRoutes = require('./src/routes/admin');
const filesRoutes = require('./src/routes/files');
const labRoutes = require('./src/routes/lab');

const app = express();

if (config.IS_PRODUCTION) {
  app.set('trust proxy', 1);
}
app.set('view engine', 'ejs');
app.set('views', path.join(config.ROOT, 'views'));
app.set('x-powered-by', false);

// ------------------------------------------------------------- middleware
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));

app.use(
  session({
    name: 'kampuskue.sid',
    secret: config.SESSION_SECRET,
    // null -> express-session memakai MemoryStore (perilaku lama persis).
    // Blobs dipakai hanya bila SESSION_BACKEND=blobs (diatur adapter Netlify).
    store: createSessionStore(config.SESSION_BACKEND) || undefined,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.IS_PRODUCTION,
      maxAge: 8 * 60 * 60 * 1000 // 8 jam
    }
  })
);

app.use(ensureCsrf);
app.use(flashMiddleware);
app.use(csrfProtection); // semua POST wajib memiliki token CSRF

// Mirror database ke Blobs (hanya aktif di Netlify bila DB_MIRROR=true).
// Dijalankan SEBELUM respons diakhiri supaya pekerjaan async masih sempat
// selesai sebelum Lambda membekukan proses.
if (config.DB_MIRROR) {
  app.use((req, res, next) => {
    const akhiri = res.end;
    res.end = function (chunk, encoding) {
      if (!adaPerubahan()) return akhiri.call(this, chunk, encoding);
      flushMirror()
        .catch(() => {}) // flushMirror sudah mencatat errornya sendiri
        .then(() => akhiri.call(this, chunk, encoding));
    };
    next();
  });
}

// Aset statis (CSS/JS) — folder `uploads` TIDAK disajikan statis.
app.use(express.static(path.join(config.ROOT, 'public'), { index: false }));

// ----------------------------------------------------------------- rute
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const home = { mahasiswa: '/mahasiswa', dosen: '/dosen', admin: '/admin' };
  return res.redirect(home[req.session.user.role] || '/login');
});

app.use('/', authRoutes);
app.use('/mahasiswa', mahasiswaRoutes);
app.use('/dosen', dosenRoutes);
app.use('/admin', adminRoutes);
app.use('/files', filesRoutes);
app.use('/lab', labRoutes);

// ------------------------------------------------------------ penanganan
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Tidak Ditemukan',
    status: 404,
    message: 'Halaman yang Anda tuju tidak ada.'
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] kesalahan:', err.message);
  if (res.headersSent) return;
  res.status(500).render('error', {
    title: 'Kesalahan Server',
    status: 500,
    message: 'Terjadi kesalahan pada server. Silakan coba lagi.'
  });
});

// ------------------------------------------------------------------ start
// Hanya dijalankan bila file ini dijalankan langsung (npm start / npm run dev).
// Saat diimpor oleh Netlify Function, app hanya diekspor TANPA membuka port
// dan TANPA menjalankan query pembuka database.
if (require.main === module) {
  // Penegakan keamanan: mode production TANPA SESSION_SECRET sah = tolak start.
  // (Nilai rahasia tidak pernah dicetak.)
  if (config.IS_PRODUCTION && !config.SESSION_SECRET_SAH) {
    console.error('');
    console.error('[server] MENOLAK START: environment variable SESSION_SECRET belum diisi');
    console.error('[server] atau masih memakai nilai contoh, sementara NODE_ENV=production.');
    console.error('[server] Isi SESSION_SECRET dengan string acak (>=16 karakter), lalu jalankan ulang.');
    process.exit(1);
  }

  const userCount = get('SELECT COUNT(*) AS c FROM users').c;
  if (userCount === 0) {
    console.log('');
    console.log('[server] PERHATIAN: database masih kosong.');
    console.log('[server] Jalankan dulu:  npm run init:db');
    console.log('');
  }

  app.listen(config.PORT, config.HOST, () => {
    console.log('');
    console.log('==========================================================');
    console.log(' KampusKu — Portal Akademik Fiktif');
    console.log(` URL        : http://${config.HOST}:${config.PORT}`);
    console.log(` Mode       : ${config.NODE_ENV}`);
    console.log(` Database   : ${config.DB_PATH}`);
    console.log(` Laboratorium : ${config.LAB_ENABLED ? 'AKTIF (/lab)' : 'NONAKTIF'}`);
    console.log(` Sesi       : ${config.SESSION_BACKEND === 'blobs' ? 'Netlify Blobs' : 'memori (lokal)'}`);
    console.log('==========================================================');
    console.log(' Akun demo : admin/admin12345 | dosen01/dosen12345');
    console.log('             mahasiswa01/mhs12345');
    console.log('==========================================================');
    console.log('');
  });
}

module.exports = app;
