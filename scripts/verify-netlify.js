'use strict';

/**
 * Verifikasi jalur deployment Netlify — TANPA deploy, TANPA jaringan, TANPA Blobs.
 *
 *   npm run verify:netlify
 *
 * Yang diperiksa:
 *   N. Jalur adapter netlify/functions/app.js lewat serverless-http (event
 *      API Gateway tiruan): guard app.listen, hydrate database & unggahan ke
 *      direktori writable, resolusi views/public dari AKAR bundle, sesi+CSRF
 *      bekerja di belakang serverless-http, lab DIPAKSA mati, database lokal
 *      tidak tersentuh.
 *   O. Penegakan SESSION_SECRET: node server.js dan adapter dijalankan dalam
 *      proses TERPISAH (anak) dengan mode production tanpa rahasia sah.
 *   P. Mirror database (DB_MIRROR=true) saat Blobs tidak tersedia: flush gagal
 *      dengan anggun — dicatat ke log, aplikasi tetap termuat.
 *
 * Total: 25 pemeriksaan.
 *
 * Seluruh berkas sementara ditulis ke os.tmpdir()/kampuskue-verify —
 * TIDAK pernah menyentuh database lokal (data/*.db) atau uploads/ proyek.
 * Nilai rahasia TIDAK pernah dicetak.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PROYEK = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'kampuskue-verify');
const DB_LOKAL = path.join(PROYEK, 'data', 'kampuskue.db');

let lulus = 0;
let gagal = 0;
function cek(nama, ok, info) {
  if (ok) {
    lulus += 1;
    console.log('  PASS  ' + nama);
  } else {
    gagal += 1;
    console.log('  FAIL  ' + nama + '  ' + (info || ''));
  }
}

function ev(method, p, body, headers) {
  return {
    httpMethod: method,
    path: p,
    resource: p,
    headers: Object.assign({ Host: 'localhost', 'X-Forwarded-For': '127.0.0.1' }, headers || {}),
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: { stage: '$default', identity: { sourceIp: '127.0.0.1' } },
    isBase64Encoded: false,
    body: body || null
  };
}

function ambilCookie(res) {
  const semua = [];
  const mv = res.multiValueHeaders || {};
  const h = res.headers || {};
  for (const sumber of [mv, h]) {
    for (const k of Object.keys(sumber)) {
      if (k.toLowerCase() === 'set-cookie') {
        [].push.apply(semua, Array.isArray(sumber[k]) ? sumber[k] : [sumber[k]]);
      }
    }
  }
  for (const c of semua) {
    const m = String(c).match(/kampuskue\.sid=([^;]+)/);
    if (m) return 'kampuskue.sid=' + m[1];
  }
  return null;
}

// ================================================================== anak: O
// Dijalankan sebagai proses terpisah supaya config.js dimuat ulang dengan
// environment production tanpa rahasia sah.
if (process.argv[2] === '--penegakan') {
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = process.argv[3] === 'placeholder'
    ? 'ganti-dengan-string-acak-panjang'
    : '';
  process.env.SESSION_BACKEND = 'memory';
  process.env.STORAGE_BACKEND = 'disk';
  process.env.DB_MIRROR = 'false';
  process.env.TMP_DIR = process.argv[3] === 'placeholder' ? TMP + '-ph' : TMP + '-kosong';

  const adapter = require(path.join(PROYEK, 'netlify', 'functions', 'app.js'));
  adapter
    .handler(ev('GET', '/login'), {})
    .then((res) => {
      console.log('STATUS=' + res.statusCode);
      console.log('ADA_SESSION_SECRET=' + String(res.body).includes('SESSION_SECRET'));
      console.log('BOCOR=' + /INSECURE-DEFAULT|ganti-dengan-string/.test(String(res.body)));
      process.exit(0);
    })
    .catch((e) => {
      console.error('ERR=' + (e && e.message ? e.message : e));
      process.exit(1);
    });
  return;
}

// ================================================================== anak: P
// DB_MIRROR=true tanpa kredensial Blobs: flush wajib GAGAL dengan anggun
// (dicatat ke log, aplikasi tetap termuat), bukan merusak permintaan.
if (process.argv[2] === '--mirror') {
  process.env.DB_MIRROR = 'true';
  process.env.STORAGE_BACKEND = 'blobs';
  process.env.SESSION_BACKEND = 'memory';
  const dirM = TMP + '-mirror';
  process.env.DB_PATH = path.join(dirM, 'kampuskue.db');
  process.env.LAB_DB_PATH = path.join(dirM, 'lab.db');
  process.env.UPLOAD_DIR = path.join(dirM, 'uploads');
  delete process.env.NETLIFY_SITE_ID;
  delete process.env.NETLIFY_BLOBS_TOKEN;
  delete process.env.NETLIFY_TOKEN;

  const pesan = [];
  const asli = console.error;
  console.error = function () {
    pesan.push(Array.prototype.map.call(arguments, String).join(' '));
  };

  const dbMod = require(path.join(PROYEK, 'src', 'db'));
  const aplikasi = require(path.join(PROYEK, 'server'));

  dbMod.run('UPDATE users SET full_name = full_name WHERE id = 1');
  const kotor = dbMod.adaPerubahan();
  dbMod
    .flushMirror()
    .catch(() => false)
    .then((ok) => {
      console.error = asli;
      console.log('KOTOR=' + kotor);
      console.log('OK=' + ok);
      console.log('ADA_PESAN=' + (pesan.length > 0));
      console.log('SEBUT_BLOBS=' + pesan.join(' ').toLowerCase().includes('blobs'));
      console.log('APP_DIMUAT=' + (typeof aplikasi === 'function' || typeof aplikasi === 'object'));
      process.exit(0);
    });
  return;
}

// ================================================================ induk
(async function () {
  const mtimeSebelum = fs.existsSync(DB_LOKAL) ? fs.statSync(DB_LOKAL).mtimeMs : null;

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  process.env.TMP_DIR = TMP;
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.SESSION_BACKEND = 'memory'; // jalur pelarian bila Blobs tak tersedia
  process.env.STORAGE_BACKEND = 'disk';
  process.env.DB_MIRROR = 'false';
  process.env.LAB_ENABLED = 'true'; // sengaja: adapter wajib menimpa jadi false
  delete process.env.APP_ROOT;
  delete process.env.NODE_ENV;
  delete process.env.DB_PATH;
  delete process.env.LAB_DB_PATH;
  delete process.env.UPLOAD_DIR;
  delete process.env.MAX_UPLOAD_BYTES;

  console.log('=== N. Jalur adapter Netlify Functions (lokal, tanpa Blobs) ===');
  const adapter = require(path.join(PROYEK, 'netlify', 'functions', 'app.js'));
  const handler = adapter.handler;

  const r1 = await handler(ev('GET', '/login'), {});
  cek('GET /login membalas 200 lewat serverless-http', r1.statusCode === 200, 'status=' + r1.statusCode);
  cek('Template EJS ter-render (views ditemukan dari AKAR bundle)', String(r1.body).includes('KampusKu'));

  const r2 = await handler(ev('GET', '/css/style.css'), {});
  cek('Aset statis /css/style.css dilayani (public/ ditemukan)', r2.statusCode === 200, 'status=' + r2.statusCode);

  const r3 = await handler(ev('GET', '/lab'), {});
  cek('Jalur /lab DIPAKSA 404 (LAB_ENABLED dipaksa false oleh adapter)',
    r3.statusCode === 404 && String(r3.body).includes('Laboratorium dinonaktifkan'), 'status=' + r3.statusCode);
  const r3b = await handler(ev('GET', '/lab/sqli'), {});
  cek('Jalur /lab/sqli juga 404', r3b.statusCode === 404, 'status=' + r3b.statusCode);
  const r3c = await handler(ev('GET', '/lab/login'), {});
  cek('Jalur /lab/login juga 404', r3c.statusCode === 404, 'status=' + r3c.statusCode);

  const token = (String(r1.body).match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
  cek('Token CSRF tersedia di halaman login', Boolean(token));
  const cookie = ambilCookie(r1);
  cek('Cookie sesi diberikan lewat respons serverless-http', Boolean(cookie));

  const form = '_csrf=' + token + '&username=admin&password=admin12345';
  const r4 = await handler(
    ev('POST', '/login', form, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(form)),
      Cookie: cookie
    }),
    {}
  );
  const lokasi = r4.headers && (r4.headers.location || r4.headers.Location);
  cek('Login admin berhasil lewat adapter (302 -> /admin)', r4.statusCode === 302 && lokasi === '/admin',
    'status=' + r4.statusCode + ' loc=' + lokasi);

  const cookieAdmin = ambilCookie(r4) || cookie;
  const r5 = await handler(ev('GET', '/admin', null, { Cookie: cookieAdmin }), {});
  cek('Halaman admin terbuka dengan sesi hasil login adapter',
    r5.statusCode === 200 && String(r5.body).includes('Dashboard Admin'), 'status=' + r5.statusCode);

  cek('Database tersalin ke direktori writable (simulasi /tmp)',
    fs.existsSync(path.join(TMP, 'kampuskue.db')));
  const jumlahSeed = fs.existsSync(path.join(TMP, 'uploads'))
    ? fs.readdirSync(path.join(TMP, 'uploads')).filter((f) => f.startsWith('seed_')).length
    : 0;
  cek('Berkas seed unggahan tersalin (>0 berkas)', jumlahSeed > 0, 'jumlah=' + jumlahSeed);

  const mtimeSesudah = fs.existsSync(DB_LOKAL) ? fs.statSync(DB_LOKAL).mtimeMs : null;
  cek('Database lokal proyek TIDAK diubah jalur adapter', mtimeSebelum === mtimeSesudah);

  console.log('');
  console.log('=== O. Penegakan SESSION_SECRET (proses terpisah) ===');

  // (1) adapter tanpa rahasia -> membalas 500 konfigurasi
  const anakKosong = spawnSync(process.execPath, [__filename, '--penegakan', ''], {
    cwd: PROYEK,
    encoding: 'utf8',
    timeout: 60000
  });
  const baris = String(anakKosong.stdout || '').split('\n');
  const status = (baris.find((b) => b.startsWith('STATUS=')) || '').split('=')[1];
  const ada = (baris.find((b) => b.startsWith('ADA_SESSION_SECRET=')) || '').split('=')[1];
  const bocor = (baris.find((b) => b.startsWith('BOCOR=')) || '').split('=')[1];
  cek('Proses anak berjalan normal', anakKosong.status === 0,
    'status=' + anakKosong.status + ' ' + String(anakKosong.stderr || '').slice(-200));
  cek('Adapter menolak melayani tanpa SESSION_SECRET (500)', status === '500', 'status=' + status);
  cek('Respons penolakan menyarankan mengisi SESSION_SECRET', ada === 'true');
  cek('Respons penolakan TIDAK membocorkan nilai rahasia apa pun', bocor === 'false');

  // (2) adapter dengan nilai contoh -> tetap ditolak
  const anakPlaceholder = spawnSync(process.execPath, [__filename, '--penegakan', 'placeholder'], {
    cwd: PROYEK,
    encoding: 'utf8',
    timeout: 60000
  });
  const barisPh = String(anakPlaceholder.stdout || '').split('\n');
  const statusPh = (barisPh.find((b) => b.startsWith('STATUS=')) || '').split('=')[1];
  cek('Nilai contoh (placeholder) TIDAK dianggap sah', statusPh === '500', 'status=' + statusPh);

  // (3) node server.js tanpa rahasia -> exit 1 (langsung)
  const langsung = spawnSync(process.execPath, ['server.js'], {
    cwd: PROYEK,
    encoding: 'utf8',
    timeout: 60000,
    env: Object.assign({}, process.env, {
      NODE_ENV: 'production',
      SESSION_SECRET: '',
      DB_PATH: path.join(TMP, 'sec', 'kampuskue.db'),
      LAB_DB_PATH: path.join(TMP, 'sec', 'lab.db'),
      UPLOAD_DIR: path.join(TMP, 'sec', 'uploads')
    })
  });
  const teks = String(langsung.stdout || '') + String(langsung.stderr || '');
  cek('node server.js (production, tanpa SESSION_SECRET) keluar dengan kode 1',
    langsung.status === 1, 'status=' + langsung.status);
  cek('Pesan penolakan menyebut SESSION_SECRET tanpa membocorkan nilainya',
    teks.includes('SESSION_SECRET') && !/INSECURE-DEFAULT|ganti-dengan-string/.test(teks));

  console.log('');
  console.log('=== P. Mirror database saat Blobs tidak tersedia (proses terpisah) ===');
  const anakMirror = spawnSync(process.execPath, [__filename, '--mirror'], {
    cwd: PROYEK,
    encoding: 'utf8',
    timeout: 90000
  });
  const barisM = String(anakMirror.stdout || '').split('\n');
  const ambil = (k) => (barisM.find((b) => b.startsWith(k + '=')) || '').split('=')[1];
  cek('Proses mirror berjalan normal', anakMirror.status === 0,
    'status=' + anakMirror.status + ' ' + String(anakMirror.stderr || '').slice(-300));
  cek('Tanda perubahan database terdeteksi setelah tulisan', ambil('KOTOR') === 'true');
  cek('Aplikasi Express tetap termuat (guard listen bekerja)', ambil('APP_DIMUAT') === 'true');
  cek('flushMirror mengembalikan false (tidak mengaku berhasil)', ambil('OK') === 'false');
  cek('Kegagalan mirror dicatat ke log dan menyebut Blobs', ambil('SEBUT_BLOBS') === 'true');

  console.log('');
  console.log(`Ringkasan verifikasi Netlify: ${lulus} lulus, ${gagal} gagal.`);
  process.exit(gagal > 0 ? 1 : 0);
})().catch((e) => {
  console.error('Kesalahan pada verifikasi:', e && e.stack ? e.stack : e);
  process.exit(1);
});
