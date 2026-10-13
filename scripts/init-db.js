'use strict';

/**
 * Inisialisasi database KampusKu + pembuatan akun demo.
 *   node scripts/init-db.js          -> isi data jika database masih kosong
 *   node scripts/init-db.js --fresh  -> hapus & bangun ulang seluruh data
 *
 * SELURUH data yang dibuat di sini bersifat FIKTIF / SINTETIS.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const fresh = process.argv.includes('--fresh') || process.argv.includes('-f');

const config = require('../src/config');
const { db, labDb, initSchema, gradeLetter, tx } = require('../src/db');

function count(table) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
}

if (fresh) {
  const tables = [
    'discussion_replies', 'discussions', 'grades', 'submissions',
    'assignments', 'enrollments', 'courses', 'users'
  ];
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS ${t};`);
  labDb.exec('DROP TABLE IF EXISTS lab_login_attempts;');
  labDb.exec('DROP TABLE IF EXISTS lab_users;');
  initSchema();
  console.log('[init] Tabel lama dihapus dan skema dibangun ulang (mode --fresh).');
} else {
  initSchema();
}

// ---------------------------------------------------------------- guard
if (!fresh && count('users') > 0) {
  console.log('[init] Database sudah berisi data. Gunakan "--fresh" untuk membangun ulang.');
  console.log(`[init] Pengguna: ${count('users')}, mata kuliah: ${count('courses')}.`);
  process.exit(0);
}

// ------------------------------------------------------- data sintetis
const hash = (pwd) => bcrypt.hashSync(pwd, 10);

const DOSEN = [
  ['dosen01', 'Prof. Arif Nugroho, S.Kom., M.T.', 'arif.nugroho@kampuskue.test', 'D-001'],
  ['dosen02', 'Dr. Siti Rahmawati, S.Si., M.T.', 'siti.rahmawati@kampuskue.test', 'D-002'],
  ['dosen03', 'Budi Santoso, S.T., M.T.', 'budi.santoso@kampuskue.test', 'D-003'],
  ['dosen04', 'Dewi Lestari, S.Pd., M.Hum.', 'dewi.lestari@kampuskue.test', 'D-004']
];

const MAHASISWA = [
  ['mahasiswa01', 'Andi Pratama', 'A0112001'],
  ['mahasiswa02', 'Bella Safitri', 'A0112002'],
  ['mahasiswa03', 'Candra Wijaya', 'A0112003'],
  ['mahasiswa04', 'Dinda Permata', 'A0112004'],
  ['mahasiswa05', 'Eko Saputra', 'A0112005'],
  ['mahasiswa06', 'Fitri Handayani', 'A0112006'],
  ['mahasiswa07', 'Galih Ramadhan', 'A0112007'],
  ['mahasiswa08', 'Hana Maulida', 'A0112008'],
  ['mahasiswa09', 'Indra Kusuma', 'A0112009'],
  ['mahasiswa10', 'Jelita Anggraini', 'A0112010'],
  ['mahasiswa11', 'Kevin Hidayat', 'A0112011'],
  ['mahasiswa12', 'Laras Ayu Wulandari', 'A0112012']
];

const COURSES = [
  ['TI101', 'Algoritma dan Struktur Data', 4, 'dosen01'],
  ['TI102', 'Basis Data', 3, 'dosen02'],
  ['TI103', 'Pemrograman Web', 4, 'dosen01'],
  ['TI104', 'Jaringan Komputer', 3, 'dosen03'],
  ['TI105', 'Sistem Operasi', 3, 'dosen03'],
  ['TI106', 'Keamanan Informasi', 3, 'dosen04'],
  ['TI107', 'Matematika Diskrit', 3, 'dosen02'],
  ['TI108', 'Bahasa Inggris Teknik', 2, 'dosen04']
];

const SEMESTER = 'Ganjil 2026/2027';
const DOSEN_PWD = 'dosen12345';
const MHS_PWD = 'mhs12345';
const ADMIN_PWD = 'admin12345';

const uins = (sql, ...p) => db.prepare(sql).run(...p);
const findId = (table, col, val) => Number(db.prepare(`SELECT id FROM ${table} WHERE ${col}=?`).get(val).id);

// --------------------------------------------------------------- insert
console.log('[init] Menyisipkan akun sintetis ...');

uins(
  `INSERT INTO users (username, password_hash, full_name, role, email, identity_no, active)
   VALUES (?,?,?,?,?,?,1)`,
  'admin', hash(ADMIN_PWD), 'Administrator Sistem (Akun Demo)', 'admin',
  'admin@kampuskue.test', 'ADM-0001'
);

for (const [u, name, mail, nip] of DOSEN) {
  uins(`INSERT INTO users (username, password_hash, full_name, role, email, identity_no, active)
        VALUES (?,?,?,?,?,?,1)`, u, hash(DOSEN_PWD), name, 'dosen', mail, nip);
}

for (const [u, name, nim] of MAHASISWA) {
  uins(`INSERT INTO users (username, password_hash, full_name, role, email, identity_no, active)
        VALUES (?,?,?,?,?,?,1)`, u, hash(MHS_PWD), name, 'mahasiswa',
    `${u}@mahasiswa.kampuskue.test`, nim);
}

console.log('[init] Menyisipkan mata kuliah ...');
const courseIds = [];
for (const [code, name, credits, dosen] of COURSES) {
  uins('INSERT INTO courses (code, name, credits, semester, dosen_id) VALUES (?,?,?,?,?)',
    code, name, credits, SEMESTER, findId('users', 'username', dosen));
  courseIds.push(findId('courses', 'code', code));
}

console.log('[init] Menyisipkan keanggotaan, tugas, nilai, dan diskusi ...');
const students = MAHASISWA.map(([u]) => ({ username: u, id: findId('users', 'username', u) }));
const submissionsToSeed = [];

tx(() => {
  // Pendaftaran: setiap mahasiswa mengambil 5 dari 8 mata kuliah.
  students.forEach((st, si) => {
    courseIds.forEach((cid, ci) => {
      if ((si + ci) % 8 < 5) {
        uins('INSERT INTO enrollments (course_id, student_id) VALUES (?,?)', cid, st.id);
      }
    });
  });

  // Tugas: 2 tugas per mata kuliah.
  const assignmentIds = [];
  courseIds.forEach((cid, ci) => {
    for (let k = 1; k <= 2; k++) {
      const title = k === 1
        ? `Tugas ${k} — Latihan soal minggu ke-${2 + ci}`
        : `Tugas ${k} — Proyek praktikum minggu ke-${5 + ci}`;
      const desc = `Kerjakan seluruh soal pada lampiran, kumpulkan berkas dalam format PDF. ` +
        `Mata kuliah ${COURSES[ci][1]} (data contoh sintetis).`;
      const due = `2026-${String(9 + k).padStart(2, '0')}-${String(5 + ci).padStart(2, '0')}`;
      const r = uins(
        'INSERT INTO assignments (course_id, title, description, due_date, max_score) VALUES (?,?,?,?,100)',
        cid, title, desc, due);
      assignmentIds.push({ id: Number(r.lastInsertRowid), course: cid, idx: k - 1, ci });
    }
  });

  // Pengumpulan + nilai tugas (sebagian).
  students.forEach((st, si) => {
    courseIds.forEach((cid, ci) => {
      if ((si + ci) % 8 >= 5) return;
      assignmentIds.filter((a) => a.course === cid).forEach((a) => {
        const submitted = a.idx === 0 ? (si + ci) % 3 !== 0 : (si + ci) % 4 < 2;
        if (!submitted) return;
        const graded = a.idx === 0 ? (si + ci) % 2 === 0 : (si + ci) % 4 === 0;
        const score = graded ? 60 + ((si * 7 + ci * 11 + a.idx * 5) % 41) : null;
        const r = uins(
          `INSERT INTO submissions (assignment_id, student_id, file_name, file_size, note,
             submitted_at, score, feedback, graded_at, graded_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          a.id, st.id,
          `laporan_tugas_${a.id}_${st.username}.txt`,
          1024 + ((si + ci) * 137) % 4096,
          'Berkas contoh hasil unggahan sintetis.',
          `2026-10-${String(1 + ((si + ci) % 8)).padStart(2, '0')} 09:1${si % 6}:00`,
          score,
          graded ? 'Perjelas bagian penjelasan algoritma agar lebih lengkap.' : null,
          graded ? '2026-10-10 14:00:00' : null,
          graded ? findId('users', 'username', COURSES[ci][3]) : null
        );
        submissionsToSeed.push({ id: Number(r.lastInsertRowid), student: st.username });
      });
    });
  });

  // Nilai akhir per mata kuliah (sebagian belum dinilai).
  students.forEach((st, si) => {
    courseIds.forEach((cid, ci) => {
      if ((si + ci) % 8 >= 5) return;
      if ((si + ci) % 9 === 0) return;
      const score = 60 + ((si * 7 + ci * 11) % 41);
      uins('INSERT INTO grades (course_id, student_id, score, grade_letter, updated_at) VALUES (?,?,?,?,?)',
        cid, st.id, score, gradeLetter(score), '2026-10-08 10:00:00');
    });
  });

  // Diskusi + balasan.
  const DISCUSSIONS = [
    [0, 'Bagaimana memilih struktur data yang tepat?',
      'Saya masih bingung kapan sebaiknya memakai array dibanding linked list. Ada contoh kasus nyata?',
      ['Array lebih cepat untuk akses berdasarkan indeks, linked list lebih fleksibel untuk penyisipan di tengah.',
       'Contoh kasus: antrian antrean cetak lebih cocok memakai linked list.']],
    [1, 'Perbedaan normalisasi 2NF dan 3NF',
      'Di tugas normalisasi saya menemukan tabel yang sudah 2NF tetapi belum 3NF. Bagaimana tandanya?',
      ['Tanda 3PF: tidak ada ketergantungan transitif antar atribut yang bukan kunci utama.']],
    [2, 'Unggahan tugas berukuran besar sering gagal',
      'Saat mengunggah tugas sekitar 4 MB selalu gagal. Apakah ada batas ukuran unggahan?',
      ['Batas unggahan portal adalah 5 MB, periksa juga jenis berkas yang diizinkan.']],
    [3, 'Latihan subnetting minggu ini',
      'Mari berdiskusi soal latihan subnetting nomor 4, jawaban saya 192.168.10.0/27.',
      ['Hitung jumlah host yang dibutuhkan dulu, baru tentukan panjang mask-nya.']],
    [5, 'Contoh penerapan hashing pada aplikasi web',
      'Untuk tugas Keamanan Informasi, apakah md5 masih boleh dipakai untuk menyimpan kata sandi?',
      ['MD5 sudah dianggap tidak aman, gunakan bcrypt atau argon2 pada aplikasi nyata.']],
    [7, 'Kumpulan kosakata teknis untuk laporan',
      'Boleh minta daftar istilah teknis Inggris yang sering muncul di laporan akhir?',
      ['Tambahkan kata throughput, latency, dan redundancy pada bagian pembahasan.']]
  ];
  DISCUSSIONS.forEach(([ci, title, body, replies], i) => {
    const authorId = i % 3 === 0
      ? findId('users', 'username', COURSES[ci][3])
      : students[(i * 3 + ci) % students.length].id;
    const r = uins('INSERT INTO discussions (course_id, user_id, title, body) VALUES (?,?,?,?)',
      courseIds[ci], authorId, title, body);
    const did = Number(r.lastInsertRowid);
    replies.forEach((text, ri) => {
      const replier = ri % 4 === 3
        ? findId('users', 'username', COURSES[ci][3])
        : students[(i + ri * 5 + 1) % students.length].id;
      uins('INSERT INTO discussion_replies (discussion_id, user_id, body) VALUES (?,?,?)',
        did, replier, text);
    });
  });
});

// ------------------------------------------------- berkas contoh unggahan
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
for (const s of submissionsToSeed) {
  const file = `seed_${s.id}_${s.student}.txt`;
  fs.writeFileSync(
    path.join(config.UPLOAD_DIR, file),
    `Berkas contoh SINTETIS untuk pengujian KampusKu.\n` +
      `ID pengumpulan : ${s.id}\n` +
      `Mahasiswa      : ${s.student}\n` +
      `Catatan        : file ini dibuat otomatis oleh skrip inisialisasi database.\n`,
    'utf8'
  );
  db.prepare('UPDATE submissions SET file_path=? WHERE id=?').run(file, s.id);
}

// ------------------------------------------------- akun laboratorium
labDb.exec('DELETE FROM lab_login_attempts;');
labDb.exec('DELETE FROM lab_users;');
const LAB_USERS = [
  ['lab_adi', 'adi123', 'Adi Kurniawan (akun laboratorium)', 'mahasiswa', 'lab_adi@lab.test'],
  ['lab_bela', 'bela123', 'Bela Puspita (akun laboratorium)', 'mahasiswa', 'lab_bela@lab.test'],
  ['lab_citra', 'citra123', 'Citra Ayu (akun laboratorium)', 'dosen', 'lab_citra@lab.test'],
  ['lab_mhs01', 'kampus2026', 'Mahasiswa Laboratorium 01 (akun laboratorium)', 'mahasiswa', 'lab_mhs01@lab.test']
];
const labIns = labDb.prepare(
  'INSERT INTO lab_users (username, password_hash, full_name, role, email) VALUES (?,?,?,?,?)'
);
for (const [u, p, n, r, e] of LAB_USERS) labIns.run(u, bcrypt.hashSync(p, 10), n, r, e);

console.log('');
console.log('==========================================================');
console.log(' Database berhasil diinisialisasi (data SINTETIS/FIKTIF)');
console.log('==========================================================');
console.log(` File database portal : ${config.DB_PATH}`);
console.log(` File database lab    : ${config.LAB_DB_PATH}`);
console.log(` Pengguna             : ${count('users')}`);
console.log(` Mata kuliah          : ${count('courses')}`);
console.log(` Keanggotaan kelas    : ${count('enrollments')}`);
console.log(` Tugas                : ${count('assignments')}`);
console.log(` Pengumpulan tugas    : ${count('submissions')}`);
console.log(` Nilai akhir          : ${count('grades')}`);
console.log(` Diskusi              : ${count('discussions')}`);
console.log(` Akun laboratorium    : ${labDb.prepare('SELECT COUNT(*) AS c FROM lab_users').get().c}`);
console.log('----------------------------------------------------------');
console.log(' Akun demo portal:');
console.log('   admin       / admin12345  (Admin)');
console.log('   dosen01     / dosen12345  (Dosen)');
console.log('   mahasiswa01 / mhs12345    (Mahasiswa)');
console.log('==========================================================');
