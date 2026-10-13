'use strict';

/**
 * Lapisan penyimpanan berkas unggahan pengumpulan tugas.
 *
 *   disk  -> folder UPLOAD_DIR di disk lokal  (DEFAULT — perilaku asli persis)
 *   blobs -> Netlify Blobs (tersedia di paket gratis) — untuk deployment Netlify
 *
 * VALIDASI berkas (ekstensi, MIME, ukuran, jumlah) TIDAK berada di file ini dan
 * tidak diubah sama sekali — tetap di src/routes/mahasiswa.js.
 *
 * Catatan jujur: dengan backend 'disk' di Netlify, berkas ditulis ke /tmp yang
 * HILANG saat cold start. Karena itu adapter Netlify memakai backend 'blobs'
 * agar unggahan benar-benar persisten, bukan sekadar "tampak berhasil".
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');

const NAMA_TOKO = 'kampuskue-portal';
const PREFIX = 'up/';

function backend() {
  return config.STORAGE_BACKEND === 'blobs' ? 'blobs' : 'disk';
}

function store() {
  // Tidak di-cache di sini: src/blobs.js yang menyimpan cache per konteks,
  // karena objek store membawa token konteks pada saat ia dibuat.
  const { bukaToko } = require('./blobs');
  return bukaToko(NAMA_TOKO);
}

function namaBaru(originalname) {
  const ext = path.extname(String(originalname || '')).toLowerCase().slice(1);
  return `sub_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
}

/** Storage multer: disk (lokal) atau memory (Netlify, lalu disimpan ke Blobs). */
function multerStorage() {
  if (backend() === 'blobs') return multer.memoryStorage();

  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      cb(null, `sub_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`);
    }
  });
}

/**
 * Simpan hasil unggahan multer. Wajib dipanggil SEBELUM baris database ditulis,
 * agar tidak ada baris yang menunjuk berkas yang gagal tersimpan.
 * Mengembalikan { name } — nama berkas yang disimpan di kolom submissions.file_path.
 */
async function persist(file) {
  if (!file) return { name: null };
  if (backend() === 'disk') return { name: file.filename };
  const name = namaBaru(file.originalname);
  await store().set(PREFIX + name, file.buffer);
  return { name };
}

/** Hapus berkas lama saat berkas pengumpulan diganti. */
async function remove(filePath) {
  const base = path.basename(String(filePath || ''));
  if (!base) return;
  if (backend() === 'blobs') {
    await store().delete(PREFIX + base);
    return;
  }
  const full = path.join(config.UPLOAD_DIR, base);
  try {
    if (fs.existsSync(full)) fs.rmSync(full);
  } catch (_) {
    /* berkas lama gagal dihapus bukan hal fatal */
  }
}

/**
 * Kirim berkas dari Blobs.
 * @returns {Promise<boolean>} true bila berkas sudah terkirim, false bila tidak ada.
 */
async function sendFromBlobs(res, filePath, safeName) {
  const base = path.basename(String(filePath || ''));
  if (!base) return false;
  const data = await store().get(PREFIX + base, { type: 'arrayBuffer' });
  if (data === null || data === undefined) return false;

  const nama = String(safeName || base).replace(/[^\w.\-() ]+/g, '_');
  const buf = Buffer.from(data);
  res.status(200);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${nama}"`);
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
  return true;
}

module.exports = {
  backend,
  multerStorage,
  persist,
  remove,
  sendFromBlobs
};
