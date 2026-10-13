'use strict';

/**
 * Unduhan berkas pengumpulan tugas.
 * Berkas TIDAK disajikan sebagai statis; setiap akses diperiksa otorisasinya:
 *   - mahasiswa : hanya berkas miliknya sendiri
 *   - dosen     : hanya berkas untuk mata kuliah yang diajar
 *   - admin     : seluruh berkas
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { get } = require('../db');
const storage = require('../storage');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).render('error', {
      title: 'Permintaan Tidak Valid',
      status: 400,
      message: 'ID berkas tidak valid.'
    });
  }

  const sub = get(
    `SELECT s.*, a.course_id, c.dosen_id
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN courses c ON c.id = a.course_id
      WHERE s.id = ?`,
    [id]
  );

  if (!sub) {
    return res.status(404).render('error', {
      title: 'Tidak Ditemukan',
      status: 404,
      message: 'Berkas tidak ditemukan.'
    });
  }

  const { role, id: uid } = req.session.user;
  const boleh =
    role === 'admin' ||
    (role === 'mahasiswa' && sub.student_id === uid) ||
    (role === 'dosen' && sub.dosen_id === uid);

  if (!boleh) {
    return res.status(403).render('error', {
      title: 'Akses Ditolak',
      status: 403,
      message: 'Anda tidak berhak mengakses berkas ini.'
    });
  }

  if (!sub.file_path) {
    return res.status(404).render('error', {
      title: 'Tidak Ada Berkas',
      status: 404,
      message: 'Pengumpulan ini tidak memiliki berkas.'
    });
  }

  const safeName = String(sub.file_name || 'berkas.txt').replace(/[^\w.\-() ]+/g, '_');
  const fullPath = path.join(config.UPLOAD_DIR, path.basename(sub.file_path));

  // (1) Berkas di disk lokal — termasuk berkas seed hasil `npm run init:db`.
  if (fs.existsSync(fullPath)) {
    return res.download(fullPath, safeName, (err) => {
      if (err && !res.headersSent) {
        res.status(500).render('error', {
          title: 'Kesalahan',
          status: 500,
          message: 'Gagal mengirim berkas.'
        });
      }
    });
  }

  // (2) Penyimpanan persisten Netlify Blobs (bila backend = blobs).
  if (storage.backend() === 'blobs') {
    storage
      .sendFromBlobs(res, sub.file_path, safeName)
      .then((ada) => {
        if (ada) return;
        if (!res.headersSent) {
          res.status(404).render('error', {
            title: 'Berkas Hilang',
            status: 404,
            message: 'File fisik tidak ditemukan di server.'
          });
        }
      })
      .catch((e) => {
        console.error('[files] gagal mengambil berkas dari Blobs:', e.message || e);
        if (!res.headersSent) {
          res.status(500).render('error', {
            title: 'Kesalahan',
            status: 500,
            message: 'Gagal mengambil berkas dari penyimpanan.'
          });
        }
      });
    return;
  }

  // (3) Tidak ada di mana pun.
  return res.status(404).render('error', {
    title: 'Berkas Hilang',
    status: 404,
    message: 'File fisik tidak ditemukan di server.'
  });
});

module.exports = router;
