'use strict';

const express = require('express');
const { all, get, run, gradeLetter } = require('../db');
const { ownsCourse } = require('../queries');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('dosen'));

function flash(req, type, text) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, text });
}

/** Mata kuliah yang diajar dosen beserta statistiknya. */
function coursesTaught(dosenId) {
  return all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS jml_mahasiswa,
            (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id) AS jml_tugas
       FROM courses c
      WHERE c.dosen_id = ?
      ORDER BY c.code`,
    [dosenId]
  );
}

// ------------------------------------------------------------- dashboard
router.get('/', (req, res) => {
  const did = req.session.user.id;
  const courses = coursesTaught(did);

  const belumDinilai = get(
    `SELECT COUNT(*) AS jumlah
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN courses c ON c.id = a.course_id
      WHERE c.dosen_id = ? AND s.score IS NULL`,
    [did]
  ).jumlah;

  const totalMahasiswa = get(
    `SELECT COUNT(DISTINCT e.student_id) AS jumlah
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
      WHERE c.dosen_id = ?`,
    [did]
  ).jumlah;

  const belumAdaNilai = get(
    `SELECT COUNT(*) AS jumlah
       FROM grades g
       JOIN courses c ON c.id = g.course_id
      WHERE c.dosen_id = ? AND g.score IS NULL`,
    [did]
  ).jumlah;

  res.render('dosen/dashboard', {
    title: 'Dashboard Dosen',
    courses,
    belumDinilai,
    totalMahasiswa,
    belumAdaNilai
  });
});

// ------------------------------------------------------ detail mata kuliah
router.get('/mata-kuliah/:id', (req, res) => {
  const did = req.session.user.id;
  const cid = parseInt(req.params.id, 10);
  const course = get('SELECT * FROM courses WHERE id = ?', [cid]);

  if (!course || !ownsCourse(did, cid)) {
    flash(req, 'error', 'Mata kuliah tidak ditemukan atau bukan milik Anda.');
    return res.redirect('/dosen');
  }

  const mahasiswa = all(
    `SELECT u.id, u.full_name, u.identity_no, g.score, g.grade_letter
       FROM enrollments e
       JOIN users u ON u.id = e.student_id
       LEFT JOIN grades g ON g.course_id = e.course_id AND g.student_id = e.student_id
      WHERE e.course_id = ?
      ORDER BY u.identity_no`,
    [cid]
  );

  const tugas = all(
    `SELECT a.id, a.title, a.due_date, a.max_score,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS jml_masuk,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.score IS NULL) AS jml_belum_nilai
       FROM assignments a
      WHERE a.course_id = ?
      ORDER BY a.id`,
    [cid]
  );

  res.render('dosen/mata-kuliah', {
    title: `Detail — ${course.code}`,
    course,
    mahasiswa,
    tugas
  });
});

// ----------------------------------------------------------- penilaian
router.get('/penilaian', (req, res) => {
  const did = req.session.user.id;
  const courses = coursesTaught(did);
  if (courses.length === 0) {
    return res.render('dosen/penilaian', {
      title: 'Penilaian',
      courses,
      course: null,
      mahasiswa: [],
      pengumpulan: []
    });
  }

  const wanted = parseInt(req.query.course, 10);
  const course = courses.find((c) => c.id === wanted) || courses[0];

  const mahasiswa = all(
    `SELECT u.id, u.full_name, u.identity_no, g.score, g.grade_letter
       FROM enrollments e
       JOIN users u ON u.id = e.student_id
       LEFT JOIN grades g ON g.course_id = e.course_id AND g.student_id = e.student_id
      WHERE e.course_id = ?
      ORDER BY u.identity_no`,
    [course.id]
  );

  const pengumpulan = all(
    `SELECT s.id, s.score, s.feedback, s.submitted_at, s.file_name,
            a.title AS tugas_title, a.max_score,
            u.id AS student_id, u.full_name AS student_name, u.identity_no
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN users u ON u.id = s.student_id
      WHERE a.course_id = ?
      ORDER BY a.id, u.identity_no`,
    [course.id]
  );

  const tugas = all('SELECT id, title FROM assignments WHERE course_id = ? ORDER BY id', [course.id]);

  res.render('dosen/penilaian', {
    title: 'Penilaian',
    courses,
    course,
    mahasiswa,
    pengumpulan,
    tugas
  });
});

/** Simpan nilai akhir (massal) per mata kuliah. */
router.post('/penilaian/akhir', (req, res) => {
  const did = req.session.user.id;
  const cid = parseInt(req.body.course_id, 10);

  if (!Number.isInteger(cid) || !ownsCourse(did, cid)) {
    flash(req, 'error', 'Mata kuliah tidak valid atau bukan milik Anda.');
    return res.redirect('/dosen/penilaian');
  }

  // Field dikirim sebagai "nilai_<idMahasiswa>" agar tidak terbentuk array oleh parser.
  const scores = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (k.startsWith('nilai_')) scores[k.slice('nilai_'.length)] = v;
  }

  let tersimpan = 0;

  for (const [studentIdRaw, valueRaw] of Object.entries(scores)) {
    const studentId = parseInt(studentIdRaw, 10);
    const value = String(valueRaw).trim();
    if (!Number.isInteger(studentId)) continue;

    // Hanya mahasiswa yang benar-benar terdaftar di kelas ini.
    const enrolled = get('SELECT id FROM enrollments WHERE course_id = ? AND student_id = ?', [
      cid,
      studentId
    ]);
    if (!enrolled) continue;

    let score = null;
    if (value !== '') {
      score = Number(value);
      if (!Number.isFinite(score) || score < 0 || score > 100) continue;
      score = Math.round(score * 10) / 10;
    }

    run(
      `INSERT INTO grades (course_id, student_id, score, grade_letter, updated_at)
       VALUES (?,?,?,?,datetime('now','localtime'))
       ON CONFLICT(course_id, student_id)
       DO UPDATE SET score=excluded.score,
                     grade_letter=excluded.grade_letter,
                     updated_at=excluded.updated_at`,
      [cid, studentId, score, gradeLetter(score)]
    );
    tersimpan += 1;
  }

  flash(req, 'success', `Nilai akhir berhasil disimpan (${tersimpan} baris).`);
  res.redirect(`/dosen/penilaian?course=${cid}`);
});

/** Simpan nilai satu pengumpulan tugas. */
router.post('/penilaian/tugas/:id', (req, res) => {
  const did = req.session.user.id;
  const sid = parseInt(req.params.id, 10);
  if (!Number.isInteger(sid)) {
    flash(req, 'error', 'ID pengumpulan tidak valid.');
    return res.redirect('/dosen/penilaian');
  }

  const sub = get(
    `SELECT s.*, a.course_id FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
      WHERE s.id = ?`,
    [sid]
  );
  if (!sub || !ownsCourse(did, sub.course_id)) {
    flash(req, 'error', 'Pengumpulan tidak ditemukan atau bukan milik Anda.');
    return res.redirect('/dosen/penilaian');
  }

  const raw = String(req.body.score || '').trim();
  let score = null;
  if (raw !== '') {
    score = Number(raw);
    if (!Number.isFinite(score) || score < 0 || score > sub.max_score) {
      flash(req, 'error', `Nilai harus berupa angka 0 – ${sub.max_score}.`);
      return res.redirect(`/dosen/penilaian?course=${sub.course_id}`);
    }
    score = Math.round(score * 10) / 10;
  }

  run(
    `UPDATE submissions
        SET score = ?, feedback = ?, graded_at = datetime('now','localtime'), graded_by = ?
      WHERE id = ?`,
    [score, String(req.body.feedback || '').slice(0, 1000), did, sid]
  );

  flash(req, 'success', 'Nilai tugas berhasil disimpan.');
  res.redirect(`/dosen/penilaian?course=${sub.course_id}`);
});

module.exports = router;
