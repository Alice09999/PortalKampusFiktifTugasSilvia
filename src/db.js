'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

/** Buka (dan buat jika belum ada) file database. */
function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

const db = open(config.DB_PATH);
const labDb = open(config.LAB_DB_PATH);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  email         TEXT,
  identity_no   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS courses (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  code     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  credits  INTEGER NOT NULL DEFAULT 3,
  semester TEXT NOT NULL,
  dosen_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS enrollments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  due_date    TEXT,
  max_score   REAL NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path    TEXT,
  file_name    TEXT,
  file_size    INTEGER,
  note         TEXT,
  submitted_at TEXT,
  score        REAL,
  feedback     TEXT,
  graded_at    TEXT,
  graded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS grades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       REAL,
  grade_letter TEXT,
  updated_at  TEXT,
  UNIQUE (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS discussions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS discussion_replies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_enroll_course  ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enroll_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_assign_course  ON assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_sub_assign     ON submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_sub_student    ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_grade_student  ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_disc_course    ON discussions(course_id);
`;

/**
 * Basis data TERPISAH khusus laboratorium kerentanan.
 * Tidak ada relasi apa pun dengan data portal utama.
 */
const LAB_SCHEMA = `
CREATE TABLE IF NOT EXISTS lab_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL,
  email         TEXT
);

CREATE TABLE IF NOT EXISTS lab_login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL,
  success    INTEGER NOT NULL DEFAULT 0,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

function initSchema() {
  db.exec(SCHEMA);
  labDb.exec(LAB_SCHEMA);
}

initSchema();

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Huruf nilai dari skor 0-100. */
function gradeLetter(score) {
  if (score === null || score === undefined || score === '') return null;
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s >= 90) return 'A';
  if (s >= 80) return 'B';
  if (s >= 70) return 'C';
  if (s >= 60) return 'D';
  return 'E';
}

module.exports = { db, labDb, all, get, run, tx, initSchema, gradeLetter };
