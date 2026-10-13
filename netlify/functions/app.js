'use strict';

/**
 * Adapter Express -> Netlify Functions.
 *
 * Tugas file ini (sekali per container):
 *  1. Menyetel environment variable default SEBELUM src/config.js dibaca.
 *  2. Menyalin artefak build (database hasil `npm run init:db` + berkas seed
 *     unggahan) dari bundle yang READ-ONLY ke direktori writable (/tmp).
 *  3. Memuat aplikasi Express TANPA app.listen, lalu membungkusnya dengan
 *     serverless-http (pola resmi dokumentasi Netlify untuk Express).
 *
 * Laboratorium (/lab, /lab/sqli, /lab/login) DIPAKSA nonaktif di sini:
 * LAB_ENABLED disetel 'false' apa pun isi environment variable lainnya.
 * Kode lab tetap ada di source code (src/routes/lab.js) — tidak dihapus.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Satu-satunya direktori writable di Lambda. os.tmpdir() = /tmp di Linux.
const TMP = process.env.TMP_DIR || os.tmpdir();
const TOKO = 'kampuskue-portal';

// --------------------------------------------------------------- 1. env
function cariAkar() {
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'views', 'login.ejs'))) return dir;
    const induk = path.dirname(dir);
    if (induk === dir) break;
    dir = induk;
  }
  return path.join(__dirname, '..', '..');
}

const AKAR = cariAkar();
const pakaiBlobs =
  String(process.env.STORAGE_BACKEND || 'blobs').trim().toLowerCase() === 'blobs';

// Nilai di bawah hanyalah DEFAULT; operator masih bisa menimpa lewat Netlify UI.
process.env.APP_ROOT = process.env.APP_ROOT || AKAR;
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.LAB_ENABLED = 'false'; // DIPAKSA — lab tidak boleh hidup di deploy publik
process.env.DB_PATH = process.env.DB_PATH || path.join(TMP, 'kampuskue.db');
process.env.LAB_DB_PATH = process.env.LAB_DB_PATH || path.join(TMP, 'lab.db');
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(TMP, 'uploads');
process.env.SESSION_BACKEND =
  process.env.SESSION_BACKEND || (pakaiBlobs ? 'blobs' : 'memory');
process.env.STORAGE_BACKEND =
  process.env.STORAGE_BACKEND || (pakaiBlobs ? 'blobs' : 'disk');
process.env.DB_MIRROR = process.env.DB_MIRROR || (pakaiBlobs ? 'true' : 'false');
// Batas payload fungsi yang di-buffer Netlify adalah 6 MB; unggahan 5 MB
// (default lokal) + overhead multipart bisa melewatinya -> batasi 4 MB di Netlify.
process.env.MAX_UPLOAD_BYTES = process.env.MAX_UPLOAD_BYTES || '4194304';

if (!fs.existsSync(path.join(AKAR, 'views', 'login.ejs'))) {
  console.error('[netlify] views/ tidak ditemukan di bundle. AKAR=' + AKAR);
  console.error(
    '[netlify] Pastikan netlify.toml memuat included_files = ["views/**", "public/**", ...].'
  );
}

// ------------------------------------------------------------ 2. hydrate
function salinDirSumber(sumber, tujuan) {
  if (!fs.existsSync(sumber)) return 0;
  fs.mkdirSync(tujuan, { recursive: true });
  let n = 0;
  for (const nama of fs.readdirSync(sumber)) {
    const dari = path.join(sumber, nama);
    if (fs.statSync(dari).isFile()) {
      fs.copyFileSync(dari, path.join(tujuan, nama));
      n += 1;
    }
  }
  return n;
}

function salinDatabase() {
  const tujuanDb = process.env.DB_PATH;
  const tujuanLab = process.env.LAB_DB_PATH;
  const dirTujuan = path.dirname(tujuanDb);
  const dirLab = path.dirname(tujuanLab);
  fs.mkdirSync(dirTujuan, { recursive: true });
  fs.mkdirSync(dirLab, { recursive: true });

  const pasangan = [
    ['kampuskue.db', path.basename(tujuanDb), dirTujuan],
    ['lab.db', path.basename(tujuanLab), dirLab]
  ];
  let ada = false;
  for (const pasanganItem of pasangan) {
    const namaSumber = pasanganItem[0];
    const namaTujuan = pasanganItem[1];
    const dir = pasanganItem[2];
    for (const akhiran of ['', '-wal', '-shm']) {
      const dari = path.join(AKAR, 'data', namaSumber + akhiran);
      if (fs.existsSync(dari)) {
        fs.copyFileSync(dari, path.join(dir, namaTujuan + akhiran));
        ada = true;
      }
    }
  }
  return ada;
}

async function ambilDariBlobs() {
  const { getStore } = require('@netlify/blobs');
  const toko = getStore({ name: TOKO, consistency: 'strong' });
  const isi = await toko.get('db/kampuskue.db', { type: 'arrayBuffer' });
  return isi ? Buffer.from(isi) : null;
}

async function hydrate() {
  // (a) berkas seed unggahan -> folder writable
  const dirUpload = process.env.UPLOAD_DIR;
  try {
    if (!fs.existsSync(dirUpload)) {
      const n = salinDirSumber(path.join(AKAR, 'uploads'), dirUpload);
      if (n > 0) {
        console.log('[netlify] ' + n + ' berkas seed unggahan disalin ke ' + dirUpload);
      }
    }
  } catch (e) {
    console.error('[netlify] gagal menyiapkan folder unggahan:', e.message || e);
  }

  // (b) database
  try {
    if (fs.existsSync(process.env.DB_PATH)) {
      console.log('[netlify] database di ' + TMP + ' masih ada (container hangat)');
      return;
    }

    // Data dari cold start sebelumnya dipertahankan lewat Blobs.
    if (process.env.DB_MIRROR === 'true') {
      try {
        const buf = await ambilDariBlobs();
        if (buf) {
          fs.writeFileSync(process.env.DB_PATH, buf);
          console.log('[netlify] database dipulihkan dari penyimpanan persisten (Blobs)');
          return;
        }
      } catch (e) {
        console.error('[netlify] gagal mengambil database dari Blobs:', e.message || e);
      }
    }

    if (salinDatabase()) {
      console.log(
        '[netlify] database disalin dari bundle (hasil npm run init:db saat build) ke ' +
          path.dirname(process.env.DB_PATH)
      );
    } else {
      console.error('[netlify] database TIDAK ditemukan di bundle.');
      console.error(
        '[netlify] Pastikan build menjalankan "npm run init:db" dan netlify.toml memuat included_files data/*.'
      );
    }
  } catch (e) {
    console.error('[netlify] gagal menyiapkan database:', e.message || e);
  }
}

// -------------------------------------------------------------- 3. handler
let siap = null;

function muat() {
  if (!siap) {
    siap = hydrate()
      .catch((e) => console.error('[netlify] hydrate gagal:', e.message || e))
      .then(() => {
        const config = require('../../src/config');

        // Penegakan keamanan: production tanpa SESSION_SECRET sah = tolak layan.
        // (Nilai rahasia tidak pernah dicetak.)
        if (config.IS_PRODUCTION && !config.SESSION_SECRET_SAH) {
          console.error(
            '[netlify] MENOLAK MELAYANI: environment variable SESSION_SECRET belum diisi ' +
              'atau masih memakai nilai contoh.'
          );
          return function tolak() {
            return Promise.resolve({
              statusCode: 500,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
              body:
                'Konfigurasi server belum lengkap. Operator: isi environment variable ' +
                'SESSION_SECRET di pengaturan site Netlify.'
            });
          };
        }

        const app = require('../../server');
        return require('serverless-http')(app);
      });
  }
  return siap;
}

exports.handler = async (event, context) => {
  const handler = await muat();
  return handler(event, context);
};
