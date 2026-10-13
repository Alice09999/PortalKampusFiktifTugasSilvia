'use strict';

const { all, get } = require('./db');

/** Daftar mata kuliah yang diikuti seorang mahasiswa. */
function enrolledCourses(studentId) {
  return all(
    `SELECT c.*, u.full_name AS dosen_name,
            (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id) AS jml_tugas
       FROM courses c
       JOIN users u ON u.id = c.dosen_id
       JOIN enrollments e ON e.course_id = c.id
      WHERE e.student_id = ?
      ORDER BY c.code`,
    [studentId]
  );
}

/** Apakah mahasiswa terdaftar pada mata kuliah? */
function isEnrolled(studentId, courseId) {
  return !!get('SELECT id FROM enrollments WHERE course_id = ? AND student_id = ?', [
    courseId,
    studentId
  ]);
}

/** Apakah mata kuliah diajar oleh dosen ini? */
function ownsCourse(dosenId, courseId) {
  return !!get('SELECT id FROM courses WHERE id = ? AND dosen_id = ?', [courseId, dosenId]);
}

module.exports = { enrolledCourses, isEnrolled, ownsCourse };
