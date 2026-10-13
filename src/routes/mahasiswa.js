'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { all, get, run } = require('../db');
const { enrolledCourses, isEnrolled } = require('../queries');
const { requireRole, verifyCsrf } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('mahasiswa'));

function flash(req, type, text) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, text });
}

// ------------------------------------------------------------- dashboard
router.get('/', (req, res) => {
  const sid = req.session.user.id;
  const courses = enrolledCourses(sid);

  const pending = all(
    `SELECT a.id, a.title, a.due_date, c.code, c.name AS course_name
       FROM assignments a
       JOIN courses c ON c.id = a.course_id
       JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = ?
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
      WHERE s.id IS NULL
      ORDER BY a.due_date`,
    [sid, sid]
  );

  const gradeStat = get(
    `SELECT COUNT(*) AS jumlah, AVG(score) AS rata
       FROM grades WHERE student_id = ? AND score IS NOT NULL`,
    [sid]
  );

  const submitted = get(
    `SELECT COUNT(*) AS jumlah FROM submissions WHERE student_id = ?`,
    [sid]
  );

  const graded = get(
    `SELECT COUNT(*) AS jumlah FROM submissions WHERE student_id = ? AND score IS NOT NULL`,
    [sid]
  );

  const recentDiscussions = all(
    `SELECT d.id, d.title, c.code, d.created_at, u.full_name AS penulis
       FROM discussions d
       JOIN courses c ON c.id = d.course_id
       JOIN users u ON u.id = d.user_id
       JOIN enrollments e ON e.course_id = d.course_id AND e.student_id = ?
      ORDER BY d.created_at DESC
      LIMIT 5`,
    [sid]
  );

  res.render('mahasiswa/dashboard', {
    title: 'Dashboard Mahasiswa',
    courses,
    pending,
    gradeStat,
    submitted,
    graded,
    recentDiscussions
  });
});

// ---------------------------------------------------------------- nilai
router.get('/nilai', (req, res) => {
  const sid = req.session.user.id;
  const rows = all(
    `SELECT c.id, c.code, c.name, c.credits, c.semester, u.full_name AS dosen_name,
            g.score, g.grade_letter, g.updated_at
       FROM courses c
       JOIN users u ON u.id = c.dosen_id
       JOIN enrollments e ON e.course_id = c.id AND e.student_id = ?
       LEFT JOIN grades g ON g.course_id = c.id AND g.student_id = e.student_id
      ORDER BY c.code`,
    [sid]
  );

  const nilaiTugas = all(
    `SELECT c.code, c.name AS course_name, a.title, s.score, s.feedback, s.submitted_at, s.graded_at
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN courses c ON c.id = a.course_id
      WHERE s.student_id = ?
      ORDER BY c.code, a.id`,
    [sid]
  );

  const dinilai = rows.filter((r) => r.score !== null && r.score !== undefined);
  const rata = dinilai.length
    ? dinilai.reduce((a, b) => a + Number(b.score), 0) / dinilai.length
    : null;
  const sks = dinilai.reduce((a, b) => a + Number(b.credits), 0);

  res.render('mahasiswa/nilai', {
    title: 'Nilai Saya',
    rows,
    nilaiTugas,
    rata,
    totalSks: sks
  });
});

// ---------------------------------------------------------------- tugas
router.get('/tugas', (req, res) => {
  const sid = req.session.user.id;
  const rows = all(
    `SELECT a.id, a.title, a.description, a.due_date, a.max_score,
            c.code, c.name AS course_name, c.id AS course_id,
            s.id AS sub_id, s.submitted_at, s.file_name, s.note, s.score, s.feedback
       FROM assignments a
       JOIN courses c ON c.id = a.course_id
       JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = ?
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
      ORDER BY a.due_date, a.id`,
    [sid, sid]
  );
  res.render('mahasiswa/tugas', { title: 'Tugas Saya', rows });
});

// Validasi + penyimpanan unggahan.
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    cb(null, `sub_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (!config.ALLOWED_UPLOAD_EXT.includes(ext)) {
      return cb(new Error(`Jenis berkas .${ext} tidak diizinkan.`));
    }
    if (!config.ALLOWED_UPLOAD_MIME.includes(file.mimetype)) {
      return cb(new Error(`Tipe MIME "${file.mimetype}" tidak diizinkan.`));
    }
    cb(null, true);
  }
});

router.post('/tugas/:id/submit', (req, res) => {
  upload.single('berkas')(req, res, (err) => {
    // Token CSRF diverifikasi SETELAH body multipart terparse oleh multer.
    if (!verifyCsrf(req, res)) return;
    if (err) {
      flash(req, 'error', `Unggahan ditolak: ${err.message}`);
      return res.redirect('/mahasiswa/tugas');
    }
    const sid = req.session.user.id;
    const assignmentId = parseInt(req.params.id, 10);
    if (!Number.isInteger(assignmentId)) {
      flash(req, 'error', 'ID tugas tidak valid.');
      return res.redirect('/mahasiswa/tugas');
    }

    const assignment = get('SELECT * FROM assignments WHERE id = ?', [assignmentId]);
    if (!assignment) {
      flash(req, 'error', 'Tugas tidak ditemukan.');
      return res.redirect('/mahasiswa/tugas');
    }
    if (!isEnrolled(sid, assignment.course_id)) {
      flash(req, 'error', 'Anda tidak terdaftar pada mata kuliah tersebut.');
      return res.redirect('/mahasiswa/tugas');
    }

    const note = String(req.body.catatan || '').slice(0, 500);
    const f = req.file;
    if (!f) {
      flash(req, 'error', 'Berkas unggahan wajib dipilih.');
      return res.redirect('/mahasiswa/tugas');
    }

    const existing = get('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?', [
      assignmentId,
      sid
    ]);

    if (existing) {
      // Ganti berkas: hapus berkas lama terlebih dahulu.
      if (existing.file_path) {
        const old = path.join(config.UPLOAD_DIR, path.basename(existing.file_path));
        try {
          if (fs.existsSync(old)) fs.rmSync(old);
        } catch (_) {}
      }
      run(
        `UPDATE submissions
            SET file_path=?, file_name=?, file_size=?, note=?, submitted_at=datetime('now','localtime')
          WHERE id=?`,
        [f.filename, f.originalname, f.size, note, existing.id]
      );
    } else {
      run(
        `INSERT INTO submissions (assignment_id, student_id, file_path, file_name, file_size, note, submitted_at)
         VALUES (?,?,?,?,?,?,datetime('now','localtime'))`,
        [assignmentId, sid, f.filename, f.originalname, f.size, note]
      );
    }

    flash(req, 'success', 'Tugas berhasil diunggah.');
    res.redirect('/mahasiswa/tugas');
  });
});

// -------------------------------------------------------------- diskusi
router.get('/diskusi', (req, res) => {
  const sid = req.session.user.id;
  const courses = enrolledCourses(sid);
  const rows = all(
    `SELECT d.id, d.title, d.body, d.created_at, c.code, c.name AS course_name,
            u.full_name AS penulis, u.role AS penulis_role,
            (SELECT COUNT(*) FROM discussion_replies r WHERE r.discussion_id = d.id) AS jml_balasan
       FROM discussions d
       JOIN courses c ON c.id = d.course_id
       JOIN users u ON u.id = d.user_id
       JOIN enrollments e ON e.course_id = d.course_id AND e.student_id = ?
      ORDER BY d.created_at DESC`,
    [sid]
  );
  res.render('mahasiswa/diskusi', { title: 'Forum Diskusi', rows, courses });
});

router.get('/diskusi/:id', (req, res) => {
  const sid = req.session.user.id;
  const id = parseInt(req.params.id, 10);
  const topic = get(
    `SELECT d.*, c.code, c.name AS course_name, u.full_name AS penulis, u.role AS penulis_role
       FROM discussions d
       JOIN courses c ON c.id = d.course_id
       JOIN users u ON u.id = d.user_id
      WHERE d.id = ?`,
    [id]
  );
  if (!topic || !isEnrolled(sid, topic.course_id)) {
    flash(req, 'error', 'Diskusi tidak ditemukan atau Anda tidak memiliki akses.');
    return res.redirect('/mahasiswa/diskusi');
  }
  const replies = all(
    `SELECT r.*, u.full_name AS penulis, u.role AS penulis_role
       FROM discussion_replies r
       JOIN users u ON u.id = r.user_id
      WHERE r.discussion_id = ?
      ORDER BY r.created_at`,
    [id]
  );
  res.render('mahasiswa/diskusi-detail', { title: topic.title, topic, replies });
});

router.post('/diskusi', (req, res) => {
  const sid = req.session.user.id;
  const courseId = parseInt(req.body.course_id, 10);
  const title = String(req.body.title || '').trim().slice(0, 160);
  const body = String(req.body.body || '').trim().slice(0, 4000);

  if (!title || !body) {
    flash(req, 'error', 'Judul dan isi diskusi wajib diisi.');
    return res.redirect('/mahasiswa/diskusi');
  }
  if (!isEnrolled(sid, courseId)) {
    flash(req, 'error', 'Anda tidak terdaftar pada mata kuliah tersebut.');
    return res.redirect('/mahasiswa/diskusi');
  }
  const r = run('INSERT INTO discussions (course_id, user_id, title, body) VALUES (?,?,?,?)', [
    courseId,
    sid,
    title,
    body
  ]);
  flash(req, 'success', 'Diskusi berhasil dibuat.');
  res.redirect(`/mahasiswa/diskusi/${r.lastInsertRowid}`);
});

router.post('/diskusi/:id/balas', (req, res) => {
  const sid = req.session.user.id;
  const id = parseInt(req.params.id, 10);
  const body = String(req.body.body || '').trim().slice(0, 4000);
  const topic = get('SELECT * FROM discussions WHERE id = ?', [id]);

  if (!topic || !isEnrolled(sid, topic.course_id)) {
    flash(req, 'error', 'Diskusi tidak ditemukan atau Anda tidak memiliki akses.');
    return res.redirect('/mahasiswa/diskusi');
  }
  if (!body) {
    flash(req, 'error', 'Isi balasan wajib diisi.');
    return res.redirect(`/mahasiswa/diskusi/${id}`);
  }
  run('INSERT INTO discussion_replies (discussion_id, user_id, body) VALUES (?,?,?)', [id, sid, body]);
  flash(req, 'success', 'Balasan berhasil ditambahkan.');
  res.redirect(`/mahasiswa/diskusi/${id}`);
});

module.exports = router;
