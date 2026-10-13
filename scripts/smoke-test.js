'use strict';

/**
 * Uji asap (smoke test) KampusKu.
 * Menjalankan seluruh skenario wajib terhadap server yang sedang berjalan di
 * http://127.0.0.1:3000 (jalankan dulu: npm start).
 *
 *   node scripts/smoke-test.js
 *
 * Keluaran: daftar PASS/FAIL + ringkasan. Kode keluar 0 jika semua lulus.
 */

const { spawn } = require('child_process');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const gagal = [];

function check(nama, kondisi, info = '') {
  if (kondisi) {
    pass += 1;
    console.log(`  PASS  ${nama}${info ? `  (${info})` : ''}`);
  } else {
    fail += 1;
    gagal.push(nama);
    console.log(`  FAIL  ${nama}${info ? `  (${info})` : ''}`);
  }
}

function section(judul) {
  console.log(`\n=== ${judul} ===`);
}

// ------------------------------------------------------------- klien HTTP
function buatKlien() {
  const jar = new Map();

  async function req(pilihan) {
    const {
      method = 'GET',
      url,
      form,
      json,
      raw,
      contentType,
      accept
    } = pilihan;

    const headers = {};
    if (jar.size) {
      headers.cookie = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (accept) headers.accept = accept;

    let body;
    if (form) {
      body = form; // FormData -> fetch yang menetapkan boundary
    } else if (json) {
      body = JSON.stringify(json);
      headers['content-type'] = 'application/json';
      if (accept === undefined) headers.accept = 'application/json';
    } else if (raw !== undefined) {
      body = raw;
      headers['content-type'] = contentType || 'application/x-www-form-urlencoded';
    }

    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of sc) {
      const pair = c.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    const teks = await res.text();
    return {
      status: res.status,
      location: res.headers.get('location') || '',
      text: teks,
      headers: res.headers
    };
  }

  return {
    req,
    get: (url) => req({ url }),
    postForm: (url, obj) => req({ url, method: 'POST', raw: new URLSearchParams(obj).toString() }),
    postJson: (url, obj) => req({ url, method: 'POST', json: obj, accept: 'application/json' }),
    postMultipart: (url, fd) => req({ url, method: 'POST', form: fd })
  };
}

function tokenCsrf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

async function login(klien, username, password) {
  const hal = await klien.get(`${BASE}/login`);
  const tok = tokenCsrf(hal.text);
  return klien.postForm(`${BASE}/login`, { _csrf: tok, username, password });
}

const db = new DatabaseSync(path.join(ROOT, 'data', 'kampuskue.db'));
const q1 = (sql, ...p) => db.prepare(sql).get(...p);

// ===================================================================== main
(async function main() {
  console.log('Memulai uji asap KampusKu terhadap', BASE);

  // ---------------------------------------------------------- ketersediaan
  section('A. Ketersediaan aplikasi');
  const anon = buatKlien();
  const loginPage = await anon.get(`${BASE}/login`);
  check('Halaman login terbuka (200)', loginPage.status === 200, `status=${loginPage.status}`);
  check('Halaman login memuat judul aplikasi', loginPage.text.includes('KampusKu'));

  const cekTanpaLogin = await anon.get(`${BASE}/mahasiswa`);
  check('Rute terlindungi mengarahkan ke /login',
    cekTanpaLogin.status === 302 && cekTanpaLogin.location === '/login',
    `status=${cekTanpaLogin.status} lokasi=${cekTanpaLogin.location}`);

  // --------------------------------------------------------------- CSRF
  section('B. Token CSRF pada login');
  const tanpaCsrf = await anon.postForm(`${BASE}/login`, { username: 'admin', password: 'admin12345' });
  check('POST tanpa token CSRF ditolak 403', tanpaCsrf.status === 403, `status=${tanpaCsrf.status}`);

  // ------------------------------------------------------ login 3 peran
  section('C. Login ketiga peran');
  const mhs = buatKlien();
  const mhsLogin = await login(mhs, 'mahasiswa01', 'mhs12345');
  check('Login mahasiswa diarahkan ke /mahasiswa',
    mhsLogin.status === 302 && mhsLogin.location === '/mahasiswa',
    `status=${mhsLogin.status} lokasi=${mhsLogin.location}`);

  const dsn = buatKlien();
  const dsnLogin = await login(dsn, 'dosen01', 'dosen12345');
  check('Login dosen diarahkan ke /dosen',
    dsnLogin.status === 302 && dsnLogin.location === '/dosen',
    `status=${dsnLogin.status} lokasi=${dsnLogin.location}`);

  const adm = buatKlien();
  const admLogin = await login(adm, 'admin', 'admin12345');
  check('Login admin diarahkan ke /admin',
    admLogin.status === 302 && admLogin.location === '/admin',
    `status=${admLogin.status} lokasi=${admLogin.location}`);

  const gagalLogin = await login(buatKlien(), 'mahasiswa01', 'salah-banget');
  const halGagal = await (async () => {
    const c = buatKlien();
    await login(c, 'mahasiswa01', 'salah-banget');
    return c.get(`${BASE}/login`);
  })();
  check('Login salah menampilkan pesan kegagalan',
    halGagal.text.includes('Login gagal'), 'flash ditampilkan');
  check('Login salah diarahkan kembali ke /login',
    gagalLogin.status === 302 && gagalLogin.location === '/login');

  const logout = await mhs.postForm(`${BASE}/logout`, { _csrf: tokenCsrf((await mhs.get(`${BASE}/mahasiswa/nilai`)).text) });
  check('Logout berhasil (arahkan ke /login)',
    logout.status === 302 && logout.location === '/login');
  const sesudahLogout = await mhs.get(`${BASE}/mahasiswa`);
  check('Sesi benar-benar berakhir setelah logout',
    sesudahLogout.status === 302 && sesudahLogout.location === '/login');
  // login ulang untuk pengujian berikutnya
  await login(mhs, 'mahasiswa01', 'mhs12345');

  // ------------------------------------------------------- pembatasan peran
  section('D. Pembatasan akses peran');
  const r1 = await mhs.get(`${BASE}/admin`);
  check('Mahasiswa tidak bisa membuka /admin', r1.status === 403, `status=${r1.status}`);
  const r2 = await mhs.get(`${BASE}/dosen`);
  check('Mahasiswa tidak bisa membuka /dosen', r2.status === 403, `status=${r2.status}`);
  const r3 = await dsn.get(`${BASE}/admin`);
  check('Dosen tidak bisa membuka /admin', r3.status === 403, `status=${r3.status}`);
  const r4 = await adm.get(`${BASE}/dosen`);
  check('Admin tidak bisa membuka /dosen', r4.status === 403, `status=${r4.status}`);
  const r5 = await dsn.get(`${BASE}/admin/akun`);
  check('Dosen tidak bisa membuka pengelolaan akun', r5.status === 403);

  // ----------------------------------------------------- isolasi data nilai
  section('E. Isolasi data nilai mahasiswa (anti-IDOR)');
  const halNilai = await mhs.get(`${BASE}/mahasiswa/nilai`);
  check('Halaman nilai terbuka', halNilai.status === 200);
  check('Menampilkan nama mahasiswa sendiri', halNilai.text.includes('Andi Pratama'));
  check('TIDAK menampilkan mahasiswa lain', !halNilai.text.includes('Bella Safitri'));

  const nimmahasiswa02 = q1(`SELECT identity_no AS n FROM users WHERE username='mahasiswa02'`).n;
  check('TIDAK bocor NIM mahasiswa lain', !halNilai.text.includes(nimmahasiswa02), nimmahasiswa02);

  const subLain = q1(
    `SELECT s.id AS id FROM submissions s
       JOIN users u ON u.id = s.student_id
      WHERE u.username <> 'mahasiswa01' LIMIT 1`
  ).id;
  const ambilFileLain = await mhs.get(`${BASE}/files/${subLain}`);
  check('Mahasiswa tidak bisa mengunduh berkas mahasiswa lain',
    ambilFileLain.status === 403, `status=${ambilFileLain.status}`);

  const subSendiri = q1(
    `SELECT s.id AS id FROM submissions s
       JOIN users u ON u.id = s.student_id
      WHERE u.username = 'mahasiswa01' AND s.file_path IS NOT NULL LIMIT 1`
  ).id;
  const ambilFileSendiri = await mhs.get(`${BASE}/files/${subSendiri}`);
  check('Mahasiswa bisa mengunduh berkasnya sendiri',
    ambilFileSendiri.status === 200, `status=${ambilFileSendiri.status}`);

  const detailDosenLain = await mhs.get(`${BASE}/dosen/mata-kuliah/1`);
  check('Mahasiswa tidak bisa membuka halaman detail dosen',
    detailDosenLain.status === 403);

  // ------------------------------------------------------ fitur mahasiswa
  section('F. Fitur mahasiswa: unggah tugas & diskusi');
  const tugasRow = q1(
    `SELECT a.id AS id FROM assignments a
       JOIN enrollments e ON e.course_id = a.course_id
       JOIN users u ON u.id = e.student_id
      WHERE u.username='mahasiswa01' ORDER BY a.id LIMIT 1`
  );
  const halTugas = await mhs.get(`${BASE}/mahasiswa/tugas`);
  check('Halaman tugas terbuka', halTugas.status === 200);
  const tokTugas = tokenCsrf(halTugas.text);

  const fd = new FormData();
  fd.append('_csrf', tokTugas);
  fd.append('catatan', 'Catatan uji asap KampusKu');
  fd.append('berkas', new Blob(['isi berkas uji asap sintetis'], { type: 'text/plain' }), 'tugas_smoke.txt');
  const unggah = await mhs.postMultipart(`${BASE}/mahasiswa/tugas/${tugasRow.id}/submit`, fd);
  check('Unggahan tugas diterima server',
    unggah.status === 302 && unggah.location === '/mahasiswa/tugas',
    `status=${unggah.status} lokasi=${unggah.location}`);

  const halSesudahUnggah = await mhs.get(`${BASE}/mahasiswa/tugas`);
  check('Status pengumpulan berubah menjadi terkumpul',
    halSesudahUnggah.text.includes('Sudah diunggah') || halSesudahUnggah.text.includes('Sudah dinilai'));
  check('Catatan unggahan tersimpan & tampil kembali',
    halSesudahUnggah.text.includes('Catatan uji asap KampusKu'));

  const subBaru = q1(
    `SELECT s.file_path AS fp FROM submissions s WHERE s.assignment_id=? AND
       s.student_id=(SELECT id FROM users WHERE username='mahasiswa01')`,
    tugasRow.id
  );
  check('Berkas benar-benar tersimpan di backend', !!subBaru && !!subBaru.fp, subBaru ? subBaru.fp : 'tidak ada');

  // unggahan berkas terlarang ditolak
  const fdBuruk = new FormData();
  fdBuruk.append('_csrf', tokTugas);
  fdBuruk.append('catatan', 'x');
  fdBuruk.append('berkas', new Blob(['tidak boleh'], { type: 'application/x-msdownload' }), 'jahat.exe');
  const tolakBerkas = await mhs.postMultipart(`${BASE}/mahasiswa/tugas/${tugasRow.id}/submit`, fdBuruk);
  const halTolak = await mhs.get(`${BASE}/mahasiswa/tugas`);
  check('Berkas dengan ekstensi terlarang ditolak',
    tolakBerkas.status === 302 && halTolak.text.includes('Unggahan ditolak'),
    'ekstensi .exe ditolak');

  // diskusi
  const halDiskusi = await mhs.get(`${BASE}/mahasiswa/diskusi`);
  check('Halaman diskusi terbuka', halDiskusi.status === 200);
  const tokDisk = tokenCsrf(halDiskusi.text);
  const courseId = q1(
    `SELECT e.course_id AS c FROM enrollments e
       JOIN users u ON u.id=e.student_id WHERE u.username='mahasiswa01' LIMIT 1`
  ).c;
  const buatDiskusi = await mhs.postForm(`${BASE}/mahasiswa/diskusi`, {
    _csrf: tokDisk,
    course_id: String(courseId),
    title: 'Topik uji asap KampusKu',
    body: 'Isi topik uji asap agar alur diskusi teruji.'
  });
  check('Membuat diskusi berhasil',
    buatDiskusi.status === 302 && buatDiskusi.location.startsWith('/mahasiswa/diskusi/'),
    buatDiskusi.location);

  const idDiskusi = Number(buatDiskusi.location.split('/').pop());
  const halDetail = await mhs.get(`${BASE}/mahasiswa/diskusi/${idDiskusi}`);
  check('Detail diskusi terbuka & menampilkan topik',
    halDetail.status === 200 && halDetail.text.includes('Topik uji asap KampusKu'));

  const balas = await mhs.postForm(`${BASE}/mahasiswa/diskusi/${idDiskusi}/balas`, {
    _csrf: tokenCsrf(halDetail.text),
    body: 'Balasan uji asap KampusKu.'
  });
  const halDetail2 = await mhs.get(`${BASE}/mahasiswa/diskusi/${idDiskusi}`);
  check('Balasan diskusi tersimpan',
    balas.status === 302 && halDetail2.text.includes('Balasan uji asap KampusKu'));

  // diskusi lintas kelas ditolak
  const kelasLain = q1(
    `SELECT c.id AS c FROM courses c
      WHERE c.id NOT IN (SELECT course_id FROM enrollments e
        JOIN users u ON u.id=e.student_id WHERE u.username='mahasiswa01') LIMIT 1`
  ).c;
  const postKelasLain = await mhs.postForm(`${BASE}/mahasiswa/diskusi`, {
    _csrf: tokenCsrf((await mhs.get(`${BASE}/mahasiswa/diskusi`)).text),
    course_id: String(kelasLain),
    title: 'Upaya akses silang',
    body: 'Seharusnya ditolak.'
  });
  const setelahTolak = await mhs.get(`${BASE}/mahasiswa/diskusi`);
  check('Diskusi ke kelas yang tidak diikuti ditolak',
    !setelahTolak.text.includes('Upaya akses silang'));

  // --------------------------------------------------------- fitur dosen
  section('G. Fitur dosen: menyimpan nilai');
  const halPenilaian = await dsn.get(`${BASE}/dosen/penilaian`);
  check('Halaman penilaian terbuka', halPenilaian.status === 200);

  const courseDosen1 = q1(`SELECT id AS c FROM courses WHERE dosen_id=(SELECT id FROM users WHERE username='dosen01') LIMIT 1`).c;
  const halKelas = await dsn.get(`${BASE}/dosen/penilaian?course=${courseDosen1}`);
  check('Dosen membuka kelasnya sendiri', halKelas.status === 200);

  const mhsDiKelas = q1(
    `SELECT student_id AS s FROM enrollments WHERE course_id=? LIMIT 1`, courseDosen1
  ).s;
  const nilaiUji = 87.5;
  const simpanNilai = await dsn.postForm(`${BASE}/dosen/penilaian/akhir`, {
    _csrf: tokenCsrf(halKelas.text),
    course_id: String(courseDosen1),
    [`nilai_${mhsDiKelas}`]: String(nilaiUji)
  });
  check('Simpan nilai akhir diarahkan kembali ke kelas',
    simpanNilai.status === 302 && simpanNilai.location.includes(`course=${courseDosen1}`),
    `status=${simpanNilai.status}`);
  const nilaiTersimpan = q1(
    `SELECT score AS s FROM grades WHERE course_id=? AND student_id=?`, courseDosen1, mhsDiKelas
  );
  check('Nilai akhir benar-benar tersimpan di database',
    !!nilaiTersimpan && Number(nilaiTersimpan.s) === nilaiUji,
    nilaiTersimpan ? String(nilaiTersimpan.s) : 'tidak ada');

  // nilai pengumpulan tugas
  const subDiKelas = q1(
    `SELECT s.id AS id FROM submissions s
       JOIN assignments a ON a.id=s.assignment_id
      WHERE a.course_id=? LIMIT 1`, courseDosen1
  );
  const halKelas2 = await dsn.get(`${BASE}/dosen/penilaian?course=${courseDosen1}`);
  const simpanTugas = await dsn.postForm(`${BASE}/dosen/penilaian/tugas/${subDiKelas.id}`, {
    _csrf: tokenCsrf(halKelas2.text),
    score: '91',
    feedback: 'Uji asap: kerja bagus.'
  });
  const subNilai = q1(`SELECT score AS s, feedback AS f FROM submissions WHERE id=?`, subDiKelas.id);
  check('Nilai pengumpulan tugas tersimpan ke database',
    simpanTugas.status === 302 && subNilai && Number(subNilai.s) === 91,
    subNilai ? `score=${subNilai.s}` : 'tidak ada');
  check('Umpan balik tugas tersimpan',
    subNilai && String(subNilai.f).includes('Uji asap'));

  // dosen lain tidak boleh menilai kelas yang bukan miliknya
  const courseDosen2 = q1(
    `SELECT id AS c FROM courses WHERE dosen_id=(SELECT id FROM users WHERE username='dosen02') LIMIT 1`
  ).c;
  const sebelum = JSON.stringify(
    db.prepare(`SELECT student_id, score FROM grades WHERE course_id=? ORDER BY student_id`).all(courseDosen2)
  );
  const mhsDiKelasD2 = q1(
    `SELECT student_id AS s FROM enrollments WHERE course_id=? LIMIT 1`, courseDosen2
  ).s;
  const halD2 = await dsn.get(`${BASE}/dosen/penilaian`);
  const upaya = await dsn.postForm(`${BASE}/dosen/penilaian/akhir`, {
    _csrf: tokenCsrf(halD2.text),
    course_id: String(courseDosen2),
    [`nilai_${mhsDiKelasD2}`]: '100'
  });
  const sesudah = JSON.stringify(
    db.prepare(`SELECT student_id, score FROM grades WHERE course_id=? ORDER BY student_id`).all(courseDosen2)
  );
  check('Dosen tidak bisa menilai kelas dosen lain',
    sebelum === sesudah, `status=${upaya.status}`);

  // ---------------------------------------------------------- fitur admin
  section('H. Fitur admin: pengelolaan akun');
  const halAkun = await adm.get(`${BASE}/admin/akun`);
  check('Halaman pengelolaan akun terbuka', halAkun.status === 200);
  const tokAdmin = tokenCsrf(halAkun.text);

  const buatAkun = await adm.postForm(`${BASE}/admin/akun`, {
    _csrf: tokAdmin,
    username: 'uji.smoke',
    full_name: 'Akun Uji Asap (fiktif)',
    role: 'mahasiswa',
    email: 'uji.smoke@kampuskue.test',
    identity_no: 'A0112999',
    password: 'rahasia123'
  });
  const akunBaru = q1(`SELECT id, role, active FROM users WHERE username='uji.smoke'`);
  check('Admin membuat akun baru berhasil', buatAkun.status === 302 && !!akunBaru);

  const gantiPeran = await adm.postForm(`${BASE}/admin/akun/${akunBaru.id}/role`, {
    _csrf: tokenCsrf((await adm.get(`${BASE}/admin/akun`)).text),
    role: 'dosen'
  });
  const peranBaru = q1(`SELECT role AS r FROM users WHERE id=?`, akunBaru.id);
  check('Admin mengubah peran akun', gantiPeran.status === 302 && peranBaru.r === 'dosen',
    peranBaru.r);

  const nonaktif = await adm.postForm(`${BASE}/admin/akun/${akunBaru.id}/status`, {
    _csrf: tokenCsrf((await adm.get(`${BASE}/admin/akun`)).text)
  });
  const statusBaru = q1(`SELECT active AS a FROM users WHERE id=?`, akunBaru.id);
  check('Admin menonaktifkan akun', nonaktif.status === 302 && Number(statusBaru.a) === 0);

  const akunNonaktif = buatKlien();
  await login(akunNonaktif, 'uji.smoke', 'rahasia123');
  const halSetelahNonaktif = await akunNonaktif.get(`${BASE}/login`);
  check('Akun nonaktif tidak bisa login',
    halSetelahNonaktif.status === 200 && halSetelahNonaktif.text.includes('Login gagal'));

  const halAkun2 = await adm.get(`${BASE}/admin/akun`);
  const duplikat = await adm.postForm(`${BASE}/admin/akun`, {
    _csrf: tokenCsrf(halAkun2.text),
    username: 'uji.smoke',
    full_name: 'Duplikat',
    role: 'mahasiswa',
    password: 'rahasia123'
  });
  const jumlahDup = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE username='uji.smoke'`).get().c;
  check('Username duplikat ditolak (tidak membuat baris baru)', Number(jumlahDup) === 1);

  const sandiLemah = await adm.postForm(`${BASE}/admin/akun`, {
    _csrf: tokenCsrf((await adm.get(`${BASE}/admin/akun`)).text),
    username: 'uji.smoke2',
    full_name: 'Sandi Lemah',
    role: 'mahasiswa',
    password: '123'
  });
  const adaLemah = q1(`SELECT id FROM users WHERE username='uji.smoke2'`);
  check('Kata sandi < 8 karakter ditolak', sandiLemah.status === 302 && !adaLemah);

  // ------------------------------------------- pembatas login portal utama
  section('I. Portal utama: pembatasan percobaan login');
  const pembatas = buatKlien();
  for (let i = 0; i < 9; i++) {
    await pembatas.postForm(`${BASE}/login`, {
      _csrf: tokenCsrf((await pembatas.get(`${BASE}/login`)).text),
      username: 'mahasiswa02',
      password: 'salah-salah-' + i
    });
  }
  const sesudahBatas = await pembatas.get(`${BASE}/login`);
  check('Login portal utama menahan percobaan berlebih (pesan terkunci)',
    sesudahBatas.text.includes('ditahan sementara') || sesudahBatas.text.includes('Terlalu banyak'),
    'setelah 9 kegagalan');

  // ------------------------------------------------- laboratorium SQLi
  section('J. Laboratorium SQL Injection');
  const lab = buatKlien();
  const halLab = await lab.get(`${BASE}/lab`);
  check('Indeks laboratorium terbuka', halLab.status === 200);

  const halSqli = await lab.get(`${BASE}/lab/sqli`);
  check('Halaman laboratorium SQLi terbuka', halSqli.status === 200);
  const tokLab = tokenCsrf(halSqli.text);

  const inj1 = await lab.postForm(`${BASE}/lab/sqli`, {
    _csrf: tokLab, mode: 'cari', q: "' OR '1'='1"
  });
  const barisInj = (inj1.text.match(/<code>(lab_[a-z0-9]+)<\/code>/g) || []).length;
  check('Payload sederhana menampilkan seluruh baris (perilaku rentan)',
    inj1.status === 200 && barisInj >= 4, `${barisInj} username tampil`);

  const injUnion = await lab.postForm(`${BASE}/lab/sqli`, {
    _csrf: tokLab, mode: 'cari',
    q: "x' UNION SELECT id,username,full_name,role,email FROM lab_users -- "
  });
  check('UNION injection mengeksekusi kueri tambahan',
    injUnion.status === 200 &&
      (injUnion.text.match(/<code>lab_[a-z0-9]+<\/code>/g) || []).length >= 4);

  const normal = await lab.postForm(`${BASE}/lab/sqli`, {
    _csrf: tokLab, mode: 'cari', q: 'lab_adi'
  });
  check('Pencarian normal hanya mengembalikan baris cocok',
    (normal.text.match(/<code>lab_[a-z0-9]+<\/code>/g) || []).length >= 1);

  const bagianAman = normal.text.split('Versi PERBAIKAN')[1] || '';
  check('Versi berparameter memperlakukan input sebagai teks',
    bagianAman.includes('lab_adi'), 'kueri parameter tetap bekerja');

  const invAman = await lab.postForm(`${BASE}/lab/sqli`, {
    _csrf: tokLab, mode: 'cari', q: "' OR '1'='1"
  });
  const bagianAman2 = invAman.text.split('Versi PERBAIKAN')[1] || '';
  check('Versi berparameter TIDAK tertembus payload (0 baris)',
    bagianAman2.includes('0 baris'), 'query parameter aman');

  const bypass = await lab.postForm(`${BASE}/lab/sqli`, {
    _csrf: tokLab, mode: 'login', username: "' OR 1=1 -- ", password: 'bebas'
  });
  check('Bypass login rentan berhasil (perilaku yang diaudit)',
    bypass.text.includes('BERHASIL (bypass)'));
  const bypassAman = bypass.text.split('Versi PERBAIKAN')[1] || '';
  check('Login versi aman menolak payload yang sama',
    bypassAman.includes('Login aman ditolak'));

  // ------------------------------------------- laboratorium tanpa pembatas
  section('K. Laboratorium login tanpa pembatasan');
  const halBrute = await lab.get(`${BASE}/lab/login`);
  check('Halaman laboratorium login terbuka', halBrute.status === 200);
  const tokBrute = tokenCsrf(halBrute.text);
  const kamus = ['123456', 'password', 'admin123', 'kampus', 'kampus123', 'mahasiswa', 'qwerty', 'latihan1', 'kampus2026', 'rahasia123'];

  const labDb = new DatabaseSync(path.join(ROOT, 'data', 'lab.db'));
  const hitungSebelum = labDb.prepare('SELECT COUNT(*) AS c FROM lab_login_attempts').get().c;

  let berhasilKe = -1;
  let semuaDiterima = true;
  for (let i = 0; i < kamus.length; i++) {
    const res = await lab.postJson(`${BASE}/lab/login`, {
      _csrf: tokBrute, username: 'lab_mhs01', password: kamus[i]
    });
    if (res.status !== 200) {
      semuaDiterima = false;
      break;
    }
    const data = JSON.parse(res.text);
    if (data.ok) {
      berhasilKe = i + 1;
      break;
    }
  }

  check('Seluruh percobaan login diterima server (tidak ada blokir/429)', semuaDiterima);
  check('Kata sandi tebakan benar ditemukan setelah beberapa percobaan',
    berhasilKe > 0, `percobaan ke-${berhasilKe}`);

  const hitungSesudah = labDb.prepare('SELECT COUNT(*) AS c FROM lab_login_attempts').get().c;
  check('Setiap percobaan tercatat di database laboratorium',
    hitungSesudah > hitungSebelum, `${hitungSebelum} -> ${hitungSesudah}`);

  // pastikan tidak ada pesan pembatasan pada halaman hasil
  const halBrute2 = await lab.get(`${BASE}/lab/login`);
  check('Tidak ada mekanisme penguncian/pembatas pada laboratorium',
    !halBrute2.text.includes('ditahan sementara') && !halBrute2.text.includes('Terlalu banyak percobaan'));

  // ------------------------------------------------- cakupan seluruh halaman
  section('L. Seluruh halaman wajib ter render (200)');
  const halaman = [
    ['mahasiswa', '/mahasiswa', 'Dashboard Mahasiswa', mhs],
    ['mahasiswa', '/mahasiswa/nilai', 'Nilai Saya', mhs],
    ['mahasiswa', '/mahasiswa/tugas', 'Tugas Saya', mhs],
    ['mahasiswa', '/mahasiswa/diskusi', 'Forum Diskusi', mhs],
    ['dosen', '/dosen', 'Dashboard Dosen', dsn],
    ['dosen', '/dosen/mata-kuliah/' + courseDosen1, 'Daftar Mahasiswa', dsn],
    ['dosen', '/dosen/penilaian?course=' + courseDosen1, 'Penilaian', dsn],
    ['admin', '/admin', 'Dashboard Admin', adm],
    ['admin', '/admin/akun', 'Pengelolaan Akun', adm],
    ['umum', '/lab', 'Laboratorium Kerentanan', lab],
    ['umum', '/lab/sqli', 'Laboratorium SQL Injection', lab],
    ['umum', '/lab/login', 'Percobaan Sandi Tanpa Pembatasan', lab],
    ['umum', '/login', 'Masuk ke Portal', buatKlien()]
  ];
  for (const [peran, rute, teks, klien] of halaman) {
    const h = await klien.get(BASE + rute);
    check(`[${peran}] ${rute} → 200 & memuat "${teks}"`,
      h.status === 200 && h.text.includes(teks),
      h.status === 200 ? '' : `status=${h.status}`);
  }

  const hal404 = await mhs.get(BASE + '/halaman-yang-tidak-ada');
  check('Halaman 404 ditampilkan dengan benar',
    hal404.status === 404 && hal404.text.includes('Tidak Ditemukan'), `status=${hal404.status}`);

  const halTanpaBerkas = await mhs.get(BASE + '/files/999999');
  check('Permintaan berkas tidak valid ditangani aman',
    halTanpaBerkas.status === 404, `status=${halTanpaBerkas.status}`);

  // ------------------------------------------------- lab dinonaktifkan
  section('M. Laboratorium dapat dimatikan (LAB_ENABLED=false)');

  const anak = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '3999',
      HOST: '127.0.0.1',
      LAB_ENABLED: 'false',
      NODE_ENV: 'production',
      SESSION_SECRET: 'uji-tersembunyi-1234567890abcdef'
    },
    stdio: 'ignore'
  });
  await new Promise((r) => setTimeout(r, 1800));
  try {
    const cobaLab = await fetch('http://127.0.0.1:3999/lab', { redirect: 'manual' });
    const teksLab = await cobaLab.text();
    check('Jalur /lab membalas 404 saat LAB_ENABLED=false',
      cobaLab.status === 404 && teksLab.includes('Laboratorium dinonaktifkan'),
      `status=${cobaLab.status}`);

    const cobaLogin = await fetch('http://127.0.0.1:3999/login', { redirect: 'manual' });
    check('Portal utama tetap berjalan saat lab nonaktif', cobaLogin.status === 200);
  } finally {
    anak.kill();
  }

  console.log('');
  console.log(`Ringkasan: ${pass} lulus, ${fail} gagal.`);
  if (fail > 0) {
    console.log('Gagal:');
    gagal.forEach((g) => console.log('  - ' + g));
  }
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('Kesalahan pada skrip uji:', e);
  process.exit(1);
});
